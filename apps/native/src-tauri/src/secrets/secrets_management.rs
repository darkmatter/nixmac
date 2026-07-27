use crate::{
    shared_types::{RecipientKind, SecretBackend, SecretEntry, SecretRecipient, SecretsVault},
    system::nix::nix_command,
};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    path::{Path, PathBuf},
    process::Stdio,
};

/// Command to load the secrets state for the configured repo.
const LOAD_SECRET_IDENTITIES_APPLY: &str = r#"
cfg:
  let
    hostKeys = cfg.services.openssh.hostKeys or [];
    sopsPaths = cfg.sops.age.sshKeyPaths or [];
  in {
    hostKeys = map (key: {
      path = key.path;
      publicKeyPath = key.path + ".pub";
      type = key.type;
      usedBySops = builtins.elem key.path sopsPaths;
    }) hostKeys;

    otherSopsIdentities =
      builtins.filter
        (path:
          !(builtins.elem path (map (key: key.path) hostKeys)))
        sopsPaths;
  }
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretIdentities {
    #[serde(default)]
    host_keys: Vec<HostKey>,
    #[serde(default)]
    other_sops_identities: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostKey {
    path: String,
    public_key_path: String,
    #[serde(rename = "type")]
    key_type: String,
    used_by_sops: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum RecipientIdentity {
    Age(String),
    Ssh(String),
    Pgp(String),
}

#[derive(Debug, Default, Deserialize)]
struct SopsDocument {
    sops: Option<SopsMetadata>,
}

#[derive(Debug, Default, Deserialize)]
struct SopsMetadata {
    age: Option<Vec<SopsAgeRecipient>>,
    pgp: Option<Vec<SopsPgpRecipient>>,
    key_groups: Option<Vec<serde_yaml::Value>>,
    shamir_threshold: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SopsAgeRecipient {
    recipient: String,
}

#[derive(Debug, Deserialize)]
struct SopsPgpRecipient {
    fp: String,
}

type RecipientInventory = HashMap<PathBuf, HashSet<RecipientIdentity>>;

/// Decrypts a single secret from the configured repo, returning its plaintext value.
/// Use this carefully, as it exposes sensitive data. The decrypted value is not stored in the vault.
/// Don't send it to the agent or log it. Only use it for immediate display in the UI, and clear it from memory as soon as possible.
pub fn decrypt_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
) -> Result<String, String> {
    log::info!("Decrypting secret declaration {secret_id} from config dir {config_dir}");

    let mut matches = load_sops_secrets(host_attr, config_dir)?
        .into_iter()
        .chain(load_agenix_secrets(host_attr, config_dir)?)
        .filter(|secret| secret.id == secret_id);
    let secret = matches
        .next()
        .ok_or_else(|| format!("Secret declaration '{secret_id}' does not exist"))?;
    if matches.next().is_some() {
        return Err(format!(
            "Secret declaration '{secret_id}' is ambiguous across backends"
        ));
    }

    let secret_file_path = PathBuf::from(&secret.file);
    if !secret_file_path.exists() {
        return Err(format!(
            "Secret file {} does not exist",
            secret_file_path.display()
        ));
    }

    if secret.backend != SecretBackend::Sops {
        return Err("Decrypting Agenix secrets is not supported yet".to_string());
    }
    let sops_key = secret
        .sops_key
        .as_deref()
        .ok_or_else(|| format!("SOPS secret '{secret_id}' has no key"))?;

    let output = sops_decrypt_command(config_dir, &secret_file_path, sops_key)
        .output()
        .map_err(|e| format!("Failed to execute sops command: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "sops command failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let decrypted_value = String::from_utf8(output.stdout)
        .map_err(|e| format!("sops returned invalid UTF-8: {e}"))?;

    Ok(decrypted_value)
}

fn sops_decrypt_command(
    config_dir: &str,
    secret_file_path: &Path,
    sops_key: &str,
) -> std::process::Command {
    let extract_path = sops_extract_path(sops_key);
    let mut command = nix_command(config_dir);
    command
        .args([
            "shell",
            "nixpkgs#sops",
            "-c",
            "sops",
            "--decrypt",
            "--extract",
            &extract_path,
            "--output-type",
            "binary",
        ])
        .arg(secret_file_path);
    command
}

fn sops_extract_path(sops_key: &str) -> String {
    sops_key
        .split('/')
        .map(|part| {
            format!(
                "[{}]",
                serde_json::to_string(part).expect("serializing a string cannot fail")
            )
        })
        .collect()
}

/// Main entry point to load the secrets state for the configured repo. This is called from the Tauri command handler.
pub fn load_secrets_vault(host_attr: &str, config_dir: &str) -> Result<SecretsVault, String> {
    log::info!("Loading secrets state for host {host_attr} from config dir {config_dir}");

    // TODO: Preserve backend/load failures as non-fatal diagnostics on SecretsVault
    // instead of silently defaulting to empty vectors. The UI cannot currently
    // distinguish "no secrets" from "failed to load secrets".
    let sops_secrets = load_sops_secrets(host_attr, config_dir).unwrap_or_default();
    let agenix_secrets = load_agenix_secrets(host_attr, config_dir).unwrap_or_default();
    let mut entries = sops_secrets;
    entries.extend(agenix_secrets);

    let recipients = load_recipients(host_attr, config_dir).unwrap_or_default();

    apply_recipients_to_secrets(&mut entries, &recipients)?;

    Ok(SecretsVault {
        host_id: host_attr.to_string(),
        entries,
        recipients,
    })
}

/// Apply the known recipients to the secret entries, populating the recipient_ids field of each entry.
/// This is used to determine which recipients can decrypt which secrets.
fn apply_recipients_to_secrets(
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
) -> Result<(), String> {
    // TODO: The current agenix eval exposes only cfg.age.secrets.<name>.file. It does
    // not expose the recipients from the agenix rules inventory, and those
    // recipients cannot be inferred from .age ciphertext. Keep the inventory
    // empty until rules evaluation can supply exact public identities.
    let agenix_inventory = RecipientInventory::new();
    apply_recipients_to_secrets_with(
        entries,
        recipients,
        &agenix_inventory,
        parse_sops_recipient_metadata,
    )
}

/// Apply the known recipients to the secret entries, populating the recipient_ids field of each entry.
fn apply_recipients_to_secrets_with<F>(
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
    agenix_inventory: &RecipientInventory,
    mut load_sops_metadata: F,
) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<HashSet<RecipientIdentity>, String>,
{
    let known_recipients: Vec<(&str, HashSet<RecipientIdentity>)> = recipients
        .iter()
        .map(|recipient| (recipient.id.as_str(), identities_for_recipient(recipient)))
        .collect();
    let all_known_identities: HashSet<RecipientIdentity> = known_recipients
        .iter()
        .flat_map(|(_, identities)| identities.iter().cloned())
        .collect();
    let mut sops_cache: HashMap<PathBuf, HashSet<RecipientIdentity>> = HashMap::new();

    for entry in entries {
        let source_file = PathBuf::from(&entry.file);
        let encrypted_for = match entry.backend {
            SecretBackend::Sops => {
                if !sops_cache.contains_key(&source_file) {
                    let identities = load_sops_metadata(&source_file)?;
                    sops_cache.insert(source_file.clone(), identities);
                }
                sops_cache.get(&source_file).cloned().unwrap_or_default()
            }
            SecretBackend::Agenix => agenix_inventory
                .get(&source_file)
                .cloned()
                .unwrap_or_default(),
        };

        entry.recipient_ids = known_recipients
            .iter()
            .filter(|(_, identities)| !identities.is_disjoint(&encrypted_for))
            .map(|(id, _)| (*id).to_string())
            .collect();
        entry.recipient_ids.sort();
        entry.recipient_ids.dedup();

        let unknown_count = encrypted_for.difference(&all_known_identities).count();
        if unknown_count > 0 {
            // SecretEntry has no diagnostics field yet. Preserve a count-only
            // diagnostic without logging public identifiers or encrypted data.
            log::debug!(
                "Encrypted secret source {} has {unknown_count} unknown public recipient(s)",
                source_file.display()
            );
        }
    }

    Ok(())
}

/// Parse the SOPS metadata from the given source file and return the set of public recipient identities that can decrypt it.
fn parse_sops_recipient_metadata(source_file: &Path) -> Result<HashSet<RecipientIdentity>, String> {
    let file = File::open(source_file).map_err(|error| {
        format!(
            "Failed to open SOPS metadata file {}: {error}",
            source_file.display()
        )
    })?;
    let document: SopsDocument = serde_yaml::from_reader(file).map_err(|error| {
        format!(
            "Failed to parse SOPS metadata in {}: {error}",
            source_file.display()
        )
    })?;
    let metadata = document.sops.ok_or_else(|| {
        format!(
            "Missing SOPS metadata in encrypted file {}",
            source_file.display()
        )
    })?;

    if metadata
        .key_groups
        .as_ref()
        .is_some_and(|groups| !groups.is_empty())
        || metadata
            .shamir_threshold
            .is_some_and(|threshold| threshold > 1)
    {
        // TODO: Implement key-group/Shamir-aware recipient inference for SOPS by
        // evaluating groups as access policies instead of flattening to a simple
        // union. Until then, recipient mapping for these files remains unknown.
        log::warn!(
            "SOPS recipient access is unknown for {} because key-group/Shamir metadata is unsupported",
            source_file.display()
        );
        return Err(format!(
            "Unsupported SOPS key-group/Shamir metadata in {}; recipient access is unknown",
            source_file.display()
        ));
    }

    let mut identities = HashSet::new();
    for recipient in metadata.age.unwrap_or_default() {
        if let Some(identity) = normalize_age_or_ssh_identity(&recipient.recipient) {
            identities.insert(identity);
        }
    }
    for recipient in metadata.pgp.unwrap_or_default() {
        if let Some(fingerprint) = normalize_pgp_fingerprint(&recipient.fp) {
            identities.insert(RecipientIdentity::Pgp(fingerprint));
        }
    }

    Ok(identities)
}

/// Return the set of public recipient identities that can decrypt secrets for the given recipient.
fn identities_for_recipient(recipient: &SecretRecipient) -> HashSet<RecipientIdentity> {
    let mut identities = HashSet::new();
    let public_key = recipient.public_key.trim();
    let mut fields = public_key.split_whitespace();
    let key_type = fields.next().unwrap_or_default();
    if is_ssh_key_type(key_type) {
        if let Some(key_data) = fields.next() {
            identities.insert(RecipientIdentity::Ssh(format!("{key_type} {key_data}")));
        }
    } else if let Some(fingerprint) = normalize_pgp_fingerprint(public_key) {
        identities.insert(RecipientIdentity::Pgp(fingerprint));
    } else if !public_key.is_empty() {
        // Host SSH keys discovered by load_recipients are converted with
        // ssh-to-age before being stored here, so native age recipients match
        // the derived public identity rather than the original SSH string.
        identities.insert(RecipientIdentity::Age(public_key.to_string()));
    }
    identities
}

/// Normalize an age or SSH public identity string into a RecipientIdentity.
fn normalize_age_or_ssh_identity(value: &str) -> Option<RecipientIdentity> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut fields = trimmed.split_whitespace();
    let key_type = fields.next()?;
    if is_ssh_key_type(key_type) {
        let key_data = fields.next()?;
        return Some(RecipientIdentity::Ssh(format!("{key_type} {key_data}")));
    }

    Some(RecipientIdentity::Age(trimmed.to_string()))
}

fn is_ssh_key_type(value: &str) -> bool {
    value.starts_with("ssh-") || value.starts_with("ecdsa-") || value.starts_with("sk-ssh-")
}

fn normalize_pgp_fingerprint(value: &str) -> Option<String> {
    let fingerprint = value.trim();
    if fingerprint.len() < 16 || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(fingerprint.to_ascii_uppercase())
}

/// Load the recipients from the nix config repo by executing a nix eval to evaluate the identities used by SOPS.
fn load_recipients(host_attr: &str, config_dir: &str) -> Result<Vec<SecretRecipient>, String> {
    let identities = load_secret_identities(host_attr, config_dir)?;
    materialize_recipients(
        host_attr,
        &identities,
        |public_key_path| ssh_public_key_to_age(public_key_path, config_dir),
        |public_key_path| ssh_public_key_fingerprint(public_key_path, config_dir),
    )
}

/// Turn the evaluated SOPS SSH identity paths into public recipients.
///
/// `sops.age.sshKeyPaths` contains private-key paths. Only the corresponding
/// `.pub` files are opened here; private key material never enters the vault.
fn materialize_recipients<Convert, Fingerprint>(
    host_attr: &str,
    identities: &SecretIdentities,
    mut convert_to_age: Convert,
    mut fingerprint: Fingerprint,
) -> Result<Vec<SecretRecipient>, String>
where
    Convert: FnMut(&str) -> Result<String, String>,
    Fingerprint: FnMut(&str) -> Option<String>,
{
    let used_host_keys: Vec<&HostKey> = identities
        .host_keys
        .iter()
        .filter(|key| key.used_by_sops)
        .collect();
    if used_host_keys.is_empty() && identities.other_sops_identities.is_empty() {
        log::debug!("No OpenSSH identities are used by sops for host {host_attr}");
        return Ok(Vec::new());
    }

    let mut recipients = Vec::new();
    let mut public_keys = HashSet::new();
    let mut recipient_ids = HashSet::new();

    for (index, host_key) in used_host_keys.into_iter().enumerate() {
        log::debug!(
            "Converting sops SSH host identity {} using public key {}",
            host_key.path,
            host_key.public_key_path
        );
        let age_public_key = convert_to_age(&host_key.public_key_path)?;
        if !public_keys.insert(age_public_key.clone()) {
            continue;
        }

        // Keep the first host key addressable through SecretsVault.host_id.
        // Additional host keys get stable, collision-safe ids of their own.
        let id_base = if index == 0 {
            host_attr.to_string()
        } else {
            format!("{host_attr}-{}", host_key.key_type)
        };
        let id = unique_recipient_id(&id_base, &mut recipient_ids);
        let key_fingerprint = fingerprint(&host_key.public_key_path).unwrap_or_default();
        recipients.push(recipient(
            &id,
            host_attr,
            RecipientKind::Host,
            &format!("This Mac · {}", host_key.key_type),
            &age_public_key,
            &key_fingerprint,
            true,
            true,
        ));
    }

    for identity_path in &identities.other_sops_identities {
        let public_key_path = format!("{identity_path}.pub");
        log::debug!("Converting non-host sops SSH identity using public key {public_key_path}");
        let age_public_key = convert_to_age(&public_key_path)?;
        if !public_keys.insert(age_public_key.clone()) {
            continue;
        }

        let label = Path::new(identity_path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("ssh-identity");
        let id = unique_recipient_id(label, &mut recipient_ids);
        let key_fingerprint = fingerprint(&public_key_path).unwrap_or_default();
        recipients.push(recipient(
            &id,
            label,
            RecipientKind::User,
            "SSH identity · ssh-to-age",
            &age_public_key,
            &key_fingerprint,
            true,
            false,
        ));
    }

    Ok(recipients)
}

fn unique_recipient_id(base: &str, used_ids: &mut HashSet<String>) -> String {
    let id = base.trim();
    let id = if id.is_empty() {
        "recipient".to_string()
    } else {
        id.to_string()
    };

    if used_ids.insert(id.clone()) {
        return id;
    }

    for suffix in 2.. {
        let candidate = format!("{id}-{suffix}");
        if used_ids.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("an unused numeric recipient suffix always exists")
}

/// Load secrets from the sops backend by executing a nix eval to evaluate the secrets in the repo.
fn load_sops_secrets(host_attr: &str, config_dir: &str) -> Result<Vec<SecretEntry>, String> {
    let secrets_map = eval_backend_secrets_map(
        host_attr,
        config_dir,
        "sops",
        format!(
            r#"
            let
                cfg = (builtins.getFlake (toString ./.)).darwinConfigurations.{host_attr}.config;
            in
                if cfg ? sops && cfg.sops ? secrets then
                    builtins.mapAttrs (_: secret: {{
                        file = toString secret.sopsFile;
                        key = secret.key;
                    }}) cfg.sops.secrets
                else
                    {{}}
            "#
        ),
    )?;

    secrets_map
        .iter()
        .map(|(id, secret_value)| {
            let file = required_secret_field(secret_value, id, "file", "sops")?;
            let key = required_secret_field(secret_value, id, "key", "sops")?;
            Ok(secret(id, id, SecretBackend::Sops, file, Some(key)))
        })
        .collect::<Result<Vec<_>, String>>()
}

/// Load secrets from the agenix backend by executing a nix eval to evaluate the secrets in the repo.
fn load_agenix_secrets(host_attr: &str, config_dir: &str) -> Result<Vec<SecretEntry>, String> {
    let secrets_map = eval_backend_secrets_map(
        host_attr,
        config_dir,
        "agenix",
        format!(
            r#"
            let
                cfg = (builtins.getFlake (toString ./.)).darwinConfigurations.{host_attr}.config;
            in
                if cfg ? age && cfg.age ? secrets then
                    builtins.mapAttrs (_: secret: {{
                        file = toString secret.file;
                    }}) cfg.age.secrets
                else
                    {{}}
            "#
        ),
    )?;

    secrets_map
        .iter()
        .map(|(id, secret_value)| {
            let file = required_secret_field(secret_value, id, "file", "agenix")?;
            Ok(secret(id, id, SecretBackend::Agenix, file, None))
        })
        .collect::<Result<Vec<_>, String>>()
}

/// Helper function to evaluate a nix secrets-loading expression and return the resulting JSON object as a map.
fn eval_backend_secrets_map(
    host_attr: &str,
    config_dir: &str,
    backend_name: &str,
    expression: String,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    log::debug!("Loading {backend_name} secrets for host {host_attr} from config dir {config_dir}");
    let output = nix_command(config_dir)
        .args(["eval", "--json", "--impure", "--expr", &expression])
        .output()
        .map_err(|e| format!("Failed to execute {backend_name} secrets nix command: {e}"))?;

    if !output.status.success() {
        log::error!(
            "{backend_name} secrets nix command failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        return Err(format!(
            "{backend_name} secrets nix command failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let secrets_map: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse {backend_name} secrets nix command output: {e}"))?;

    let secrets_map = secrets_map
        .as_object()
        .ok_or_else(|| format!("{backend_name} secrets nix command output is not a JSON object"))?
        .clone();

    log::debug!("Loaded {} {backend_name} secrets", secrets_map.len());

    Ok(secrets_map)
}

fn required_secret_field<'a>(
    secret_value: &'a serde_json::Value,
    id: &str,
    field_name: &str,
    backend_name: &str,
) -> Result<&'a str, String> {
    secret_value
        .get(field_name)
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("{backend_name} secret {id} is missing '{field_name}' field"))
}

/// Load the secret identities from the nix config repo by executing a nix eval to evaluate the identities in the repo.
/// This is used to determine which SSH host key is used by sops, and to convert it to an age public key for use in the secrets vault.
fn load_secret_identities(host_attr: &str, config_dir: &str) -> Result<SecretIdentities, String> {
    let host_attr = serde_json::to_string(host_attr)
        .map_err(|e| format!("Failed to encode host attribute: {e}"))?;
    let flake_attr = format!(".#darwinConfigurations.{host_attr}.config");

    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            &flake_attr,
            "--apply",
            LOAD_SECRET_IDENTITIES_APPLY,
        ])
        .output()
        .map_err(|e| format!("Failed to evaluate secret identities: {e}"))?;

    if !output.status.success() {
        log::error!(
            "Secret identities nix eval failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        return Err(format!(
            "Secret identities nix eval failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse secret identities nix eval output: {e}"))
}

/// Convert an OpenSSH public key to an age public key using the ssh-to-age tool from nixpkgs.
/// This is used to convert the SSH host key used by sops to an age public key for use in the secrets vault.
fn ssh_public_key_to_age(public_key_path: &str, config_dir: &str) -> Result<String, String> {
    let public_key = File::open(public_key_path)
        .map_err(|e| format!("Failed to open SSH public key {public_key_path}: {e}"))?;
    let output = nix_command(config_dir)
        .args(["shell", "nixpkgs#ssh-to-age", "-c", "ssh-to-age"])
        .stdin(Stdio::from(public_key))
        .output()
        .map_err(|e| format!("Failed to execute ssh-to-age for {public_key_path}: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ssh-to-age failed for {public_key_path} with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let age_public_key = String::from_utf8(output.stdout)
        .map_err(|e| format!("ssh-to-age returned invalid UTF-8 for {public_key_path}: {e}"))?
        .trim()
        .to_string();
    if age_public_key.is_empty() {
        return Err(format!(
            "ssh-to-age returned an empty recipient for {public_key_path}"
        ));
    }

    Ok(age_public_key)
}

/// Calculate the fingerprint of an OpenSSH public key using ssh-keygen.
/// This is used to display the fingerprint of the SSH host key used by sops in the secrets vault.
fn ssh_public_key_fingerprint(public_key_path: &str, config_dir: &str) -> Option<String> {
    let output = std::process::Command::new("ssh-keygen")
        .args(["-lf", public_key_path, "-E", "sha256"])
        .env("PATH", crate::system::nix::get_nix_path())
        .current_dir(config_dir)
        .output()
        .ok()?;
    if !output.status.success() {
        log::debug!(
            "Failed to calculate SSH fingerprint for {public_key_path}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()?
        .split_whitespace()
        .nth(1)
        .map(str::to_string)
}

/// Factory function to create a SecretEntry with the given parameters.
fn secret(
    id: &str,
    name: &str,
    backend: SecretBackend,
    file: &str,
    sops_key: Option<&str>,
) -> SecretEntry {
    SecretEntry {
        id: id.into(),
        name: name.into(),
        backend,
        file: file.into(),
        recipient_ids: Vec::new(),
        sops_key: sops_key.map(Into::into),
    }
}

/// Factory function to create a SecretRecipient with the given parameters.
#[allow(clippy::too_many_arguments)]
fn recipient(
    id: &str,
    label: &str,
    kind: RecipientKind,
    device: &str,
    public_key: &str,
    fingerprint: &str,
    in_use: bool,
    is_this_host: bool,
) -> SecretRecipient {
    SecretRecipient {
        id: id.into(),
        label: label.into(),
        kind,
        device: device.into(),
        fingerprint: fingerprint.into(),
        public_key: public_key.into(),
        in_use,
        is_this_host,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        HostKey, RecipientIdentity, RecipientInventory, SecretIdentities,
        apply_recipients_to_secrets, apply_recipients_to_secrets_with, identities_for_recipient,
        materialize_recipients, normalize_age_or_ssh_identity, parse_sops_recipient_metadata,
        recipient, secret, sops_decrypt_command, sops_extract_path,
    };
    use crate::shared_types::{RecipientKind, SecretBackend};
    use std::{collections::HashSet, ffi::OsStr, fs, path::Path};
    use tempfile::TempDir;

    fn known_recipient(id: &str, public_key: &str) -> crate::shared_types::SecretRecipient {
        recipient(
            id,
            id,
            RecipientKind::Host,
            "test",
            public_key,
            "",
            true,
            false,
        )
    }

    fn write_sops_file(dir: &TempDir, name: &str, recipients: &[&str]) -> String {
        let path = dir.path().join(name);
        let age_metadata = recipients
            .iter()
            .map(|recipient| format!("    - recipient: {recipient}\n"))
            .collect::<String>();
        fs::write(
            &path,
            format!("value: ENC[AES256_GCM,data:test]\nsops:\n  age:\n{age_metadata}"),
        )
        .expect("write SOPS fixture");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn decrypt_invokes_sops_for_only_the_requested_key() {
        let command = sops_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/a secret.yaml"),
            "nested/value",
        );
        let args: Vec<&OsStr> = command.get_args().collect();

        assert_eq!(
            args,
            [
                OsStr::new("shell"),
                OsStr::new("nixpkgs#sops"),
                OsStr::new("-c"),
                OsStr::new("sops"),
                OsStr::new("--decrypt"),
                OsStr::new("--extract"),
                OsStr::new("[\"nested\"][\"value\"]"),
                OsStr::new("--output-type"),
                OsStr::new("binary"),
                OsStr::new("/tmp/a secret.yaml"),
            ]
        );
    }

    #[test]
    fn sops_extract_path_escapes_key_segments() {
        assert_eq!(
            sops_extract_path(r#"nested/a"key"#),
            r#"["nested"]["a\"key"]"#
        );
    }

    #[test]
    fn parses_secret_identity_projection() {
        let identities: SecretIdentities = serde_json::from_str(
            r#"{
                "hostKeys": [{
                    "path": "/etc/ssh/ssh_host_ed25519_key",
                    "publicKeyPath": "/etc/ssh/ssh_host_ed25519_key.pub",
                    "type": "ed25519",
                    "usedBySops": true
                }],
                "otherSopsIdentities": ["/Users/test/.config/sops/age/keys.txt"]
            }"#,
        )
        .expect("identity projection should deserialize");

        assert_eq!(identities.host_keys.len(), 1);
        assert!(identities.host_keys[0].used_by_sops);
        assert_eq!(
            identities.host_keys[0].public_key_path,
            "/etc/ssh/ssh_host_ed25519_key.pub"
        );
        assert_eq!(identities.other_sops_identities.len(), 1);
    }

    #[test]
    fn missing_identity_lists_default_to_empty() {
        let identities: SecretIdentities =
            serde_json::from_str("{}").expect("empty projection should deserialize");

        assert!(identities.host_keys.is_empty());
        assert!(identities.other_sops_identities.is_empty());
    }

    #[test]
    fn materializes_every_sops_ssh_identity_without_reading_private_keys() {
        let identities = SecretIdentities {
            host_keys: vec![
                HostKey {
                    path: "/etc/ssh/ssh_host_ed25519_key".to_string(),
                    public_key_path: "/etc/ssh/ssh_host_ed25519_key.pub".to_string(),
                    key_type: "ed25519".to_string(),
                    used_by_sops: true,
                },
                HostKey {
                    path: "/etc/ssh/unused".to_string(),
                    public_key_path: "/etc/ssh/unused.pub".to_string(),
                    key_type: "rsa".to_string(),
                    used_by_sops: false,
                },
            ],
            other_sops_identities: vec![
                "/Users/test/.ssh/id_ed25519".to_string(),
                "/Users/test/work/id_ed25519".to_string(),
            ],
        };
        let mut converted_paths = Vec::new();

        let recipients = materialize_recipients(
            "Test-Mac",
            &identities,
            |path| {
                converted_paths.push(path.to_string());
                Ok(format!("age1-{path}"))
            },
            |path| Some(format!("fingerprint-{path}")),
        )
        .expect("materialize recipients");

        assert_eq!(
            converted_paths,
            [
                "/etc/ssh/ssh_host_ed25519_key.pub",
                "/Users/test/.ssh/id_ed25519.pub",
                "/Users/test/work/id_ed25519.pub",
            ]
        );
        assert_eq!(recipients.len(), 3);
        assert_eq!(recipients[0].id, "Test-Mac");
        assert_eq!(recipients[0].kind, RecipientKind::Host);
        assert!(recipients[0].is_this_host);
        assert_eq!(recipients[1].id, "id_ed25519");
        assert_eq!(recipients[2].id, "id_ed25519-2");
        assert_eq!(recipients[1].kind, RecipientKind::User);
        assert!(!recipients[1].is_this_host);
        assert_eq!(
            recipients[1].fingerprint,
            "fingerprint-/Users/test/.ssh/id_ed25519.pub"
        );
    }

    #[test]
    fn duplicate_public_identities_are_only_materialized_once() {
        let identities = SecretIdentities {
            host_keys: vec![HostKey {
                path: "/etc/ssh/host".to_string(),
                public_key_path: "/etc/ssh/host.pub".to_string(),
                key_type: "ed25519".to_string(),
                used_by_sops: true,
            }],
            other_sops_identities: vec!["/Users/test/.ssh/same-key".to_string()],
        };

        let recipients = materialize_recipients(
            "test-host",
            &identities,
            |_path| Ok("age1same".to_string()),
            |_path| None,
        )
        .expect("materialize recipients");

        assert_eq!(recipients.len(), 1);
        assert_eq!(recipients[0].id, "test-host");
    }

    #[test]
    fn different_sops_files_match_different_recipients() {
        let dir = TempDir::new().expect("temp dir");
        let alice_file = write_sops_file(&dir, "alice.yaml", &["age1alice"]);
        let bob_file = write_sops_file(&dir, "bob.yaml", &["age1bob"]);
        let mut entries = vec![
            secret(
                "alice-secret",
                "alice-secret",
                SecretBackend::Sops,
                &alice_file,
                Some("value"),
            ),
            secret(
                "bob-secret",
                "bob-secret",
                SecretBackend::Sops,
                &bob_file,
                Some("value"),
            ),
        ];
        let recipients = vec![
            known_recipient("alice", "age1alice"),
            known_recipient("bob", "age1bob"),
        ];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["alice"]);
        assert_eq!(entries[1].recipient_ids, ["bob"]);
    }

    #[test]
    fn sops_file_encrypted_for_two_known_recipients_gets_both_ids() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "shared.yaml", &["age1bob", "age1alice"]);
        let mut entries = vec![secret(
            "shared",
            "shared",
            SecretBackend::Sops,
            &file,
            Some("value"),
        )];
        let recipients = vec![
            known_recipient("bob", "age1bob"),
            known_recipient("alice", "age1alice"),
        ];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["alice", "bob"]);
    }

    #[test]
    fn shared_sops_file_is_loaded_once_for_all_declarations() {
        let mut entries = vec![
            secret(
                "first",
                "first",
                SecretBackend::Sops,
                "/repo/shared.yaml",
                Some("first"),
            ),
            secret(
                "second",
                "second",
                SecretBackend::Sops,
                "/repo/shared.yaml",
                Some("second"),
            ),
        ];
        let recipients = vec![known_recipient("alice", "age1alice")];
        let mut load_count = 0;

        apply_recipients_to_secrets_with(
            &mut entries,
            &recipients,
            &RecipientInventory::new(),
            |_path| {
                load_count += 1;
                Ok(HashSet::from([RecipientIdentity::Age(
                    "age1alice".to_string(),
                )]))
            },
        )
        .expect("match recipients");

        assert_eq!(load_count, 1);
        assert_eq!(entries[0].recipient_ids, ["alice"]);
        assert_eq!(entries[1].recipient_ids, ["alice"]);
    }

    #[test]
    fn duplicate_known_recipients_produce_one_id() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "duplicate.yaml", &["age1alice", "age1alice"]);
        let mut entries = vec![secret(
            "duplicate",
            "duplicate",
            SecretBackend::Sops,
            &file,
            Some("value"),
        )];
        let recipients = vec![
            known_recipient("alice", "age1alice"),
            known_recipient("alice", "age1alice"),
        ];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["alice"]);
    }

    #[test]
    fn unknown_sops_recipient_does_not_match_known_recipients() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "unknown.yaml", &["age1unknown"]);
        let mut entries = vec![secret(
            "unknown",
            "unknown",
            SecretBackend::Sops,
            &file,
            Some("value"),
        )];
        let recipients = vec![
            known_recipient("alice", "age1alice"),
            known_recipient("bob", "age1bob"),
        ];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert!(entries[0].recipient_ids.is_empty());
    }

    #[test]
    fn ssh_public_key_comments_are_ignored() {
        let first =
            normalize_age_or_ssh_identity("ssh-ed25519 AAAAC3NzaFirst first-comment").unwrap();
        let second =
            normalize_age_or_ssh_identity("ssh-ed25519 AAAAC3NzaFirst different-comment").unwrap();

        assert_eq!(first, second);
        assert_eq!(
            first,
            RecipientIdentity::Ssh("ssh-ed25519 AAAAC3NzaFirst".to_string())
        );
    }

    #[test]
    fn missing_or_malformed_sops_metadata_has_filename_context() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("missing.yaml");
        fs::write(&missing, "value: ENC[AES256_GCM,data:test]\n").expect("write missing fixture");
        let missing_error =
            parse_sops_recipient_metadata(&missing).expect_err("missing metadata should fail");
        assert!(missing_error.contains("Missing SOPS metadata"));
        assert!(missing_error.contains("missing.yaml"));

        let malformed = dir.path().join("malformed.yaml");
        fs::write(&malformed, "sops:\n  age: [").expect("write malformed fixture");
        let malformed_error =
            parse_sops_recipient_metadata(&malformed).expect_err("malformed metadata should fail");
        assert!(malformed_error.contains("Failed to parse SOPS metadata"));
        assert!(malformed_error.contains("malformed.yaml"));
    }

    #[test]
    fn missing_sops_file_has_filename_context() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("does-not-exist.yaml");

        let error = parse_sops_recipient_metadata(&missing)
            .expect_err("missing file should report an open failure");

        assert!(error.contains("Failed to open SOPS metadata file"));
        assert!(error.contains("does-not-exist.yaml"));
    }

    #[test]
    fn sops_key_groups_are_reported_as_unsupported() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("key-groups.yaml");
        fs::write(
            &file,
            "value: ENC[AES256_GCM,data:test]\nsops:\n  shamir_threshold: 2\n  key_groups:\n    - age:\n        - recipient: age1alice\n",
        )
        .expect("write key-group fixture");

        let error =
            parse_sops_recipient_metadata(&file).expect_err("key groups must not be flattened");

        assert!(error.contains("Unsupported SOPS key-group/Shamir metadata"));
        assert!(error.contains("key-groups.yaml"));
    }

    #[test]
    fn missing_agenix_inventory_leaves_recipient_ids_empty() {
        let mut entries = vec![secret(
            "agenix-secret",
            "agenix-secret",
            SecretBackend::Agenix,
            "/repo/secrets/secret.age",
            None,
        )];
        let recipients = vec![known_recipient("alice", "age1alice")];

        apply_recipients_to_secrets_with(
            &mut entries,
            &recipients,
            &RecipientInventory::new(),
            |_path: &Path| panic!("SOPS metadata loader must not run for agenix entries"),
        )
        .expect("missing agenix inventory is not an error");

        assert!(entries[0].recipient_ids.is_empty());
    }

    #[test]
    fn agenix_inventory_matches_known_recipients() {
        let mut entries = vec![secret(
            "agenix-secret",
            "agenix-secret",
            SecretBackend::Agenix,
            "/repo/secrets/secret.age",
            None,
        )];
        let recipients = vec![
            known_recipient("alice", "age1alice"),
            known_recipient("bob", "age1bob"),
        ];
        let mut agenix_inventory = RecipientInventory::new();
        agenix_inventory.insert(
            std::path::PathBuf::from("/repo/secrets/secret.age"),
            HashSet::from([RecipientIdentity::Age("age1alice".to_string())]),
        );

        apply_recipients_to_secrets_with(
            &mut entries,
            &recipients,
            &agenix_inventory,
            |_path: &Path| panic!("SOPS metadata loader must not run for agenix entries"),
        )
        .expect("agenix inventory should be applied");

        assert_eq!(entries[0].recipient_ids, ["alice"]);
    }

    #[test]
    fn sops_metadata_loader_error_is_propagated() {
        let mut entries = vec![secret(
            "sops-secret",
            "sops-secret",
            SecretBackend::Sops,
            "/repo/secrets/secret.yaml",
            Some("value"),
        )];
        let recipients = vec![known_recipient("alice", "age1alice")];

        let error = apply_recipients_to_secrets_with(
            &mut entries,
            &recipients,
            &RecipientInventory::new(),
            |_path| Err("fixture loader failed".to_string()),
        )
        .expect_err("loader failure should be returned");

        assert!(error.contains("fixture loader failed"));
    }

    #[test]
    fn recipient_matching_preserves_existing_secret_inventory_fields() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "preserved.yaml", &["age1alice"]);
        let mut entries = vec![secret(
            "secret-id",
            "secret-name",
            SecretBackend::Sops,
            &file,
            Some("nested/key"),
        )];
        let recipients = vec![known_recipient("alice", "age1alice")];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert_eq!(entries[0].id, "secret-id");
        assert_eq!(entries[0].name, "secret-name");
        assert_eq!(entries[0].backend, SecretBackend::Sops);
        assert_eq!(entries[0].file, file);
        assert_eq!(entries[0].sops_key.as_deref(), Some("nested/key"));
    }

    #[test]
    fn pgp_fingerprints_match_case_insensitively() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("pgp.yaml");
        fs::write(
            &file,
            "value: ENC[AES256_GCM,data:test]\nsops:\n  pgp:\n    - fp: abcdef0123456789abcdef0123456789abcdef01\n",
        )
        .expect("write PGP fixture");
        let mut entries = vec![secret(
            "pgp",
            "pgp",
            SecretBackend::Sops,
            &file.to_string_lossy(),
            Some("value"),
        )];
        let recipients = vec![known_recipient(
            "pgp-recipient",
            "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        )];

        apply_recipients_to_secrets(&mut entries, &recipients).expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["pgp-recipient"]);
    }

    #[test]
    fn identities_for_recipient_handles_ssh_pgp_age_and_empty_values() {
        let ssh = identities_for_recipient(&known_recipient(
            "ssh",
            "ssh-ed25519 AAAAC3NzaSshData trailing-comment",
        ));
        assert_eq!(
            ssh,
            HashSet::from([RecipientIdentity::Ssh(
                "ssh-ed25519 AAAAC3NzaSshData".to_string()
            )])
        );

        let pgp = identities_for_recipient(&known_recipient(
            "pgp",
            "abcdef0123456789abcdef0123456789abcdef01",
        ));
        assert_eq!(
            pgp,
            HashSet::from([RecipientIdentity::Pgp(
                "ABCDEF0123456789ABCDEF0123456789ABCDEF01".to_string()
            )])
        );

        let age = identities_for_recipient(&known_recipient("age", " age1recipient "));
        assert_eq!(
            age,
            HashSet::from([RecipientIdentity::Age("age1recipient".to_string())])
        );

        let empty = identities_for_recipient(&known_recipient("empty", "   "));
        assert!(empty.is_empty());
    }

    #[test]
    fn normalize_age_or_ssh_identity_handles_empty_and_age_values() {
        assert_eq!(normalize_age_or_ssh_identity("\n\t "), None);
        assert_eq!(
            normalize_age_or_ssh_identity(" age1trimmed "),
            Some(RecipientIdentity::Age("age1trimmed".to_string()))
        );
    }

    #[test]
    fn shamir_threshold_of_one_is_supported_without_key_groups() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("shamir-one.yaml");
        fs::write(
            &file,
            "value: ENC[AES256_GCM,data:test]\nsops:\n  shamir_threshold: 1\n  age:\n    - recipient: age1alice\n",
        )
        .expect("write shamir fixture");

        let recipients = parse_sops_recipient_metadata(&file)
            .expect("shamir threshold one should remain supported");

        assert_eq!(
            recipients,
            HashSet::from([RecipientIdentity::Age("age1alice".to_string())])
        );
    }
}
