//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::{evolve, peek};
use chrono::Local;
use log::{debug, error, info, warn};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

/// Get the log directory path, creating it if needed.
fn get_log_dir() -> anyhow::Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| anyhow::anyhow!("HOME not set"))?;
    let log_dir = PathBuf::from(home).join("Library/Logs/nixmac");
    fs::create_dir_all(&log_dir)?;
    Ok(log_dir)
}

/// Create a new log file for this darwin-rebuild run.
fn create_log_file() -> anyhow::Result<(File, PathBuf)> {
    let log_dir = get_log_dir()?;
    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S");
    let log_path = log_dir.join(format!("darwin-rebuild_{}.log", timestamp));
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)?;
    Ok((file, log_path))
}

/// Uses AI to propose configuration changes based on a natural language description.
///
/// Workflow:
/// 1. Ensures the config directory is a git repo (for safe rollback)
/// 2. Invokes `codex` CLI to generate a unified diff based on the prompt
///
/// The patch is written to /tmp/darwin-evolve.patch by codex.
pub async fn start_evolve(
    app: &AppHandle,
    config_dir: &str,
    description: &str,
) -> anyhow::Result<serde_json::Value> {
    let result = evolve::generate_evolution(app, config_dir, description).await;

    match result {
        Ok(evolution) => Ok(serde_json::to_value(evolution).unwrap_or_default()),
        Err(e) => Err(e),
    }
}

/// Runs `darwin-rebuild switch` with streaming output.
///
/// This spawns the rebuild in a background thread and emits events:
/// - `darwin:apply:data`: Emitted for each line of output with `{"chunk": "..."}`
/// - `darwin:apply:end`: Emitted on completion with `{"ok": bool, "code": int}`
///
/// Uses `osascript` to prompt for admin privileges since darwin-rebuild
/// requires sudo for system-level changes.
pub fn apply_stream(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<(), anyhow::Error> {
    info!(
        "[darwin] apply_stream called with config_dir={}, host_attr={}",
        config_dir, host_attr
    );

    // Clone needed data to satisfy 'static bound for thread
    let config_dir_owned = config_dir.to_owned();
    let host_attr_owned = host_attr.to_owned();
    let app_handle = app.clone();

    // Spawn the thread but DON'T join it - let it run asynchronously
    std::thread::spawn(move || {
        if let Err(e) = run_darwin_rebuild(&app_handle, &config_dir_owned, &host_attr_owned) {
            error!("[darwin] darwin-rebuild failed: {}", e);
            // Emit error to all windows
            let _ = app_handle.emit(
                "darwin:apply:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error": e.to_string(),
                }),
            );
            // Hide the overlay on error
            let _ = peek::hide_rebuild_overlay(&app_handle);
        }
    });

    info!("[darwin] apply_stream started background thread");
    Ok(())
}

/// Internal function to run darwin-rebuild with proper streaming.
/// All output is written to ~/Library/Logs/nixmac/darwin-rebuild_<timestamp>.log
fn run_darwin_rebuild(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<(), anyhow::Error> {
    // Show the rebuild overlay
    if let Err(e) = peek::show_rebuild_overlay(app) {
        warn!("[darwin] Failed to show rebuild overlay: {}", e);
    }

    // Create log file for this run
    let (mut log_file, log_path) = create_log_file()?;
    info!("[darwin] Logging to: {:?}", log_path);

    // Helper macro to write to both log file and emit to all windows
    macro_rules! log_and_emit {
        ($msg:expr) => {
            let msg = $msg;
            let _ = writeln!(log_file, "{}", msg);
            let _ = log_file.flush();
            let payload = serde_json::json!({"chunk": format!("{}\n", msg)});
            // Emit to all windows so both main and overlay receive events
            let _ = app.emit("darwin:apply:data", payload);
        };
    }

    // Log header
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(log_file, "=== darwin-rebuild started at {} ===", timestamp);
    let _ = writeln!(log_file, "Config dir: {}", config_dir);
    let _ = writeln!(log_file, "Host attr: {}", host_attr);
    let _ = writeln!(log_file, "Log file: {:?}", log_path);
    let _ = writeln!(log_file, "");

    info!("[darwin] Building darwin-rebuild command...");

    // Build the darwin-rebuild command
    let cmd_str = format!(
        "cd '{}' && darwin-rebuild switch --flake '.#{}'",
        config_dir.replace('\'', "'\\''"),
        host_attr
    );

    info!("[darwin] Command: {}", cmd_str);
    let _ = writeln!(log_file, "Command: {}", cmd_str);
    let _ = writeln!(log_file, "");

    info!("[darwin] Starting darwin-rebuild...");
    log_and_emit!("Starting darwin-rebuild switch...");

    // Run darwin-rebuild with sudo
    let mut child = Command::new("sudo")
        .args([
            "darwin-rebuild",
            "switch",
            "--flake",
            &format!(".#{}", host_attr),
        ])
        .env("PATH", crate::nix::get_nix_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(config_dir)
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to start darwin-rebuild: {}", e))?;

    info!("[darwin] darwin-rebuild process spawned, streaming output...");
    let _ = writeln!(log_file, "--- stdout ---");

    // Stream stdout line by line to all windows and log file
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line_content) => {
                    debug!("[darwin] stdout: {}", line_content);
                    let _ = writeln!(log_file, "{}", line_content);
                    let _ = log_file.flush();
                    let payload = serde_json::json!({"chunk": format!("{}\n", line_content)});
                    if let Err(e) = app.emit("darwin:apply:data", payload) {
                        error!("[darwin] Failed to emit data event: {}", e);
                    }
                }
                Err(e) => {
                    warn!("[darwin] Error reading stdout: {}", e);
                    let _ = writeln!(log_file, "[ERROR reading stdout: {}]", e);
                }
            }
        }
    }

    // Also capture stderr
    let _ = writeln!(log_file, "--- stderr ---");
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line_content) = line {
                debug!("[darwin] stderr: {}", line_content);
                let _ = writeln!(log_file, "{}", line_content);
                let _ = log_file.flush();
                let payload = serde_json::json!({"chunk": format!("{}\n", line_content)});
                let _ = app.emit("darwin:apply:data", payload);
            }
        }
    }

    info!("[darwin] Waiting for darwin-rebuild to complete...");
    let status = child
        .wait()
        .map_err(|e| anyhow::anyhow!("Failed to wait for child: {}", e))?;
    let code = status.code().unwrap_or(-1);

    info!(
        "[darwin] darwin-rebuild completed with code={}, success={}",
        code,
        status.success()
    );

    // Log completion
    let _ = writeln!(log_file, "");
    let _ = writeln!(log_file, "=== darwin-rebuild completed ===");
    let _ = writeln!(log_file, "Exit code: {}", code);
    let _ = writeln!(log_file, "Success: {}", status.success());
    let end_timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(log_file, "Finished at: {}", end_timestamp);

    // If successful, stage all changes to mark them as "previewed"
    if status.success() {
        info!("[darwin] Staging changes with git add -A...");
        let _ = writeln!(log_file, "Running: git add -A");
        let git_result = Command::new("git")
            .args(["add", "-A"])
            .current_dir(config_dir)
            .env("PATH", crate::nix::get_nix_path())
            .output();

        match git_result {
            Ok(output) => {
                if output.status.success() {
                    info!("[darwin] Git add completed successfully");
                    let _ = writeln!(log_file, "Git add: success");
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    warn!("[darwin] Git add failed: {}", stderr);
                    let _ = writeln!(log_file, "Git add failed: {}", stderr);
                }
            }
            Err(e) => {
                warn!("[darwin] Git add error: {}", e);
                let _ = writeln!(log_file, "Git add error: {}", e);
            }
        }
    }

    // Emit log file location
    log_and_emit!(format!("Log saved to: {:?}", log_path));

    // Emit completion event to all windows
    app.emit(
        "darwin:apply:end",
        serde_json::json!({
            "ok": status.success(),
            "code": code,
            "log_file": log_path.to_string_lossy(),
        }),
    )?;

    // Hide the rebuild overlay after a short delay to show completion status
    std::thread::sleep(std::time::Duration::from_millis(2000));
    if let Err(e) = peek::hide_rebuild_overlay(app) {
        warn!("[darwin] Failed to hide rebuild overlay: {}", e);
    }

    info!("[darwin] apply_stream completed");
    Ok(())
}
