//! Canonical nix-darwin configuration path at `/etc/nix-darwin`.
//!
//! nix-darwin expects the system flake at this location. When the user stores
//! their configuration elsewhere, we maintain a symlink from `/etc/nix-darwin` to
//! the chosen directory (requires administrator privileges on macOS).

use std::path::{Path, PathBuf};
use std::process::Command;

pub use crate::privileged_helper::protocol::CANONICAL_CONFIG_DIR;

/// Returns true when `path` resolves to the canonical nix-darwin directory.
pub fn is_canonical_config_path(path: &Path) -> bool {
    paths_equivalent(path, Path::new(CANONICAL_CONFIG_DIR))
}

/// Ensures `/etc/nix-darwin` points at the repository directory.
///
/// When `repo_dir` is the canonical path, creates the directory and assigns
/// ownership to the current user. Otherwise creates or updates a symlink at
/// `/etc/nix-darwin` that targets `repo_dir`.
pub fn ensure_canonical_config_link(repo_dir: &Path) -> Result<(), String> {
    if crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR).is_some() {
        return Ok(());
    }

    let repo = repo_dir
        .canonicalize()
        .unwrap_or_else(|_| repo_dir.to_path_buf());

    if is_canonical_config_path(&repo) {
        if canonical_directory_is_ready() {
            return Ok(());
        }
        return ensure_canonical_directory_owned();
    }

    if let Some(message) = symlink_blocked_reason(&repo)? {
        return Err(message);
    }

    if canonical_symlink_is_current(&repo)? {
        return Ok(());
    }

    ensure_symlink_to(&repo)
}

/// Decides whether the next privileged activation should re-point
/// `/etc/nix-darwin` at `repo_dir`, returning the canonicalized target.
///
/// The link is maintained during apply — an already-privileged step — so
/// changing the configuration directory in preferences never has to prompt
/// for a password on its own, and the link always names the configuration
/// that was last *applied* (the one a bare `darwin-rebuild switch` should
/// rebuild), not one merely selected.
///
/// Returns `None` when there is nothing to do: the link is already current,
/// the config lives at the canonical path itself, the location is occupied
/// by a foreign non-empty directory (logged, never deleted), or an e2e
/// override is active.
pub fn canonical_link_pending(repo_dir: &Path) -> Option<String> {
    if crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR).is_some() {
        return None;
    }

    let repo = repo_dir
        .canonicalize()
        .unwrap_or_else(|_| repo_dir.to_path_buf());

    if is_canonical_config_path(&repo) {
        return None;
    }

    match symlink_blocked_reason(&repo) {
        Ok(None) => {}
        Ok(Some(reason)) => {
            log::warn!("[canonical-config] leaving {CANONICAL_CONFIG_DIR} alone: {reason}");
            return None;
        }
        Err(error) => {
            log::warn!("[canonical-config] cannot inspect {CANONICAL_CONFIG_DIR}: {error}");
            return None;
        }
    }

    match canonical_symlink_is_current(&repo) {
        Ok(true) => None,
        Ok(false) => match repo.to_str() {
            Some(target) => Some(target.to_string()),
            None => {
                log::warn!("[canonical-config] config dir path is not valid UTF-8");
                None
            }
        },
        Err(error) => {
            log::warn!("[canonical-config] cannot read {CANONICAL_CONFIG_DIR}: {error}");
            None
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
            "{CANONICAL_CONFIG_DIR} already contains a configuration. Move or remove it before using a different directory."
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
    let script = format!(
        "set -e\nmkdir -p '{CANONICAL_CONFIG_DIR}'\nchown -R '{user}' '{CANONICAL_CONFIG_DIR}'"
    );
    run_privileged_shell(&script)
}

fn ensure_symlink_to(target: &Path) -> Result<(), String> {
    let target = target
        .to_str()
        .ok_or_else(|| "Configuration directory path is not valid UTF-8".to_string())?;
    let script = format!(
        "set -e\nTARGET='{target}'\nLINK='{CANONICAL_CONFIG_DIR}'\n\
         if [ -L \"$LINK\" ] && [ \"$(readlink \"$LINK\")\" = \"$TARGET\" ]; then exit 0; fi\n\
         if [ -e \"$LINK\" ] && [ ! -L \"$LINK\" ]; then rm -rf \"$LINK\"; fi\n\
         ln -sfn \"$TARGET\" \"$LINK\""
    );
    run_privileged_shell(&script)
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
}
