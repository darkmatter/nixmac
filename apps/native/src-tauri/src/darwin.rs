//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::log_summarizer;
use chrono::Local;
use log::{error, info};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
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
/// - `darwin:apply:end`: Emitted on completion with `{"ok": bool, "code": int, "error_type": string, "error": string, "log_file": string}`
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
        match run_darwin_rebuild(&app_handle, &config_dir_owned, &host_attr_owned) {
            Ok(payload) => {
                info!("[darwin] darwin-rebuild completed successfully");
                let _ = app_handle.emit("darwin:apply:end", payload);
            }
            Err(error_payload) => {
                let error_type = error_payload
                    .get("error_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("generic_error");
                error!(
                    "[darwin] darwin-rebuild completed with error_type: {}",
                    error_type
                );
                let _ = app_handle.emit("darwin:apply:end", error_payload);
            }
        }
    });

    Ok(())
}

/// Result of the build step containing exit status and stderr output.
struct BuildResult {
    success: bool,
    code: i32,
    stderr: Vec<String>,
}

/// Result of the activation step.
struct ActivateResult {
    success: bool,
    code: i32,
    stdout: String,
    stderr: String,
}

/// Run the darwin-rebuild build step as the current user (no sudo).
/// This avoids Git ownership issues while building the configuration.
fn run_build_step(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
    summarizer: &Arc<log_summarizer::LogSummarizerHandle>,
    log_writer: Arc<Mutex<File>>,
) -> Result<BuildResult, anyhow::Error> {
    // Ensure untracked files are visible to Nix flake evaluation
    if let Err(e) = crate::git::intent_add_untracked(config_dir) {
        info!("[darwin] intent_add_untracked warning: {}", e);
    }

    let use_fallback = !crate::nix::is_darwin_rebuild_available();
    let flake_arg = format!(".#{}", host_attr);

    let mut build_cmd = if use_fallback {
        let mut cmd = Command::new("nix");
        cmd.args([
            "run",
            "nix-darwin/master#darwin-rebuild",
            "--",
            "build",
            "--flake",
            &flake_arg,
            "--show-trace",
            "--verbose",
        ]);
        cmd.env("NIX_CONFIG", "experimental-features = nix-command flakes");
        cmd
    } else {
        let mut cmd = Command::new("darwin-rebuild");
        cmd.args(["build", "--flake", &flake_arg, "--show-trace", "--verbose"]);
        cmd
    };

    let mut build_child = build_cmd
        .env("PATH", crate::nix::get_nix_path())
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to spawn darwin-rebuild build: {}", e))?;

    let stdout = build_child.stdout.take();
    let stderr = build_child.stderr.take();
    let app_out = app.clone();
    let app_err = app.clone();
    let sum_out = summarizer.clone();
    let sum_err = summarizer.clone();
    let log_for_out = log_writer.clone();
    let log_for_err = log_writer.clone();

    let stdout_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app_out.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_out.send_line(&line);
                // Also write stdout lines to the main log file
                if let Ok(mut f) = log_for_out.lock() {
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                lines.push(line);
            }
        }
        lines
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app_err.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_err.send_line(&line);
                // Also write stderr lines to the main log file
                if let Ok(mut f) = log_for_err.lock() {
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                lines.push(line);
            }
        }
        lines
    });
    let _ = stdout_handle.join();
    let build_stderr = stderr_handle.join().unwrap_or_default();

    let build_status = build_child
        .wait()
        .map_err(|e| anyhow::anyhow!("Failed to wait for darwin-rebuild build: {}", e))?;
    let build_code = build_status.code().unwrap_or(-1);

    info!(
        "[darwin] build completed: code={}, success={}",
        build_code,
        build_status.success()
    );

    Ok(BuildResult {
        success: build_status.success(),
        code: build_code,
        stderr: build_stderr,
    })
}

/// Run the activation step as root using native macOS authentication dialog.
/// Uses `osascript` to show Touch ID dialog on compatible hardware.
fn run_activate_step(config_dir: &str) -> Result<ActivateResult, anyhow::Error> {
    let activate_path = format!("{}/result/activate", config_dir);
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
    let code = output.status.code().unwrap_or(-1);

    info!(
        "[darwin] activate completed: code={}, success={}",
        code,
        output.status.success()
    );

    Ok(ActivateResult {
        success: output.status.success(),
        code,
        stdout: stdout_str,
        stderr: stderr_str,
    })
}

/// Handle activation failures and determine the appropriate error response.
fn handle_activation_error(result: &ActivateResult, log_path: &Path) -> serde_json::Value {
    let stderr_lower = result.stderr.to_lowercase();

    // AppleScript cancellation (-128)
    if stderr_lower.contains("user canceled") {
        info!("[darwin] Activation cancelled by user");
        error!("[darwin] osascript stderr: {}", result.stderr);
        return serde_json::json!({
            "ok": false,
            "code": -128,
            "error_type": "user_cancelled",
            "error": "Activation cancelled by user",
        });
    }

    // Authorization / privilege failure
    const AUTH_DENIED_PHRASES: &[&str] = &[
        "authorization failed",
        "not authorized",
        "authorization denied",
        "not permitted",
        "you do not have permission",
        "authentication failed",
        "is not an administrator",
    ];

    if AUTH_DENIED_PHRASES.iter().any(|p| stderr_lower.contains(p)) {
        let details = result
            .stderr
            .lines()
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        error!(
            "[darwin] Activation failed: authorization denied. Details: {}",
            details
        );
        return serde_json::json!({
            "ok": false,
            "code": -129,
            "log_file": log_path.to_string_lossy(),
            "error_type": "authorization_denied",
            "error": format!(
                "Authorization denied — administrator credentials required.\n\nDetails:\n{}",
                details
            ),
        });
    }

    // Generic activation failure
    // Include a tail of stderr in the logged and returned error for easier debugging
    let stderr_tail = result
        .stderr
        .lines()
        .rev()
        .take(10)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    error!(
        "[darwin] Activation failed (code={}): {}",
        result.code,
        if stderr_tail.is_empty() {
            &result.stderr
        } else {
            &stderr_tail
        }
    );

    serde_json::json!({
        "ok": false,
        "code": result.code,
        "log_file": log_path.to_string_lossy(),
        "error_type": "generic_error",
        "error": format!("Activation failed (exit code {}):\n{}", result.code, stderr_tail),
    })
}

/// Internal function to run darwin-rebuild with proper streaming.
/// All output is written to ~/Library/Logs/nixmac/darwin-rebuild_<timestamp>.log
/// Returns Ok(success_payload) on success, Err(error_payload) on failure.
/// The caller should emit the appropriate darwin:apply:end event.
fn run_darwin_rebuild(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<serde_json::Value, serde_json::Value> {
    let (log_file, log_path) = create_log_file().map_err(|e| {
        serde_json::json!({
            "ok": false,
            "code": -1,
            "error_type": "generic_error",
            "error": format!("Failed to create log file: {}", e),
        })
    })?;
    let log_file = Arc::new(Mutex::new(log_file));
    info!("[darwin] Logging to: {:?}", log_path);

    let summarizer = Arc::new(log_summarizer::start(app.clone()));

    macro_rules! log_and_emit {
        ($msg:expr) => {
            let msg = $msg;
            {
                let mut f = log_file.lock().unwrap();
                let _ = writeln!(f, "{}", msg);
                let _ = f.flush();
            }
            let _ = app.emit(
                "darwin:apply:data",
                serde_json::json!({"chunk": format!("{}\n", msg)}),
            );
            summarizer.send_line(&msg);
        };
    }

    // Log header
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    {
        let mut f = log_file.lock().unwrap();
        let _ = writeln!(f, "=== darwin-rebuild started at {} ===", timestamp);
        let _ = writeln!(f, "Config dir: {}", config_dir);
        let _ = writeln!(f, "Host attr: {}", host_attr);
        let _ = writeln!(f, "Log file: {:?}", log_path);
        let _ = writeln!(f);
        let _ = f.flush();
    }

    // =========================================================================
    // Step 1: build as user (no sudo, avoids Git ownership issues)
    // =========================================================================
    log_and_emit!("Starting darwin-rebuild build (as user)...");

    let build_result = run_build_step(app, config_dir, host_attr, &summarizer, log_file.clone())
        .map_err(|e| {
            serde_json::json!({
                "ok": false,
                "code": -1,
                "log_file": log_path.to_string_lossy(),
                "error_type": "generic_error",
                "error": format!("Build step failed to execute: {}", e),
            })
        })?;

    if !build_result.success {
        let tail = &build_result.stderr[build_result.stderr.len().saturating_sub(10)..];
        let err_msg = format!(
            "darwin-rebuild build failed (exit code {}):\n{}",
            build_result.code,
            tail.join("\n")
        );
        log_and_emit!(format!("Build failed (exit code {})", build_result.code));
        summarizer.complete(false);

        {
            if let Ok(mut f) = log_file.lock() {
                let _ = writeln!(f, "\n=== darwin-rebuild build FAILED ===");
                let _ = writeln!(f, "Exit code: {}", build_result.code);
                let _ = f.flush();
            }
        }

        return Err(serde_json::json!({
            "ok": false,
            "code": build_result.code,
            "log_file": log_path.to_string_lossy(),
            "error": err_msg,
            "error_type": "build_error",
        }));
    }

    log_and_emit!("darwin-rebuild build completed successfully.");

    // =========================================================================
    // Step 2: activate as root via native macOS authentication dialog
    // =========================================================================
    log_and_emit!("Requesting admin privileges for activation...");

    let activate_result = run_activate_step(config_dir).map_err(|e| {
        serde_json::json!({
            "ok": false,
            "code": -1,
            "log_file": log_path.to_string_lossy(),
            "error_type": "generic_error",
            "error": format!("Activation step failed to execute: {}", e),
        })
    })?;

    if !activate_result.success {
        summarizer.complete(false);
        // Write and emit activation output (osascript uses `2>&1`, so useful details are often in stdout)
        let mut stdout_lines: Vec<String> = Vec::new();
        for line in activate_result.stdout.lines() {
            if !line.is_empty() {
                if let Ok(mut f) = log_file.lock() {
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                let _ = app.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                summarizer.send_line(line);
                stdout_lines.push(line.to_string());
            }
        }

        // Include a tail of stdout in the returned error payload for easier debugging
        let stdout_tail = stdout_lines
            .iter()
            .rev()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");

        let mut error_response = handle_activation_error(&activate_result, &log_path);
        if !stdout_tail.is_empty() {
            if let Some(obj) = error_response.as_object_mut() {
                obj.insert(
                    "stdout_tail".to_string(),
                    serde_json::Value::String(stdout_tail.clone()),
                );
                if let Some(err_val) = obj.get_mut("error") {
                    if let Some(s) = err_val.as_str() {
                        let new_err =
                            format!("{}\n\nActivation output (last lines):\n{}", s, stdout_tail);
                        *err_val = serde_json::Value::String(new_err);
                    }
                } else {
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(format!("Activation output:\n{}", stdout_tail)),
                    );
                }
            } else {
                error_response = serde_json::json!({
                    "stdout_tail": stdout_tail,
                    "error": error_response,
                });
            }
        }

        log_and_emit!(format!(
            "Activation failed: {} ({})",
            error_response, stdout_tail
        ));

        return Err(error_response);
    }

    log_and_emit!("Activating configuration...");

    // Emit captured output to frontend
    for line in activate_result.stdout.lines() {
        if !line.is_empty() {
            if let Ok(mut f) = log_file.lock() {
                let _ = writeln!(f, "{}", line);
                let _ = f.flush();
            }
            let _ = app.emit(
                "darwin:apply:data",
                serde_json::json!({"chunk": format!("{}\n", line)}),
            );
            summarizer.send_line(line);
        }
    }

    summarizer.complete(true);

    // Log completion
    {
        if let Ok(mut f) = log_file.lock() {
            let _ = writeln!(f);
            let _ = writeln!(f, "=== darwin-rebuild completed ===");
            let _ = writeln!(f, "Exit code: {}", activate_result.code);
            let _ = writeln!(f, "Success: true");
            let _ = writeln!(
                f,
                "Finished at: {}",
                Local::now().format("%Y-%m-%d %H:%M:%S")
            );
            let _ = writeln!(f, "Log saved to: {:?}", log_path);
            let _ = f.flush();
        }
    }
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

    let error_type = if is_fda_error {
        Some("full_disk_access")
    } else {
        None
    };

    info!("[darwin] apply_stream completed");
    let mut success_payload = serde_json::json!({
        "ok": true,
        "code": activate_result.code,
        "log_file": log_path.to_string_lossy(),
    });
    if let Some(et) = error_type {
        if let Some(obj) = success_payload.as_object_mut() {
            obj.insert(
                "error_type".to_string(),
                serde_json::Value::String(et.to_string()),
            );
        }
    }
    Ok(success_payload)
}
