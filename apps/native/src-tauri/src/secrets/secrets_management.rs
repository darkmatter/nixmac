use crate::{
    secrets::{
        identities::load_secret_identities,
        is_readable_file,
        recipients::{
            apply_recipients_to_secrets_with_identities, load_recipients,
            recipient_has_local_identity,
        },
        resolve_secret_file_path, sanitized_subprocess_error,
    },
    shared_types::{
        DecryptionIdentity, DecryptionIdentityKind, SecretBackend, SecretEntry, SecretsVault,
    },
    system::nix::nix_command,
    utils::nix_string_literal,
};
use std::path::Path;

const AGENIX_DECRYPTION_FAILED: &str = "Failed to decrypt agenix secret";
const SOPS_DECRYPTION_FAILED: &str = "Failed to decrypt SOPS secret";

/// Decrypts a single secret from the configured repo, returning its plaintext value.
/// Use this carefully, as it exposes sensitive data. The decrypted value is not stored in the vault.
/// Don't send it to the agent or log it. Only use it for immediate display in the UI, and clear it from memory as soon as possible.
pub fn decrypt_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
    backend: SecretBackend,
) -> Result<String, String> {
    log::info!(
        "Decrypting secret declaration {secret_id} of type {backend:?} from config dir {config_dir}"
    );
    match backend {
        SecretBackend::Sops => decrypt_sops_secret(host_attr, config_dir, secret_id),
        SecretBackend::Agenix => decrypt_agenix_secret(host_attr, config_dir, secret_id),
    }
}

/// Decrypts an agenix secret from the configured repo, returning its plaintext value.
/// Use this carefully, as it exposes sensitive data.
fn decrypt_agenix_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
) -> Result<String, String> {
    let mut matches = load_agenix_secrets(host_attr, config_dir)?
        .into_iter()
        .filter(|secret| secret.id == secret_id);
    let secret = matches
        .next()
        .ok_or_else(|| format!("Secret declaration '{secret_id}' does not exist"))?;
    let secret_file_path = resolve_secret_file_path(config_dir, &secret.file)?;
    let identity_paths = readable_agenix_identity_paths(
        load_secret_identities(host_attr, config_dir)?.agenix_identity_paths,
    );
    if identity_paths.is_empty() {
        return Err(format!(
            "Agenix secret '{secret_id}' has no readable age.identityPaths"
        ));
    }
    // Preserve age's native SSH handling as the first attempt for encrypted
    // files that contain a matching raw SSH recipient stanza. The conversion
    // fallback below is only needed for recipients stored as ssh-to-age aliases.
    let direct_output = age_decrypt_command(config_dir, &secret_file_path, &identity_paths)
        .output()
        .map_err(|e| format!("Failed to execute age command: {e}"))?;
    if direct_output.status.success() {
        return String::from_utf8(direct_output.stdout)
            .map_err(|e| format!("age returned invalid UTF-8: {e}"));
    }
    // A raw OpenSSH identity cannot unwrap the X25519 stanza produced when an
    // agenix rule uses its ssh-to-age age1 alias. Only after the native attempt
    // fails, try streaming converted SSH identities to age. This fallback is
    // deliberately separate so conversion failures cannot poison native SSH
    // decryption, especially for passphrase-protected private keys.
    let Some(mut fallback_command) =
        ssh_to_age_decrypt_command(config_dir, &secret_file_path, &identity_paths)
    else {
        return Err(sanitized_subprocess_error(
            AGENIX_DECRYPTION_FAILED,
            &direct_output,
        ));
    };
    let fallback_output = fallback_command
        .output()
        .map_err(|e| format!("Failed to execute ssh-to-age fallback command: {e}"))?;
    if fallback_output.status.success() {
        return String::from_utf8(fallback_output.stdout)
            .map_err(|e| format!("age returned invalid UTF-8: {e}"));
    }

    // ssh-to-age may echo an entire private key to stderr when conversion
    // fails, so never include subprocess stderr in an error returned to the UI
    // or logger.
    Err(sanitized_subprocess_error(
        AGENIX_DECRYPTION_FAILED,
        &fallback_output,
    ))
}

/// Keep only identity files that age can attempt to read. A single missing or
/// unreadable `--identity` makes age fail without trying the remaining files.
fn readable_agenix_identity_paths(identity_paths: Vec<String>) -> Vec<String> {
    identity_paths
        .into_iter()
        .filter(|identity_path| is_readable_file(identity_path))
        .collect()
}

/// Decrypts a SOPS secret from the configured repo, returning its plaintext value.
/// Use this carefully, as it exposes sensitive data.
fn decrypt_sops_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
) -> Result<String, String> {
    let mut matches = load_sops_secrets(host_attr, config_dir)?
        .into_iter()
        .filter(|secret| secret.id == secret_id);
    let secret = matches
        .next()
        .ok_or_else(|| format!("Secret declaration '{secret_id}' does not exist"))?;

    let secret_file_path = resolve_secret_file_path(config_dir, &secret.file)?;

    let sops_key = secret
        .sops_key
        .as_deref()
        .ok_or_else(|| format!("SOPS secret '{secret_id}' has no key"))?;

    // Use the same configured and ambient identities that determine the
    // vault's decryption capability. Keep a bare SOPS attempt as a fallback
    // for identity mechanisms we cannot currently inventory (for example
    // PGP, KMS, agents, and plugins).
    let (_, decryption_identities, _) = load_recipients(host_attr, config_dir, &[], false)?;
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
        last_error = Some(sanitized_subprocess_error(SOPS_DECRYPTION_FAILED, &output));
    }
    Err(last_error.unwrap_or_else(|| "sops decryption was not attempted".to_string()))
}

/// Decrypts a secret from the configured repo using age executed via nix, returning its plaintext value.
fn age_decrypt_command(
    config_dir: &str,
    secret_file_path: &Path,
    identity_paths: &[String],
) -> std::process::Command {
    let mut command = nix_command(config_dir);
    command.args(["shell", "nixpkgs#age", "-c", "age", "--decrypt"]);
    for identity_path in identity_paths {
        command.args(["--identity", identity_path]);
    }
    command.arg(secret_file_path);
    command
}

/// Construct the fallback that converts SSH private identities for agenix
/// rules using their ssh-to-age `age1` aliases. Returns `None` when no
/// configured identity has the neighboring `.pub` file used to classify SSH
/// identities. Converted private material is streamed between subprocesses
/// and never enters Rust memory or command arguments.
fn ssh_to_age_decrypt_command(
    config_dir: &str,
    secret_file_path: &Path,
    identity_paths: &[String],
) -> Option<std::process::Command> {
    let ssh_identity_paths: Vec<&String> = identity_paths
        .iter()
        .filter(|identity_path| Path::new(&format!("{identity_path}.pub")).is_file())
        .collect();
    if ssh_identity_paths.is_empty() {
        return None;
    }

    // Positional parameters keep all paths out of the shell source.
    let conversion_pipeline = ssh_identity_paths
        .iter()
        .enumerate()
        .map(|(index, _)| format!("ssh-to-age -private-key -i \"${}\"", index + 1))
        .collect::<Vec<_>>()
        .join("; ");
    let secret_file_arg = ssh_identity_paths.len() + 1;
    let script = format!(
        "{{ {conversion_pipeline}; }} 2>/dev/null | age --decrypt --identity - \"${secret_file_arg}\""
    );
    let mut command = nix_command(config_dir);
    command.args([
        "shell",
        "nixpkgs#age",
        "nixpkgs#ssh-to-age",
        "-c",
        "sh",
        "-c",
        &script,
        "age-with-ssh-to-age",
    ]);
    command.args(ssh_identity_paths);
    command.arg(secret_file_path);
    Some(command)
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

    let (recipients, decryption_identities, agenix_inventory) =
        load_recipients(host_attr, config_dir, &entries, true)?;
    apply_recipients_to_secrets_with_identities(
        config_dir,
        &mut entries,
        &recipients,
        &decryption_identities,
        &agenix_inventory,
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
    use super::{
        AGENIX_DECRYPTION_FAILED, SOPS_DECRYPTION_FAILED, age_decrypt_command,
        readable_agenix_identity_paths, resolve_secret_file_path, sanitized_subprocess_error,
        sops_decrypt_command, sops_extract_path, ssh_to_age_decrypt_command,
    };
    use crate::shared_types::{
        DecryptionIdentity, DecryptionIdentityKind, DecryptionIdentityLocality,
    };
    use std::{
        ffi::OsStr,
        fs,
        os::unix::process::ExitStatusExt,
        path::Path,
        process::{ExitStatus, Output},
    };
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
    fn decryption_errors_do_not_expose_subprocess_output() {
        let output = Output {
            status: ExitStatus::from_raw(1),
            stdout: b"decrypted secret".to_vec(),
            stderr: b"ssh-to-age: failed to convert '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate key material\n-----END OPENSSH PRIVATE KEY-----'"
                .to_vec(),
        };

        let agenix_error = sanitized_subprocess_error(AGENIX_DECRYPTION_FAILED, &output);
        let sops_error = sanitized_subprocess_error(SOPS_DECRYPTION_FAILED, &output);

        assert_eq!(agenix_error, AGENIX_DECRYPTION_FAILED);
        assert_eq!(sops_error, SOPS_DECRYPTION_FAILED);
        for error in [agenix_error, sops_error] {
            assert!(!error.contains("BEGIN OPENSSH PRIVATE KEY"));
            assert!(!error.contains("private key material"));
            assert!(!error.contains("decrypted secret"));
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
    fn decrypt_invokes_age_with_readable_agenix_identities_only() {
        let identities = TempDir::new().expect("create identities dir");
        let first_identity = identities.path().join("host key");
        let missing_identity = identities.path().join("missing key");
        let second_identity = identities.path().join("age keys.txt");
        fs::write(&first_identity, "AGE-SECRET-KEY-1TEST").expect("write first identity");
        fs::write(&second_identity, "AGE-SECRET-KEY-1TEST").expect("write second identity");

        let identity_paths = readable_agenix_identity_paths(vec![
            first_identity.to_string_lossy().into_owned(),
            missing_identity.to_string_lossy().into_owned(),
            second_identity.to_string_lossy().into_owned(),
        ]);
        let command = age_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/a secret.age"),
            &identity_paths,
        );
        let args: Vec<&OsStr> = command.get_args().collect();

        assert_eq!(
            args,
            [
                OsStr::new("shell"),
                OsStr::new("nixpkgs#age"),
                OsStr::new("-c"),
                OsStr::new("age"),
                OsStr::new("--decrypt"),
                OsStr::new("--identity"),
                first_identity.as_os_str(),
                OsStr::new("--identity"),
                second_identity.as_os_str(),
                OsStr::new("/tmp/a secret.age"),
            ]
        );
    }

    #[test]
    fn ssh_to_age_conversion_is_separate_from_native_age_attempt() {
        let identities = TempDir::new().expect("create identities dir");
        let ssh_identity = identities.path().join("ssh host key");
        let age_identity = identities.path().join("age keys.txt");
        fs::write(&ssh_identity, "OPENSSH PRIVATE KEY").expect("write SSH identity");
        fs::write(
            format!("{}.pub", ssh_identity.to_string_lossy()),
            "ssh-ed25519 AAAAtest",
        )
        .expect("write SSH public key");
        fs::write(&age_identity, "AGE-SECRET-KEY-1TEST").expect("write age identity");

        let identity_paths = vec![
            ssh_identity.to_string_lossy().into_owned(),
            age_identity.to_string_lossy().into_owned(),
        ];
        let direct_command = age_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/a secret.age"),
            &identity_paths,
        );
        let direct_args: Vec<&OsStr> = direct_command.get_args().collect();
        assert_eq!(
            direct_args,
            [
                OsStr::new("shell"),
                OsStr::new("nixpkgs#age"),
                OsStr::new("-c"),
                OsStr::new("age"),
                OsStr::new("--decrypt"),
                OsStr::new("--identity"),
                ssh_identity.as_os_str(),
                OsStr::new("--identity"),
                age_identity.as_os_str(),
                OsStr::new("/tmp/a secret.age"),
            ]
        );

        let fallback_command = ssh_to_age_decrypt_command(
            "/tmp/config",
            Path::new("/tmp/a secret.age"),
            &identity_paths,
        )
        .expect("SSH identity should produce an ssh-to-age fallback");
        let fallback_args: Vec<&OsStr> = fallback_command.get_args().collect();

        assert_eq!(
            fallback_args,
            [
                OsStr::new("shell"),
                OsStr::new("nixpkgs#age"),
                OsStr::new("nixpkgs#ssh-to-age"),
                OsStr::new("-c"),
                OsStr::new("sh"),
                OsStr::new("-c"),
                OsStr::new(
                    "{ ssh-to-age -private-key -i \"$1\"; } 2>/dev/null | age --decrypt --identity - \"$2\""
                ),
                OsStr::new("age-with-ssh-to-age"),
                ssh_identity.as_os_str(),
                OsStr::new("/tmp/a secret.age"),
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
