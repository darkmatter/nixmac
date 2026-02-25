use anyhow::Result;
use log::{error, info};
use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

const NIX_PATHS_FALLBACK: &[&str] = &[
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/etc/profiles/per-user/root/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
];

/// Resolves PATH using a login shell so GUI apps can find Nix binaries.
pub fn get_nix_path() -> String {
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

    let base_path = std::env::var("PATH").unwrap_or_default();
    let nix_paths = NIX_PATHS_FALLBACK.join(":");
    format!("{}:{}", nix_paths, base_path)
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

pub fn is_nix_installed() -> bool {
    Command::new("/bin/bash")
        .args(["-l", "-c", "nix --version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

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

fn run_nix_install(app: &AppHandle) -> Result<()> {
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

    // Terminal provides the TTY and Full Disk Access the installer needs.
    let install_cmd = "curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm; exit";
    let applescript = format!(
        "tell application \"Terminal\"\n  activate\n  do script \"{}\"\nend tell",
        install_cmd
    );

    info!("[nix] Opening Terminal for Nix installation");
    let status = Command::new("osascript")
        .args(["-e", &applescript])
        .output()?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr).to_string();
        error!("[nix] Failed to open Terminal: {}", stderr);
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": false,
                "code": -1,
                "error_type": "terminal",
                "error": format!("Failed to open Terminal: {}", stderr),
            }),
        )?;
        return Ok(());
    }

    let max_wait = std::time::Duration::from_secs(600); // 10 min timeout
    let poll_interval = std::time::Duration::from_secs(3);
    let start = std::time::Instant::now();

    let mut poll_count = 0u32;
    loop {
        std::thread::sleep(poll_interval);
        poll_count += 1;
        info!(
            "[nix] Poll #{}: checking if nix is installed...",
            poll_count
        );

        if is_nix_installed() {
            let version = get_nix_version().unwrap_or_default();
            info!(
                "[nix] Poll #{}: nix detected! version: {}",
                poll_count, version
            );

            if let Err(e) = crate::default_config::finalize_flake_lock(app) {
                info!("[nix] Could not finalize flake.lock: {}", e);
            }

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

        if start.elapsed() > max_wait {
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "timeout",
                    "error": "Nix installation timed out. Please try installing manually in Terminal.",
                }),
            )?;
            return Ok(());
        }
    }
}
