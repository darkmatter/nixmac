//! Nix flake operations for querying configuration data.
//!
//! Uses `nix eval` to extract information from the user's flake without building it.

use anyhow::Result;
use log::{error, info};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

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

/// Checks whether Nix is installed by running `nix --version`.
pub fn is_nix_installed() -> bool {
    Command::new("nix")
        .arg("--version")
        .env("PATH", get_nix_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Returns the Nix version string (e.g. "nix (Nix) 2.24.6") if installed.
pub fn get_nix_version() -> Option<String> {
    let output = Command::new("nix")
        .arg("--version")
        .env("PATH", get_nix_path())
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Starts a streaming Nix installation using the Determinate Systems installer.
///
/// Spawns a background thread and emits events:
/// - `nix:install:data`: per-line progress with `{"chunk": "..."}`
/// - `nix:install:end`: completion with `{"ok": bool, "code": int, ...}`
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

/// Internal function that performs the actual Nix installation.
///
/// Three phases:
/// 1. Check if already installed (skip if so)
/// 2. Download the Determinate Systems installer binary
/// 3. Execute via osascript for native macOS password elevation
fn run_nix_install(app: &AppHandle) -> Result<()> {
    // Phase 1: Check if already installed
    if is_nix_installed() {
        let version = get_nix_version().unwrap_or_default();
        info!("[nix] already installed: {}", version);
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": true,
                "code": 0,
                "nix_version": version,
            }),
        )?;
        return Ok(());
    }

    // Phase 2: Download the installer binary
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };

    let url = format!(
        "https://install.determinate.systems/nix/nix-installer-{}-apple-darwin",
        arch
    );
    let installer_path = "/tmp/nix-installer";

    info!("[nix] Downloading installer from {}", url);
    let payload =
        serde_json::json!({"chunk": format!("Downloading Nix installer for {}...\n", arch)});
    let _ = app.emit("nix:install:data", payload);

    let curl_output = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--output",
            installer_path,
            &url,
        ])
        .output()?;

    if !curl_output.status.success() {
        let stderr = String::from_utf8_lossy(&curl_output.stderr).to_string();
        error!("[nix] Download failed: {}", stderr);
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": false,
                "code": curl_output.status.code().unwrap_or(22),
                "error_type": "network",
                "error": format!("Download failed: {}", stderr),
            }),
        )?;
        return Ok(());
    }

    // Make executable
    Command::new("chmod")
        .args(["+x", installer_path])
        .status()?;

    let payload = serde_json::json!({"chunk": "Download complete. Starting installation...\n"});
    let _ = app.emit("nix:install:data", payload);

    // Phase 3: Execute via osascript for native password prompt
    let applescript = format!(
        "do shell script \"sudo '{}' install --no-confirm\" with administrator privileges",
        installer_path
    );

    info!("[nix] Running installer via osascript");
    let mut child = Command::new("osascript")
        .args(["-e", &applescript])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();

    // Stream stdout
    let stdout_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let payload = serde_json::json!({"chunk": format!("{}\n", line)});
                let _ = app_for_stdout.emit("nix:install:data", payload);
                lines.push(line);
            }
        }
        lines
    });

    // Stream stderr
    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let payload = serde_json::json!({"chunk": format!("{}\n", line)});
                let _ = app_for_stderr.emit("nix:install:data", payload);
                lines.push(line);
            }
        }
        lines
    });

    let _stdout_lines = stdout_handle.join().unwrap_or_default();
    let stderr_lines = stderr_handle.join().unwrap_or_default();

    let status = child.wait()?;
    let code = status.code().unwrap_or(-1);

    info!("[nix] Installer completed with code={}", code);

    if status.success() {
        let version = get_nix_version().unwrap_or_default();
        info!("[nix] Installation successful, version: {}", version);
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": true,
                "code": 0,
                "nix_version": version,
            }),
        )?;
    } else {
        // Detect user cancellation
        let stderr_combined = stderr_lines.join("\n");
        let is_cancelled = code == -128
            || stderr_combined.contains("User canceled")
            || stderr_combined.contains("(-128)");

        if is_cancelled {
            info!("[nix] Installation cancelled by user");
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": code,
                    "error_type": "cancelled",
                    "error": "Installation cancelled by user",
                }),
            )?;
        } else {
            error!("[nix] Installation failed with code {}", code);
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": code,
                    "error_type": "installer_error",
                    "error": stderr_combined,
                }),
            )?;
        }
    }

    Ok(())
}
