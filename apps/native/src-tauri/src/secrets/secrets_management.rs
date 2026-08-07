use crate::{
    secrets::{
        recipients::{
            apply_recipients_to_secrets_with_identities, load_recipients,
            recipient_has_local_identity,
        },
        resolve_secret_file_path,
    },
    shared_types::{
        DecryptionIdentity, DecryptionIdentityKind, SecretBackend, SecretEntry, SecretsVault,
    },
    system::nix::nix_command,
    utils::nix_string_literal,
};
use std::path::Path;

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
        // TODO(agenix-read): Make the reveal RPC backend-qualified (or give
        // entries opaque backend-qualified ids) so SOPS and agenix declarations
        // with the same name can both be addressed unambiguously.
        return Err(format!(
            "Secret declaration '{secret_id}' is ambiguous across backends"
        ));
    }

    let secret_file_path = resolve_secret_file_path(config_dir, &secret.file)?;

    if secret.backend != SecretBackend::Sops {
        // TODO(agenix-read): Resolve the repository's pinned agenix CLI and
        // classic rules file, evaluate `cfg.age.identityPaths`, and pass the
        // available identities explicitly with `--identity` while decrypting
        // this file to stdout with `agenix --decrypt`. Keep plaintext in the
        // existing explicit reveal response only: never command arguments,
        // logs, diffs, or temporary files. Define whether non-UTF-8 output is
        // supported before returning through this String-valued RPC.
        return Err("Decrypting Agenix secrets is not supported yet".to_string());
    }
    let sops_key = secret
        .sops_key
        .as_deref()
        .ok_or_else(|| format!("SOPS secret '{secret_id}' has no key"))?;

    // Use the same configured and ambient identities that determine the
    // vault's decryption capability. Keep a bare SOPS attempt as a fallback
    // for identity mechanisms we cannot currently inventory (for example
    // PGP, KMS, agents, and plugins).
    let (_, decryption_identities) = load_recipients(host_attr, config_dir)?;
    let attempts = decryption_identities
        .iter()
        .filter(|identity| identity.available)
        .map(Some)
        .chain(std::iter::once(None));
    let mut last_error = None;
    for identity in attempts {
        let output = sops_decrypt_command(config_dir, &secret_file_path, sops_key, identity)
            .output()
            .map_err(|e| format!("Failed to execute sops command: {e}"))?;
        if output.status.success() {
            return String::from_utf8(output.stdout)
                .map_err(|e| format!("sops returned invalid UTF-8: {e}"));
        }
        last_error = Some(format!(
            "sops command failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Err(last_error.unwrap_or_else(|| "sops decryption was not attempted".to_string()))
}

/// Construct a nix shell command to decrypt a SOPS secret file using the given key.
fn sops_decrypt_command(
    config_dir: &str,
    secret_file_path: &Path,
    sops_key: &str,
    identity: Option<&DecryptionIdentity>,
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
    if let Some(identity) = identity {
        match identity.kind {
            DecryptionIdentityKind::AgeKeyFile => {
                command.env("SOPS_AGE_KEY_FILE", &identity.path);
            }
            DecryptionIdentityKind::SshKeyPath => {
                command.env("SOPS_AGE_SSH_PRIVATE_KEY_FILE", &identity.path);
            }
        }
    }
    command
}

/// Convert a SOPS key path (e.g. `nested/value`) into a JSON pointer path for use with `sops --extract`.
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

/// Main entry point to load the secrets state for the configured repo.
pub fn load_secrets_vault(host_attr: &str, config_dir: &str) -> Result<SecretsVault, String> {
    log::info!("Loading secrets state for host {host_attr} from config dir {config_dir}");

    let mut entries = load_sops_secrets(host_attr, config_dir)?;
    entries.extend(load_agenix_secrets(host_attr, config_dir)?);

    let (recipients, decryption_identities) = load_recipients(host_attr, config_dir)?;
    apply_recipients_to_secrets_with_identities(
        config_dir,
        &mut entries,
        &recipients,
        &decryption_identities,
    )?;
    let primary_decryption_identity_id = recipients
        .iter()
        .find(|recipient| recipient_has_local_identity(recipient, &decryption_identities))
        .map(|recipient| recipient.id.clone());

    Ok(SecretsVault {
        primary_decryption_identity_id,
        entries,
        recipients,
        decryption_identities,
    })
}

/// Load the SOPS secrets from the nix config repo by executing a nix eval to evaluate the secrets in the repo.
fn load_sops_secrets(host_attr: &str, config_dir: &str) -> Result<Vec<SecretEntry>, String> {
    let safe_host_attr = nix_string_literal(host_attr);
    let secrets_map = eval_backend_secrets_map(
        host_attr,
        config_dir,
        "sops",
        format!(
            r#"
            let
                cfg = (builtins.getFlake (toString ./.)).darwinConfigurations.{safe_host_attr}.config;
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
        .collect()
}

/// Load the agenix secrets from the nix config repo by executing a nix eval to evaluate the secrets in the repo.
fn load_agenix_secrets(host_attr: &str, config_dir: &str) -> Result<Vec<SecretEntry>, String> {
    let safe_host_attr = nix_string_literal(host_attr);
    let secrets_map = eval_backend_secrets_map(
        host_attr,
        config_dir,
        "agenix",
        format!(
            r#"
            let
                cfg = (builtins.getFlake (toString ./.)).darwinConfigurations.{safe_host_attr}.config;
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
        .collect()
}

/// Evaluate a nix expression to load the secrets for a given backend into a map of secret ids to their attributes.
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

/// Helper function to extract a required field from a secret's JSON value, returning an error if the field is missing / not a string.
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

/// Factory function to construct a SecretEntry for a given secret declaration.
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
        public_recipients: Vec::new(),
        public_recipients_resolved: false,
        recipient_ids: Vec::new(),
        decryption_capability: Default::default(),
        sops_key: sops_key.map(Into::into),
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_secret_file_path, sops_decrypt_command, sops_extract_path};
    use crate::shared_types::{
        DecryptionIdentity, DecryptionIdentityKind, DecryptionIdentityLocality,
    };
    use std::{ffi::OsStr, fs, path::Path};
    use tempfile::TempDir;

    fn decryption_identity(kind: DecryptionIdentityKind, path: &str) -> DecryptionIdentity {
        DecryptionIdentity {
            kind,
            locality: DecryptionIdentityLocality::Configuration,
            path: path.to_string(),
            available: true,
            public_keys: Vec::new(),
        }
    }

    #[test]
    fn decrypt_invokes_sops_for_only_the_requested_key() {
        let identity = decryption_identity(DecryptionIdentityKind::AgeKeyFile, "/tmp/keys.txt");
        let command = sops_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/a secret.yaml"),
            "nested/value",
            Some(&identity),
        );
        let envs: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(
            envs.get(OsStr::new("SOPS_AGE_KEY_FILE")).copied().flatten(),
            Some(OsStr::new("/tmp/keys.txt"))
        );
        assert!(!envs.contains_key(OsStr::new("SOPS_AGE_SSH_PRIVATE_KEY_FILE")));
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
    fn decrypt_sets_only_the_selected_ssh_identity() {
        let identity = decryption_identity(DecryptionIdentityKind::SshKeyPath, "/tmp/id_ed25519");
        let command = sops_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/secret.yaml"),
            "value",
            Some(&identity),
        );
        let envs: std::collections::HashMap<_, _> = command.get_envs().collect();

        assert_eq!(
            envs.get(OsStr::new("SOPS_AGE_SSH_PRIVATE_KEY_FILE"))
                .copied()
                .flatten(),
            Some(OsStr::new("/tmp/id_ed25519"))
        );
        assert!(!envs.contains_key(OsStr::new("SOPS_AGE_KEY_FILE")));
    }

    #[test]
    fn decrypt_without_selected_identity_preserves_sops_lookup() {
        let command =
            sops_decrypt_command("/tmp/config", Path::new("/tmp/secret.yaml"), "value", None);
        let envs: std::collections::HashMap<_, _> = command.get_envs().collect();

        assert!(!envs.contains_key(OsStr::new("SOPS_AGE_KEY_FILE")));
        assert!(!envs.contains_key(OsStr::new("SOPS_AGE_SSH_PRIVATE_KEY_FILE")));
    }

    #[test]
    fn sops_extract_path_escapes_key_segments() {
        assert_eq!(
            sops_extract_path(r#"nested/a"key"#),
            r#"["nested"]["a\"key"]"#
        );
    }

    #[test]
    fn relative_secret_files_resolve_from_config_dir() {
        let config_dir = TempDir::new().expect("create config dir");
        fs::create_dir(config_dir.path().join("secrets")).expect("create secrets dir");
        fs::write(config_dir.path().join("secrets/example.yaml"), "encrypted")
            .expect("write secret");

        let resolved =
            resolve_secret_file_path(config_dir.path().to_str().unwrap(), "secrets/example.yaml")
                .expect("resolve secret");

        assert_eq!(
            resolved,
            config_dir
                .path()
                .join("secrets/example.yaml")
                .canonicalize()
                .unwrap()
        );
    }

    #[test]
    fn absolute_secret_files_remain_supported() {
        let config_dir = TempDir::new().expect("create config dir");
        let external_dir = TempDir::new().expect("create external dir");
        let secret_file = external_dir.path().join("example.yaml");
        fs::write(&secret_file, "encrypted").expect("write secret");

        let resolved = resolve_secret_file_path(
            config_dir.path().to_str().unwrap(),
            secret_file.to_str().unwrap(),
        )
        .expect("resolve secret");

        assert_eq!(resolved, secret_file.canonicalize().unwrap());
    }

    #[test]
    fn relative_secret_files_cannot_escape_config_dir() {
        let parent = TempDir::new().expect("create parent dir");
        let config_dir = parent.path().join("config");
        fs::create_dir(&config_dir).expect("create config dir");
        fs::write(parent.path().join("outside.yaml"), "encrypted").expect("write secret");

        let error =
            resolve_secret_file_path(config_dir.to_str().unwrap(), "../outside.yaml").unwrap_err();

        assert!(error.contains("escapes"));
    }
}
