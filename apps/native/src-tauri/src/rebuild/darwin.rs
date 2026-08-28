//! Darwin (macOS) specific operations for nix-darwin configuration management.
//!
//! Handles AI-assisted configuration evolution and system rebuilds.

use crate::ai::log_summarizer;
use crate::privileged_helper::{
    client as helper_client, helper_runtime, protocol as helper_protocol, reconcile,
    root_activation, service as helper_service,
};
use crate::rebuild::activation_path;
use crate::system::helper_permission;
use crate::utils::nix_string_literal;
use chrono::Local;
use log::{error, info, warn};
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
    let safe_host_attr = nix_string_literal(host_attr);
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

/// How often streamed build-check output is flushed to the caller. Batching
/// keeps the event volume low (mirrors `log_summarizer`'s approach) while
/// still reading as live.
const BUILD_CHECK_FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(120);

/// Streaming variant of [`dry_run_build_check`]: identical check, but output
/// lines are forwarded to `on_output` in throttled batches while the check
/// runs, and `should_cancel` is polled between batches — a cancelled run
/// kills the child instead of waiting minutes for a doomed evaluation.
///
/// Modeled on `run_build_step`'s piped-stdio reader threads. stdout and
/// stderr are read concurrently, so interleaving in `on_output` is
/// best-effort (like the apply stream), but the returned strings keep each
/// stream whole for the model.
pub fn dry_run_build_check_streaming(
    config_dir: &str,
    host_attr: &str,
    show_trace: bool,
    on_output: &dyn Fn(&str),
    should_cancel: &dyn Fn() -> bool,
) -> Result<(bool, String, String), anyhow::Error> {
    if e2e_mock_system_enabled() {
        info!(
            "[darwin] NIXMAC_E2E_MOCK_SYSTEM enabled; dry-run build check bypassed for config_dir={}, host_attr={}",
            config_dir, host_attr
        );
        let mock = "NIXMAC_E2E_MOCK_SYSTEM dry-run build check passed\n";
        on_output(mock);
        return Ok((true, mock.to_string(), String::new()));
    }

    // Ensure untracked files are visible to flake evaluation.
    // Hard-fail: if this fails, untracked .nix files won't be seen and the
    // build result would be misleading.
    crate::git::intent_add_untracked(config_dir)?;

    let mut command = Command::new("nix");
    let safe_host_attr = nix_string_literal(host_attr);
    command
        .arg("build")
        .arg(format!(".#darwinConfigurations.{}.system", safe_host_attr))
        .arg("--dry-run")
        // At default verbosity a dry run prints NOTHING until evaluation
        // finishes — there would be nothing to stream during the long part.
        // -v emits "evaluating file/derivation ..." lines throughout, which
        // is the liveness signal this variant exists for.
        .arg("--verbose");

    if show_trace {
        command.arg("--show-trace");
    }

    let mut child = command
        .current_dir(config_dir)
        .env("PATH", crate::system::nix::get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let tx_err = tx.clone();
    let stdout_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                // fire-and-forget: the receiver is gone only when the caller
                // already gave up on the check.
                let _ = tx.send(line.clone());
                lines.push(line);
            }
        }
        lines
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = tx_err.send(line.clone());
                lines.push(line);
            }
        }
        lines
    });

    // Pump lines into throttled batches until both reader threads hang up.
    let mut batch = String::new();
    let mut last_flush = std::time::Instant::now();
    loop {
        if should_cancel() {
            // Reap the child so it doesn't outlive the cancelled evolution;
            // the readers end when the pipes close.
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            return Err(anyhow::anyhow!("Build check cancelled"));
        }
        match rx.recv_timeout(BUILD_CHECK_FLUSH_INTERVAL) {
            Ok(line) => {
                batch.push_str(&line);
                batch.push('\n');
                if last_flush.elapsed() >= BUILD_CHECK_FLUSH_INTERVAL {
                    on_output(&batch);
                    batch.clear();
                    last_flush = std::time::Instant::now();
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !batch.is_empty() {
                    on_output(&batch);
                    batch.clear();
                    last_flush = std::time::Instant::now();
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if !batch.is_empty() {
        on_output(&batch);
    }

    let stdout_lines = stdout_handle
        .join()
        .map_err(|_| anyhow::anyhow!("Build check stdout reader panicked"))?;
    let stderr_lines = stderr_handle
        .join()
        .map_err(|_| anyhow::anyhow!("Build check stderr reader panicked"))?;
    let status = child.wait()?;

    let join_lines = |lines: Vec<String>| {
        let mut joined = lines.join("\n");
        if !joined.is_empty() {
            joined.push('\n');
        }
        joined
    };

    Ok((
        status.success(),
        join_lines(stdout_lines),
        join_lines(stderr_lines),
    ))
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

/// Runs the equivalent of `darwin-rebuild switch` with streaming output in two steps:
/// 1. `nix build` of the system closure as the user (no sudo), with the
///    out-link in app-support so the config dir stays clean
/// 2. `<store path>/activate` as root — through the privileged helper when one is
///    installed and enabled, otherwise via the native macOS admin password prompt
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
    /// GC-root link in app-support; removed once activation has set the
    /// durable system-profile root.
    out_link: PathBuf,
    /// Resolved /nix/store path of the built system; `Some` iff `success`.
    store_path: Option<PathBuf>,
}

/// Result of the activation step.
///
/// Also how a refused activation is reported: `success: false` with the reason
/// in `stderr`, which is the shape every consumer already renders (see
/// [`super::activation_path`]).
#[derive(Debug)]
pub(crate) struct ActivateResult {
    pub(crate) success: bool,
    pub(crate) code: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    /// The apply refused to start an activation and mutated nothing; `stderr`
    /// carries the finished sentence saying why. `code` is fabricated on these
    /// results, so classification keys on this flag, never on the code or the
    /// text. False for an activation that ran — and for a dispatched one whose
    /// outcome is unknown, which cannot claim the system is untouched.
    pub(crate) refused: bool,
}

/// Run the build step as the current user (no sudo).
/// This avoids Git ownership issues while building the configuration.
///
/// Builds with `nix build` directly (what `darwin-rebuild build` runs under
/// the hood), with the out-link in the nixmac app-support directory so the
/// user's config dir never grows a `result` symlink. The link only serves as
/// a GC root until activation sets the system profile.
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

    let out_link = super::out_link::prepare_out_link(super::out_link::APPLY_OUT_LINK_NAME)?;
    let safe_host_attr = nix_string_literal(host_attr);

    let mut build_cmd = Command::new("nix");
    build_cmd
        .arg("build")
        .arg(format!(".#darwinConfigurations.{}.system", safe_host_attr))
        .arg("--out-link")
        .arg(&out_link)
        .args(["--show-trace", "--verbose"])
        .env("NIX_CONFIG", "experimental-features = nix-command flakes");

    let mut build_child = build_cmd
        .env("PATH", crate::system::nix::get_nix_path())
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to spawn nix build: {}", e))?;

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
        .map_err(|e| anyhow::anyhow!("Failed to wait for nix build: {}", e))?;
    let build_code = build_status.code().unwrap_or(-1);

    info!(
        "[darwin] build completed: code={}, success={}",
        build_code,
        build_status.success()
    );

    // Resolve the built system's store path immediately: activation uses it
    // directly, so the out-link never needs to be read again (and can't be
    // redirected under us by a concurrent apply).
    let store_path = if build_status.success() {
        Some(super::out_link::resolve_out_link(&out_link)?)
    } else {
        None
    };

    Ok(BuildResult {
        success: build_status.success(),
        code: build_code,
        stderr: build_stderr,
        out_link,
        store_path,
    })
}

/// Run the activation step, by whichever of the two paths is allowed — the
/// privileged helper, or one native authentication dialog (see
/// [`password_activation`]).
fn run_activate_step(
    app: &AppHandle,
    system_store_path: &Path,
) -> Result<ActivateResult, anyhow::Error> {
    let activate_path = system_store_path.join("activate");
    run_activate_with_path(app, &activate_path.to_string_lossy())
}

/// Activate a specific nix store path directly
fn activate_store_path(app: &AppHandle, store_path: &str) -> Result<ActivateResult, anyhow::Error> {
    let activate_path = format!("{}/activate", store_path);
    run_activate_with_path(app, &activate_path)
}

/// Classify an activation failure into (error_type, error_message).
fn classify_activate_error(result: &ActivateResult) -> (&'static str, String) {
    // A refusal is not a failed process: the sentence in stderr is the whole
    // report, and there is no real exit code to headline.
    if result.refused {
        return ("activation_refused", result.stderr.clone());
    }
    let output_lower = format!("{}\n{}", result.stderr, result.stdout).to_lowercase();
    if output_lower.contains("user canceled") {
        return ("user_cancelled", "Activation cancelled by user".to_string());
    }
    // The admin-password path's root executor refuses at the shared activation
    // lock before mutating anything (`helper_runtime::acquire_activation_lock`),
    // but that arrives here as a real process exit wrapped by osascript, so
    // text is the only channel to recognize it by.
    if output_lower.contains(
        helper_runtime::ACTIVATION_ALREADY_RUNNING_MESSAGE
            .to_lowercase()
            .as_str(),
    ) {
        return (
            "activation_refused",
            activation_path::ACTIVATION_RUNNING_REPORT.to_string(),
        );
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

        match activate_store_path(&app_handle, &store_path) {
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
    app: &AppHandle,
    activate_path: &str,
) -> Result<ActivateResult, anyhow::Error> {
    // Resolve the symlink to the real nix store path: the privileged step
    // only ever accepts canonical /nix/store activation paths.
    let real_activate = std::fs::canonicalize(activate_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| activate_path.to_owned());

    // Which path this apply may use is decided there, before any bytes reach
    // the helper. Nothing in this module chooses between them.
    activation_path::activate(&AppActivation { app }, &real_activate)
}

/// The observations and effects [`activation_path`] decides over. Nothing here
/// decides anything; the two gates come from the replacement function's own, so
/// Apply and reconciliation cannot disagree about where this copy runs from.
struct AppActivation<'a> {
    app: &'a AppHandle,
}

impl activation_path::ApplyEnvironment for AppActivation<'_> {
    fn preference(&self) -> Result<crate::shared_types::HelperPreference, String> {
        crate::state::preferences::read_helper_preference(self.app)
            .map_err(|error| format!("{error:#}"))
    }

    fn displacement(&self) -> Option<String> {
        reconcile::gates_live()
            .err()
            .map(|report| helper_permission::describe(&report))
    }

    fn registration_status(&self) -> Result<helper_service::RegistrationStatus, String> {
        helper_service::registration_status().map_err(|error| format!("{error:#}"))
    }

    fn dispatch_activation(
        &self,
        activate_path: &str,
    ) -> Result<helper_protocol::HelperReply, activation_path::DispatchFailure> {
        let request =
            helper_protocol::activation_request(Path::new(activate_path)).map_err(|error| {
                activation_path::DispatchFailure::Unusable(
                    error.context("failed to build helper activation request"),
                )
            })?;
        // The result arrives on this connection when the activation completes,
        // under the client's one generous bound rather than the short leashes
        // the other exchanges use (`client::ACTIVATION_TIMEOUT`). An activation
        // still running when that expires is reported as an unknown outcome and
        // never compensated.
        helper_client::activate_store_path(&request)
            .map_err(activation_path::DispatchFailure::Exchange)
    }

    fn observe_listener(&self) -> helper_client::ListenerObservation {
        helper_client::observe_listener()
    }

    fn password_activate(&self, activate_path: &str) -> Result<ActivateResult, anyhow::Error> {
        // No record and no slot to consult here: the root executor this
        // launches takes the shared activation lock itself, so a concurrent
        // activation — helper-run or password-run — refuses it there, with
        // the admin prompt's own error surface reporting why.
        password_activation(activate_path)
    }
}

/// The administrator-password path: one native macOS authentication dialog, then
/// this binary re-executed in root-activation mode.
///
/// `osascript ... with administrator privileges` shows the legacy Security Agent
/// dialog, which is password-only — macOS does not offer Touch ID there. Avoiding
/// that prompt is what the privileged helper exists for.
///
/// Root cause of the "updating apps over SSH" error:
///   `osascript do shell script ... with administrator privileges` spawns the
///   privileged process in the *system* bootstrap domain (root context), not
///   the user's Aqua GUI session domain.  The nix-darwin activation script
///   calls `launchctl managername` and aborts with the "over SSH" error
///   whenever the result is not "Aqua" — even when called from a GUI app.
///
/// Fix: the elevated step uses `launchctl asuser <uid>` to re-enter the
///   user's Aqua bootstrap domain before exec'ing the activation script.
///   fork()/exec() inherits the bootstrap port, so the activation script
///   sees `launchctl managername == "Aqua"` and the App Management check
///   proceeds correctly.
///
///   The elevated command is this binary re-executed in root-activation
///   mode (`privileged_helper::root_activation`): fixed Rust code with the
///   same hardening rules as the helper daemon — no shell script, no
///   sudoers rules, no EXIT traps, absolute programs, and a fixed root-owned
///   environment.
///
/// Reached only through [`activation_path::ApplyEnvironment::password_activate`],
/// which records that a password activation is running for as long as this
/// takes.
fn password_activation(real_activate: &str) -> Result<ActivateResult, anyhow::Error> {
    let real_activate = real_activate.to_owned();
    let root_args = root_activation::RootActivationArgs {
        // SAFETY: `getuid` is thread-safe, has no preconditions, and cannot fail.
        uid: unsafe { libc::getuid() },
        activate_path: real_activate,
    };
    let exe = std::env::current_exe()
        .map_err(|e| anyhow::anyhow!("Failed to resolve current executable: {}", e))?;
    let shell_command = root_activation::shell_command(&exe.to_string_lossy(), &root_args);

    // Escape the command for embedding in an AppleScript string literal:
    //   \ → \\ and " → \"
    let escaped_command = shell_command.replace('\\', "\\\\").replace('"', "\\\"");

    let osascript_cmd = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped_command
    );

    info!("[darwin] Running interactive activation via root re-exec of the app binary");

    let output = Command::new("/usr/bin/osascript")
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
        refused: false,
    })
}

/// Handle activation failures and determine the appropriate error response.
fn handle_activation_error(result: &ActivateResult, log_path: &Path) -> serde_json::Value {
    let (error_type, friendly_error) = classify_activate_error(result);

    // A refusal: no activation process ran and nothing was mutated. The
    // sentence is the whole report — no exit-code headline and no log tail.
    if error_type == "activation_refused" {
        error!("[darwin] activation refused: {friendly_error}");
        return serde_json::json!({
            "ok": false,
            "code": result.code,
            "error_type": error_type,
            "system_untouched": true,
            "error": friendly_error,
        });
    }

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
    matches!(error_type, "user_cancelled" | "activation_refused")
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
    log_and_emit!("Starting nix build (as user)...");

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
            "nix build failed (exit code {}):\n{}",
            build_result.code,
            tail.join("\n")
        );
        log_and_emit!(format!("Build failed (exit code {})", build_result.code));
        summarizer.complete(false);

        {
            if let Ok(mut f) = log_file.lock() {
                // fire-and-forget: log write in error path — see macro comment above.
                let _ = writeln!(f, "\n=== nix build FAILED ===");
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

    log_and_emit!("nix build completed successfully.");

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
    // probe, but does it before the admin activation prompt.
    //
    // A denial refuses the apply here. A pass says the bundle writes succeed,
    // and the activation path is chosen the same way it is for every other
    // apply: managed app bundles used to divert this flow to the password
    // prompt, which was a silent substitution while an enabled registration
    // could still admit a scheduled sync-agent activation of the same
    // generation.
    // =========================================================================
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

    // The build succeeded, so the resolved store path is present.
    let Some(system_store_path) = build_result.store_path.as_deref() else {
        return Err(serde_json::json!({
            "ok": false,
            "code": -1,
            "log_file": log_path.to_string_lossy(),
            "error_type": "generic_error",
            "system_untouched": true,
            "error": "Build succeeded but produced no system store path",
        }));
    };

    let activate_result = run_activate_step(app, system_store_path).map_err(|e| {
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
        // Write and emit activation output (the privileged step merges stderr
        // into stdout, so useful details are often in stdout)
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

    // Activation set the durable GC root (`nix-env -p .../profiles/system
    // --set`), so the out-link has done its job; remove it so it never pins
    // this closure once the system moves on. Also clear the `result` link
    // that pre-out-link versions left in the config dir.
    super::out_link::cleanup_out_link(&build_result.out_link);
    super::out_link::remove_legacy_result_link(config_dir);

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
    if let Some(et) = error_type
        && let Some(obj) = success_payload.as_object_mut()
    {
        obj.insert(
            "error_type".to_string(),
            serde_json::Value::String(et.to_string()),
        );
    }
    Ok(success_payload)
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
            refused: false,
        }
    }

    #[test]
    fn a_refused_result_is_classified_from_its_flag_with_the_sentence_verbatim() {
        let mut result = failed_activation("", "An activation is already running.");
        result.refused = true;
        result.code = -1;

        let (error_type, message) = classify_activate_error(&result);

        assert_eq!(error_type, "activation_refused");
        // The sentence is the whole report: no exit-code headline around it.
        assert_eq!(message, "An activation is already running.");
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
    fn a_password_path_lock_refusal_is_classified_as_refused() {
        // The real shape: osascript wraps the root executor's pre-mutation
        // bail into a process exit, so `refused` is false and only the text
        // identifies it.
        let result = failed_activation(
            "",
            "0:233: execution error: nixmac root activation failed: an activation is already running; try again once it finishes (1)",
        );

        let (error_type, message) = classify_activate_error(&result);

        assert_eq!(error_type, "activation_refused");
        assert_eq!(
            message,
            "An activation is already running, so nixmac did not start another."
        );
    }

    #[test]
    fn only_cancellations_and_refusals_are_known_untouched() {
        assert!(activation_failure_left_system_untouched("user_cancelled"));
        assert!(activation_failure_left_system_untouched(
            "activation_refused"
        ));
        assert!(!activation_failure_left_system_untouched(
            "authorization_denied"
        ));
        assert!(!activation_failure_left_system_untouched("generic_error"));
    }
}
