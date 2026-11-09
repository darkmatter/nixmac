use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::Deserialize;
use serde_yaml::Value;

use crate::{
    secrets::{
        identities::{
            HostKey, RecipientIdentity, SecretIdentities, identities_for_recipient,
            load_secret_identities, normalize_age_or_ssh_identity, normalize_pgp_fingerprint,
        },
        resolve_secret_file_path,
    },
    shared_types::{
        DecryptionCapability, DecryptionIdentity, DecryptionIdentityKind,
        DecryptionIdentityLocality, RecipientKeyType, RecipientKind, RecipientRegistration,
        RecipientSource, SecretBackend, SecretEntry, SecretRecipient,
    },
    system::nix::nix_command,
};

#[derive(Debug, Default, Deserialize)]
struct SopsDocument {
    sops: Option<SopsMetadata>,
}

#[derive(Debug, Default, Deserialize)]
struct SopsMetadata {
    age: Option<Vec<SopsAgeRecipient>>,
    pgp: Option<Vec<SopsPgpRecipient>>,
    key_groups: Option<Vec<Value>>,
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

/// A mapping from an encrypted file to the public recipients recorded for it.
type RecipientInventory = HashMap<PathBuf, HashSet<RecipientIdentity>>;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConfigRecipient {
    public_key: String,
    anchor: Option<String>,
    registration_file: String,
}

/// Populate each secret with public recipient metadata and local capability.
#[cfg(test)]
pub(crate) fn apply_recipients_to_secrets(
    config_dir: &str,
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
) -> Result<(), String> {
    apply_recipients_to_secrets_with_identities(config_dir, entries, recipients, &[])
}

/// Populate each secret with public recipient metadata and local capability, including decryption identities.
pub(crate) fn apply_recipients_to_secrets_with_identities(
    config_dir: &str,
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
    decryption_identities: &[DecryptionIdentity],
) -> Result<(), String> {
    // TODO(agenix-read): Locate the classic agenix rules file through an
    // explicit future setting (the equivalent of agenix's `RULES`) or a
    // conventional `secrets.nix` fallback. Evaluate it with Nix rather than
    // parsing Nix source, then map each rule's `publicKeys` to the matching
    // evaluated `cfg.age.secrets.<name>.file`. Feed that map into the existing
    // `RecipientInventory` path below; until then agenix recipient metadata and
    // local capability intentionally remain unresolved.
    let agenix_inventory = RecipientInventory::new();
    apply_recipients_to_secrets_with_and_identities(
        config_dir,
        entries,
        recipients,
        decryption_identities,
        &agenix_inventory,
        parse_sops_recipient_metadata,
    )
}

/// Helper function to apply recipients to secrets, allowing a custom loader for SOPS metadata.
/// Only for testability.
#[cfg(test)]
fn apply_recipients_to_secrets_with<F>(
    config_dir: &str,
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
    agenix_inventory: &RecipientInventory,
    load_sops_metadata: F,
) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<HashSet<RecipientIdentity>, String>,
{
    apply_recipients_to_secrets_with_and_identities(
        config_dir,
        entries,
        recipients,
        &[],
        agenix_inventory,
        load_sops_metadata,
    )
}

/// Helper function to apply recipients to secrets, allowing a custom loader for SOPS metadata and decryption identities.
fn apply_recipients_to_secrets_with_and_identities<F>(
    config_dir: &str,
    entries: &mut [SecretEntry],
    recipients: &[SecretRecipient],
    decryption_identities: &[DecryptionIdentity],
    agenix_inventory: &RecipientInventory,
    mut load_sops_metadata: F,
) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<HashSet<RecipientIdentity>, String>,
{
    let known_recipients: Vec<(&str, HashSet<RecipientIdentity>)> = recipients
        .iter()
        .map(|recipient| {
            (
                recipient.id.as_str(),
                identities_for_recipient_with_aliases(recipient, decryption_identities),
            )
        })
        .collect();
    let all_known_identities: HashSet<RecipientIdentity> = known_recipients
        .iter()
        .flat_map(|(_, identities)| identities.iter().cloned())
        .collect();
    let locally_available_identities: HashSet<RecipientIdentity> = decryption_identities
        .iter()
        .filter(|identity| identity.available)
        .flat_map(|identity| identity.public_keys.iter().map(String::as_str))
        .filter_map(normalize_age_or_ssh_identity)
        .collect();
    let mut sops_cache: HashMap<PathBuf, Option<HashSet<RecipientIdentity>>> = HashMap::new();

    for entry in entries {
        let source_file = resolve_secret_file_path(config_dir, &entry.file)?;
        let encrypted_for = match entry.backend {
            SecretBackend::Sops => {
                if !sops_cache.contains_key(&source_file) {
                    let identities =
                        load_sops_metadata(&source_file)
                            .map(Some)
                            .unwrap_or_else(|error| {
                                log::warn!(
                                    "SOPS public recipient metadata is unresolved for {}: {error}",
                                    source_file.display()
                                );
                                None
                            });
                    sops_cache.insert(source_file.clone(), identities);
                }
                sops_cache.get(&source_file).cloned().flatten()
            }
            SecretBackend::Agenix => agenix_inventory.get(&source_file).cloned(),
        };
        entry.public_recipients_resolved = encrypted_for.is_some();
        let encrypted_for = encrypted_for.unwrap_or_default();

        entry.recipient_ids = known_recipients
            .iter()
            .filter(|(_, identities)| !identities.is_disjoint(&encrypted_for))
            .map(|(id, _)| (*id).to_string())
            .collect();
        entry.recipient_ids.sort();
        entry.recipient_ids.dedup();
        entry.public_recipients = encrypted_for
            .iter()
            .map(|identity| match identity {
                RecipientIdentity::Age(value)
                | RecipientIdentity::Ssh(value)
                | RecipientIdentity::Pgp(value) => value.clone(),
            })
            .collect();
        entry.public_recipients.sort();
        entry.decryption_capability = if encrypted_for.is_disjoint(&locally_available_identities) {
            // SOPS may also use other identities (agent, plugin, KMS, etc.) that we cannot access
            // in this process. So absence from our inventory is not proof of inability to decrypt.
            // So we will call it "unknown".
            DecryptionCapability::Unknown
        } else {
            DecryptionCapability::Available
        };

        let unknown_count = encrypted_for.difference(&all_known_identities).count();
        if unknown_count > 0 {
            log::debug!(
                "Encrypted secret source {} has {unknown_count} unknown public recipient(s)",
                source_file.display()
            );
        }
    }

    Ok(())
}

/// Whether a public recipient corresponds to any configured or discovered
/// local decryption identity. Availability is intentionally separate.
pub(crate) fn recipient_has_local_identity(
    recipient: &SecretRecipient,
    decryption_identities: &[DecryptionIdentity],
) -> bool {
    let recipient_identities = identities_for_recipient(recipient);
    decryption_identities
        .iter()
        .flat_map(|identity| identity.public_keys.iter().map(String::as_str))
        .filter_map(normalize_age_or_ssh_identity)
        .any(|identity| recipient_identities.contains(&identity))
}

/// Return every public identity known to represent a recipient. SSH private
/// identities retain both their normalized SSH public key and the equivalent
/// ssh-to-age recipient, even though only one value is displayed.
fn identities_for_recipient_with_aliases(
    recipient: &SecretRecipient,
    decryption_identities: &[DecryptionIdentity],
) -> HashSet<RecipientIdentity> {
    let mut recipient_identities = identities_for_recipient(recipient);
    loop {
        let mut changed = false;
        for identity in decryption_identities {
            let aliases: HashSet<RecipientIdentity> = identity
                .public_keys
                .iter()
                .filter_map(|public_key| normalize_age_or_ssh_identity(public_key))
                .collect();
            if !recipient_identities.is_disjoint(&aliases) {
                let previous_len = recipient_identities.len();
                recipient_identities.extend(aliases);
                changed |= recipient_identities.len() != previous_len;
            }
        }
        if !changed {
            return recipient_identities;
        }
    }
}

/// Parse the public recipient identities stored in an encrypted SOPS file.
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

/// Load the recipients from the nix config repo by executing a nix eval to evaluate the identities used by SOPS.
pub(crate) fn load_recipients(
    host_attr: &str,
    config_dir: &str,
) -> Result<(Vec<SecretRecipient>, Vec<DecryptionIdentity>), String> {
    let identities = load_secret_identities(host_attr, config_dir)?;
    let (local_recipients, mut decryption_identities) = materialize_recipients(
        host_attr,
        &identities,
        |public_key_path| ssh_public_key_to_age(public_key_path, config_dir),
        ssh_public_key_identity,
        |public_key_path| ssh_public_key_fingerprint(public_key_path, config_dir),
        |key_file| age_key_file_public_keys(key_file, config_dir),
    )?;
    decryption_identities.extend(discover_ambient_age_identities(
        identities.age_key_file.as_deref(),
        |key_file| age_key_file_public_keys(key_file, config_dir),
    ));
    let config_recipients = load_sops_config_recipients(Path::new(config_dir))?;

    // TODO(agenix-read): Merge public recipients found in the evaluated agenix
    // rules inventory here as well. Mark them in use and attach an
    // `RecipientRegistration { backend: Agenix, file: <rules path> }`, while
    // deduplicating them against local-identity and SOPS recipients by all
    // known public identity aliases rather than only the displayed public key.
    Ok((
        merge_config_recipients(local_recipients, config_recipients, &decryption_identities),
        decryption_identities,
    ))
}

/// Load the public recipients declared by the repository's SOPS config.
///
/// YAML aliases resolve to their scalar values during deserialization, but their
/// anchor names are presentation syntax and are not retained by serde_yaml. Read
/// both views: the parsed document supplies the actual recipients, while a small
/// source scan recovers optional friendly names such as `&build-server`.
/// If this doesn't make sense, see the unit tests.
fn load_sops_config_recipients(config_dir: &Path) -> Result<Vec<ConfigRecipient>, String> {
    let config_path = if config_dir.join(".sops.yaml").exists() {
        config_dir.join(".sops.yaml")
    } else if config_dir.join("sops.yaml").exists() {
        config_dir.join("sops.yaml")
    } else {
        return Ok(Vec::new());
    };
    let source = fs::read_to_string(&config_path)
        .map_err(|error| format!("Failed to read {}: {error}", config_path.display()))?;
    let registration_file = config_path
        .strip_prefix(config_dir)
        .unwrap_or(&config_path)
        .to_string_lossy()
        .into_owned();
    let mut recipients = parse_sops_config_recipients(&source)
        .map_err(|error| format!("Failed to parse {}: {error}", config_path.display()))?;
    for recipient in &mut recipients {
        recipient.registration_file.clone_from(&registration_file);
    }
    Ok(recipients)
}

/// Parse the SOPS config YAML to extract the public recipients, preserving anchor names for friendly labels.
fn parse_sops_config_recipients(source: &str) -> Result<Vec<ConfigRecipient>, String> {
    let document: Value =
        serde_yaml::from_str(source).map_err(|error| format!("invalid YAML: {error}"))?;
    let anchor_names = sops_anchor_names(source);
    let mut public_keys = Vec::new();

    if let Some(root) = document.as_mapping() {
        if let Some(keys) = root.get(Value::String("keys".to_string())) {
            collect_recipient_scalars(keys, &mut public_keys);
        }
        if let Some(rules) = root.get(Value::String("creation_rules".to_string())) {
            collect_named_recipient_lists(rules, &mut public_keys);
        }
    }

    let mut seen = HashSet::new();
    Ok(public_keys
        .into_iter()
        .filter_map(|public_key| {
            let canonical = canonical_public_identity(&public_key)?;
            if !seen.insert(canonical.clone()) {
                return None;
            }
            Some(ConfigRecipient {
                anchor: anchor_names.get(&canonical).cloned(),
                public_key: canonical,
                // The loader replaces this with the actual config filename.
                registration_file: ".sops.yaml".to_string(),
            })
        })
        .collect())
}

/// Recursively find recipient lists supported by SOPS creation rules. This
/// includes age/PGP lists nested in key_groups without pretending that a flat
/// inventory describes their Shamir access policy.
fn collect_named_recipient_lists(value: &Value, recipients: &mut Vec<String>) {
    match value {
        Value::Mapping(mapping) => {
            for (key, child) in mapping {
                match key.as_str() {
                    Some("age" | "pgp") => collect_recipient_scalars(child, recipients),
                    _ => collect_named_recipient_lists(child, recipients),
                }
            }
        }
        Value::Sequence(sequence) => {
            for child in sequence {
                collect_named_recipient_lists(child, recipients);
            }
        }
        _ => {}
    }
}

/// Recursively find recipient scalars supported by SOPS. This includes age/PGP
/// scalars nested in key_groups.
fn collect_recipient_scalars(value: &Value, recipients: &mut Vec<String>) {
    match value {
        Value::String(public_key) => recipients.push(public_key.clone()),
        Value::Sequence(sequence) => {
            for child in sequence {
                collect_recipient_scalars(child, recipients);
            }
        }
        Value::Mapping(mapping) => {
            for field in ["recipient", "fp"] {
                if let Some(public_key) = mapping
                    .get(Value::String(field.to_string()))
                    .and_then(Value::as_str)
                {
                    recipients.push(public_key.to_string());
                }
            }
        }
        _ => {}
    }
}

/// Return the canonical public identity for an age or SSH recipient, or None if the value is invalid.
fn canonical_public_identity(value: &str) -> Option<String> {
    match normalize_age_or_ssh_identity(value)? {
        RecipientIdentity::Age(key) | RecipientIdentity::Ssh(key) => Some(key),
        RecipientIdentity::Pgp(_) => unreachable!("age/SSH normalization does not produce PGP"),
    }
}

/// Parse the SOPS config YAML to extract the anchor names for friendly labels.
fn sops_anchor_names(source: &str) -> HashMap<String, String> {
    let anchor = regex::Regex::new(r"(?m)^[ \t]*-[ \t]*&([^\s\[\]{},]+)[ \t]+([^\r\n#]+)")
        .expect("SOPS anchor regex is valid");
    anchor
        .captures_iter(source)
        .filter_map(|capture| {
            let name = capture.get(1)?.as_str().to_string();
            let public_key = canonical_public_identity(capture.get(2)?.as_str().trim())?;
            Some((public_key, name))
        })
        .collect()
}

/// Merge the local recipients materialized from the host's SOPS identities with the
/// recipients declared in the repository's SOPS config. The local recipients are
/// always included, and the config recipients are added if they are not already present.
fn merge_config_recipients(
    mut local_recipients: Vec<SecretRecipient>,
    config_recipients: Vec<ConfigRecipient>,
    decryption_identities: &[DecryptionIdentity],
) -> Vec<SecretRecipient> {
    for recipient in &mut local_recipients {
        recipient.in_use = false;
        recipient.registrations.clear();
    }

    let mut used_ids: HashSet<String> = local_recipients
        .iter()
        .map(|recipient| recipient.id.clone())
        .collect();

    for config_recipient in config_recipients {
        let config_identity = normalize_age_or_ssh_identity(&config_recipient.public_key);
        if let Some(local) = local_recipients.iter_mut().find(|local| {
            local.public_key == config_recipient.public_key
                || config_identity.as_ref().is_some_and(|config_identity| {
                    identities_for_recipient_with_aliases(local, decryption_identities)
                        .contains(config_identity)
                })
        }) {
            local.in_use = true;
            local.registrations.push(RecipientRegistration {
                backend: SecretBackend::Sops,
                file: config_recipient.registration_file.clone(),
            });
            continue;
        }

        let label = config_recipient
            .anchor
            .as_deref()
            .unwrap_or(&config_recipient.public_key);
        let id = unique_recipient_id(label, &mut used_ids);
        local_recipients.push(
            recipient(
                &id,
                label,
                // An age recipient alone does not reveal whether it belongs to a
                // host, a person, a hardware token, or something else.
                RecipientKind::Unknown,
                if config_recipient.anchor.is_some() {
                    ".sops.yaml named recipient"
                } else {
                    ".sops.yaml recipient"
                },
                &config_recipient.public_key,
                "",
                recipient_key_type(&config_recipient.public_key),
                RecipientSource::Repository,
                true,
            )
            .with_registration(RecipientRegistration {
                backend: SecretBackend::Sops,
                file: config_recipient.registration_file,
            }),
        );
    }

    local_recipients
}

/// Turn the evaluated SOPS SSH identity paths into public recipients.
/// IMPORTANT: `sops.age.sshKeyPaths` contains private-key paths. Only the corresponding
/// `.pub` files are opened here; private key material never enters the vault.
fn materialize_recipients<Convert, ReadSshIdentity, Fingerprint, DeriveAge>(
    host_attr: &str,
    identities: &SecretIdentities,
    mut convert_to_age: Convert,
    mut read_ssh_identity: ReadSshIdentity,
    mut fingerprint: Fingerprint,
    mut derive_age: DeriveAge,
) -> Result<(Vec<SecretRecipient>, Vec<DecryptionIdentity>), String>
where
    Convert: FnMut(&str) -> Result<String, String>,
    ReadSshIdentity: FnMut(&str) -> Result<String, String>,
    Fingerprint: FnMut(&str) -> Result<Option<String>, String>,
    DeriveAge: FnMut(&str) -> Result<Vec<String>, String>,
{
    let used_host_keys: Vec<&HostKey> = identities
        .host_keys
        .iter()
        .filter(|key| key.used_by_sops)
        .collect();
    let mut recipients = Vec::new();
    let mut decryption_identities = Vec::new();
    let mut public_keys = HashSet::new();
    let mut recipient_ids = HashSet::new();

    // 1. Materialize the host's SOPS SSH identities into age recipients.
    for (index, host_key) in used_host_keys.into_iter().enumerate() {
        validate_public_key_path(&host_key.path, &host_key.public_key_path)?;
        log::debug!(
            "Converting sops SSH host identity {} using public key {}",
            host_key.path,
            host_key.public_key_path
        );
        let available = Path::new(&host_key.path).is_file();
        let age_public_key = match convert_to_age(&host_key.public_key_path) {
            Ok(public_key) => public_key,
            Err(error) => {
                log::warn!(
                    "Could not derive a public recipient for configured SSH identity {} from {}: {error}",
                    host_key.path,
                    host_key.public_key_path
                );
                decryption_identities.push(DecryptionIdentity {
                    kind: DecryptionIdentityKind::SshKeyPath,
                    locality: DecryptionIdentityLocality::Configuration,
                    path: host_key.path.clone(),
                    available,
                    public_keys: Vec::new(),
                });
                continue;
            }
        };
        let mut identity_aliases = vec![age_public_key.clone()];
        match read_ssh_identity(&host_key.public_key_path) {
            Ok(ssh_public_key) => identity_aliases.push(ssh_public_key),
            Err(error) => log::warn!(
                "Could not retain SSH public identity alias from {}: {error}",
                host_key.public_key_path
            ),
        }
        decryption_identities.push(DecryptionIdentity {
            kind: DecryptionIdentityKind::SshKeyPath,
            locality: DecryptionIdentityLocality::Configuration,
            path: host_key.path.clone(),
            available,
            public_keys: identity_aliases,
        });
        if !public_keys.insert(age_public_key.clone()) {
            continue;
        }

        // Prefer the first host identity as the primary decryption identity.
        // Additional identities get stable, collision-safe ids of their own.
        let id_base = if index == 0 {
            host_attr.to_string()
        } else {
            format!("{host_attr}-{}", host_key.key_type)
        };
        let id = unique_recipient_id(&id_base, &mut recipient_ids);
        let key_fingerprint = fingerprint(&host_key.public_key_path)
            .unwrap_or_else(|error| {
                log::warn!(
                    "Could not fingerprint SSH public key {}: {error}",
                    host_key.public_key_path
                );
                None
            })
            .unwrap_or_default();
        recipients.push(recipient(
            &id,
            host_attr,
            RecipientKind::Host,
            &format!("This Mac · {}", host_key.key_type),
            &age_public_key,
            &key_fingerprint,
            RecipientKeyType::Age,
            RecipientSource::SshHostKey,
            true,
        ));
    }

    // 2. Materialize the other SOPS SSH identities into age recipients.
    for identity_path in &identities.other_sops_identities {
        let public_key_path = format!("{identity_path}.pub");
        validate_public_key_path(identity_path, &public_key_path)?;
        log::debug!("Converting non-host sops SSH identity using public key {public_key_path}");
        let available = Path::new(identity_path).is_file();
        let age_public_key = match convert_to_age(&public_key_path) {
            Ok(public_key) => public_key,
            Err(error) => {
                log::warn!(
                    "Could not derive a public recipient for configured SSH identity {identity_path} from {public_key_path}: {error}"
                );
                decryption_identities.push(DecryptionIdentity {
                    kind: DecryptionIdentityKind::SshKeyPath,
                    locality: DecryptionIdentityLocality::Configuration,
                    path: identity_path.clone(),
                    available,
                    public_keys: Vec::new(),
                });
                continue;
            }
        };
        let mut identity_aliases = vec![age_public_key.clone()];
        match read_ssh_identity(&public_key_path) {
            Ok(ssh_public_key) => identity_aliases.push(ssh_public_key),
            Err(error) => log::warn!(
                "Could not retain SSH public identity alias from {public_key_path}: {error}"
            ),
        }
        decryption_identities.push(DecryptionIdentity {
            kind: DecryptionIdentityKind::SshKeyPath,
            locality: DecryptionIdentityLocality::Configuration,
            path: identity_path.clone(),
            available,
            public_keys: identity_aliases,
        });
        if !public_keys.insert(age_public_key.clone()) {
            continue;
        }

        let label = Path::new(identity_path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("ssh-identity");
        let id = unique_recipient_id(label, &mut recipient_ids);
        let key_fingerprint = fingerprint(&public_key_path)
            .unwrap_or_else(|error| {
                log::warn!("Could not fingerprint SSH public key {public_key_path}: {error}");
                None
            })
            .unwrap_or_default();
        recipients.push(recipient(
            &id,
            label,
            RecipientKind::User,
            "SSH identity · ssh-to-age",
            &age_public_key,
            &key_fingerprint,
            RecipientKeyType::Age,
            RecipientSource::SshIdentity,
            true,
        ));
    }

    // 3. Materialize the SOPS age key file into age recipients.
    if let Some(key_file) = identities.age_key_file.as_deref() {
        let path = Path::new(key_file);
        let available = path.is_file();
        let derived_public_keys = available
            .then(|| derive_age(key_file))
            .transpose()?
            .unwrap_or_default();
        decryption_identities.push(DecryptionIdentity {
            kind: DecryptionIdentityKind::AgeKeyFile,
            locality: DecryptionIdentityLocality::Configuration,
            path: key_file.to_string(),
            available,
            public_keys: derived_public_keys.clone(),
        });
        for public_key in derived_public_keys {
            if !public_keys.insert(public_key.clone()) {
                continue;
            }
            let label = path
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or("age-key-file");
            let id = unique_recipient_id(label, &mut recipient_ids);
            recipients.push(recipient(
                &id,
                label,
                RecipientKind::User,
                "Configured age decryption identity",
                &public_key,
                "",
                RecipientKeyType::Age,
                RecipientSource::AgeKeyFile,
                true,
            ));
        }
    }

    Ok((recipients, decryption_identities))
}

/// Create a decryption identity for a SOPS SSH host key or identity, or an age key file.
/// Also marks where the identity was discovered (process, machine, or configuration) and whether it is available.
fn discover_ambient_age_identities<DeriveAge>(
    configured_key_file: Option<&str>,
    mut derive_age: DeriveAge,
) -> Vec<DecryptionIdentity>
where
    DeriveAge: FnMut(&str) -> Result<Vec<String>, String>,
{
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("SOPS_AGE_KEY_FILE").filter(|value| !value.is_empty()) {
        candidates.push((PathBuf::from(path), DecryptionIdentityLocality::Process));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push((
            home.join("Library/Application Support/sops/age/keys.txt"),
            DecryptionIdentityLocality::Machine,
        ));
        candidates.push((
            home.join(".config/sops/age/keys.txt"),
            DecryptionIdentityLocality::Machine,
        ));
    }

    let mut seen = HashSet::new();
    configured_key_file
        .map(PathBuf::from)
        .into_iter()
        .for_each(|path| {
            seen.insert(path);
        });
    candidates
        .into_iter()
        .filter(|(path, _)| seen.insert(path.clone()))
        .filter(|(path, _)| path.is_file())
        .map(|(path, locality)| {
            let path_string = path.to_string_lossy().into_owned();
            let public_keys = derive_age(&path_string).map_err(|error| {
                log::debug!(
                    "Could not derive public recipient for {}: {error}",
                    path.display()
                );
                error
            });
            DecryptionIdentity {
                kind: DecryptionIdentityKind::AgeKeyFile,
                locality,
                path: path_string,
                available: true,
                public_keys: public_keys.unwrap_or_default(),
            }
        })
        .collect()
}

/// Require the public-key path to be derived from, and distinct from, the
/// configured private identity path before anything may open it.
fn validate_public_key_path(private_key_path: &str, public_key_path: &str) -> Result<(), String> {
    let expected = format!("{private_key_path}.pub");
    if public_key_path != expected {
        return Err(format!(
            "Refusing to access SSH key path {public_key_path}: expected the public key path {expected}"
        ));
    }
    ensure_public_key_path(public_key_path)
}

/// Ensure that the public-key path is a regular file with a `.pub` extension and not a symlink.
/// This is a security measure to help prevent accidental exposure of private key material.
fn ensure_public_key_path(public_key_path: &str) -> Result<(), String> {
    if Path::new(public_key_path)
        .extension()
        .and_then(|value| value.to_str())
        != Some("pub")
    {
        return Err(format!(
            "Refusing to access SSH key path {public_key_path}: only .pub public key files may be opened"
        ));
    }

    match fs::symlink_metadata(public_key_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!(
                "Refusing to access SSH public key {public_key_path}: symlinks are not allowed"
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // The actual opener will return the more useful missing-file error.
        }
        Err(error) => {
            return Err(format!(
                "Failed to inspect SSH public key path {public_key_path}: {error}"
            ));
        }
    }

    Ok(())
}

/// Generate a unique recipient ID based on a base string and a set of used IDs.
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

/// Convert an OpenSSH public key to an age public key using the ssh-to-age tool from nixpkgs.
/// This is used to convert the SSH host key used by sops to an age public key for use in the secrets vault.
fn ssh_public_key_to_age(public_key_path: &str, config_dir: &str) -> Result<String, String> {
    ensure_public_key_path(public_key_path)?;
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

/// Read and normalize an OpenSSH public key so it can be retained as an alias
/// of the corresponding ssh-to-age recipient. This only accepts protected
/// `.pub` paths; private identity material is never read.
fn ssh_public_key_identity(public_key_path: &str) -> Result<String, String> {
    ensure_public_key_path(public_key_path)?;
    let source = fs::read_to_string(public_key_path)
        .map_err(|error| format!("Failed to read SSH public key {public_key_path}: {error}"))?;
    let public_key = source
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| format!("SSH public key {public_key_path} is empty"))?;
    match normalize_age_or_ssh_identity(public_key) {
        Some(RecipientIdentity::Ssh(public_key)) => Ok(public_key),
        _ => Err(format!(
            "SSH public key {public_key_path} does not contain a supported SSH recipient"
        )),
    }
}

/// Calculate the fingerprint of an OpenSSH public key using ssh-keygen.
/// This is used to display the fingerprint of the SSH host key used by sops in the secrets vault.
fn ssh_public_key_fingerprint(
    public_key_path: &str,
    config_dir: &str,
) -> Result<Option<String>, String> {
    ensure_public_key_path(public_key_path)?;
    let Ok(output) = std::process::Command::new("ssh-keygen")
        .args(["-lf", public_key_path, "-E", "sha256"])
        .env("PATH", crate::system::nix::get_nix_path())
        .current_dir(config_dir)
        .output()
    else {
        return Ok(None);
    };
    if !output.status.success() {
        log::debug!(
            "Failed to calculate SSH fingerprint for {public_key_path}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Ok(None);
    }

    Ok(String::from_utf8(output.stdout)
        .ok()
        .and_then(|stdout| stdout.split_whitespace().nth(1).map(str::to_string)))
}

/// Derive the public recipient from an age identity file in a subprocess so
/// private identity material never enters the vault response or Rust memory.
fn age_key_file_public_keys(key_file: &str, config_dir: &str) -> Result<Vec<String>, String> {
    let output = nix_command(config_dir)
        .args(["shell", "nixpkgs#age", "-c", "age-keygen", "-y", key_file])
        .output()
        .map_err(|error| format!("Failed to derive age recipient for {key_file}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "age-keygen failed for {key_file} with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let public_keys: Vec<String> = String::from_utf8(output.stdout)
        .map_err(|error| format!("age-keygen returned invalid UTF-8 for {key_file}: {error}"))?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    if public_keys.is_empty() {
        return Err(format!(
            "age-keygen returned an empty recipient for {key_file}"
        ));
    }
    Ok(public_keys)
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
    key_type: RecipientKeyType,
    source: RecipientSource,
    in_use: bool,
) -> SecretRecipient {
    SecretRecipient {
        id: id.into(),
        label: label.into(),
        kind,
        device: device.into(),
        fingerprint: fingerprint.into(),
        public_key: public_key.into(),
        key_type,
        source,
        in_use,
        registrations: Vec::new(),
    }
}

/// Determine the key type of a recipient based on its public key.
fn recipient_key_type(public_key: &str) -> RecipientKeyType {
    if normalize_pgp_fingerprint(public_key).is_some() {
        return RecipientKeyType::Pgp;
    }
    match normalize_age_or_ssh_identity(public_key) {
        Some(RecipientIdentity::Ssh(_)) => RecipientKeyType::Ssh,
        Some(RecipientIdentity::Age(_)) => RecipientKeyType::Age,
        Some(RecipientIdentity::Pgp(_)) => RecipientKeyType::Pgp,
        None => RecipientKeyType::Unknown,
    }
}

/// Helper trait to add a registration to a SecretRecipient.
trait WithRegistration {
    fn with_registration(self, registration: RecipientRegistration) -> Self;
}

impl WithRegistration for SecretRecipient {
    fn with_registration(mut self, registration: RecipientRegistration) -> Self {
        self.registrations.push(registration);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ConfigRecipient, RecipientInventory, apply_recipients_to_secrets,
        apply_recipients_to_secrets_with, apply_recipients_to_secrets_with_and_identities,
        load_sops_config_recipients, materialize_recipients, merge_config_recipients,
        parse_sops_config_recipients, parse_sops_recipient_metadata, recipient,
        recipient_has_local_identity, recipient_key_type, ssh_public_key_fingerprint,
        ssh_public_key_identity, ssh_public_key_to_age, unique_recipient_id,
    };
    use crate::{
        secrets::identities::{HostKey, RecipientIdentity, SecretIdentities},
        shared_types::{
            DecryptionCapability, DecryptionIdentity, DecryptionIdentityKind,
            DecryptionIdentityLocality, RecipientKeyType, RecipientKind, RecipientRegistration,
            RecipientSource, SecretBackend, SecretEntry, SecretRecipient,
        },
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        os::unix::fs::symlink,
        path::{Path, PathBuf},
    };
    use tempfile::TempDir;

    fn known_recipient(id: &str, public_key: &str) -> SecretRecipient {
        recipient(
            id,
            id,
            RecipientKind::Unknown,
            "test",
            public_key,
            "",
            recipient_key_type(public_key),
            RecipientSource::Repository,
            true,
        )
    }

    fn secret(backend: SecretBackend, file: impl Into<String>) -> SecretEntry {
        SecretEntry {
            id: "secret".into(),
            name: "secret".into(),
            backend,
            file: file.into(),
            public_recipients: Vec::new(),
            public_recipients_resolved: false,
            recipient_ids: Vec::new(),
            decryption_capability: Default::default(),
            sops_key: (backend == SecretBackend::Sops).then(|| "value".into()),
        }
    }

    fn write_sops_file(dir: &TempDir, name: &str, recipients: &[&str]) -> PathBuf {
        let path = dir.path().join(name);
        let age = recipients
            .iter()
            .map(|recipient| format!("    - recipient: {recipient}\n"))
            .collect::<String>();
        fs::write(
            &path,
            format!("value: ENC[AES256_GCM,data:test]\nsops:\n  age:\n{age}"),
        )
        .expect("write SOPS fixture");
        path
    }

    #[test]
    fn materializes_every_sops_ssh_identity_without_reading_private_keys() {
        let identities = SecretIdentities {
            age_key_file: None,
            host_keys: vec![
                HostKey {
                    path: "/etc/ssh/ssh_host_ed25519_key".into(),
                    public_key_path: "/etc/ssh/ssh_host_ed25519_key.pub".into(),
                    key_type: "ed25519".into(),
                    used_by_sops: true,
                },
                HostKey {
                    path: "/etc/ssh/unused".into(),
                    public_key_path: "/etc/ssh/unused.pub".into(),
                    key_type: "rsa".into(),
                    used_by_sops: false,
                },
            ],
            other_sops_identities: vec![
                "/Users/test/.ssh/id_ed25519".into(),
                "/Users/test/work/id_ed25519".into(),
            ],
        };
        let mut converted_paths = Vec::new();

        let (recipients, decryption_identities) = materialize_recipients(
            "Test-Mac",
            &identities,
            |path| {
                converted_paths.push(path.to_string());
                Ok(format!("age1-{path}"))
            },
            |path| Ok(format!("ssh-ed25519 alias-{path}")),
            |path| Ok(Some(format!("fingerprint-{path}"))),
            |_path| -> Result<Vec<String>, String> { panic!("no age key file configured") },
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
        assert_eq!(decryption_identities.len(), 3);
        assert_eq!(recipients[0].id, "Test-Mac");
        assert_eq!(recipients[0].kind, RecipientKind::Host);
        assert_eq!(recipients[0].key_type, RecipientKeyType::Age);
        assert_eq!(recipients[0].source, RecipientSource::SshHostKey);
        assert!(recipient_has_local_identity(
            &recipients[0],
            &decryption_identities
        ));
        assert_eq!(recipients[1].id, "id_ed25519");
        assert_eq!(recipients[1].key_type, RecipientKeyType::Age);
        assert_eq!(recipients[1].source, RecipientSource::SshIdentity);
        assert!(recipient_has_local_identity(
            &recipients[1],
            &decryption_identities
        ));
        assert_eq!(recipients[2].id, "id_ed25519-2");
        assert!(recipient_has_local_identity(
            &recipients[2],
            &decryption_identities
        ));
        assert_eq!(
            recipients[1].fingerprint,
            "fingerprint-/Users/test/.ssh/id_ed25519.pub"
        );
    }

    #[test]
    fn missing_ssh_public_key_preserves_identity_and_does_not_block_other_recipients() {
        let dir = TempDir::new().expect("temp dir");
        let missing_public_identity = dir.path().join("missing-public-key");
        let valid_identity = dir.path().join("valid-key");
        let valid_public_key = dir.path().join("valid-key.pub");
        fs::write(&missing_public_identity, "private identity fixture")
            .expect("write private identity fixture");
        fs::write(&valid_identity, "private identity fixture")
            .expect("write private identity fixture");
        fs::write(&valid_public_key, "public key fixture").expect("write public key fixture");

        let missing_public_path = format!("{}.pub", missing_public_identity.display());
        let valid_public_path = valid_public_key.to_string_lossy().into_owned();
        let identities = SecretIdentities {
            age_key_file: None,
            host_keys: Vec::new(),
            other_sops_identities: vec![
                missing_public_identity.to_string_lossy().into_owned(),
                valid_identity.to_string_lossy().into_owned(),
            ],
        };
        let mut fingerprinted_paths = Vec::new();

        let (recipients, decryption_identities) = materialize_recipients(
            "test-host",
            &identities,
            |path| {
                if path == missing_public_path {
                    Err("public key does not exist".into())
                } else {
                    assert_eq!(path, valid_public_path);
                    Ok("age1valid".into())
                }
            },
            |path| {
                assert_eq!(path, valid_public_path);
                Ok("ssh-ed25519 AAAAvalid".into())
            },
            |path| {
                fingerprinted_paths.push(path.to_string());
                Err("fingerprint unavailable".into())
            },
            |_path| -> Result<Vec<String>, String> { panic!("no age key file configured") },
        )
        .expect("public recipient enrichment is best-effort");

        assert_eq!(decryption_identities.len(), 2);
        assert!(
            decryption_identities
                .iter()
                .all(|identity| identity.available)
        );
        assert!(decryption_identities[0].public_keys.is_empty());
        assert_eq!(
            decryption_identities[1].public_keys,
            ["age1valid", "ssh-ed25519 AAAAvalid"]
        );
        assert_eq!(recipients.len(), 1);
        assert_eq!(recipients[0].id, "valid-key");
        assert_eq!(recipients[0].public_key, "age1valid");
        assert!(recipients[0].fingerprint.is_empty());
        assert_eq!(fingerprinted_paths, [valid_public_path]);
    }

    #[test]
    fn materialization_deduplicates_public_identities() {
        let identities = SecretIdentities {
            age_key_file: None,
            host_keys: vec![HostKey {
                path: "/etc/ssh/host".into(),
                public_key_path: "/etc/ssh/host.pub".into(),
                key_type: "ed25519".into(),
                used_by_sops: true,
            }],
            other_sops_identities: vec!["/Users/test/.ssh/same-key".into()],
        };

        let (recipients, _) = materialize_recipients(
            "test-host",
            &identities,
            |_path| Ok("age1same".into()),
            |_path| Ok("ssh-ed25519 AAAAsame".into()),
            |_path| Ok(None),
            |_path| -> Result<Vec<String>, String> { panic!("no age key file configured") },
        )
        .expect("materialize recipients");

        assert_eq!(recipients.len(), 1);
        assert_eq!(recipients[0].id, "test-host");
    }

    #[test]
    fn materializes_evaluated_age_key_file_as_a_configuration_local_identity() {
        let dir = TempDir::new().expect("temp dir");
        let key_file = dir.path().join("keys.txt");
        fs::write(&key_file, "private identity fixture").expect("write identity fixture");
        let identities = SecretIdentities {
            age_key_file: Some(key_file.to_string_lossy().into_owned()),
            host_keys: Vec::new(),
            other_sops_identities: Vec::new(),
        };

        let (recipients, local_identities) = materialize_recipients(
            "test-host",
            &identities,
            |_path| -> Result<String, String> { panic!("no SSH identity configured") },
            |_path| -> Result<String, String> { panic!("no SSH identity configured") },
            |_path| -> Result<Option<String>, String> { panic!("no SSH identity configured") },
            |_path| Ok(vec!["age1configured".into(), "age1second".into()]),
        )
        .expect("materialize age key file");

        assert_eq!(recipients.len(), 2);
        assert_eq!(recipients[0].source, RecipientSource::AgeKeyFile);
        assert!(
            recipients
                .iter()
                .all(|recipient| recipient_has_local_identity(recipient, &local_identities))
        );
        assert_eq!(local_identities.len(), 1);
        assert_eq!(
            local_identities[0].locality,
            DecryptionIdentityLocality::Configuration
        );
        assert_eq!(local_identities[0].kind, DecryptionIdentityKind::AgeKeyFile);
        assert_eq!(
            local_identities[0].public_keys,
            ["age1configured", "age1second"]
        );
    }

    #[test]
    fn empty_identity_projection_materializes_no_recipients() {
        let (recipients, decryption_identities) = materialize_recipients(
            "test-host",
            &SecretIdentities {
                age_key_file: None,
                host_keys: Vec::new(),
                other_sops_identities: Vec::new(),
            },
            |_path| -> Result<String, String> { panic!("conversion should not run") },
            |_path| -> Result<String, String> { panic!("SSH identity read should not run") },
            |_path| -> Result<Option<String>, String> { panic!("fingerprinting should not run") },
            |_path| -> Result<Vec<String>, String> { panic!("age derivation should not run") },
        )
        .expect("empty projection");

        assert!(recipients.is_empty());
        assert!(decryption_identities.is_empty());
    }

    #[test]
    fn materialization_rejects_a_private_key_path_before_callbacks_run() {
        let private_path = "/tmp/ssh_host_ed25519_key";
        let identities = SecretIdentities {
            age_key_file: None,
            host_keys: vec![HostKey {
                path: private_path.into(),
                // Simulate a malformed or malicious projection attempting to
                // pass the private identity path through as the public path.
                public_key_path: private_path.into(),
                key_type: "ed25519".into(),
                used_by_sops: true,
            }],
            other_sops_identities: Vec::new(),
        };

        let error = materialize_recipients(
            "test-host",
            &identities,
            |_path| -> Result<String, String> { panic!("conversion must not run") },
            |_path| -> Result<String, String> { panic!("SSH identity read must not run") },
            |_path| -> Result<Option<String>, String> { panic!("fingerprinting must not run") },
            |_path| -> Result<Vec<String>, String> { panic!("age derivation must not run") },
        )
        .expect_err("private key path must be rejected");

        assert!(error.contains("Refusing to access SSH key path"));
        assert!(error.contains(".pub"));
    }

    #[test]
    fn low_level_key_access_rejects_private_key_paths() {
        let private_path = "/tmp/id_ed25519";

        let conversion_error = ssh_public_key_to_age(private_path, "/tmp")
            .expect_err("conversion must reject a private key path");
        let identity_error = ssh_public_key_identity(private_path)
            .expect_err("identity read must reject a private key path");
        let fingerprint_error = ssh_public_key_fingerprint(private_path, "/tmp")
            .expect_err("fingerprinting must reject a private key path");

        assert!(conversion_error.contains("only .pub public key files"));
        assert!(identity_error.contains("only .pub public key files"));
        assert!(fingerprint_error.contains("only .pub public key files"));
    }

    #[test]
    fn low_level_key_access_rejects_public_path_symlinks() {
        let dir = TempDir::new().expect("temp dir");
        let private_path = dir.path().join("id_ed25519");
        let public_path = dir.path().join("id_ed25519.pub");
        fs::write(&private_path, "PRIVATE KEY MATERIAL").expect("write private fixture");
        symlink(&private_path, &public_path).expect("create public-path symlink");

        let error =
            ssh_public_key_to_age(&public_path.to_string_lossy(), dir.path().to_str().unwrap())
                .expect_err("symlinked public path must be rejected");
        let identity_error = ssh_public_key_identity(&public_path.to_string_lossy())
            .expect_err("symlinked public path must not be read");

        assert!(error.contains("symlinks are not allowed"));
        assert!(identity_error.contains("symlinks are not allowed"));
    }

    #[test]
    fn ssh_public_identity_is_normalized_without_its_comment() {
        let dir = TempDir::new().expect("temp dir");
        let public_path = dir.path().join("id_ed25519.pub");
        fs::write(&public_path, "ssh-ed25519 AAAAoperator optional-comment\n")
            .expect("write public fixture");

        assert_eq!(
            ssh_public_key_identity(&public_path.to_string_lossy()).expect("read public identity"),
            "ssh-ed25519 AAAAoperator"
        );
    }

    #[test]
    fn sops_config_anchors_name_recipients_and_aliases_resolve() {
        let recipients = parse_sops_config_recipients(
            r#"
keys:
  - &build_server age1server
  - &operator ssh-ed25519 AAAAoperator optional-comment
creation_rules:
  - path_regex: .*
    age: [*build_server, *operator, age1raw]
"#,
        )
        .expect("parse SOPS config");

        assert_eq!(
            recipients,
            [
                ConfigRecipient {
                    public_key: "age1server".into(),
                    anchor: Some("build_server".into()),
                    registration_file: ".sops.yaml".into(),
                },
                ConfigRecipient {
                    public_key: "ssh-ed25519 AAAAoperator".into(),
                    anchor: Some("operator".into()),
                    registration_file: ".sops.yaml".into(),
                },
                ConfigRecipient {
                    public_key: "age1raw".into(),
                    anchor: None,
                    registration_file: ".sops.yaml".into(),
                },
            ]
        );
    }

    #[test]
    fn config_parser_deduplicates_keys_across_registry_and_rules() {
        let recipients = parse_sops_config_recipients(
            "keys:\n  - &alice age1alice\ncreation_rules:\n  - age: [*alice, age1alice]\n",
        )
        .expect("parse SOPS config");

        assert_eq!(
            recipients,
            [ConfigRecipient {
                public_key: "age1alice".into(),
                anchor: Some("alice".into()),
                registration_file: ".sops.yaml".into(),
            }]
        );
    }

    #[test]
    fn config_loader_prefers_dot_sops_yaml_and_handles_missing_config() {
        let dir = TempDir::new().expect("temp dir");
        assert!(
            load_sops_config_recipients(dir.path())
                .expect("missing config")
                .is_empty()
        );

        fs::write(
            dir.path().join("sops.yaml"),
            "creation_rules:\n  - age: [age1fallback]\n",
        )
        .expect("write fallback");
        fs::write(
            dir.path().join(".sops.yaml"),
            "creation_rules:\n  - age: [age1preferred]\n",
        )
        .expect("write preferred");

        let recipients = load_sops_config_recipients(dir.path()).expect("load config");
        assert_eq!(recipients[0].public_key, "age1preferred");
        assert_eq!(recipients[0].registration_file, ".sops.yaml");
    }

    #[test]
    fn merge_preserves_materialized_recipient_identity() {
        let local = vec![
            recipient(
                "my-host",
                "my-host",
                RecipientKind::Host,
                "This Mac",
                "age1local",
                "SHA256:local",
                RecipientKeyType::Age,
                RecipientSource::SshHostKey,
                true,
            ),
            recipient(
                "id_ed25519",
                "id_ed25519",
                RecipientKind::User,
                "SSH identity",
                "age1operator",
                "SHA256:operator",
                RecipientKeyType::Age,
                RecipientSource::SshIdentity,
                true,
            ),
        ];
        let ssh_identity = DecryptionIdentity {
            kind: DecryptionIdentityKind::SshKeyPath,
            locality: DecryptionIdentityLocality::Configuration,
            path: "/Users/test/.ssh/id_ed25519".into(),
            available: true,
            public_keys: vec!["age1operator".into(), "ssh-ed25519 AAAAoperator".into()],
        };
        let config = parse_sops_config_recipients(
            "keys:\n  - &local_alias age1local\n  - &cooper ssh-ed25519 AAAAoperator comment\n  - age1unknown\n",
        )
        .expect("parse config");

        let recipients =
            merge_config_recipients(local, config, std::slice::from_ref(&ssh_identity));

        assert_eq!(recipients.len(), 3);
        assert_eq!(recipients[0].id, "my-host");
        assert_eq!(recipients[0].label, "my-host");
        assert!(recipients[0].in_use);
        assert_eq!(
            recipients[0].registrations,
            [RecipientRegistration {
                backend: SecretBackend::Sops,
                file: ".sops.yaml".into(),
            }]
        );
        assert_eq!(recipients[1].id, "id_ed25519");
        assert_eq!(recipients[1].label, "id_ed25519");
        assert!(recipients[1].in_use);
        assert_eq!(recipients[2].kind, RecipientKind::Unknown);
        assert_eq!(recipients[2].label, "age1unknown");
    }

    #[test]
    fn local_recipient_absent_from_config_is_not_in_use() {
        let local = vec![known_recipient("local-only", "age1local")];
        let recipients = merge_config_recipients(local, Vec::new(), &[]);

        assert!(!recipients[0].in_use);
    }

    #[test]
    fn recipient_ids_are_collision_safe_and_have_an_empty_fallback() {
        let mut used = HashSet::new();
        assert_eq!(unique_recipient_id("", &mut used), "recipient");
        assert_eq!(unique_recipient_id("recipient", &mut used), "recipient-2");
        assert_eq!(unique_recipient_id("recipient", &mut used), "recipient-3");
    }

    #[test]
    fn different_sops_files_match_different_recipients() {
        let dir = TempDir::new().expect("temp dir");
        let alice = write_sops_file(&dir, "alice.yaml", &["age1alice"]);
        let bob = write_sops_file(&dir, "bob.yaml", &["age1bob"]);
        let mut entries = vec![
            secret(SecretBackend::Sops, alice.to_string_lossy()),
            secret(SecretBackend::Sops, bob.to_string_lossy()),
        ];
        entries[0].id = "alice-secret".into();
        entries[1].id = "bob-secret".into();

        apply_recipients_to_secrets(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[
                known_recipient("alice", "age1alice"),
                known_recipient("bob", "age1bob"),
            ],
        )
        .expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["alice"]);
        assert_eq!(entries[1].recipient_ids, ["bob"]);
    }

    #[test]
    fn matching_deduplicates_ids_and_ignores_unknown_recipients() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "secret.yaml", &["age1alice", "age1unknown"]);
        let mut entries = vec![secret(SecretBackend::Sops, file.to_string_lossy())];

        apply_recipients_to_secrets(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[
                known_recipient("alice", "age1alice"),
                known_recipient("alice", "age1alice"),
                known_recipient("bob", "age1bob"),
            ],
        )
        .expect("match recipients");

        assert_eq!(entries[0].recipient_ids, ["alice"]);
    }

    #[test]
    fn decryption_capability_is_positive_only_for_a_matching_available_identity() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("secret.yaml");
        fs::write(&file, "").expect("write secret fixture");
        let mut entries = vec![secret(SecretBackend::Sops, file.to_string_lossy())];
        let local_identity = DecryptionIdentity {
            kind: DecryptionIdentityKind::SshKeyPath,
            locality: DecryptionIdentityLocality::Configuration,
            path: "/tmp/id_ed25519".into(),
            available: true,
            public_keys: vec!["age1alice".into(), "ssh-ed25519 AAAAalice".into()],
        };
        assert!(recipient_has_local_identity(
            &known_recipient("alice", "age1alice"),
            std::slice::from_ref(&local_identity),
        ));
        assert!(!recipient_has_local_identity(
            &known_recipient("bob", "age1bob"),
            std::slice::from_ref(&local_identity),
        ));

        apply_recipients_to_secrets_with_and_identities(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            std::slice::from_ref(&local_identity),
            &RecipientInventory::new(),
            |_path| {
                Ok(HashSet::from([RecipientIdentity::Ssh(
                    "ssh-ed25519 AAAAalice".into(),
                )]))
            },
        )
        .expect("match local identity");
        assert_eq!(
            entries[0].decryption_capability,
            DecryptionCapability::Available
        );
        assert_eq!(entries[0].recipient_ids, ["alice"]);
        assert_eq!(entries[0].public_recipients, ["ssh-ed25519 AAAAalice"]);

        apply_recipients_to_secrets_with(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            &RecipientInventory::new(),
            |_path| {
                Ok(HashSet::from([RecipientIdentity::Ssh(
                    "ssh-ed25519 AAAAalice".into(),
                )]))
            },
        )
        .expect("match without local identity");
        assert_eq!(
            entries[0].decryption_capability,
            DecryptionCapability::Unknown
        );
        assert!(entries[0].recipient_ids.is_empty());
    }

    #[test]
    fn matching_preserves_non_recipient_secret_fields() {
        let dir = TempDir::new().expect("temp dir");
        let file = write_sops_file(&dir, "secret.yaml", &["age1alice"]);
        let mut entry = secret(SecretBackend::Sops, file.to_string_lossy());
        entry.id = "secret-id".into();
        entry.name = "secret-name".into();
        entry.sops_key = Some("nested/key".into());
        let mut entries = vec![entry];

        apply_recipients_to_secrets(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
        )
        .expect("match recipients");

        assert_eq!(entries[0].id, "secret-id");
        assert_eq!(entries[0].name, "secret-name");
        assert_eq!(entries[0].backend, SecretBackend::Sops);
        assert_eq!(entries[0].sops_key.as_deref(), Some("nested/key"));
    }

    #[test]
    fn shared_sops_file_is_loaded_only_once() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("shared.yaml");
        fs::write(&file, "").expect("write secret fixture");
        let mut entries = vec![
            secret(SecretBackend::Sops, file.to_string_lossy()),
            secret(SecretBackend::Sops, file.to_string_lossy()),
        ];
        let mut calls = 0;

        apply_recipients_to_secrets_with(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            &RecipientInventory::new(),
            |_path| {
                calls += 1;
                Ok(HashSet::from([RecipientIdentity::Age("age1alice".into())]))
            },
        )
        .expect("match recipients");

        assert_eq!(calls, 1);
        assert_eq!(entries[0].recipient_ids, ["alice"]);
        assert_eq!(entries[1].recipient_ids, ["alice"]);
    }

    #[test]
    fn agenix_uses_explicit_inventory_and_missing_inventory_is_empty() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("secret.age");
        fs::write(&path, "").expect("write secret fixture");
        let path = path.canonicalize().expect("canonicalize secret fixture");
        let mut inventory: RecipientInventory = HashMap::new();
        inventory.insert(
            path.clone(),
            HashSet::from([RecipientIdentity::Age("age1alice".into())]),
        );
        let mut entries = vec![secret(SecretBackend::Agenix, path.to_string_lossy())];

        apply_recipients_to_secrets_with(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            &inventory,
            |_path| panic!("SOPS loader must not run for agenix"),
        )
        .expect("match agenix inventory");
        assert_eq!(entries[0].recipient_ids, ["alice"]);

        apply_recipients_to_secrets_with(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            &RecipientInventory::new(),
            |_path| panic!("SOPS loader must not run for agenix"),
        )
        .expect("missing inventory");
        assert!(entries[0].recipient_ids.is_empty());
    }

    #[test]
    fn metadata_supports_age_ssh_pgp_and_shamir_threshold_one() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("mixed.yaml");
        fs::write(
            &file,
            "sops:\n  shamir_threshold: 1\n  age:\n    - recipient: age1alice\n    - recipient: ssh-ed25519 AAAA comment\n  pgp:\n    - fp: abcdef0123456789abcdef0123456789abcdef01\n",
        )
        .expect("write metadata");

        let identities = parse_sops_recipient_metadata(&file).expect("parse metadata");

        assert_eq!(
            identities,
            HashSet::from([
                RecipientIdentity::Age("age1alice".into()),
                RecipientIdentity::Ssh("ssh-ed25519 AAAA".into()),
                RecipientIdentity::Pgp("ABCDEF0123456789ABCDEF0123456789ABCDEF01".into()),
            ])
        );
    }

    #[test]
    fn metadata_errors_include_filename_and_reject_key_groups() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("missing.yaml");
        let error = parse_sops_recipient_metadata(&missing).expect_err("missing file");
        assert!(error.contains("missing.yaml"));

        let malformed = dir.path().join("malformed.yaml");
        fs::write(&malformed, "sops: [").expect("write malformed metadata");
        let error = parse_sops_recipient_metadata(&malformed).expect_err("malformed file");
        assert!(error.contains("malformed.yaml"));

        let no_metadata = dir.path().join("no-metadata.yaml");
        fs::write(&no_metadata, "value: encrypted\n").expect("write file without metadata");
        let error = parse_sops_recipient_metadata(&no_metadata).expect_err("missing metadata");
        assert!(error.contains("no-metadata.yaml"));

        let groups = dir.path().join("groups.yaml");
        fs::write(
            &groups,
            "sops:\n  shamir_threshold: 2\n  key_groups:\n    - age:\n        - recipient: age1alice\n",
        )
        .expect("write grouped metadata");
        let error = parse_sops_recipient_metadata(&groups).expect_err("unsupported groups");
        assert!(error.contains("key-group/Shamir"));
    }

    #[test]
    fn sops_metadata_loader_errors_leave_recipient_access_unresolved() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("failing.yaml");
        fs::write(&file, "").expect("write secret fixture");
        let mut entries = vec![secret(SecretBackend::Sops, file.to_string_lossy())];
        apply_recipients_to_secrets_with(
            dir.path().to_str().expect("valid path"),
            &mut entries,
            &[known_recipient("alice", "age1alice")],
            &RecipientInventory::new(),
            |_path: &Path| Err("synthetic metadata failure".into()),
        )
        .expect("metadata failure is represented in the entry");

        assert!(!entries[0].public_recipients_resolved);
        assert_eq!(
            entries[0].decryption_capability,
            DecryptionCapability::Unknown
        );
    }
}
