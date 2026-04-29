//! Nix command execution and PATH resolution for macOS GUI apps.
//!
//! This module provides two approaches for resolving PATH when executing Nix commands:
//!
//! ## 1. Regular PATH (`get_nix_path()`)
//! - Uses process environment + fallback Nix paths
//! - **Fast:** No shell spawning
//! - **Use for:** Frequent operations (git polling, nix eval)
//! - **Trade-off:** May not find Nix if app launched from Finder without shell environment
//!
//! ## 2. Login Shell PATH (`get_nix_path_with_login_shell()`)
//! - Spawns `/bin/bash -l` to source shell init files
//! - **Reliable:** Finds Nix even in GUI contexts
//! - **Use for:** One-time checks (is_nix_installed, initial detection)
//! - **Warning:** Triggers shell init which may invoke `xcrun` from Nix's `xcbuild`,
//!   causing repeated `warning: unhandled Platform key FamilyDisplayName` in logs
//!
//! ## Why Two Approaches?
//!
//! The git watcher polls status every 2.5 seconds, executing multiple git commands per poll.
//! If each command spawned a login shell, we'd get hundreds of xcrun warnings per minute.
//! By using the simple PATH for frequent operations and login shell only for initial detection,
//! we get reliability where needed without polluting logs.
//!
//! See: <https://github.com/NixOS/nixpkgs/issues/376958>

use anyhow::Result;
use log::{error, info};
use serde_json::Value;
use std::fs;
use std::io::{Read as _, Write as _};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

const NIX_PATHS_FALLBACK: &[&str] = &[
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/etc/profiles/per-user/root/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
];

static NIX_PATH_CACHE: OnceLock<String> = OnceLock::new();

/// Resolves PATH for Nix commands by prepending known Nix paths to the current environment.
///
/// **Important:** This version uses the process environment PATH directly without spawning
/// a login shell. This is the correct choice for high-frequency operations like git polling
/// (which happens every 2.5 seconds).
///
/// The result is computed once and cached for the lifetime of the process.
///
/// See: https://github.com/NixOS/nixpkgs/issues/376958
pub fn get_nix_path() -> String {
    NIX_PATH_CACHE
        .get_or_init(|| {
            let base_path = std::env::var("PATH").unwrap_or_default();
            let nix_paths = NIX_PATHS_FALLBACK.join(":");
            if base_path.is_empty() {
                nix_paths
            } else {
                format!("{}:{}", nix_paths, base_path)
            }
        })
        .clone()
}

/// Resolves PATH using a login shell to find Nix binaries in GUI app contexts.
///
/// **Warning:** Do NOT use this for repeated/frequent operations!
/// - Each call spawns a bash process and sources shell init files
/// - Shell init may trigger `xcrun` from Nix's `xcbuild`, causing warning spam
/// - For frequent operations, use `get_nix_path()` instead
///
pub fn get_nix_path_with_login_shell() -> String {
    if let Ok(output) = Command::new("/bin/bash")
        .args(["-l", "-c", "echo $PATH"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !path.is_empty() {
            return path;
        }
    }

    // Fallback to environment PATH if login shell fails
    get_nix_path()
}

pub fn determine_host_attr<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    if let Ok(Some(attr)) = crate::store::get_host_attr(app) {
        return Some(attr);
    }

    crate::store::read_host_attr_from_file()
}

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

pub fn list_darwin_hosts(config_dir: &str) -> Result<Vec<String>> {
    if crate::e2e_support::should_mock_system() {
        return list_darwin_hosts_from_flake(config_dir);
    }

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

fn list_darwin_hosts_from_flake(config_dir: &str) -> Result<Vec<String>> {
    let flake = fs::read_to_string(std::path::Path::new(config_dir).join("flake.nix"))?;
    let mut hosts = Vec::new();

    for line in flake.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("darwinConfigurations.\"") {
            if let Some((host, _)) = rest.split_once('"') {
                if !host.is_empty() {
                    hosts.push(host.to_string());
                }
            }
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("darwinConfigurations.") {
            let host: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if !host.is_empty() {
                hosts.push(host);
            }
        }
    }

    hosts.sort();
    hosts.dedup();
    if hosts.is_empty() {
        anyhow::bail!("No darwinConfigurations found in flake.nix");
    }
    Ok(hosts)
}

/// Checks if Nix is installed by attempting to run `nix --version`.
pub fn is_nix_installed() -> bool {
    if crate::e2e_support::should_mock_system() {
        return true;
    }

    Command::new("nix")
        .arg("--version")
        .env("PATH", get_nix_path_with_login_shell())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Checks if `darwin-rebuild` is available in the Nix PATH.
pub fn is_darwin_rebuild_available() -> bool {
    if crate::e2e_support::should_mock_system() {
        return true;
    }

    for dir in get_nix_path().split(':') {
        if std::path::Path::new(dir).join("darwin-rebuild").exists() {
            return true;
        }
    }
    false
}

/// Gets the installed Nix version string.
///
/// Uses the login shell because it's typically called in contexts where we want to reliably detect Nix
/// even if launched from Finder. The original use case is for nix-install.
pub fn get_nix_version() -> Option<String> {
    let output = Command::new("nix")
        .arg("--version")
        .env("PATH", get_nix_path_with_login_shell())
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Prefetches darwin-rebuild by running `nix build --no-link nix-darwin/master#darwin-rebuild`.
/// This caches the derivation in the nix store so the `nix run` fallback in darwin.rs is fast.
/// Emits `nix:darwin-rebuild:end` with `{ ok: bool, error?: string }` on completion.
pub fn prefetch_darwin_rebuild_stream(app: &AppHandle) -> Result<()> {
    info!("[nix] prefetch_darwin_rebuild_stream called");

    let app_handle = app.clone();

    std::thread::spawn(move || {
        let result = Command::new("nix")
            .args(["build", "--no-link", "nix-darwin/master#darwin-rebuild"])
            .env("PATH", get_nix_path_with_login_shell())
            .env("NIX_CONFIG", "experimental-features = nix-command flakes")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        match result {
            Ok(output) if output.status.success() => {
                info!("[nix] darwin-rebuild prefetch succeeded");
                let _ =
                    app_handle.emit("nix:darwin-rebuild:end", serde_json::json!({ "ok": true }));
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                error!("[nix] darwin-rebuild prefetch failed: {}", stderr);
                let _ = app_handle.emit(
                    "nix:darwin-rebuild:end",
                    serde_json::json!({ "ok": false, "error": stderr }),
                );
            }
            Err(e) => {
                error!("[nix] darwin-rebuild prefetch error: {}", e);
                let _ = app_handle.emit(
                    "nix:darwin-rebuild:end",
                    serde_json::json!({ "ok": false, "error": e.to_string() }),
                );
            }
        }
    });

    info!("[nix] prefetch_darwin_rebuild_stream started background thread");
    Ok(())
}

pub fn install_nix_stream(app: &AppHandle) -> Result<()> {
    info!("[nix] install_nix_stream called");

    let app_handle = app.clone();

    std::thread::spawn(move || {
        if let Err(e) = run_nix_install(&app_handle) {
            error!("[nix] install failed: {}", e);
            let _ = app_handle.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "internal",
                    "error": e.to_string(),
                }),
            );
        }
    });

    info!("[nix] install_nix_stream started background thread");
    Ok(())
}

const PKG_DOWNLOAD_URL: &str =
    "https://install.determinate.systems/determinate-pkg/stable/Universal";

/// Downloads the Determinate Nix .pkg installer with progress reporting.
///
/// Emits `nix:install:progress` events with `phase: "downloading"` and
/// `downloaded`/`total` byte counts so the frontend can show a progress bar.
fn download_nix_pkg(app: &AppHandle) -> Result<std::path::PathBuf> {
    info!("[nix] Downloading .pkg from {}", PKG_DOWNLOAD_URL);

    let client = reqwest::blocking::Client::new();
    let mut response = client.get(PKG_DOWNLOAD_URL).send()?;

    if !response.status().is_success() {
        anyhow::bail!("Download failed with status {}", response.status());
    }

    let total = response.content_length().unwrap_or(0);
    let pkg_path = std::env::temp_dir().join("Determinate Nix.pkg");
    let mut file = std::fs::File::create(&pkg_path)?;
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 65536];
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = response.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])?;
        downloaded += n as u64;

        // Throttle progress events to ~20/sec max
        if last_emit.elapsed() > std::time::Duration::from_millis(50) {
            let _ = app.emit(
                "nix:install:progress",
                serde_json::json!({
                    "phase": "downloading",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
            last_emit = std::time::Instant::now();
        }
    }

    // Final progress event
    let _ = app.emit(
        "nix:install:progress",
        serde_json::json!({
            "phase": "downloading",
            "downloaded": downloaded,
            "total": total,
        }),
    );

    info!("[nix] Download complete: {} bytes", downloaded);
    Ok(pkg_path)
}

/// Timeout for each installation phase — nix install and nix-darwin prefetch (5 minutes each).
const INSTALL_PHASE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

fn run_nix_install(app: &AppHandle) -> Result<()> {
    let nix_installed = is_nix_installed();
    let dr_available = nix_installed && is_darwin_rebuild_available();
    // Each phase gets its own 5-minute deadline.
    let mut deadline;

    // Both already available — nothing to do
    if nix_installed && dr_available {
        let version = get_nix_version().unwrap_or_default();
        info!(
            "[nix] already installed, darwin-rebuild available: {}",
            version
        );
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": true,
                "code": 0,
                "nix_version": version,
                "darwin_rebuild_available": true,
            }),
        )?;
        return Ok(());
    }

    if !nix_installed {
        // Phase 1: Download .pkg and open with macOS Installer.app
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "downloading", "downloaded": 0, "total": 0 }),
        );

        let pkg_path = match download_nix_pkg(app) {
            Ok(path) => path,
            Err(e) => {
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "download_failed",
                        "error": format!("Failed to download Nix installer: {}", e),
                    }),
                )?;
                return Ok(());
            }
        };

        // Open the .pkg with macOS Installer.app
        info!("[nix] Opening .pkg with macOS Installer: {:?}", pkg_path);
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "waiting-for-installer" }),
        );

        if let Err(e) = Command::new("open").arg(&pkg_path).status() {
            let _ = std::fs::remove_file(&pkg_path);
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "installer_failed",
                    "error": format!("Failed to open installer: {}", e),
                }),
            )?;
            return Ok(());
        }

        // Start the 5-minute deadline for nix installation (download time doesn't count)
        deadline = std::time::Instant::now() + INSTALL_PHASE_TIMEOUT;

        // Poll until Nix is installed (user completes the macOS Installer wizard)
        let poll_interval = std::time::Duration::from_secs(3);
        let mut poll_count = 0u32;

        loop {
            std::thread::sleep(poll_interval);
            poll_count += 1;
            info!(
                "[nix] Poll #{}: checking if nix is installed...",
                poll_count
            );

            if is_nix_installed() {
                info!("[nix] Poll #{}: nix detected!", poll_count);
                // Clean up the downloaded .pkg
                let _ = std::fs::remove_file(&pkg_path);
                if let Err(e) = crate::default_config::finalize_flake_lock(app) {
                    info!("[nix] Could not finalize flake.lock: {}", e);
                }
                break;
            }

            if std::time::Instant::now() >= deadline {
                let _ = std::fs::remove_file(&pkg_path);
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "timeout",
                        "error": "Installation timed out after 5 minutes. Please try again.",
                    }),
                )?;
                return Ok(());
            }
        }
    }

    // Phase 2: Prefetch darwin-rebuild directly (no Terminal needed)
    // Fresh 5-minute deadline for this phase
    deadline = std::time::Instant::now() + INSTALL_PHASE_TIMEOUT;
    let _ = app.emit(
        "nix:install:progress",
        serde_json::json!({ "phase": "prefetching" }),
    );

    info!("[nix] Prefetching darwin-rebuild in background");
    let mut child = match Command::new("nix")
        .args(["build", "--no-link", "nix-darwin/master#darwin-rebuild"])
        .env("PATH", get_nix_path_with_login_shell())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            error!("[nix] darwin-rebuild prefetch error: {}", e);
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "darwin_rebuild",
                    "error": format!("Failed to set up nix-darwin: {}", e),
                }),
            )?;
            return Ok(());
        }
    };

    // Poll until the child exits or the deadline is reached
    let poll_interval = std::time::Duration::from_secs(1);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("timed out");
                }
                std::thread::sleep(poll_interval);
            }
            Err(e) => {
                error!("[nix] darwin-rebuild wait error: {}", e);
                break Err("wait failed");
            }
        }
    };

    match status {
        Ok(s) if s.success() => {
            info!("[nix] darwin-rebuild prefetch succeeded");
        }
        Ok(_) => {
            error!("[nix] darwin-rebuild prefetch failed");
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "darwin_rebuild",
                    "error": "Failed to set up nix-darwin. Please try again.",
                }),
            )?;
            return Ok(());
        }
        Err(_) => {
            error!("[nix] darwin-rebuild prefetch timed out");
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "timeout",
                    "error": "Installation timed out after 5 minutes. Please try again.",
                }),
            )?;
            return Ok(());
        }
    }

    // Both ready
    let version = get_nix_version().unwrap_or_default();
    info!(
        "[nix] Setup complete: nix={}, darwin-rebuild cached",
        version
    );
    app.emit(
        "nix:install:end",
        serde_json::json!({
            "ok": true,
            "code": 0,
            "nix_version": version,
            "darwin_rebuild_available": true,
        }),
    )?;
    Ok(())
}
