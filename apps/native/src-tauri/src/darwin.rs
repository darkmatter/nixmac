//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::{evolve, log_summarizer};
use chrono::Local;
use log::{debug, error, info};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
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

/// Streams stdout and stderr from a child process to the frontend via events,
/// while also feeding lines to the log summarizer. Returns collected lines
/// prefixed with their stream name for writing to the log file.
fn stream_child_output(
    child: &mut Child,
    app: &AppHandle,
    summarizer: &Arc<log_summarizer::LogSummarizerHandle>,
    label: &str,
) -> (Vec<String>, Vec<String>) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let app_err = app.clone();
    let sum_out = summarizer.clone();
    let sum_err = summarizer.clone();
    let label_out = label.to_owned();
    let label_err = label.to_owned();

    let stdout_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                debug!("[darwin] {} stdout: {}", label_out, line);
                let _ = app_out.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_out.send_line(&line);
                lines.push(line);
            }
        }
        lines
    });

    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                debug!("[darwin] {} stderr: {}", label_err, line);
                let _ = app_err.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_err.send_line(&line);
                lines.push(line);
            }
        }
        lines
    });

    let stdout_lines = stdout_handle.join().unwrap_or_default();
    let stderr_lines = stderr_handle.join().unwrap_or_default();
    (stdout_lines, stderr_lines)
}

/// Extracts the last N lines from a list of stderr lines as an error summary.
fn extract_error_summary(stderr_lines: &[String], max_lines: usize) -> String {
    stderr_lines
        .iter()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Writes collected output lines to a log file under a section header.
fn write_output_to_log(log_file: &mut File, header: &str, stdout: &[String], stderr: &[String]) {
    let _ = writeln!(log_file, "--- {} ---", header);
    for line in stdout {
        let _ = writeln!(log_file, "[stdout] {}", line);
    }
    for line in stderr {
        let _ = writeln!(log_file, "[stderr] {}", line);
    }
    let _ = log_file.flush();
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

/// Runs `darwin-rebuild switch` with streaming output in two steps:
/// 1. `darwin-rebuild build` as the user (no sudo)
/// 2. `result/activate` as root via native macOS authentication dialog (supports Touch ID)
///
/// This pattern avoids Git ownership issues by keeping all file operations
/// under the user's permissions during the build phase while still making system
/// changes as root which is a nix-darwin requirement.
///
/// This spawns the rebuild in a background thread and emits events:
/// - `darwin:apply:data`: Emitted for each line of output with `{"chunk": "..."}`
/// - `darwin:apply:end`: Emitted on completion with `{"ok": bool, "code": int}`
pub fn apply_stream(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<(), anyhow::Error> {
    info!(
        "[darwin] apply_stream: config_dir={}, host_attr={}",
        config_dir, host_attr
    );

    let config_dir_owned = config_dir.to_owned();
    let host_attr_owned = host_attr.to_owned();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        if let Err(e) = run_darwin_rebuild(&app_handle, &config_dir_owned, &host_attr_owned) {
            error!("[darwin] darwin-rebuild failed: {}", e);
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

    Ok(())
}

/// Internal function to run darwin-rebuild with proper streaming.
/// All output is written to ~/Library/Logs/nixmac/darwin-rebuild_<timestamp>.log
fn run_darwin_rebuild(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<(), anyhow::Error> {
    let (mut log_file, log_path) = create_log_file()?;
    info!("[darwin] Logging to: {:?}", log_path);

    let summarizer = Arc::new(log_summarizer::start(app.clone()));

    macro_rules! log_and_emit {
        ($msg:expr) => {
            let msg = $msg;
            let _ = writeln!(log_file, "{}", msg);
            let _ = log_file.flush();
            let _ = app.emit(
                "darwin:apply:data",
                serde_json::json!({"chunk": format!("{}\n", msg)}),
            );
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

    let cmd_str = format!(
        "cd '{}' && darwin-rebuild switch --flake '.#{}' --show-trace --verbose",
        config_dir.replace('\'', "'\\''"),
        host_attr
    );
    info!("[darwin] Command: {}", cmd_str);
    let _ = writeln!(log_file, "Command: {}", cmd_str);
    let _ = writeln!(log_file);

    // =========================================================================
    // Step 1: build as user (no sudo, avoids Git ownership issues)
    // =========================================================================
    log_and_emit!("Starting darwin-rebuild build (as user)...");

    let mut build_child = Command::new("darwin-rebuild")
        .args([
            "build",
            "--flake",
            &format!(".#{}", host_attr),
            "--show-trace",
            "--verbose",
        ])
        .env("PATH", crate::nix::get_nix_path())
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to spawn darwin-rebuild build: {}", e))?;

    let (build_stdout, build_stderr) =
        stream_child_output(&mut build_child, app, &summarizer, "build");
    write_output_to_log(&mut log_file, "build output", &build_stdout, &build_stderr);

    let build_status = build_child
        .wait()
        .map_err(|e| anyhow::anyhow!("Failed to wait for darwin-rebuild build: {}", e))?;
    let build_code = build_status.code().unwrap_or(-1);

    info!(
        "[darwin] build completed: code={}, success={}",
        build_code,
        build_status.success()
    );

    if !build_status.success() {
        let summary = extract_error_summary(&build_stderr, 10);
        let err_msg = format!(
            "darwin-rebuild build failed (exit code {}):\n{}",
            build_code, summary
        );
        log_and_emit!(format!("Build failed (exit code {})", build_code));
        summarizer.complete(false);

        let _ = writeln!(log_file, "\n=== darwin-rebuild build FAILED ===");
        let _ = writeln!(log_file, "Exit code: {}", build_code);

        app.emit(
            "darwin:apply:end",
            serde_json::json!({
                "ok": false,
                "code": build_code,
                "log_file": log_path.to_string_lossy(),
                "error": err_msg,
            }),
        )?;
        return Ok(());
    }

    log_and_emit!("darwin-rebuild build completed successfully.");

    // =========================================================================
    // Step 2: activate as root via native macOS authentication dialog
    //
    // Uses `osascript` with `with administrator privileges` to show the
    // native macOS authentication dialog, which supports Touch ID on
    // compatible hardware. This runs the activate script as root.
    // =========================================================================
    let activate_path = format!("{}/result/activate", config_dir);

    log_and_emit!("Requesting admin privileges for activation...");

    let nix_path = crate::nix::get_nix_path();
    let shell_script = format!(
        "export PATH='{}' && '{}' 2>&1",
        nix_path.replace('\'', "'\\''"),
        activate_path.replace('\'', "'\\''"),
    );
    let escaped_script = shell_script.replace('\\', "\\\\").replace('"', "\\\"");
    let osascript_cmd = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped_script
    );

    info!("[darwin] Running osascript for activation");

    let output = Command::new("osascript")
        .args(["-e", &osascript_cmd])
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to run osascript: {}", e))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    // Check if user cancelled the authentication dialog
    if !output.status.success() && stderr_str.contains("User canceled") {
        log_and_emit!("Activation cancelled by user.");
        summarizer.complete(false);
        app.emit(
            "darwin:apply:end",
            serde_json::json!({
                "ok": false,
                "code": -128,
                "error": "Activation cancelled by user",
            }),
        )?;
        return Ok(());
    }

    log_and_emit!("Activating configuration...");

    // Emit captured output to frontend
    for line in stdout_str.lines() {
        if !line.is_empty() {
            let _ = writeln!(log_file, "{}", line);
            let _ = log_file.flush();
            let _ = app.emit(
                "darwin:apply:data",
                serde_json::json!({"chunk": format!("{}\n", line)}),
            );
            summarizer.send_line(line);
        }
    }

    let activate_stdout: Vec<String> = stdout_str.lines().map(|l| l.to_string()).collect();
    let activate_stderr: Vec<String> = stderr_str.lines().map(|l| l.to_string()).collect();
    write_output_to_log(
        &mut log_file,
        "activate output",
        &activate_stdout,
        &activate_stderr,
    );

    let code = output.status.code().unwrap_or(-1);

    info!(
        "[darwin] activate completed: code={}, success={}",
        code,
        output.status.success()
    );

    summarizer.complete(output.status.success());

    // Log completion
    let _ = writeln!(log_file);
    let _ = writeln!(log_file, "=== darwin-rebuild completed ===");
    let _ = writeln!(log_file, "Exit code: {}", code);
    let _ = writeln!(log_file, "Success: {}", output.status.success());
    let _ = writeln!(
        log_file,
        "Finished at: {}",
        Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    let _ = writeln!(log_file, "Log saved to: {:?}", log_path);
    let _ = app.emit(
        "darwin:apply:data",
        serde_json::json!({"chunk": format!("Log saved to: {:?}\n", log_path)}),
    );

    // Detect FDA errors from nix-darwin's activation output
    let log_contents = fs::read_to_string(&log_path).unwrap_or_default();
    let is_fda_error = log_contents
        .contains("permission denied when trying to update apps over SSH")
        || log_contents.contains("Operation not permitted")
        || log_contents.contains("error: unable to read");

    let error_type = if !output.status.success() && is_fda_error {
        Some("full_disk_access")
    } else {
        None
    };

    let activate_error = if !output.status.success() {
        let summary = extract_error_summary(&activate_stderr, 10);
        if summary.is_empty() {
            Some(format!(
                "darwin-rebuild activate failed with exit code {}",
                code
            ))
        } else {
            Some(format!(
                "darwin-rebuild activate failed (exit code {}):\n{}",
                code, summary
            ))
        }
    } else {
        None
    };

    app.emit(
        "darwin:apply:end",
        serde_json::json!({
            "ok": output.status.success(),
            "code": code,
            "log_file": log_path.to_string_lossy(),
            "error_type": error_type,
            "error": activate_error,
        }),
    )?;

    info!("[darwin] apply_stream completed");
    Ok(())
}
