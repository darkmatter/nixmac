//! Nix flake operations for querying configuration data.
//!
//! Uses `nix eval` to extract information from the user's flake without building it.

use anyhow::Result;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

/// Common Nix binary paths on macOS (GUI apps don't inherit shell PATH)
const NIX_PATHS: &[&str] = &[
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/etc/profiles/per-user/root/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
];

/// Get the PATH with Nix directories prepended
pub fn get_nix_path() -> String {
    let base_path = std::env::var("PATH").unwrap_or_default();
    let nix_paths = NIX_PATHS.join(":");
    format!("{}:{}", nix_paths, base_path)
}

/// Get Nix version by running `nix --version`
pub fn get_nix_version() -> Option<String> {
    for nix_path in get_nix_path().split(':') {
        if Path::new(nix_path).exists() {
            if let Ok(output) = Command::new(nix_path).arg("--version").output() {
                if output.status.success() {
                    if let Ok(version) = String::from_utf8(output.stdout) {
                        // Output is like "nix (Nix) 2.24.1"
                        // Extract just the version number
                        let parts: Vec<&str> = version.split_whitespace().collect();
                        if let Some(v) = parts.last() {
                            return Some(v.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Determines the host attribute to use for darwin-rebuild.
///
/// Resolution order:
/// 1. Stored preference in app settings
/// 2. Legacy file at ~/.config/darwin/host (for backwards compatibility)
pub fn determine_host_attr<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    if let Ok(Some(attr)) = crate::store::get_host_attr(app) {
        return Some(attr);
    }

    crate::store::read_host_attr_from_file()
}

/// Evaluates the flake to get the list of system packages for a host.
///
/// This uses `nix eval --json` to introspect the darwinConfiguration
/// without actually building anything.
pub fn evaluate_installed_apps(config_dir: &str, host_attr: &str) -> Result<Vec<Value>> {
    let attr = format!(
        ".#darwinConfigurations.{}.config.environment.systemPackages",
        host_attr
    );

    let output = Command::new("nix")
        .args(["eval", "--json", &attr])
        .current_dir(config_dir)
        .env("PATH", get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate installed apps: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)?;
    let apps: Vec<Value> = serde_json::from_str(&stdout)?;
    Ok(apps)
}

/// Lists all host names defined in the flake's darwinConfigurations.
///
/// Uses `builtins.attrNames` to get just the keys without evaluating
/// the full configuration.
pub fn list_darwin_hosts(config_dir: &str) -> Result<Vec<String>> {
    let output = Command::new("nix")
        .args([
            "eval",
            "--json",
            ".#darwinConfigurations",
            "--apply",
            "builtins.attrNames",
        ])
        .current_dir(config_dir)
        .env("PATH", get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to list hosts: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)?;
    let hosts: Vec<String> = serde_json::from_str(&stdout)?;
    Ok(hosts)
}
