//! Homebrew detection and guided installation.
//!
//! Homebrew is an optional prerequisite for nixmac: many users' customizations
//! and migrations depend on `brew`, but non-technical users often arrive without
//! it. This module detects whether Homebrew is present and drives the official
//! installer with streamed progress so onboarding can offer a one-click install.

use log::{error, info};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Official Homebrew install script (same one-liner brew.sh documents).
const HOMEBREW_INSTALL_URL: &str =
    "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh";

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

/// Checks whether Homebrew is installed by running `brew --version`.
///
/// Uses the Nix-augmented PATH so a brew installed under `/opt/homebrew` or
/// `/usr/local/bin` is found in the GUI app context.
pub fn is_installed() -> bool {
    Command::new("brew")
        .arg("--version")
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Runs the official Homebrew installer in a background thread with streaming
/// output.
///
/// Emits:
/// - `homebrew:install:data` for each line of output as `{"chunk": "...\n"}`
/// - `homebrew:install:end` on completion as `{"ok": bool, "code": int, "error": string | null}`
///
/// The installer is run with `NONINTERACTIVE=1` so it does not pause to prompt
/// the user to press RETURN. It may still require `sudo`; password handling is
/// surfaced through the streamed log for now.
pub fn install_stream(app: &AppHandle) -> Result<(), anyhow::Error> {
    info!("[homebrew] install_stream: starting guided install");

    let app_handle = app.clone();

    if e2e_mock_system_enabled() {
        std::thread::spawn(move || {
            let emit_line = |line: &str| {
                let _ = app_handle.emit(
                    "homebrew:install:data",
                    serde_json::json!({ "chunk": format!("{}\n", line) }),
                );
            };
            emit_line("NIXMAC_E2E_MOCK_SYSTEM: mocked Homebrew install started.");
            emit_line("NIXMAC_E2E_MOCK_SYSTEM: mocked Homebrew install complete.");
            let _ = app_handle.emit(
                "homebrew:install:end",
                serde_json::json!({ "ok": true, "code": 0, "error": null, "e2e_mock_system": true }),
            );
        });
        return Ok(());
    }

    std::thread::spawn(move || {
        match run_install(&app_handle) {
            Ok(()) => {
                info!("[homebrew] install completed successfully");
                // fire-and-forget: emit only errors when no listeners are
                // registered (window hidden/destroyed); a missing event is non-fatal.
                let _ = app_handle.emit(
                    "homebrew:install:end",
                    serde_json::json!({ "ok": true, "code": 0, "error": null }),
                );
            }
            Err((code, message)) => {
                error!("[homebrew] install failed (code {}): {}", code, message);
                let _ = app_handle.emit(
                    "homebrew:install:end",
                    serde_json::json!({ "ok": false, "code": code, "error": message }),
                );
            }
        }
    });

    Ok(())
}

/// Orchestrates the install: acquire sudo (one native password dialog, kept
/// warm for the install's duration), stream the installer, then release sudo.
///
/// The official installer creates and chowns directories under `/opt/homebrew`
/// (or `/usr/local`), which requires `sudo`. Because the GUI app has no
/// controlling terminal, we prime sudo's credential cache from a password
/// captured via a native dialog and refresh it on a timer so the installer's
/// internal `sudo` calls succeed non-interactively. No persistent privilege is
/// left behind: the cached credential is invalidated when we finish and expires
/// on its own otherwise.
fn run_install(app: &AppHandle) -> Result<(), (i32, String)> {
    let needs_sudo = std::env::var("USER").map(|u| u != "root").unwrap_or(true);

    let stop_keepalive = Arc::new(AtomicBool::new(false));
    let mut keepalive = None;
    if needs_sudo {
        let password = prompt_password()?;
        prime_sudo(&password)?;
        keepalive = Some(spawn_sudo_keepalive(stop_keepalive.clone()));
    }

    let result = run_installer_streamed(app);

    stop_keepalive.store(true, Ordering::Relaxed);
    if let Some(handle) = keepalive {
        let _ = handle.join();
    }
    if needs_sudo {
        // Drop the cached credential so no elevated access lingers after install.
        let _ = Command::new("sudo")
            .arg("-k")
            .env("PATH", crate::system::nix::get_nix_path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    result
}

/// Prompts for the user's login password via a native macOS dialog.
fn prompt_password() -> Result<String, (i32, String)> {
    let script = "display dialog \"nixmac needs your password to install Homebrew.\" \
                  default answer \"\" with hidden answer with title \"Install Homebrew\" \
                  with icon note\ntext returned of result";
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| (-1, format!("Failed to show password dialog: {}", e)))?;

    if output.status.success() {
        // Strip only the trailing newline osascript adds; preserve any other chars.
        let pw = String::from_utf8_lossy(&output.stdout);
        Ok(pw.strip_suffix('\n').unwrap_or(&pw).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") || stderr.to_lowercase().contains("user canceled") {
            Err((-128, "Installation cancelled.".to_string()))
        } else {
            Err((
                output.status.code().unwrap_or(-1),
                format!("Password prompt failed: {}", stderr.trim()),
            ))
        }
    }
}

/// Primes sudo's credential cache by feeding the password to `sudo -S` over
/// stdin (never via argv). Returns an error on an incorrect password.
fn prime_sudo(password: &str) -> Result<(), (i32, String)> {
    let mut child = Command::new("sudo")
        .args(["-S", "-p", "", "-v"])
        .env("PATH", crate::system::nix::get_nix_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| (-1, format!("Failed to run sudo: {}", e)))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{}", password);
    }

    let status = child
        .wait()
        .map_err(|e| (-1, format!("sudo did not complete: {}", e)))?;

    if status.success() {
        Ok(())
    } else {
        Err((1, "Incorrect password.".to_string()))
    }
}

/// Refreshes sudo's cached credential on a timer so it stays valid across a
/// long install. Stops when `stop` is set. Checks `stop` every second so
/// teardown is prompt, and refreshes roughly once a minute.
fn spawn_sudo_keepalive(stop: Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            for _ in 0..60 {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
            let _ = Command::new("sudo")
                .args(["-n", "-v"])
                .env("PATH", crate::system::nix::get_nix_path())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    })
}

/// Spawns the install script, streaming stdout+stderr line-by-line to the
/// frontend. Returns the exit code and a message on failure.
fn run_installer_streamed(app: &AppHandle) -> Result<(), (i32, String)> {
    let script = format!(r#"/bin/bash -c "$(curl -fsSL {})""#, HOMEBREW_INSTALL_URL);

    let mut child = Command::new("/bin/bash")
        .args(["-c", &script])
        .env("NONINTERACTIVE", "1")
        .env("PATH", crate::system::nix::get_nix_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| (-1, format!("Failed to spawn Homebrew installer: {}", e)))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let stdout_handle = std::thread::spawn(move || stream_lines(&app_out, stdout));
    let app_err = app.clone();
    let stderr_handle = std::thread::spawn(move || stream_lines(&app_err, stderr));

    let status = child
        .wait()
        .map_err(|e| (-1, format!("Homebrew installer did not complete: {}", e)))?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if status.success() {
        Ok(())
    } else {
        let code = status.code().unwrap_or(-1);
        Err((code, format!("Homebrew installer exited with code {}", code)))
    }
}

/// Reads a child pipe line-by-line and emits each line to the frontend log.
fn stream_lines<R: std::io::Read>(app: &AppHandle, pipe: Option<R>) {
    if let Some(pipe) = pipe {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit(
                "homebrew:install:data",
                serde_json::json!({ "chunk": format!("{}\n", line) }),
            );
        }
    }
}
