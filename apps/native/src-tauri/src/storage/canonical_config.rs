//! Canonical nix-darwin configuration path at `/etc/nix-darwin`.
//!
//! `darwin-rebuild` invoked without `--flake` looks for the system flake at
//! this location, so when the user stores their configuration elsewhere a
//! symlink from `/etc/nix-darwin` keeps the bare-CLI convention working.
//! Updating the link needs root, so it is maintained during the privileged
//! activation step of the next apply ([`canonical_link_pending`] decides,
//! the activation scripts execute) rather than eagerly on directory
//! selection — nixmac itself always passes `--flake` and never needs the
//! link for its own operation.

use std::path::{Path, PathBuf};
use std::process::Command;

pub use crate::privileged_helper::protocol::CANONICAL_CONFIG_DIR;

/// Returns true when `path` resolves to the canonical nix-darwin directory.
pub fn is_canonical_config_path(path: &Path) -> bool {
    paths_equivalent(path, Path::new(CANONICAL_CONFIG_DIR))
}

/// Ensures `/etc/nix-darwin` exists and is writable by the current user, for
/// configurations kept at the canonical path itself. Prompts for admin
/// approval when the directory must be created or re-owned.
pub fn ensure_canonical_dir_ready() -> Result<(), String> {
    if crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR).is_some() {
        return Ok(());
    }
    if canonical_directory_is_ready() {
        return Ok(());
    }
    ensure_canonical_directory_owned()
}

/// What the next privileged activation should do about the `/etc/nix-darwin`
/// convention link. See [`canonical_link_plan`].
pub enum CanonicalLinkPlan {
    /// Nothing to do: link already current, config lives at the canonical
    /// path itself, or an e2e override is active.
    UpToDate,
    /// Re-point the link at this canonicalized config directory.
    Update(String),
    /// The canonical path is occupied by something nixmac must not delete;
    /// the link stays untouched. Carries a user-facing reason so the apply
    /// stream can surface it as a notice.
    Blocked(String),
}

/// Decides whether the next privileged activation should re-point
/// `/etc/nix-darwin` at `repo_dir`.
///
/// The link is maintained during apply — an already-privileged step — so
/// changing the configuration directory in preferences never has to prompt
/// for a password on its own, and the link always names the configuration
/// that was last *applied* (the one a bare `darwin-rebuild switch` should
/// rebuild), not one merely selected.
pub fn canonical_link_plan(repo_dir: &Path) -> CanonicalLinkPlan {
    if crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR).is_some() {
        return CanonicalLinkPlan::UpToDate;
    }

    let repo = repo_dir
        .canonicalize()
        .unwrap_or_else(|_| repo_dir.to_path_buf());

    if is_canonical_config_path(&repo) {
        return CanonicalLinkPlan::UpToDate;
    }

    match symlink_blocked_reason(&repo) {
        Ok(None) => {}
        Ok(Some(reason)) | Err(reason) => {
            log::warn!("[canonical-config] leaving {CANONICAL_CONFIG_DIR} alone: {reason}");
            return CanonicalLinkPlan::Blocked(reason);
        }
    }

    match canonical_symlink_is_current(&repo) {
        Ok(true) => CanonicalLinkPlan::UpToDate,
        Ok(false) => match repo.to_str() {
            Some(target) => CanonicalLinkPlan::Update(target.to_string()),
            None => {
                log::warn!("[canonical-config] config dir path is not valid UTF-8");
                CanonicalLinkPlan::UpToDate
            }
        },
        Err(error) => {
            log::warn!("[canonical-config] cannot read {CANONICAL_CONFIG_DIR}: {error}");
            CanonicalLinkPlan::UpToDate
        }
    }
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn canonical_path() -> PathBuf {
    PathBuf::from(CANONICAL_CONFIG_DIR)
}

fn symlink_blocked_reason(target: &Path) -> Result<Option<String>, String> {
    let link = canonical_path();
    if !link.exists() {
        return Ok(None);
    }

    if link.is_symlink() {
        return Ok(None);
    }

    if !link.is_dir() {
        return Err(format!(
            "{} exists but is not a directory or symlink",
            CANONICAL_CONFIG_DIR
        ));
    }

    if paths_equivalent(&link, target) {
        return Ok(None);
    }

    if directory_has_entries(&link)? {
        return Ok(Some(format!(
            "{CANONICAL_CONFIG_DIR} already contains a configuration that nixmac will not delete. Move or remove it to let nixmac maintain the link."
        )));
    }

    Ok(None)
}

/// Returns true when `/etc/nix-darwin` already exists and the current user can
/// write to it. Avoids invoking `osascript` on every apply once setup is done.
#[cfg(unix)]
fn canonical_directory_is_ready() -> bool {
    use std::os::unix::fs::PermissionsExt;

    let path = canonical_path();
    path.is_dir()
        && path
            .metadata()
            .map(|meta| meta.permissions().mode() & 0o200 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn canonical_directory_is_ready() -> bool {
    canonical_path().is_dir()
}

fn canonical_symlink_is_current(target: &Path) -> Result<bool, String> {
    symlink_points_to(&canonical_path(), target)
}

fn symlink_points_to(link: &Path, target: &Path) -> Result<bool, String> {
    if !link.is_symlink() {
        return Ok(false);
    }

    let link_target = std::fs::read_link(link)
        .map_err(|e| format!("Failed to read symlink {}: {e}", link.display()))?;

    Ok(paths_equivalent(&link_target, target))
}

fn directory_has_entries(path: &Path) -> Result<bool, String> {
    let entries: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_str() != Some(".DS_Store"))
        .collect();

    Ok(!entries.is_empty())
}

fn ensure_canonical_directory_owned() -> Result<(), String> {
    let user = whoami::username().map_err(|e| format!("Failed to resolve username: {e}"))?;
    let canonical_dir = shell_literal(CANONICAL_CONFIG_DIR);
    let owner = shell_literal(&user);
    let script = format!("set -e\nmkdir -p {canonical_dir}\nchown -R {owner} {canonical_dir}");
    run_privileged_shell(&script)
}

fn shell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn run_privileged_shell(script: &str) -> Result<(), String> {
    let escaped_script = script.replace('\\', "\\\\").replace('"', "\\\"");
    let osascript_cmd = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped_script
    );

    let output = Command::new("osascript")
        .args(["-e", &osascript_cmd])
        .output()
        .map_err(|e| format!("Failed to run privileged setup for {CANONICAL_CONFIG_DIR}: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };

    if detail.to_lowercase().contains("user canceled") {
        return Err(format!(
            "Administrator approval is required to configure {CANONICAL_CONFIG_DIR}."
        ));
    }

    Err(format!(
        "Failed to configure {CANONICAL_CONFIG_DIR}: {detail}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn is_canonical_config_path_matches_etc_nix_darwin() {
        assert!(is_canonical_config_path(Path::new("/etc/nix-darwin")));
    }

    #[test]
    fn directory_has_entries_ignores_ds_store() {
        let temp = tempfile::tempdir().expect("temp dir");
        fs::write(temp.path().join(".DS_Store"), "").expect("write metadata");

        assert!(!directory_has_entries(temp.path()).expect("check directory"));
    }

    #[test]
    fn symlink_points_to_matches_equivalent_target() {
        let temp = tempfile::tempdir().expect("temp dir");
        let target = temp.path().join("config");
        fs::create_dir_all(&target).expect("create target");

        let link = temp.path().join("nix-darwin");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");

        assert!(symlink_points_to(&link, &target).expect("check symlink"));
    }

    #[test]
    fn shell_literal_escapes_embedded_single_quotes() {
        assert_eq!(shell_literal("alice"), "'alice'");
        assert_eq!(shell_literal("al'ice"), "'al'\\''ice'");
    }
}
