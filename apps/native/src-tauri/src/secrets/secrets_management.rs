use crate::{
    evolve::{
        GitignoreChecker, NixmacIgnoreChecker,
        file_ops::{
            relative_nix_path_between, relative_path_between, repo_relative_path,
            repo_relative_path_string, resolve_existing_path_in_dir,
        },
    },
    secrets::{
        identities::load_secret_identities,
        is_readable_file,
        recipients::{
            agenix_filename_matches, apply_recipients_to_secrets_with_identities,
            discover_agenix_rules_path, load_recipients, recipient_has_local_identity,
        },
        resolve_secret_file_path, sanitized_subprocess_error,
    },
    shared_types::{
        AddSecretResult, DecryptionIdentity, DecryptionIdentityKind, FileEditAction, SecretBackend,
        SecretEntry, SecretsVault, SemanticFileEdit,
    },
    system::nix::nix_command,
    utils::nix_string_literal,
};
use anyhow::{Context, anyhow};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
};

/// The path to the standard nix-darwin module that declares SOPS secrets.
const STANDARD_SOPS_MODULE: &str = "modules/darwin/sops-secrets.nix";
const STANDARD_AGENIX_MODULE: &str = "modules/darwin/agenix-secrets.nix";

/// Returns the repository-relative path used for a SOPS secret.
fn managed_sops_file(secret_id: &str) -> String {
    format!("secrets/{secret_id}.yaml")
}

const UNCOMMITTED_REPO_ERROR: &str = "The repository has uncommitted changes. Commit or stash them before editing secrets so nixmac can roll back safely if verification fails.";

/// Require a clean repository before mutating a secret. This is a safety check,
/// not a formatting policy: the add/delete flows verify each edit with a dry
/// build and then commit only the files they touched. If verification fails, we
/// restore the exact paths we edited rather than guessing about unrelated work.
fn ensure_clean_repo(config_dir: &str) -> anyhow::Result<()> {
    let status = crate::git::status(config_dir).context("inspect repository status")?;
    if status.clean_head {
        Ok(())
    } else {
        anyhow::bail!(UNCOMMITTED_REPO_ERROR)
    }
}

/// Best-effort rollback for the small set of repository files touched by a secret
/// mutation. The clean-repo guard above ensures we only restore the exact files
/// owned by this operation; restoring unrelated user changes would be unsafe.
fn restore_repo_files_on_failure(config_dir: &str, paths: &[&str]) {
    for path in paths {
        if path.is_empty() {
            continue;
        }
        let _ = crate::git::restore_file(config_dir, path);
    }
}

/// Shared validation for the secret-edit flow: after a file mutation, we rerun
/// the host dry build before committing. The build acts as the final safety
/// gate, and if it fails we undo just the files touched in this operation.
fn verify_dry_build_for_secret_edit(
    config_dir: &str,
    host_attr: &str,
    action: &str,
) -> anyhow::Result<()> {
    let (passed, stdout, stderr) =
        crate::rebuild::dry_run_build_check(config_dir, host_attr, false)
            .context("run darwin build check")?;
    if passed {
        Ok(())
    } else {
        anyhow::bail!(
            "darwin build check failed after {action}:\n{}{}",
            stdout,
            stderr
        )
    }
}

/// Deletes a secret from the configured repo, returning the result.
pub fn delete_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
    backend: SecretBackend,
) -> Result<crate::shared_types::DeleteSecretResult, String> {
    match backend {
        SecretBackend::Sops => delete_sops_secret(host_attr, config_dir, secret_id),
        SecretBackend::Agenix => delete_age_secret(host_attr, config_dir, secret_id),
    }
}

/// Add a secret to the configured repo, returning the result.
pub fn add_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
    value: &str,
    backend: SecretBackend,
) -> Result<AddSecretResult, String> {
    match backend {
        SecretBackend::Sops => add_sops_secret(host_attr, config_dir, secret_id, value)
            .map_err(|error| error.to_string()),
        SecretBackend::Agenix => add_age_secret(host_attr, config_dir, secret_id, value)
            .map_err(|error| error.to_string()),
    }
}

/// Deletes an agenix secret from the configured repo, returning the result.
/// Requires that the repository is clean and that the secret exists.
/// If the operation fails, it attempts to restore the repository to its original state.
fn delete_age_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
) -> Result<crate::shared_types::DeleteSecretResult, String> {
    (|| -> anyhow::Result<crate::shared_types::DeleteSecretResult> {
        ensure_clean_repo(config_dir)?;

        log::info!("Deleting agenix secret declaration {secret_id} from config dir {config_dir}");

        let secret = load_agenix_secrets(host_attr, config_dir)
            .map_err(|error| anyhow!(error))?
            .into_iter()
            .find(|secret| secret.id == secret_id)
            .ok_or_else(|| anyhow!("Secret declaration '{secret_id}' does not exist"))?;

        let base = Path::new(config_dir);
        let rules_file = find_agenix_rules_file(base)?;
        let declaration_file = find_agenix_declaration_file(base)?;
        let rules_rel = repo_relative_path_string(base, &rules_file)?;
        let declaration_rel = repo_relative_path_string(base, &declaration_file)?;
        let (rule_key, encrypted_path) =
            resolve_agenix_rule_file(config_dir, &rules_file, &secret)?;
        let encrypted_rel = repo_relative_path_string(base, &encrypted_path)?;

        let operation = (|| -> anyhow::Result<crate::shared_types::DeleteSecretResult> {
            std::fs::remove_file(&encrypted_path).context("remove encrypted agenix secret")?;
            remove_agenix_rule(base, &rules_rel, &rule_key)?;
            remove_agenix_declaration(base, &declaration_rel, secret_id)?;

            verify_dry_build_for_secret_edit(config_dir, host_attr, "deleting the secret")?;

            if load_agenix_secrets(host_attr, config_dir)
                .map_err(|error| anyhow!(error))?
                .iter()
                .any(|secret| secret.id == secret_id)
            {
                anyhow::bail!("The agenix declaration is still present after editing the module");
            }
            if load_agenix_rule_keys(config_dir, &rules_file)?.contains(&rule_key) {
                anyhow::bail!("The agenix rule '{rule_key}' is still present after editing");
            }

            let commit = crate::git::commit_files(
                config_dir,
                &[&encrypted_rel, &rules_rel, &declaration_rel],
                &format!("secrets: delete {secret_id} (agenix)"),
            )
            .context("commit deleted agenix secret")?;

            Ok(crate::shared_types::DeleteSecretResult {
                secret_id: secret_id.to_string(),
                commit_hash: commit.hash,
            })
        })();

        if operation.is_err() {
            restore_repo_files_on_failure(
                config_dir,
                &[
                    encrypted_rel.as_str(),
                    rules_rel.as_str(),
                    declaration_rel.as_str(),
                ],
            );
        }
        operation
    })()
    .map_err(|error| error.to_string())
}

/// Load the evaluated agenix rule names from the rules file, returning an error if evaluation fails or the output is not valid JSON for some reason.
fn load_agenix_rule_keys(config_dir: &str, rules_file: &Path) -> anyhow::Result<Vec<String>> {
    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            "--file",
            rules_file.to_string_lossy().as_ref(),
            "--apply",
            "rules: builtins.attrNames rules",
        ])
        .output()
        .context("evaluate agenix rules")?;
    if !output.status.success() {
        anyhow::bail!(
            "Agenix rules evaluation failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    serde_json::from_slice(&output.stdout).context("parse evaluated agenix rule names")
}

/// Resolve the agenix rule key and the path to the encrypted file for a given secret entry,
/// returning an error if the rule cannot be resolved or the file does not exist.
fn resolve_agenix_rule_file(
    config_dir: &str,
    rules_file: &Path,
    secret: &SecretEntry,
) -> anyhow::Result<(String, PathBuf)> {
    let base = Path::new(config_dir);
    let rules_dir = rules_file.parent().unwrap_or(base);
    let rule_keys = load_agenix_rule_keys(config_dir, rules_file)?;
    let rule_key = matching_agenix_rule_key(&rule_keys, secret)?;

    let mut candidates = [rules_dir.join(&rule_key), base.join(&rule_key)]
        .into_iter()
        .filter_map(|path| path.canonicalize().ok())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.dedup();
    let resolved = match candidates.as_slice() {
        [path] => path,
        [] => anyhow::bail!("Encrypted file for agenix rule '{rule_key}' does not exist"),
        _ => anyhow::bail!(
            "Agenix rule '{rule_key}' resolves to multiple repository files; refusing to guess"
        ),
    };
    let base_resolved = base.canonicalize().context("resolve repository")?;
    let relative = repo_relative_path(&base_resolved, resolved).with_context(|| {
        format!(
            "Encrypted agenix file {} is outside the repository and cannot be deleted",
            resolved.display()
        )
    })?;
    Ok((rule_key, base.join(relative)))
}

/// Find the agenix rule key that matches a given secret entry, preferring an exact path match and falling back to a unique basename match if necessary.
fn matching_agenix_rule_key(rule_keys: &[String], secret: &SecretEntry) -> anyhow::Result<String> {
    let evaluated_path = Path::new(&secret.file);
    let exact = rule_keys
        .iter()
        .filter(|key| evaluated_path.ends_with(Path::new(key)))
        .cloned()
        .collect::<Vec<_>>();
    let matching = if exact.is_empty() {
        rule_keys
            .iter()
            .filter(|key| {
                Path::new(key)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|basename| agenix_filename_matches(&secret.file, basename))
            })
            .cloned()
            .collect::<Vec<_>>()
    } else {
        exact
    };
    match matching.as_slice() {
        [key] => Ok(key.clone()),
        [] => anyhow::bail!(
            "Could not find an agenix rule matching secret '{}' at {}",
            secret.id,
            secret.file
        ),
        _ => anyhow::bail!(
            "Found multiple agenix rules matching secret '{}' at {}; refusing to guess",
            secret.id,
            secret.file
        ),
    }
}

/// Remove an agenix rule from the rules file, returning an error if the rule was not found.
fn remove_agenix_rule(base: &Path, relative_file: &str, rule_key: &str) -> anyhow::Result<()> {
    let attrpath = serde_json::to_string(rule_key).expect("serialize agenix rule key");
    crate::evolve::nix_file_editor::remove_attrpath_in_file(base, relative_file, &attrpath, true)
        .with_context(|| format!("remove agenix rule '{attrpath}'"))
}

/// Remove an agenix declaration for a specific secret from the declaration module, returning an error if the declaration was not found.
fn remove_agenix_declaration(
    base: &Path,
    relative_file: &str,
    secret_id: &str,
) -> anyhow::Result<()> {
    let attrpath = format!("age.secrets.\"{secret_id}\"");
    crate::evolve::nix_file_editor::remove_attrpath_in_file(base, relative_file, &attrpath, true)
        .with_context(|| format!("remove agenix declaration '{attrpath}'"))
}

/// Deletes a SOPS secret from the configured repo, returning the result.
/// Requires that the repository is clean and that the secret exists.
/// If the operation fails, it attempts to restore the repository to its original state.
fn delete_sops_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
) -> Result<crate::shared_types::DeleteSecretResult, String> {
    (|| -> anyhow::Result<crate::shared_types::DeleteSecretResult> {
        ensure_clean_repo(config_dir)?;

        log::info!("Deleting SOPS secret declaration {secret_id} from config dir {config_dir}");

        load_sops_secrets(host_attr, config_dir)
            .map_err(|error| anyhow!(error))?
            .into_iter()
            .find(|secret| secret.id == secret_id)
            .ok_or_else(|| anyhow!("Secret declaration '{secret_id}' does not exist"))?;

        let base = Path::new(config_dir);
        let encrypted_file = managed_sops_file(secret_id);
        let encrypted_path = resolve_existing_path_in_dir(base, &encrypted_file)
            .with_context(|| format!("resolve {encrypted_file}"))?;
        let declaration_file = find_sops_declaration_file(base)?;
        let declaration_rel = repo_relative_path_string(base, &declaration_file)?;

        // Steps:
        // 1. Remove the secret's SOPS YAML file.
        // 2. Remove the secret declaration from the nix-darwin module.
        // 3. Run a dry build to verify that the secret is no longer present.
        let operation = (|| -> anyhow::Result<crate::shared_types::DeleteSecretResult> {
            std::fs::remove_file(&encrypted_path).context("remove SOPS secret file")?;
            remove_sops_declaration(base, &declaration_rel, secret_id)?;

            verify_dry_build_for_secret_edit(config_dir, host_attr, "deleting the secret")?;

            if load_sops_secrets(host_attr, config_dir)
                .map_err(|error| anyhow!(error))?
                .iter()
                .any(|secret| secret.id == secret_id)
            {
                anyhow::bail!("The SOPS declaration is still present after editing the module");
            }

            let commit = crate::git::commit_files(
                config_dir,
                &[&encrypted_file, &declaration_rel],
                &format!("secrets: delete {secret_id} (sops)"),
            )
            .context("commit deleted SOPS secret")?;

            Ok(crate::shared_types::DeleteSecretResult {
                secret_id: secret_id.to_string(),
                commit_hash: commit.hash,
            })
        })();

        if operation.is_err() {
            restore_repo_files_on_failure(
                config_dir,
                &[encrypted_file.as_str(), declaration_rel.as_str()],
            );
        }
        operation
    })()
    .map_err(|error| error.to_string())
}

/// Removes a SOPS secret declaration from the nix-darwin module, returning an error if the declaration was not found.
fn remove_sops_declaration(
    base: &Path,
    relative_file: &str,
    secret_id: &str,
) -> anyhow::Result<()> {
    let attrpath = format!("sops.secrets.\"{secret_id}\"");
    crate::evolve::nix_file_editor::remove_attrpath_in_file(base, relative_file, &attrpath, true)
        .with_context(|| format!("remove SOPS declaration '{attrpath}'"))
}

/// Add an agenix secret to the configured repo, returning the result.
/// Requires that the repository is clean and that the secret does not already exist.
/// If the operation fails, it attempts to restore the repository to its original state.
fn add_age_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
    value: &str,
) -> anyhow::Result<AddSecretResult> {
    validate_new_secret(secret_id, value)?;
    ensure_clean_repo(config_dir)?;

    let base = Path::new(config_dir);
    let vault = load_secrets_vault(host_attr, config_dir).map_err(|error| anyhow!(error))?;
    if vault.entries.iter().any(|secret| secret.id == secret_id) {
        anyhow::bail!("Secret declaration '{secret_id}' already exists");
    }

    // Steps:
    // 1. Encrypt the secret value with age and write it to a new file in the repository.
    // 2. Add a new rule to the agenix rules file that points to the encrypted file and lists the recipients.
    // 3. Add a new declaration to the agenix declaration module that points to the encrypted file.

    let rules_file = find_agenix_rules_file(base)?;
    let declaration_file = find_agenix_declaration_file(base)?;
    let rules_rel = repo_relative_path_string(base, &rules_file)?;
    let declaration_rel = repo_relative_path_string(base, &declaration_file)?;
    let encrypted_rel = format!("secrets/{secret_id}.age");
    let encrypted_path = base.join(&encrypted_rel);
    if encrypted_path.exists() {
        anyhow::bail!("Encrypted file '{encrypted_rel}' already exists");
    }

    let recipients = vault
        .recipients
        .iter()
        .filter(|recipient| {
            recipient
                .registrations
                .iter()
                .any(|registration| registration.backend == SecretBackend::Agenix)
        })
        .map(|recipient| recipient.public_key.clone())
        .collect::<Vec<_>>();
    if recipients.is_empty() {
        anyhow::bail!(
            "No agenix recipients were found in {}. Register at least one public key before adding a secret.",
            rules_rel
        );
    }

    let operation = (|| -> anyhow::Result<AddSecretResult> {
        encrypt_age_secret(config_dir, &encrypted_rel, value.as_bytes(), &recipients)?;
        declare_agenix_rule(base, &rules_file, &encrypted_rel, &recipients)?;
        declare_agenix_secret(base, &declaration_file, secret_id, &encrypted_rel)?;

        verify_dry_build_for_secret_edit(config_dir, host_attr, "adding the secret")?;

        let reloaded_vault =
            load_secrets_vault(host_attr, config_dir).map_err(|error| anyhow!(error))?;
        let declared = reloaded_vault
            .entries
            .iter()
            .find(|secret| secret.backend == SecretBackend::Agenix && secret.id == secret_id);
        let Some(declared) = declared else {
            anyhow::bail!(
                "The edited agenix declaration was not present in the evaluated host configuration"
            );
        };
        if !declared.public_recipients_resolved
            || !recipients
                .iter()
                .all(|recipient| declared.public_recipients.contains(recipient))
        {
            anyhow::bail!(
                "The new agenix rule did not resolve to every recipient used for encryption"
            );
        }

        let commit = crate::git::commit_files(
            config_dir,
            &[&encrypted_rel, &rules_rel, &declaration_rel],
            &format!("secrets: add {secret_id} (agenix)"),
        )
        .context("commit agenix secret")?;

        Ok(AddSecretResult {
            secret_id: secret_id.to_string(),
            encrypted_file: encrypted_rel.clone(),
            declaration_file: declaration_rel.clone(),
            runtime_path: format!("/run/agenix/{secret_id}"),
            commit_hash: commit.hash,
        })
    })();

    if operation.is_err() {
        restore_repo_files_on_failure(
            config_dir,
            &[
                encrypted_rel.as_str(),
                rules_rel.as_str(),
                declaration_rel.as_str(),
            ],
        );
    }
    operation
}

/// Locate the classic agenix rules file that nixmac can safely edit and commit.
fn find_agenix_rules_file(base: &Path) -> anyhow::Result<PathBuf> {
    let candidate = discover_agenix_rules_path(base)
        .map_err(|error| anyhow!(error))?
        .ok_or_else(|| {
            anyhow!("Could not find classic agenix rules at secrets.nix or secrets/secrets.nix")
        })?;
    let resolved = candidate
        .canonicalize()
        .with_context(|| format!("resolve agenix rules file {}", candidate.display()))?;
    if !resolved.is_file() {
        anyhow::bail!(
            "Agenix rules path {} is not a regular file",
            resolved.display()
        );
    }
    let base_resolved = base
        .canonicalize()
        .with_context(|| format!("resolve repository {}", base.display()))?;
    let relative = repo_relative_path(&base_resolved, &resolved).with_context(|| {
        format!(
            "Agenix rules file {} is outside the repository and cannot be committed",
            resolved.display()
        )
    })?;
    Ok(base.join(relative))
}

/// Find the Nix module that owns `age.secrets` declarations.
fn find_agenix_declaration_file(base: &Path) -> anyhow::Result<PathBuf> {
    find_secret_declaration_file(base, STANDARD_AGENIX_MODULE, "age.secrets", "agenix")
}

/// Find the Nix module that owns `sops.secrets` declarations.
fn find_sops_declaration_file(base: &Path) -> anyhow::Result<PathBuf> {
    find_secret_declaration_file(base, STANDARD_SOPS_MODULE, "sops.secrets", "SOPS")
}

/// Find a Nix module that contains a specific secret declaration, preferring the standard module path if it exists and is visible.
fn find_secret_declaration_file(
    base: &Path,
    standard_relative: &str,
    declaration_marker: &str,
    backend_name: &str,
) -> anyhow::Result<PathBuf> {
    let visible = GitignoreChecker::new(base)?
        .map(|checker| checker.visible_files())
        .transpose()?;
    let nixmac_ignore = NixmacIgnoreChecker::new(base)?;
    let standard_relative = Path::new(standard_relative);
    let standard = base.join(standard_relative);
    if standard.is_file()
        && visible
            .as_ref()
            .is_none_or(|files| files.contains_file(standard_relative))
        && !nixmac_ignore.is_ignored(standard_relative, false)
    {
        let resolved = resolve_existing_path_in_dir(
            base,
            standard_relative
                .to_str()
                .ok_or_else(|| anyhow!("standard declaration path is not valid UTF-8"))?,
        )
        .with_context(|| format!("resolve {}", standard_relative.display()))?;
        if std::fs::read_to_string(&resolved).is_ok_and(|text| text.contains(declaration_marker)) {
            let base_resolved = base
                .canonicalize()
                .with_context(|| format!("resolve repository {}", base.display()))?;
            let relative = repo_relative_path(&base_resolved, &resolved)?;
            return Ok(base.join(relative));
        }
    }
    let candidates = walkdir::WalkDir::new(base)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let Ok(relative) = entry.path().strip_prefix(base) else {
                return false;
            };
            let is_dir = entry.file_type().is_dir();
            !nixmac_ignore.is_ignored(relative, is_dir)
                && visible.as_ref().is_none_or(|files| {
                    if is_dir {
                        files.contains_dir(relative)
                    } else {
                        files.contains_file(relative)
                    }
                })
        })
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.path().extension().is_some_and(|ext| ext == "nix")
        })
        .filter_map(|entry| {
            std::fs::read_to_string(entry.path())
                .ok()
                .filter(|text| text.contains(declaration_marker))
                .map(|_| entry.into_path())
        })
        .collect::<Vec<_>>();
    match candidates.as_slice() {
        [path] => Ok(path.clone()),
        [] => anyhow::bail!("Could not find a Nix module containing {declaration_marker}"),
        _ => anyhow::bail!(
            "Found multiple Nix modules containing {declaration_marker}; expected {} for {backend_name}",
            standard_relative.display()
        ),
    }
}

/// Encrypt a plaintext secret with age and write it to the specified relative path in the repository.
/// The plaintext is sent to age over stdin and is never written to disk.
fn encrypt_age_secret(
    config_dir: &str,
    relative_path: &str,
    plaintext: &[u8],
    recipients: &[String],
) -> anyhow::Result<()> {
    let mut command = age_encrypt_command(config_dir, recipients);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().context("execute age encrypt")?;
    child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("open age stdin"))?
        .write_all(plaintext)
        .context("send plaintext to age")?;
    let output = child.wait_with_output().context("wait for age encrypt")?;
    if !output.status.success() {
        anyhow::bail!(
            "age encryption failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let target = crate::evolve::file_ops::resolve_path_in_dir_allow_create(
        Path::new(config_dir),
        relative_path,
    )?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, output.stdout).context("write encrypted age file")
}

/// Build a command to encrypt a secret with age, using the configured recipients.
fn age_encrypt_command(config_dir: &str, recipients: &[String]) -> std::process::Command {
    let mut command = nix_command(config_dir);
    command.args(["shell", "nixpkgs#age", "-c", "age", "--encrypt"]);
    for recipient in recipients {
        command.args(["--recipient", recipient]);
    }
    command
}

/// Add a new agenix rule to the rules file, pointing to the specified encrypted file and listing the recipients.
/// The rule is added as a top-level attribute with the path to the encrypted file as its value, and a `publicKeys` attribute listing the recipients.
fn declare_agenix_rule(
    base: &Path,
    rules_file: &Path,
    encrypted_relative: &str,
    recipients: &[String],
) -> anyhow::Result<()> {
    let rules_rel = repo_relative_path_string(base, rules_file)?;
    let rules_dir = repo_relative_path(base, rules_file.parent().unwrap_or(base))?;
    let rule_path = relative_path_between(&rules_dir, Path::new(encrypted_relative))?
        .to_string_lossy()
        .replace('\\', "/");
    let mut attrs = serde_json::Map::new();
    attrs.insert("publicKeys".to_string(), serde_json::json!(recipients));
    crate::evolve::nix_file_editor::apply_semantic_edit(
        base,
        &SemanticFileEdit {
            path: rules_rel,
            action: FileEditAction::SetAttrs {
                path: serde_json::to_string(&rule_path).expect("serialize agenix rule key"),
                attrs,
            },
        },
        true,
        None,
    )
}

/// Add a new agenix secret declaration to the declaration module, pointing to the specified encrypted file.
/// The declaration is added as a top-level attribute under `age.secrets` with the secret ID as its key and a `file` attribute pointing to the encrypted file.
fn declare_agenix_secret(
    base: &Path,
    declaration_file: &Path,
    secret_id: &str,
    encrypted_relative: &str,
) -> anyhow::Result<()> {
    let declaration_rel = repo_relative_path_string(base, declaration_file)?;
    let from = repo_relative_path(base, declaration_file.parent().unwrap_or(base))?;
    let rendered_path = relative_nix_path_between(&from, Path::new(encrypted_relative))?;
    let mut attrs = serde_json::Map::new();
    attrs.insert(
        "file".to_string(),
        crate::evolve::nix_file_editor::nix_builtins_path_meta_value(&rendered_path),
    );
    crate::evolve::nix_file_editor::apply_semantic_edit(
        base,
        &SemanticFileEdit {
            path: declaration_rel,
            action: FileEditAction::SetAttrs {
                path: format!("age.secrets.\"{secret_id}\""),
                attrs,
            },
        },
        true,
        None,
    )
}

/// Add one value to its own SOPS YAML file, declare it in the
/// nix-darwin module, run a dry build, and commit only the two managed files.
/// Plaintext is kept in memory and sent to SOPS over stdin; it is never written
/// to the repository.
fn add_sops_secret(
    host_attr: &str,
    config_dir: &str,
    secret_id: &str,
    value: &str,
) -> anyhow::Result<AddSecretResult> {
    validate_new_secret(secret_id, value)?;
    ensure_clean_repo(config_dir)?;

    let base = Path::new(config_dir);
    if !base.join(".sops.yaml").is_file() && !base.join("sops.yaml").is_file() {
        anyhow::bail!("No .sops.yaml or sops.yaml was found in the repository root");
    }

    // Make sure the secret does not already exist in the vault.
    if load_sops_secrets(host_attr, config_dir)
        .map_err(|error| anyhow!(error))?
        .iter()
        .any(|secret| secret.id == secret_id)
    {
        anyhow::bail!("Secret declaration '{secret_id}' already exists");
    }

    let declaration_file = find_sops_declaration_file(base)?;
    let encrypted_file = managed_sops_file(secret_id);
    if base.join(&encrypted_file).exists() {
        anyhow::bail!("SOPS file '{encrypted_file}' already exists");
    }
    let plaintext = sops_plaintext(secret_id, value)?;

    let operation = (|| -> anyhow::Result<AddSecretResult> {
        encrypt_sops_yaml(config_dir, &encrypted_file, plaintext.as_bytes())?;
        declare_sops_secret(base, &declaration_file, secret_id, &encrypted_file)?;

        verify_dry_build_for_secret_edit(config_dir, host_attr, "adding the secret")?;

        // Reload the secrets vault to verify that the new secret is present and has the expected SOPS key.
        let declared = load_sops_secrets(host_attr, config_dir)
            .map_err(|error| anyhow!(error))?
            .into_iter()
            .any(|secret| secret.id == secret_id && secret.sops_key.as_deref() == Some(secret_id));
        if !declared {
            anyhow::bail!(
                "The edited SOPS declaration was not present in the evaluated host configuration"
            );
        }

        let declaration_rel = repo_relative_path_string(base, &declaration_file)?;
        let commit = crate::git::commit_files(
            config_dir,
            &[&encrypted_file, &declaration_rel],
            &format!("secrets: add {secret_id} (sops)"),
        )
        .context("commit SOPS secret")?;

        Ok(AddSecretResult {
            secret_id: secret_id.to_string(),
            encrypted_file: encrypted_file.clone(),
            declaration_file: declaration_rel,
            runtime_path: format!("/run/secrets/{secret_id}"),
            commit_hash: commit.hash,
        })
    })();

    if operation.is_err() {
        // The repo was clean at entry, and this helper restores only the files
        // this operation owns. That keeps the rollback bounded to the secret edit
        // and prevents accidentally discarding unrelated user work.
        let declaration_rel = repo_relative_path_string(base, &declaration_file)
            .ok()
            .unwrap_or_default();
        restore_repo_files_on_failure(
            config_dir,
            &[encrypted_file.as_str(), declaration_rel.as_str()],
        );
    }
    operation
}

/// Validates that a new secret ID and value are acceptable for adding to the repository.
/// Rules:
/// - Secret IDs must be lowercase slugs containing only a-z, 0-9, and '-'.
/// - Secret values must not be empty.
fn validate_new_secret(secret_id: &str, value: &str) -> anyhow::Result<()> {
    if secret_id.is_empty()
        || !secret_id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        anyhow::bail!("Secret names must be lowercase slugs containing only a-z, 0-9, and '-'");
    }
    if value.is_empty() {
        anyhow::bail!("Secret value must not be empty");
    }
    Ok(())
}

/// Renders the plaintext for a one-secret SOPS YAML file.
fn sops_plaintext(secret_id: &str, value: &str) -> anyhow::Result<String> {
    let mut mapping = serde_yaml::Mapping::new();
    mapping.insert(
        serde_yaml::Value::String(secret_id.to_string()),
        serde_yaml::Value::String(value.to_string()),
    );
    let document = serde_yaml::Value::Mapping(mapping);
    serde_yaml::to_string(&document).context("serialize secrets YAML")
}

/// Encrypts a SOPS YAML file using the available identities, writing the encrypted file to the given relative path.
fn encrypt_sops_yaml(
    config_dir: &str,
    relative_path: &str,
    plaintext: &[u8],
) -> anyhow::Result<()> {
    let mut command = nix_command(config_dir);
    command.args([
        "shell",
        "nixpkgs#sops",
        "-c",
        "sops",
        "--encrypt",
        "--input-type",
        "yaml",
        "--output-type",
        "yaml",
        "--filename-override",
        relative_path,
        "/dev/stdin",
    ]);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().context("execute sops encrypt")?;
    child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("open sops stdin"))?
        .write_all(plaintext)
        .context("send plaintext to sops")?;
    let output = child.wait_with_output().context("wait for sops encrypt")?;
    if !output.status.success() {
        anyhow::bail!(
            "sops encryption failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let target = crate::evolve::file_ops::resolve_path_in_dir_allow_create(
        Path::new(config_dir),
        relative_path,
    )?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, output.stdout).context("write encrypted SOPS file")
}

/// Make one explicit local age identity available to a SOPS decryption attempt.
///
/// These environment variables are optional: without them, SOPS still uses
/// identities available through its inherited environment, default age key
/// locations, agents, plugins, PGP, or cloud KMS providers. We set one here
/// because nixmac also discovers identity paths from the evaluated host
/// configuration, and SOPS cannot otherwise know about an arbitrary key file.
/// `Command::env` affects only this child command; it does not modify nixmac's
/// process environment.
///
/// Passing `None` deliberately sets nothing and lets SOPS perform its normal
/// ambient discovery. Passing `Some` overrides only the matching environment
/// variable for this attempt; other inherited identity mechanisms remain
/// available.
fn apply_sops_identity(command: &mut std::process::Command, identity: Option<&DecryptionIdentity>) {
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
}

/// Declares a SOPS secret in the existing nix-darwin module identified by `declaration_file`.
fn declare_sops_secret(
    base: &Path,
    declaration_file: &Path,
    secret_id: &str,
    encrypted_file: &str,
) -> anyhow::Result<()> {
    let declaration_rel = repo_relative_path_string(base, declaration_file)?;
    let from = repo_relative_path(base, declaration_file.parent().unwrap_or(base))?;
    let rendered_path = relative_nix_path_between(&from, Path::new(encrypted_file))?;
    let mut attrs = serde_json::Map::new();
    attrs.insert(
        "sopsFile".to_string(),
        crate::evolve::nix_file_editor::nix_builtins_path_meta_value(&rendered_path),
    );
    crate::evolve::nix_file_editor::apply_semantic_edit(
        base,
        &SemanticFileEdit {
            path: declaration_rel,
            action: FileEditAction::SetAttrs {
                path: format!("sops.secrets.\"{secret_id}\""),
                attrs,
            },
        },
        true,
        None,
    )
}

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
    apply_sops_identity(&mut command, identity);
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
    let base = Path::new(config_dir);
    let agenix_rules_file = find_agenix_rules_file(base)
        .and_then(|path| repo_relative_path_string(base, &path))
        .ok();
    let agenix_declaration_path = find_agenix_declaration_file(base).ok();
    let agenix_encrypted_directory_from_declaration = agenix_declaration_path
        .as_ref()
        .and_then(|path| repo_relative_path(base, path.parent().unwrap_or(base)).ok())
        .and_then(|from| relative_nix_path_between(&from, Path::new("secrets")).ok());
    let agenix_declaration_file =
        agenix_declaration_path.and_then(|path| repo_relative_path_string(base, &path).ok());

    Ok(SecretsVault {
        primary_decryption_identity_id,
        agenix_rules_file,
        agenix_declaration_file,
        agenix_encrypted_directory_from_declaration,
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
        AGENIX_DECRYPTION_FAILED, SOPS_DECRYPTION_FAILED, age_decrypt_command, age_encrypt_command,
        find_agenix_declaration_file, find_agenix_rules_file, find_sops_declaration_file,
        managed_sops_file, matching_agenix_rule_key, readable_agenix_identity_paths,
        relative_nix_path_between, relative_path_between, repo_relative_path_string,
        resolve_secret_file_path, sanitized_subprocess_error, secret, sops_decrypt_command,
        sops_extract_path, sops_plaintext, ssh_to_age_decrypt_command, validate_new_secret,
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
    fn encrypt_invokes_age_with_every_registered_recipient() {
        let command = age_encrypt_command(
            "/tmp/config",
            &[
                "age1example".to_string(),
                "ssh-ed25519 AAAAexample".to_string(),
            ],
        );
        let args: Vec<&OsStr> = command.get_args().collect();

        assert_eq!(
            args,
            [
                OsStr::new("shell"),
                OsStr::new("nixpkgs#age"),
                OsStr::new("-c"),
                OsStr::new("age"),
                OsStr::new("--encrypt"),
                OsStr::new("--recipient"),
                OsStr::new("age1example"),
                OsStr::new("--recipient"),
                OsStr::new("ssh-ed25519 AAAAexample"),
            ]
        );
    }

    #[test]
    fn agenix_rule_matching_handles_nix_store_file_names() {
        let entry = secret(
            "api-token",
            "api-token",
            crate::shared_types::SecretBackend::Agenix,
            "/nix/store/0123456789abcdfghijklmnpqrsvwxyz-api-token.age",
            None,
        );

        assert_eq!(
            matching_agenix_rule_key(
                &["api-token.age".to_string(), "other.age".to_string()],
                &entry,
            )
            .expect("match store-backed secret"),
            "api-token.age"
        );
    }

    #[test]
    fn agenix_rule_matching_refuses_ambiguous_basenames() {
        let entry = secret(
            "api-token",
            "api-token",
            crate::shared_types::SecretBackend::Agenix,
            "/nix/store/0123456789abcdfghijklmnpqrsvwxyz-api-token.age",
            None,
        );

        assert!(
            matching_agenix_rule_key(
                &[
                    "hosts/a/api-token.age".to_string(),
                    "hosts/b/api-token.age".to_string(),
                ],
                &entry,
            )
            .is_err()
        );
    }

    #[test]
    fn agenix_rule_matching_ignores_partial_filename_suffixes() {
        let entry = secret(
            "api-token",
            "api-token",
            crate::shared_types::SecretBackend::Agenix,
            "/nix/store/0123456789abcdfghijklmnpqrsvwxyz-api-token.age",
            None,
        );

        assert_eq!(
            matching_agenix_rule_key(&["n.age".to_string(), "api-token.age".to_string()], &entry,)
                .expect("ignore partial filename suffix"),
            "api-token.age"
        );
        assert!(matching_agenix_rule_key(&["n.age".to_string()], &entry).is_err());
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
    fn new_sops_plaintext_is_a_yaml_mapping_and_preserves_multiline_values() {
        let rendered =
            sops_plaintext("github-token", "line one\nline two").expect("render plaintext");
        let parsed: serde_yaml::Value = serde_yaml::from_str(&rendered).expect("parse YAML");

        assert_eq!(parsed["github-token"], "line one\nline two");
    }

    #[test]
    fn sops_secrets_use_one_file_per_secret() {
        assert_eq!(
            managed_sops_file("github-token"),
            "secrets/github-token.yaml"
        );
    }

    #[test]
    fn add_secret_validation_accepts_only_lowercase_slugs() {
        assert!(validate_new_secret("github-token-2", "value").is_ok());
        assert!(validate_new_secret("GitHub token", "value").is_err());
        assert!(validate_new_secret("github-token", "").is_err());
    }

    #[test]
    fn declaration_discovery_prefers_the_standard_module() {
        let config_dir = TempDir::new().expect("create config dir");
        let standard = config_dir.path().join("modules/darwin/sops-secrets.nix");
        fs::create_dir_all(standard.parent().unwrap()).expect("create module dir");
        fs::write(&standard, "{ sops.secrets = {}; }").expect("write standard module");
        fs::write(
            config_dir.path().join("other.nix"),
            "{ sops.secrets = {}; }",
        )
        .expect("write other module");

        assert_eq!(
            find_sops_declaration_file(config_dir.path()).expect("find module"),
            standard
        );
    }

    #[test]
    fn declaration_discovery_skips_a_standard_module_without_the_marker() {
        let config_dir = TempDir::new().expect("create config dir");
        let standard = config_dir.path().join("modules/darwin/agenix-secrets.nix");
        fs::create_dir_all(standard.parent().unwrap()).expect("create module dir");
        fs::write(&standard, "{ services.example.enable = true; }")
            .expect("write unrelated standard module");
        let declaration = config_dir.path().join("hosts/agenix.nix");
        fs::create_dir_all(declaration.parent().unwrap()).expect("create declaration dir");
        fs::write(&declaration, "{ age.secrets = {}; }").expect("write declaration module");

        assert_eq!(
            find_agenix_declaration_file(config_dir.path()).expect("find declaration module"),
            declaration
        );
    }

    #[test]
    fn declaration_discovery_returns_the_resolved_standard_module_target() {
        let config_dir = TempDir::new().expect("create config dir");
        let target = config_dir.path().join("modules/shared/sops-secrets.nix");
        fs::create_dir_all(target.parent().unwrap()).expect("create target dir");
        fs::write(&target, "{ sops.secrets = {}; }").expect("write target module");
        let standard = config_dir.path().join("modules/darwin/sops-secrets.nix");
        fs::create_dir_all(standard.parent().unwrap()).expect("create standard dir");
        std::os::unix::fs::symlink("../shared/sops-secrets.nix", &standard)
            .expect("link standard module");

        assert_eq!(
            find_sops_declaration_file(config_dir.path()).expect("find standard module"),
            target
        );
    }

    #[test]
    fn agenix_discovery_finds_conventional_rules_and_standard_module() {
        let config_dir = TempDir::new().expect("create config dir");
        let rules = config_dir.path().join("secrets/secrets.nix");
        fs::create_dir_all(rules.parent().unwrap()).expect("create secrets dir");
        fs::write(&rules, "{ }").expect("write agenix rules");
        let module = config_dir.path().join("modules/darwin/agenix-secrets.nix");
        fs::create_dir_all(module.parent().unwrap()).expect("create module dir");
        fs::write(&module, "{ age.secrets = {}; }").expect("write agenix module");

        assert_eq!(
            find_agenix_rules_file(config_dir.path()).expect("find agenix rules"),
            rules
        );
        assert_eq!(
            find_agenix_declaration_file(config_dir.path()).expect("find agenix module"),
            module
        );
    }

    #[test]
    fn agenix_discovery_preserves_a_nonstandard_declaration_location() {
        let config_dir = TempDir::new().expect("create config dir");
        let rules = config_dir.path().join("secrets.nix");
        fs::write(&rules, "{ }").expect("write agenix rules");
        let module = config_dir
            .path()
            .join("hosts/workstation/modules/security.nix");
        fs::create_dir_all(module.parent().unwrap()).expect("create module dir");
        fs::write(&module, "{ age.secrets = {}; }").expect("write agenix module");

        let discovered =
            find_agenix_declaration_file(config_dir.path()).expect("find agenix module");
        assert_eq!(
            repo_relative_path_string(config_dir.path(), &discovered)
                .expect("render repository-relative module path"),
            "hosts/workstation/modules/security.nix"
        );
        assert_eq!(
            relative_nix_path_between(Path::new("hosts/workstation/modules"), Path::new("secrets"))
                .expect("render encrypted directory from declaration"),
            "../../../secrets"
        );
    }

    #[test]
    fn agenix_declaration_discovery_excludes_nixmac_ignored_modules() {
        let config_dir = TempDir::new().expect("create config dir");
        let ignored = config_dir.path().join("private/agenix.nix");
        fs::create_dir_all(ignored.parent().unwrap()).expect("create ignored dir");
        fs::write(&ignored, "{ age.secrets = {}; }").expect("write ignored module");
        fs::write(config_dir.path().join(".nixmacignore"), "private/\n")
            .expect("write nixmacignore");
        let visible = config_dir.path().join("visible.nix");
        fs::write(&visible, "{ age.secrets = {}; }").expect("write visible module");

        assert_eq!(
            find_agenix_declaration_file(config_dir.path()).expect("find visible module"),
            visible
        );
    }

    #[test]
    fn declaration_discovery_excludes_gitignored_modules() {
        let config_dir = TempDir::new().expect("create config dir");
        git2::Repository::init(config_dir.path()).expect("initialize git repository");
        let standard = config_dir.path().join("modules/darwin/sops-secrets.nix");
        fs::create_dir_all(standard.parent().unwrap()).expect("create module dir");
        fs::write(&standard, "{ sops.secrets = {}; }").expect("write ignored module");
        fs::write(
            config_dir.path().join(".gitignore"),
            "modules/darwin/sops-secrets.nix\n",
        )
        .expect("write gitignore");
        let visible = config_dir.path().join("visible.nix");
        fs::write(&visible, "{ sops.secrets = {}; }").expect("write visible module");

        assert_eq!(
            find_sops_declaration_file(config_dir.path()).expect("find visible module"),
            visible
        );
    }

    #[test]
    fn declaration_discovery_excludes_nixmac_ignored_modules() {
        let config_dir = TempDir::new().expect("create config dir");
        let standard = config_dir.path().join("modules/darwin/sops-secrets.nix");
        fs::create_dir_all(standard.parent().unwrap()).expect("create standard module dir");
        fs::write(&standard, "{ sops.secrets = {}; }").expect("write ignored standard module");
        let ignored = config_dir.path().join("private/secrets.nix");
        fs::create_dir_all(ignored.parent().unwrap()).expect("create ignored module dir");
        fs::write(&ignored, "{ sops.secrets = {}; }").expect("write ignored module");
        fs::write(
            config_dir.path().join(".nixmacignore"),
            "modules/darwin/sops-secrets.nix\nprivate/\n",
        )
        .expect("write nixmacignore");
        let visible = config_dir.path().join("visible.nix");
        fs::write(&visible, "{ sops.secrets = {}; }").expect("write visible module");

        assert_eq!(
            find_sops_declaration_file(config_dir.path()).expect("find visible module"),
            visible
        );
    }

    #[test]
    fn relative_sops_path_is_computed_from_the_declaration_directory() {
        assert_eq!(
            relative_path_between(
                Path::new("modules/darwin"),
                Path::new("secrets/github-token.yaml")
            )
            .expect("compute relative path"),
            Path::new("../../secrets/github-token.yaml")
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
