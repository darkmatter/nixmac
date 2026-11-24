use crate::{shared_types::SecretRecipient, system::nix::nix_command, utils::nix_string_literal};
use serde::Deserialize;
use std::collections::HashSet;

/// Command to load the secrets state for the configured repo.
const LOAD_SECRET_IDENTITIES_APPLY: &str = r#"
cfg:
  let
    hostKeys = cfg.services.openssh.hostKeys or [];
    sopsPaths = cfg.sops.age.sshKeyPaths or [];
    ageKeyFile = cfg.sops.age.keyFile or null;
    agenixPaths = cfg.age.identityPaths or [];
  in {
    ageKeyFile = if ageKeyFile == null then null else toString ageKeyFile;
    agenixIdentityPaths = map toString agenixPaths;
    hostKeys = map (key: {
      path = key.path;
      publicKeyPath = key.path + ".pub";
      type = key.type;
      usedBySops = builtins.elem key.path sopsPaths;
      usedByAgenix = builtins.elem (toString key.path) (map toString agenixPaths);
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
pub(crate) struct HostKey {
    pub path: String,
    pub public_key_path: String,
    #[serde(rename = "type")]
    pub key_type: String,
    #[serde(default)]
    pub used_by_sops: bool,
    #[serde(default)]
    pub used_by_agenix: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecretIdentities {
    pub age_key_file: Option<String>,
    #[serde(default)]
    pub host_keys: Vec<HostKey>,
    #[serde(default)]
    pub other_sops_identities: Vec<String>,
    #[serde(default)]
    pub agenix_identity_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum RecipientIdentity {
    Age(String),
    Ssh(String),
    Pgp(String),
}

/// Return the normalized public identities represented by a recipient.
pub(crate) fn identities_for_recipient(recipient: &SecretRecipient) -> HashSet<RecipientIdentity> {
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
        identities.insert(RecipientIdentity::Age(public_key.to_string()));
    }
    identities
}

/// Normalize an age or SSH public identity, discarding SSH comments.
pub(crate) fn normalize_age_or_ssh_identity(value: &str) -> Option<RecipientIdentity> {
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

pub(crate) fn normalize_pgp_fingerprint(value: &str) -> Option<String> {
    let fingerprint = value.trim();
    if fingerprint.len() < 16 || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(fingerprint.to_ascii_uppercase())
}

fn is_ssh_key_type(value: &str) -> bool {
    value.starts_with("ssh-") || value.starts_with("ecdsa-") || value.starts_with("sk-ssh-")
}

/// Load the secret identities from the nix config repo by executing a nix eval to evaluate the identities in the repo.
/// This is used to determine which SSH host key is used by sops, and to convert it to an age public key for use in the secrets vault.
pub(crate) fn load_secret_identities(
    host_attr: &str,
    config_dir: &str,
) -> Result<SecretIdentities, String> {
    let safe_host_attr = nix_string_literal(host_attr);
    let flake_attr = format!(".#darwinConfigurations.{safe_host_attr}.config");

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

#[cfg(test)]
mod tests {
    use super::{
        RecipientIdentity, SecretIdentities, identities_for_recipient,
        normalize_age_or_ssh_identity, normalize_pgp_fingerprint,
    };
    use crate::shared_types::{RecipientKeyType, RecipientKind, RecipientSource, SecretRecipient};
    use std::collections::HashSet;

    fn recipient(public_key: &str) -> SecretRecipient {
        SecretRecipient {
            id: "test".into(),
            label: "test".into(),
            kind: RecipientKind::Unknown,
            device: "test".into(),
            fingerprint: String::new(),
            public_key: public_key.into(),
            key_type: RecipientKeyType::Unknown,
            source: RecipientSource::Unknown,
            in_use: true,
            registrations: Vec::new(),
        }
    }

    #[test]
    fn parses_secret_identity_projection() {
        let identities: SecretIdentities = serde_json::from_str(
            r#"{
                "ageKeyFile": "/Users/test/.config/sops/age/keys.txt",
                "hostKeys": [{
                    "path": "/etc/ssh/ssh_host_ed25519_key",
                    "publicKeyPath": "/etc/ssh/ssh_host_ed25519_key.pub",
                    "type": "ed25519",
                    "usedBySops": true,
                    "usedByAgenix": true
                }],
                "otherSopsIdentities": ["/Users/test/.config/sops/age/keys.txt"],
                "agenixIdentityPaths": ["/etc/ssh/ssh_host_ed25519_key"]
            }"#,
        )
        .expect("identity projection should deserialize");

        assert_eq!(identities.host_keys.len(), 1);
        assert_eq!(
            identities.age_key_file.as_deref(),
            Some("/Users/test/.config/sops/age/keys.txt")
        );
        assert!(identities.host_keys[0].used_by_sops);
        assert!(identities.host_keys[0].used_by_agenix);
        assert_eq!(
            identities.host_keys[0].public_key_path,
            "/etc/ssh/ssh_host_ed25519_key.pub"
        );
        assert_eq!(identities.other_sops_identities.len(), 1);
        assert_eq!(
            identities.agenix_identity_paths,
            ["/etc/ssh/ssh_host_ed25519_key"]
        );
    }

    #[test]
    fn missing_identity_lists_default_to_empty() {
        let identities: SecretIdentities =
            serde_json::from_str("{}").expect("empty projection should deserialize");

        assert!(identities.host_keys.is_empty());
        assert!(identities.other_sops_identities.is_empty());
        assert!(identities.agenix_identity_paths.is_empty());
        assert!(identities.age_key_file.is_none());
    }

    #[test]
    fn recipient_identities_handle_ssh_pgp_age_and_empty_values() {
        assert_eq!(
            identities_for_recipient(&recipient("ssh-ed25519 AAAAC3NzaSshData trailing-comment")),
            HashSet::from([RecipientIdentity::Ssh(
                "ssh-ed25519 AAAAC3NzaSshData".to_string()
            )])
        );
        assert_eq!(
            identities_for_recipient(&recipient("abcdef0123456789abcdef0123456789abcdef01")),
            HashSet::from([RecipientIdentity::Pgp(
                "ABCDEF0123456789ABCDEF0123456789ABCDEF01".to_string()
            )])
        );
        assert_eq!(
            identities_for_recipient(&recipient(" age1recipient ")),
            HashSet::from([RecipientIdentity::Age("age1recipient".to_string())])
        );
        assert!(identities_for_recipient(&recipient("   ")).is_empty());
    }

    #[test]
    fn normalizes_supported_identity_formats() {
        assert_eq!(normalize_age_or_ssh_identity("\n\t "), None);
        assert_eq!(
            normalize_age_or_ssh_identity(" age1trimmed "),
            Some(RecipientIdentity::Age("age1trimmed".to_string()))
        );
        assert_eq!(
            normalize_age_or_ssh_identity("ssh-ed25519 AAAA comment"),
            Some(RecipientIdentity::Ssh("ssh-ed25519 AAAA".to_string()))
        );
        assert_eq!(
            normalize_pgp_fingerprint("abcdef0123456789"),
            Some("ABCDEF0123456789".to_string())
        );
        assert_eq!(normalize_pgp_fingerprint("not-a-fingerprint"), None);
    }
}
