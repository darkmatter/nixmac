//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::{evolve, log_summarizer};
use chrono::Local;
use log::{debug, error, info};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
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
/// It does this in two steps:
/// 1. `darwin-rebuild build` as the user (no sudo)
/// 2. `darwin-rebuild activate` as root via `osascript` to prompt for admin password
///
/// This pattern avoids Git ownership issues by keeping all file operations
/// under the user's permissions during the build phase while still making system
/// changes as sudo which is a nix-darwin requirement.
/// This approach is discussed https://github.com/nix-darwin/nix-darwin/issues/1471#issuecomment-3104988438
/// and in many other nix-darwin issues because it seems to be a common pain point.
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
    // Note: The rebuild overlay is now shown by the frontend before calling applyStreamStart.
    // This ensures the overlay window is mounted and listening before events start streaming.

    // Create log file for this run
    let (mut log_file, log_path) = create_log_file()?;
    info!("[darwin] Logging to: {:?}", log_path);

    // Start the log summarizer for smooth UI updates
    let summarizer = log_summarizer::start(app.clone());
    let summarizer = Arc::new(summarizer);

    // Helper macro to write to log file, emit raw data, and send to summarizer
    macro_rules! log_and_emit {
        ($msg:expr) => {
            let msg = $msg;
            let _ = writeln!(log_file, "{}", msg);
            let _ = log_file.flush();
            // Emit raw log for debugging/file logging
            let payload = serde_json::json!({"chunk": format!("{}\n", msg)});
            let _ = app.emit("darwin:apply:data", payload);
            // Also send to summarizer for UI display
            summarizer.send_line(&msg);
        };
    }

    // Log header
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(log_file, "=== darwin-rebuild started at {} ===", timestamp);
    let _ = writeln!(log_file, "Config dir: {}", config_dir);
    let _ = writeln!(log_file, "Host attr: {}", host_attr);
    let _ = writeln!(log_file, "Log file: {:?}", log_path);
    let _ = writeln!(log_file);

    info!("[darwin] Building darwin-rebuild command...");

    // Build the darwin-rebuild command
    // sudo darwin-rebuild switch --flake .#Coopers-Mac-Studio --show-trace --print-build-logs
    let cmd_str = format!(
        "cd '{}' && darwin-rebuild switch --flake '.#{}' --show-trace --verbose",
        config_dir.replace('\'', "'\\''"),
        host_attr
    );

    info!("[darwin] Command: {}", cmd_str);
    let _ = writeln!(log_file, "Command: {}", cmd_str);
    let _ = writeln!(log_file);

    info!("[darwin] Starting darwin-rebuild...");
    log_and_emit!("Starting darwin-rebuild switch...");

    // Step 1: build as user (no sudo, avoids Git ownership issues)
    let build_status = Command::new("darwin-rebuild")
        .args([
            "build",
            "--flake",
            &format!(".#{}", host_attr),
            "--show-trace",
            "--verbose",
        ])
        .env("PATH", crate::nix::get_nix_path())
        .current_dir(config_dir)
        .status()
        .map_err(|e| anyhow::anyhow!("Failed to run darwin-rebuild build: {}", e))?;

    if !build_status.success() {
        anyhow::bail!(
            "darwin-rebuild build failed with exit code {:?}",
            build_status.code()
        );
    }
    log_and_emit!("darwin-rebuild build (user) completed successfully.");

    // Step 2: activate as root using osascript for GUI password prompt
    let activate_path = format!("{}/result/activate", config_dir);
    let applescript = format!(
        "do shell script \"sudo '{}'\" with administrator privileges",
        activate_path.replace('\'', "'\\''")
    );

    let mut child = Command::new("osascript")
        .args(["-e", &applescript])
        .env("PATH", crate::nix::get_nix_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to run activate via osascript: {}", e))?;

    info!("[darwin] darwin-rebuild activate process spawned, streaming output...");

    // Read stdout and stderr concurrently using threads
    // This is critical because nix/darwin-rebuild writes progress to stderr,
    // and we need to interleave both streams for real-time output.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let summarizer_for_stdout = summarizer.clone();
    let summarizer_for_stderr = summarizer.clone();

    // Spawn thread for stdout
    let stdout_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                debug!("[darwin] stdout: {}", line);
                // Emit raw log
                let payload = serde_json::json!({"chunk": format!("{}\n", line)});
                let _ = app_for_stdout.emit("darwin:apply:data", payload);
                // Send to summarizer
                summarizer_for_stdout.send_line(&line);
                lines.push(format!("[stdout] {}", line));
            }
        }
        lines
    });

    // Spawn thread for stderr
    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                debug!("[darwin] stderr: {}", line);
                // Emit raw log
                let payload = serde_json::json!({"chunk": format!("{}\n", line)});
                let _ = app_for_stderr.emit("darwin:apply:data", payload);
                // Send to summarizer
                summarizer_for_stderr.send_line(&line);
                lines.push(format!("[stderr] {}", line));
            }
        }
        lines
    });

    // Wait for both threads to complete and collect their output for the log file
    let stdout_lines = stdout_handle.join().unwrap_or_default();
    let stderr_lines = stderr_handle.join().unwrap_or_default();

    // Write to log file (order may not be perfectly interleaved, but that's ok for logs)
    let _ = writeln!(log_file, "--- output ---");
    for line in stdout_lines {
        let _ = writeln!(log_file, "{}", line);
    }
    for line in stderr_lines {
        let _ = writeln!(log_file, "{}", line);
    }
    let _ = log_file.flush();

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

    // Signal the summarizer that we're done
    summarizer.complete(status.success());

    // Log completion
    let _ = writeln!(log_file);
    let _ = writeln!(log_file, "=== darwin-rebuild completed ===");
    let _ = writeln!(log_file, "Exit code: {}", code);
    let _ = writeln!(log_file, "Success: {}", status.success());
    let end_timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(log_file, "Finished at: {}", end_timestamp);

    // Note: git add is now handled by the frontend after receiving darwin:apply:end

    // Emit log file location (to raw log only, summarizer has already emitted completion)
    let _ = writeln!(log_file, "Log saved to: {:?}", log_path);
    let payload = serde_json::json!({"chunk": format!("Log saved to: {:?}\n", log_path)});
    let _ = app.emit("darwin:apply:data", payload);

    // Check if this was a Full Disk Access error by reading the log
    let log_contents = fs::read_to_string(&log_path).unwrap_or_default();
    let is_fda_error = log_contents
        .contains("permission denied when trying to update apps over SSH")
        || log_contents.contains("Full Disk Access")
        || log_contents.contains("full disk access");

    // Emit completion event to all windows
    let error_type: Option<&str> = if !status.success() && is_fda_error {
        Some("full_disk_access")
    } else {
        None
    };

    app.emit(
        "darwin:apply:end",
        serde_json::json!({
            "ok": status.success(),
            "code": code,
            "log_file": log_path.to_string_lossy(),
            "error_type": error_type,
        }),
    )?;

    // Note: overlay hiding is now handled by the frontend

    info!("[darwin] apply_stream completed");
    Ok(())
}
