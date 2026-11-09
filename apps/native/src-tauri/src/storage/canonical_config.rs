//! Canonical nix-darwin configuration path at `/etc/nix-darwin`.
//!
//! Supports configurations stored at the canonical path itself: the
//! directory is created and re-owned (with admin approval) when needed.
//! nixmac does not maintain an `/etc/nix-darwin` symlink for configs stored
//! elsewhere — it always passes `--flake` and never needs the bare-CLI
//! convention for its own operation.

use std::path::{Path, PathBuf};
use std::process::Command;

pub const CANONICAL_CONFIG_DIR: &str = "/etc/nix-darwin";

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

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn canonical_path() -> PathBuf {
    PathBuf::from(CANONICAL_CONFIG_DIR)
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

    #[test]
    fn is_canonical_config_path_matches_etc_nix_darwin() {
        assert!(is_canonical_config_path(Path::new("/etc/nix-darwin")));
    }

    #[test]
    fn shell_literal_escapes_embedded_single_quotes() {
        assert_eq!(shell_literal("alice"), "'alice'");
        assert_eq!(shell_literal("al'ice"), "'al'\\''ice'");
    }
}
