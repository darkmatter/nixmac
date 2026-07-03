//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::ai::log_summarizer;
use crate::privileged_helper::{
    client as helper_client, protocol as helper_protocol, service as helper_service,
};
use chrono::Local;
use log::{error, info};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

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

/// Read the tail (last `max_lines` lines) of the most-recently-modified
/// `darwin-rebuild_*.log`, for feeding build-failure context to the "Fix with
/// AI" evolve run.
///
/// The frontend never receives a durable log path (`log_file` lives only on the
/// transient `darwin:apply:end` event and `RebuildStatus` has no such field), so
/// the current run's transcript is rediscovered here by modification time.
/// Returns `None` when the log dir is unreadable or holds no rebuild logs.
pub fn read_latest_rebuild_log_tail(max_lines: usize) -> Option<String> {
    let log_dir = get_log_dir().ok()?;

    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&log_dir).ok()?.flatten() {
        let path = entry.path();
        let is_rebuild_log = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("darwin-rebuild_") && name.ends_with(".log"));
        if !is_rebuild_log {
            continue;
        }
        let Some(modified) = entry.metadata().ok().and_then(|meta| meta.modified().ok()) else {
            continue;
        };
        if newest.as_ref().is_none_or(|(best, _)| modified > *best) {
            newest = Some((modified, path));
        }
    }

    let (_, path) = newest?;
    let contents = fs::read_to_string(&path).ok()?;
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Some(lines[start..].join("\n"))
}

/// Run a dry-run nix build check against the current working tree.
///
/// Returns `(passed, stdout, stderr)`. No build artefacts are produced.
/// Pass `show_trace: true` to include `--show-trace` for deeper diagnostics.
pub fn dry_run_build_check(
    config_dir: &str,
    host_attr: &str,
    show_trace: bool,
) -> Result<(bool, String, String), anyhow::Error> {
    if e2e_mock_system_enabled() {
        info!(
            "[darwin] NIXMAC_E2E_MOCK_SYSTEM enabled; dry-run build check bypassed for config_dir={}, host_attr={}",
            config_dir, host_attr
        );
        return Ok((
            true,
            "NIXMAC_E2E_MOCK_SYSTEM dry-run build check passed\n".to_string(),
            String::new(),
        ));
    }

    // Ensure untracked files are visible to flake evaluation.
    // Hard-fail: if this fails, untracked .nix files won't be seen and the
    // build result would be misleading.
    crate::git::intent_add_untracked(config_dir)?;

    let mut command = Command::new("nix");
    let safe_host_attr = serde_json::to_string(host_attr)?;
    command
        .arg("build")
        .arg(format!(".#darwinConfigurations.{}.system", safe_host_attr))
        .arg("--dry-run");

    if show_trace {
        command.arg("--show-trace");
    }

    let output = command
        .current_dir(config_dir)
        .env("PATH", crate::system::nix::get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok((output.status.success(), stdout, stderr))
}

/// Thin re-export of the `/etc` clobber preflight so callers in this module (and
/// the rebuild flow) don't reach across into `system::etc_preflight` directly.
pub fn preflight_etc_clobber(
    config_dir: &str,
    host_attr: &str,
) -> Result<crate::shared_types::EtcClobberCheckResult, anyhow::Error> {
    crate::system::etc_preflight::check_etc_clobber(config_dir, host_attr)
}

/// Thin re-export of the App Management preflight. This mirrors Home Manager's
/// `targets.darwin.copyApps` permission probe before activation asks for admin
/// rights.
pub fn preflight_app_management(
    config_dir: &str,
    host_attr: &str,
) -> Result<crate::shared_types::AppManagementCheckResult, anyhow::Error> {
    crate::system::app_management_preflight::check_app_management(config_dir, host_attr)
}

/// Build the `darwin:apply:end` payload for an aborted-before-activation clobber.
///
/// `system_untouched: true` is the key signal to the UI: because we bail before
/// the activation step (and before the admin prompt), nothing on the system has
/// changed and the user can safely rename the listed files and retry.
fn etc_clobber_error_payload(
    result: crate::shared_types::EtcClobberCheckResult,
    log_path: &Path,
) -> serde_json::Value {
    let paths = result
        .conflicts
        .iter()
        .map(|conflict| format!("  {}", conflict.path))
        .collect::<Vec<_>>()
        .join("\n");

    serde_json::json!({
        "ok": false,
        "code": 2,
        "log_file": log_path.to_string_lossy(),
        "error_type": "etc_clobber",
        "system_untouched": true,
        "etc_clobber": result,
        "error": format!(
            "Unexpected files in /etc would be overwritten:\n{}\n\nPlease check there is nothing critical in these files, rename them by adding .before-nix-darwin to the end, and then try again.",
            paths
        ),
    })
}

/// Build the `darwin:apply:end` payload for an App Management denial caught
/// before activation.
fn app_management_error_payload(
    result: crate::shared_types::AppManagementCheckResult,
    log_path: &Path,
) -> serde_json::Value {
    let app_bundles = result
        .failures
        .iter()
        .map(|failure| format!("  {}", failure.app_bundle))
        .collect::<Vec<_>>()
        .join("\n");

    serde_json::json!({
        "ok": false,
        "code": 3,
        "log_file": log_path.to_string_lossy(),
        "error_type": "app_management",
        "system_untouched": true,
        "app_management": result,
        "error": format!(
            "App Management permission is required to update managed app bundles:\n{}\n\nOpen System Settings > Privacy & Security > App Management and enable nixmac, then retry.",
            app_bundles
        ),
    })
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
/// - `darwin:apply:end`: Emitted on completion with `{"ok": bool, "code": int, "error_type": string, "error": string, "system_untouched": bool | null, "log_file": string}`
///
/// Emits the terminal `darwin:apply:end` event and records the outcome in
/// the rebuild-status cell (which emits `rebuild_status_changed`).
fn emit_apply_end(app: &AppHandle, payload: serde_json::Value) {
    crate::state::rebuild_status::record_end(app, &payload);
    // fire-and-forget: emit returns Err only when no listeners are registered
    // (window may be hidden/destroyed). Missing this event is non-fatal.
    let _ = app.emit("darwin:apply:end", payload);
}

pub fn apply_stream(
    app: &AppHandle,
    config_dir: &str,
    host_attr: &str,
) -> Result<(), anyhow::Error> {
    info!(
        "[darwin] apply_stream: config_dir={}, host_attr={}",
        config_dir, host_attr
    );
    crate::state::rebuild_status::record_start(app);

    if e2e_mock_system_enabled() {
        let app_handle = app.clone();
        let config_dir_owned = config_dir.to_owned();
        let host_attr_owned = host_attr.to_owned();
        std::thread::spawn(move || {
            let log_path = create_log_file()
                .map(|(mut file, path)| {
                    let _ = writeln!(
                        file,
                        "NIXMAC_E2E_MOCK_SYSTEM mocked darwin-rebuild for config_dir={}, host_attr={}",
                        config_dir_owned, host_attr_owned
                    );
                    let _ = file.flush();
                    path
                })
                .ok();

            let emit_line = |line: &str| {
                let _ = app_handle.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                let _ = app_handle.emit("darwin:apply:summary", serde_json::json!({"text": line}));
            };

            emit_line("NIXMAC_E2E_MOCK_SYSTEM: mocked darwin-rebuild build passed.");
            emit_line("NIXMAC_E2E_MOCK_SYSTEM: mocked activation passed.");
            let _ = app_handle.emit(
                "darwin:apply:summary",
                serde_json::json!({
                    "text": "NIXMAC_E2E_MOCK_SYSTEM: mocked system rebuild complete.",
                    "complete": true,
                    "success": true,
                }),
            );
            emit_apply_end(
                &app_handle,
                serde_json::json!({
                    "ok": true,
                    "code": 0,
                    "log_file": log_path.map(|path| path.to_string_lossy().to_string()),
                    "e2e_mock_system": true,
                }),
            );
        });
        return Ok(());
    }

    let config_dir_owned = config_dir.to_owned();
    let host_attr_owned = host_attr.to_owned();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        match run_darwin_rebuild(&app_handle, &config_dir_owned, &host_attr_owned) {
            Ok(payload) => {
                info!("[darwin] darwin-rebuild completed successfully");
                // fire-and-forget: emit returns Err only when no listeners are registered
                // (window may be hidden/destroyed). Missing this event is non-fatal.
                emit_apply_end(&app_handle, payload);
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
                // fire-and-forget: same reasoning as the Ok branch above.
                emit_apply_end(&app_handle, error_payload);
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

    let use_fallback = !crate::system::nix::is_darwin_rebuild_available();
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
        .env("PATH", crate::system::nix::get_nix_path())
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
                // fire-and-forget: streaming log chunks to the frontend; missing a line
                // is non-fatal. Emit fails only when no listeners are registered.
                let _ = app_out.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_out.send_line(&line);
                // Also write stdout lines to the main log file
                if let Ok(mut f) = log_for_out.lock() {
                    // fire-and-forget: log write failure (e.g. disk full) cannot be
                    // meaningfully reported from inside this streaming loop.
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
                // fire-and-forget: same reasoning as stdout thread above.
                let _ = app_err.emit(
                    "darwin:apply:data",
                    serde_json::json!({"chunk": format!("{}\n", line)}),
                );
                sum_err.send_line(&line);
                // Also write stderr lines to the main log file
                if let Ok(mut f) = log_for_err.lock() {
                    // fire-and-forget: log write failure cannot be usefully reported here.
                    let _ = writeln!(f, "{}", line);
                    let _ = f.flush();
                }
                lines.push(line);
            }
        }
        lines
    });
    // fire-and-forget join: stdout content is not used; we only need stderr for error reporting.
    // A panic inside the stdout thread would surface as Err(payload) — safe to ignore.
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
/// Uses `osascript` to show Touch ID / password dialog on compatible hardware.
///
/// Root cause of the "updating apps over SSH" error:
///   `osascript do shell script ... with administrator privileges` spawns the
///   privileged process in the *system* bootstrap domain (root context), not
///   the user's Aqua GUI session domain.  The nix-darwin activation script
///   calls `launchctl managername` and aborts with the "over SSH" error
///   whenever the result is not "Aqua" — even when called from a GUI app.
///
/// Fix: from within the root osascript shell, use `launchctl asuser <uid>`
///   to re-enter the user's Aqua bootstrap domain before invoking sudo.
///   fork()/exec() inherits the bootstrap port, so the activation script
///   sees `launchctl managername == "Aqua"` and the App Management check
///   proceeds correctly.
///
///   A temporary NOPASSWD sudoers rule is created for the exact, content-
///   addressed, immutable nix store activate path and is removed via a shell
///   trap — no persistent system configuration is required.
fn run_activate_step(
    config_dir: &str,
    allow_helper: bool,
) -> Result<ActivateResult, anyhow::Error> {
    let activate_path = format!("{}/result/activate", config_dir);
    run_activate_with_path(&activate_path, allow_helper)
}

/// Activate a specific nix store path directly
fn activate_store_path(store_path: &str) -> Result<ActivateResult, anyhow::Error> {
    let activate_path = format!("{}/activate", store_path);
    run_activate_with_path(&activate_path, true)
}

/// Classify an activation failure into (error_type, error_message).
fn classify_activate_error(result: &ActivateResult) -> (&'static str, String) {
    let output_lower = format!("{}\n{}", result.stderr, result.stdout).to_lowercase();
    if output_lower.contains("user canceled") {
        return ("user_cancelled", "Activation cancelled by user".to_string());
    }
    const APP_MANAGEMENT_PHRASES: &[&str] = &[
        "permission denied when trying to update apps",
        "requires permission to update your apps",
        "grant the permission for your terminal emulator in system settings",
        "privacy & security > app management",
    ];
    if APP_MANAGEMENT_PHRASES
        .iter()
        .any(|p| output_lower.contains(p))
    {
        return (
            "app_management",
            "App Management permission is required to update managed app bundles.".to_string(),
        );
    }

    const AUTH_PHRASES: &[&str] = &[
        "authorization failed",
        "not authorized",
        "authorization denied",
        "not permitted",
        "you do not have permission",
        "authentication failed",
        "is not an administrator",
    ];
    if AUTH_PHRASES.iter().any(|p| output_lower.contains(p)) {
        return (
            "authorization_denied",
            "Authorization denied — administrator credentials required.".to_string(),
        );
    }
    (
        "generic_error",
        format!("Activation failed (exit code {})", result.code),
    )
}

/// Mimics build but less interesting
pub fn activate_store_path_stream(
    app: &AppHandle,
    store_path: String,
) -> Result<(), anyhow::Error> {
    info!(
        "[darwin] activate_store_path_stream: store_path={}",
        store_path
    );
    crate::state::rebuild_status::record_start(app);
    let app_handle = app.clone();

    // All emit calls below are fire-and-forget: this closure runs in a background
    // thread and the frontend window may be hidden or destroyed by the time we emit.
    // Tauri's emit returns Err only when there are no listeners, which is non-fatal.
    std::thread::spawn(move || {
        let _ = app_handle.emit(
            "darwin:apply:data",
            serde_json::json!({"chunk": "Activating previous nix store...\n"}),
        );

        match activate_store_path(&store_path) {
            Ok(result) => {
                for line in result.stdout.lines() {
                    if !line.is_empty() {
                        let _ = app_handle.emit(
                            "darwin:apply:data",
                            serde_json::json!({"chunk": format!("{}\n", line)}),
                        );
                    }
                }

                if result.success {
                    info!("[darwin] store path activation succeeded");
                    emit_apply_end(
                        &app_handle,
                        serde_json::json!({"ok": true, "code": result.code}),
                    );
                } else {
                    let (error_type, error) = classify_activate_error(&result);
                    error!(
                        "[darwin] store path activation failed (code={}): {}",
                        result.code, error
                    );
                    emit_apply_end(
                        &app_handle,
                        serde_json::json!({
                            "ok": false,
                            "code": result.code,
                            "error_type": error_type,
                            "error": error,
                            "system_untouched": activation_failure_left_system_untouched(error_type),
                        }),
                    );
                }
            }
            Err(e) => {
                error!("[darwin] activate_store_path_stream error: {}", e);
                emit_apply_end(
                    &app_handle,
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "generic_error",
                        "error": format!("Activation failed: {}", e),
                        "system_untouched": true,
                    }),
                );
            }
        }
    });

    Ok(())
}

fn run_activate_with_path(
    activate_path: &str,
    allow_helper: bool,
) -> Result<ActivateResult, anyhow::Error> {
    let nix_path = crate::system::nix::get_nix_path();
    let home = std::env::var("HOME").unwrap_or_default();
    let ssh_sock = std::env::var("SSH_AUTH_SOCK").unwrap_or_default();
    let user = whoami::username().unwrap_or_else(|_| "root".to_string());

    // Resolve the symlink to the real nix store path.
    // sudo / visudo match against the canonical path, not the symlink.
    let real_activate = std::fs::canonicalize(activate_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| activate_path.to_owned());

    if allow_helper {
        if let Some(result) = try_activate_with_helper(&real_activate) {
            return result;
        }
    } else {
        info!("[darwin] Skipping privileged helper for App Management-sensitive activation");
    }

    // Escape a value for safe embedding inside a shell single-quoted string.
    let sq = |s: &str| s.replace('\'', "'\\''");

    // Build the privileged shell script that runs as root via osascript.
    // It:
    //   1. Creates a temp NOPASSWD sudoers rule for this exact nix store path.
    //   2. Uses `launchctl asuser` to switch into the user's Aqua bootstrap
    //      domain before calling sudo, so the activation script sees
    //      `launchctl managername == "Aqua"`.
    //   3. Removes the temp sudoers file via a trap on exit.
    let shell_script = format!(
        "set -e\n\
         ACTIVATE='{activate}'\n\
         USER_ID=$(id -u '{user}')\n\
         \n\
         trap 'rm -f /etc/sudoers.d/nixmac-activate-temp' EXIT\n\
         \n\
         printf '%s ALL=(ALL) NOPASSWD: %s\\n' '{user}' \"$ACTIVATE\" \
             > /etc/sudoers.d/nixmac-activate-temp\n\
         chmod 440 /etc/sudoers.d/nixmac-activate-temp\n\
         visudo -cf /etc/sudoers.d/nixmac-activate-temp >/dev/null\n\
         \n\
         export PATH='{path}'\n\
         export HOME='{home}'\n\
         export SSH_AUTH_SOCK='{sock}'\n\
         launchctl asuser \"$USER_ID\" sudo -E -n \"$ACTIVATE\" 2>&1\n\
         SYSTEM_PATH=$(dirname \"$ACTIVATE\")\n\
         nix-env -p /nix/var/nix/profiles/system --set \"$SYSTEM_PATH\" || true",
        activate = sq(&real_activate),
        user = sq(&user),
        path = sq(&nix_path),
        home = sq(&home),
        sock = sq(&ssh_sock),
    );

    // Escape the shell script for embedding in an AppleScript string literal:
    //   \ → \\ and " → \"
    let escaped_script = shell_script.replace('\\', "\\\\").replace('"', "\\\"");

    let osascript_cmd = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped_script
    );

    info!("[darwin] Running activation with launchctl asuser (Aqua bootstrap domain)");

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

fn try_activate_with_helper(activate_path: &str) -> Option<Result<ActivateResult, anyhow::Error>> {
    let status = helper_service::status();
    if !status.authorized || !status.socket_available {
        return None;
    }

    let request = match helper_protocol::current_user_activation_request(Path::new(activate_path)) {
        Ok(request) => request,
        Err(error) => {
            return Some(Err(
                error.context("failed to build helper activation request")
            ));
        }
    };

    match helper_client::activate_store_path(request) {
        Ok(response) => Some(Ok(ActivateResult {
            success: response.ok,
            code: response.code,
            stdout: response.stdout,
            stderr: response.error.unwrap_or(response.stderr),
        })),
        Err(error) => {
            if error
                .to_string()
                .contains("failed to connect to /var/run/nixmac/helper.sock")
            {
                info!(
                    "[darwin] privileged helper socket was stale; falling back to osascript: {error:#}"
                );
                return None;
            }

            Some(Ok(ActivateResult {
                success: false,
                code: -1,
                stdout: String::new(),
                stderr: format!(
                    "Privileged helper activation did not return a response: {error:#}. Activation may still be running; nixmac did not fall back to the password prompt."
                ),
            }))
        }
    }
}

/// Handle activation failures and determine the appropriate error response.
fn handle_activation_error(result: &ActivateResult, log_path: &Path) -> serde_json::Value {
    let (error_type, friendly_error) = classify_activate_error(result);

    // AppleScript cancellation (-128)
    if error_type == "user_cancelled" {
        info!("[darwin] Activation cancelled by user");
        error!("[darwin] osascript stderr: {}", result.stderr);
        return serde_json::json!({
            "ok": false,
            "code": -128,
            "error_type": "user_cancelled",
            "error": "Activation cancelled by user",
            "system_untouched": true,
        });
    }

    if error_type == "app_management" {
        error!("[darwin] Activation failed: {friendly_error}");
        return serde_json::json!({
            "ok": false,
            "code": result.code,
            "log_file": log_path.to_string_lossy(),
            "error_type": error_type,
            "system_untouched": false,
            "error": friendly_error,
        });
    }

    // Authorization / privilege failure
    if error_type == "authorization_denied" {
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
            "system_untouched": false,
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
        "system_untouched": false,
        "error": format!("Activation failed (exit code {}):\n{}", result.code, stderr_tail),
    })
}

fn activation_failure_left_system_untouched(error_type: &str) -> bool {
    matches!(error_type, "user_cancelled")
}

#[cfg(test)]
mod activation_safety_tests {
    use super::{
        ActivateResult, activation_failure_left_system_untouched, classify_activate_error,
    };

    fn failed_activation(stdout: &str, stderr: &str) -> ActivateResult {
        ActivateResult {
            success: false,
            code: 1,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
        }
    }

    #[test]
    fn app_management_failure_is_classified_from_activation_stdout() {
        let result = failed_activation(
            "error: permission denied when trying to update apps, aborting activation\nhome-manager requires permission to update your apps",
            "",
        );

        let (error_type, message) = classify_activate_error(&result);

        assert_eq!(error_type, "app_management");
        assert!(message.contains("App Management"));
    }

    #[test]
    fn app_management_failure_takes_precedence_over_generic_not_permitted_text() {
        let result = failed_activation(
            "Operation not permitted\nIf you did not get a notification, navigate to System Settings > Privacy & Security > App Management.",
            "",
        );

        let (error_type, _) = classify_activate_error(&result);

        assert_eq!(error_type, "app_management");
    }

    #[test]
    fn only_explicit_cancellation_is_known_untouched() {
        assert!(activation_failure_left_system_untouched("user_cancelled"));
        assert!(!activation_failure_left_system_untouched(
            "authorization_denied"
        ));
        assert!(!activation_failure_left_system_untouched("generic_error"));
    }
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
            "system_untouched": true,
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
                // fire-and-forget: log write failure (disk full etc.) cannot be usefully
                // propagated from inside the macro; we continue building regardless.
                let _ = writeln!(f, "{}", msg);
                let _ = f.flush();
            }
            // fire-and-forget: emit to frontend; window may not be listening.
            let _ = app.emit(
                "darwin:apply:data",
                serde_json::json!({"chunk": format!("{}\n", msg)}),
            );
            summarizer.send_line(&msg);
        };
    }

    // Log header — fire-and-forget writes; see macro comment above.
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
                "system_untouched": true,
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
                // fire-and-forget: log write in error path — see macro comment above.
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
            "system_untouched": true,
        }));
    }

    log_and_emit!("darwin-rebuild build completed successfully.");

    // =========================================================================
    // Step 1b: proactively detect /etc files nix-darwin would refuse to
    // overwrite. We mirror nix-darwin's own etc.nix check (compare each
    // managed target against its knownSha256Hashes) using structured data
    // from `nix eval`, so we can fail *before* prompting for admin rights and
    // leave the system untouched. A check failure (e.g. nix eval error) is
    // non-fatal: we fall through and let activation surface the real error.
    // =========================================================================
    match preflight_etc_clobber(config_dir, host_attr) {
        Ok(result) if !result.ok => {
            log_and_emit!(format!(
                "Preflight: {} file(s) in /etc would be overwritten; aborting before activation.",
                result.conflicts.len()
            ));
            summarizer.complete(false);
            return Err(etc_clobber_error_payload(result, &log_path));
        }
        Ok(result) => {
            if result.warnings.is_empty() {
                log_and_emit!("Preflight: no /etc conflicts detected.");
            } else {
                log_and_emit!(format!(
                    "Preflight: no /etc conflicts detected; {} managed file(s) will be backed up before activation.",
                    result.warnings.len()
                ));
            }
        }
        Err(error) => {
            log_and_emit!(format!("Preflight: /etc conflict check skipped ({error}).",));
        }
    }

    // =========================================================================
    // Step 1c: proactively detect App Management denial for Home Manager
    // copyApps. This mirrors Home Manager's own harmless `.DS_Store` update
    // probe, but does it before the admin activation prompt. When existing app
    // bundles are involved, avoid the unattended helper path so macOS attributes
    // the TCC decision to the foreground app flow more consistently.
    // =========================================================================
    let mut allow_activation_helper = true;
    match preflight_app_management(config_dir, host_attr) {
        Ok(result) if !result.ok => {
            log_and_emit!(
                "Preflight: App Management permission is required to update managed app bundles. Open System Settings > Privacy & Security > App Management and enable nixmac, then retry."
            );
            summarizer.complete(false);
            return Err(app_management_error_payload(result, &log_path));
        }
        Ok(result) => {
            if result.checked > 0 {
                allow_activation_helper = false;
                log_and_emit!(format!(
                    "Preflight: App Management check passed for {} managed app bundle(s).",
                    result.checked
                ));
            } else {
                log_and_emit!("Preflight: no managed app bundles require App Management.");
            }
        }
        Err(error) => {
            log_and_emit!(format!(
                "Preflight: App Management check skipped ({error}).",
            ));
        }
    }

    // =========================================================================
    // Step 2: activate as root via native macOS authentication dialog
    // =========================================================================
    log_and_emit!("Requesting admin privileges for activation...");

    let activate_result = run_activate_step(config_dir, allow_activation_helper).map_err(|e| {
        serde_json::json!({
            "ok": false,
            "code": -1,
            "log_file": log_path.to_string_lossy(),
            "error_type": "generic_error",
            "system_untouched": true,
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
