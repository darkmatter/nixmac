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

use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
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
    if let Ok(Some(attr)) = crate::storage::store::get_host_attr(app) {
        return Some(attr);
    }

    crate::storage::store::read_host_attr_from_file()
}

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

/// Checks if Nix is installed by attempting to run `nix --version`.
pub fn is_nix_installed() -> bool {
    Command::new("/bin/bash")
        .args(["-l", "-c", "nix --version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Checks if `darwin-rebuild` is available in the Nix PATH.
pub fn is_darwin_rebuild_available() -> bool {
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

    // All emit calls below are fire-and-forget: background thread; window may not be
    // listening. Tauri emit returns Err only when no listeners are registered.
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

const DETERMINATE_PKG_URL: &str =
    "https://install.determinate.systems/determinate-pkg/stable/Universal";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NixPkgInstaller {
    platform: &'static str,
    url: &'static str,
    file_name: &'static str,
}

fn nix_pkg_installer_for_arch(arch: &str) -> Result<NixPkgInstaller> {
    match arch {
        // Determinate currently publishes one signed macOS .pkg that supports both
        // Apple Silicon and Intel. Keep the platform explicit so logs/tests prove
        // the onboarding flow selected a supported Darwin target before download.
        "aarch64" | "arm64" => Ok(NixPkgInstaller {
            platform: "aarch64-darwin",
            url: DETERMINATE_PKG_URL,
            file_name: "Determinate Nix aarch64-darwin.pkg",
        }),
        "x86_64" => Ok(NixPkgInstaller {
            platform: "x86_64-darwin",
            url: DETERMINATE_PKG_URL,
            file_name: "Determinate Nix x86_64-darwin.pkg",
        }),
        other => anyhow::bail!(
            "Unsupported macOS architecture for Nix installer: {}",
            other
        ),
    }
}

fn current_nix_pkg_installer() -> Result<NixPkgInstaller> {
    nix_pkg_installer_for_arch(std::env::consts::ARCH)
}

#[derive(Debug)]
struct PkgInstallResult {
    success: bool,
    code: i32,
    stdout: String,
    stderr: String,
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_pkg_installer_shell_script(pkg_path: &Path) -> String {
    let pkg_path = pkg_path.to_string_lossy();
    format!(
        "set -e\n\
         PKG_PATH={}\n\
         /usr/sbin/installer -pkg \"$PKG_PATH\" -target / 2>&1",
        shell_single_quote(&pkg_path)
    )
}

fn run_pkg_installer(pkg_path: &Path) -> Result<PkgInstallResult> {
    let shell_script = build_pkg_installer_shell_script(pkg_path);
    let escaped_script = escape_applescript_string(&shell_script);
    let osascript_cmd = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped_script
    );

    info!("[nix] Running .pkg installer with native macOS administrator authentication");
    let output = Command::new("osascript")
        .args(["-e", &osascript_cmd])
        .output()
        .map_err(|e| {
            anyhow::anyhow!("Failed to run macOS installer authorization prompt: {}", e)
        })?;

    Ok(PkgInstallResult {
        success: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn classify_pkg_install_error(result: &PkgInstallResult) -> String {
    let details = [result.stdout.trim(), result.stderr.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let details_lower = details.to_lowercase();

    if details_lower.contains("user canceled") || details_lower.contains("user cancelled") {
        return "Nix installation was cancelled. Retry the install and approve the macOS administrator prompt, or install Nix manually from https://determinate.systems/nix-installer/.".to_string();
    }

    const AUTH_DENIED_PHRASES: &[&str] = &[
        "authorization failed",
        "not authorized",
        "authorization denied",
        "not permitted",
        "you do not have permission",
        "authentication failed",
        "is not an administrator",
    ];
    if AUTH_DENIED_PHRASES
        .iter()
        .any(|phrase| details_lower.contains(phrase))
    {
        return "Administrator authorization was denied. Retry the install with an admin account or install Nix manually from https://determinate.systems/nix-installer/.".to_string();
    }

    if details.is_empty() {
        format!(
            "The Nix .pkg installer failed with exit code {}. Retry the install, or install Nix manually from https://determinate.systems/nix-installer/.",
            result.code
        )
    } else {
        format!(
            "The Nix .pkg installer failed with exit code {}. Retry the install, or install Nix manually from https://determinate.systems/nix-installer/.\n\nDetails:\n{}",
            result.code, details
        )
    }
}

/// Downloads the Determinate Nix .pkg installer with progress reporting.
///
/// Emits `nix:install:progress` events with `phase: "downloading"` and
/// `downloaded`/`total` byte counts so the frontend can show a progress bar.
fn download_nix_pkg(app: &AppHandle, installer: &NixPkgInstaller) -> Result<PathBuf> {
    info!(
        "[nix] Downloading .pkg for {} from {}",
        installer.platform, installer.url
    );

    let client = reqwest::blocking::Client::new();
    let mut response = client.get(installer.url).send()?;

    if !response.status().is_success() {
        anyhow::bail!("Download failed with status {}", response.status());
    }

    let total = response.content_length().unwrap_or(0);
    let pkg_path = std::env::temp_dir().join(installer.file_name);
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
        // Phase 1: Download .pkg and install it with native macOS authentication.
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "downloading", "downloaded": 0, "total": 0 }),
        );

        let installer = match current_nix_pkg_installer() {
            Ok(installer) => installer,
            Err(e) => {
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "installer_failed",
                        "error": format!("Failed to select a Nix installer package: {}. Install Nix manually from https://determinate.systems/nix-installer/ or contact support.", e),
                    }),
                )?;
                return Ok(());
            }
        };

        let pkg_path = match download_nix_pkg(app, &installer) {
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

        // Run the .pkg with macOS native administrator authentication (Touch ID / admin dialog).
        info!(
            "[nix] Installing .pkg for {}: {:?}",
            installer.platform, pkg_path
        );
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "waiting-for-installer" }),
        );

        match run_pkg_installer(&pkg_path) {
            Ok(result) if result.success => {
                info!(
                    "[nix] .pkg installer completed successfully for {}",
                    installer.platform
                );
            }
            Ok(result) => {
                let error = classify_pkg_install_error(&result);
                error!(
                    "[nix] .pkg installer failed for {} (code={}): {}",
                    installer.platform, result.code, error
                );
                let _ = std::fs::remove_file(&pkg_path);
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": result.code,
                        "error_type": "installer_failed",
                        "error": error,
                    }),
                )?;
                return Ok(());
            }
            Err(e) => {
                let _ = std::fs::remove_file(&pkg_path);
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "installer_failed",
                        "error": format!("Failed to run the macOS Nix installer: {}. Retry the install, or install Nix manually from https://determinate.systems/nix-installer/.", e),
                    }),
                )?;
                return Ok(());
            }
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
                // fire-and-forget cleanup: temp pkg; benign if already removed.
                let _ = std::fs::remove_file(&pkg_path);
                if let Err(e) = crate::bootstrap::default_config::finalize_flake_lock(app) {
                    info!("[nix] Could not finalize flake.lock: {}", e);
                }
                break;
            }

            if std::time::Instant::now() >= deadline {
                // fire-and-forget cleanup on timeout path.
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
    // fire-and-forget: progress event; non-fatal if no listener.
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
                    // fire-and-forget: kill() fails only if process already exited.
                    // wait() cleanup after kill may also fail — both are acceptable here.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_supported_darwin_pkg_targets_by_architecture() {
        let apple_silicon = nix_pkg_installer_for_arch("aarch64").unwrap();
        assert_eq!(apple_silicon.platform, "aarch64-darwin");
        assert_eq!(apple_silicon.url, DETERMINATE_PKG_URL);
        assert!(apple_silicon.file_name.contains("aarch64-darwin"));

        let intel = nix_pkg_installer_for_arch("x86_64").unwrap();
        assert_eq!(intel.platform, "x86_64-darwin");
        assert_eq!(intel.url, DETERMINATE_PKG_URL);
        assert!(intel.file_name.contains("x86_64-darwin"));

        assert!(nix_pkg_installer_for_arch("powerpc").is_err());
    }

    #[test]
    fn builds_native_pkg_installer_script_with_escaped_path() {
        let script = build_pkg_installer_shell_script(Path::new(
            "/tmp/nixmac's installer/Determinate Nix.pkg",
        ));

        assert!(script.contains("/usr/sbin/installer -pkg \"$PKG_PATH\" -target / 2>&1"));
        assert!(script.contains("PKG_PATH='/tmp/nixmac'\\''s installer/Determinate Nix.pkg'"));
    }

    #[test]
    fn classifies_cancelled_pkg_install_with_retry_guidance() {
        let result = PkgInstallResult {
            success: false,
            code: -128,
            stdout: String::new(),
            stderr: "execution error: User canceled. (-128)".to_string(),
        };

        let message = classify_pkg_install_error(&result);
        assert!(message.contains("cancelled"));
        assert!(message.contains("Retry"));
        assert!(message.contains("https://determinate.systems/nix-installer/"));
    }
}
