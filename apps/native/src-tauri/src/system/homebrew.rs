//! Homebrew detection and guided installation.
//!
//! Homebrew is an optional prerequisite for nixmac: many users' customizations
//! and migrations depend on `brew`, but non-technical users often arrive without
//! it. This module detects whether Homebrew is present, and drives Homebrew's
//! official signed package through the privileged helper so onboarding can
//! offer a one-click install with no password prompt of our own.

use crate::shared_types::{HomebrewInstallDataEvent, HomebrewInstallEndEvent};
use crate::state::homebrew_state;
use log::{error, info};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

/// Checks whether Homebrew is installed by running `brew --version`.
///
/// Uses the Nix-augmented PATH so a brew installed under `/opt/homebrew` or
/// `/usr/local/bin` is found in the GUI app context. Under e2e mock mode the
/// answer comes from `NIXMAC_E2E_HOMEBREW_INSTALLED` instead, so every caller
/// shares one definition of "installed" rather than gating at each call site.
pub fn is_installed() -> bool {
    if e2e_mock_system_enabled() {
        return crate::e2e_runtime::enabled("NIXMAC_E2E_HOMEBREW_INSTALLED");
    }
    Command::new("brew")
        .arg("--version")
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Guards against a second concurrent install run: a double invoke would have
/// two `installer` processes writing the same prefix. The UI disables the
/// button while `installing` is set, but the command has to be safe on its own.
static INSTALL_RUNNING: AtomicBool = AtomicBool::new(false);

/// Clears `INSTALL_RUNNING` when the install thread returns *or* unwinds, so a
/// panic can't wedge the command for the rest of the session.
struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_RUNNING.store(false, Ordering::Release);
    }
}

/// Runs the guided Homebrew install in a background thread.
///
/// Emits:
/// - `homebrew:install:data` for each line of output as `{"chunk": "...\n"}`
/// - `homebrew:install:end` on completion as `{"ok": bool, "code": int, "error": string | null}`
///
/// The privileged work happens in the helper daemon, which answers one request
/// with one response, so the installer's own output arrives in a batch at the
/// end rather than line by line. The phases either side of it — waiting on the
/// Command Line Tools, then the install itself — are what the UI reports while
/// it runs.
///
/// Progress that outlives the step's mount — `installing` and the current phase
/// — is recorded in the `HomebrewInstallState` cell rather than returned, so
/// leaving the onboarding step mid-install and coming back finds a step that
/// still knows a run is in flight.
pub fn install_stream(app: &AppHandle) -> Result<(), anyhow::Error> {
    if INSTALL_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        anyhow::bail!("A Homebrew install is already running.");
    }

    info!("[homebrew] install_stream: starting guided install");

    let app_handle = app.clone();
    homebrew_state::record_install_start(&app_handle);

    if e2e_mock_system_enabled() {
        std::thread::spawn(move || {
            let _guard = InstallGuard;
            emit_line(
                &app_handle,
                "NIXMAC_E2E_MOCK_SYSTEM: mocked Homebrew install started.",
            );
            emit_line(
                &app_handle,
                "NIXMAC_E2E_MOCK_SYSTEM: mocked Homebrew install complete.",
            );
            homebrew_state::record_install_end(&app_handle, true, None);
            let _ = app_handle.emit(
                "homebrew:install:end",
                HomebrewInstallEndEvent {
                    ok: true,
                    code: 0,
                    error: None,
                },
            );
        });
        return Ok(());
    }

    std::thread::spawn(move || {
        let _guard = InstallGuard;
        let result = run_install(&app_handle);

        // Probe rather than translate the exit code. "Succeeded" must never
        // mean anything less than "the prerequisite is actually present now",
        // whatever the installer reported — that gap is what used to leave the
        // onboarding step claiming success against a gate that still blocked.
        let installed = is_installed();
        let (ok, code, error) = match result {
            Ok(()) if installed => {
                info!("[homebrew] install completed successfully");
                (true, 0, None)
            }
            Ok(()) => {
                error!("[homebrew] installer exited 0 but brew is still not detectable");
                (
                    false,
                    -1,
                    Some(
                        "The installer finished, but Homebrew could not be found afterwards. \
                         Check the log above and try again."
                            .to_string(),
                    ),
                )
            }
            Err((code, message)) => {
                error!("[homebrew] install failed (code {}): {}", code, message);
                (false, code, Some(message))
            }
        };

        homebrew_state::record_install_end(&app_handle, installed, error.clone());
        // fire-and-forget: emit only errors when no listeners are registered
        // (window hidden/destroyed); a missing event is non-fatal.
        let _ = app_handle.emit(
            "homebrew:install:end",
            HomebrewInstallEndEvent { ok, code, error },
        );
    });

    Ok(())
}

/// Orchestrates the install: make sure the Command Line Tools are present,
/// then hand the privileged work to the helper daemon.
///
/// Homebrew's official package is authenticated as root, which the helper
/// already is, so this path needs no password prompt, no `sudo`, and no
/// credential relay. It also carries its whole payload, so there is no
/// fetch-a-script step that can fail into a "successful" install.
fn run_install(app: &AppHandle) -> Result<(), (i32, String)> {
    // First, because Homebrew's package refuses to install without it, and the
    // wait can be long enough that it deserves its own phase in the UI.
    ensure_command_line_tools(app)?;

    if !crate::privileged_helper::client::socket_available() {
        return Err((
            -1,
            "The nixmac privileged helper is not available. Re-grant it in \
             Permissions, then try again."
                .to_string(),
        ));
    }

    homebrew_state::record_phase(app, homebrew_state::PHASE_INSTALLING);
    emit_line(
        app,
        "==> Requesting the official Homebrew installer\u{2026}",
    );
    emit_line(
        app,
        "    (downloading and verifying Apple's signature; this can take a few minutes)",
    );

    let response = crate::privileged_helper::client::install_homebrew()
        .map_err(|e| (-1, format!("Failed to reach the privileged helper: {e:#}")))?;

    for line in response.stdout.lines().chain(response.stderr.lines()) {
        if !line.trim().is_empty() {
            emit_line(app, line);
        }
    }

    if response.ok {
        Ok(())
    } else {
        Err((response.code, response.failure_detail()))
    }
}

/// How long to wait for the user to complete the macOS Command Line Tools
/// install. Deliberately generous: the download is ~1 GB and has been observed
/// sitting idle for minutes before reaching full speed, so a short timeout
/// would abort installs that were about to succeed.
const CLT_WAIT_TIMEOUT: Duration = Duration::from_secs(45 * 60);
const CLT_POLL_INTERVAL: Duration = Duration::from_secs(5);
/// Emit a "still waiting" line roughly this often so the log pane shows life.
const CLT_HEARTBEAT_EVERY: u32 = 6;

/// Emits one line to the install log pane.
fn emit_line(app: &AppHandle, line: &str) {
    let _ = app.emit(
        "homebrew:install:data",
        HomebrewInstallDataEvent {
            chunk: format!("{}\n", line),
        },
    );
}

/// Whether a developer directory is configured — Command Line Tools or a full
/// Xcode. Homebrew requires one.
pub fn command_line_tools_installed() -> bool {
    Command::new("xcode-select")
        .arg("-p")
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Ensures Command Line Tools are present before the Homebrew installer runs.
///
/// Left to itself, `install.sh` installs CLT via a headless
/// `sudo softwareupdate -i "Command Line Tools for Xcode-N"`. That was observed
/// to hang indefinitely — 12 minutes with *zero* bytes transferred and no
/// output — while `curl` on the same machine reached Apple at full speed. The
/// UI has no way to distinguish that from slow progress, so it spins forever.
///
/// Driving the install through `xcode-select --install` instead hands the work
/// to macOS's normal update flow, which does download. It requires the user to
/// confirm a system dialog, so we poll for completion rather than blocking on
/// the command (it returns as soon as the dialog is requested).
fn ensure_command_line_tools(app: &AppHandle) -> Result<(), (i32, String)> {
    if command_line_tools_installed() {
        return Ok(());
    }

    info!("[homebrew] Command Line Tools missing; requesting install");
    homebrew_state::record_phase(app, homebrew_state::PHASE_COMMAND_LINE_TOOLS);
    emit_line(
        app,
        "==> Command Line Tools are required by Homebrew and were not found.",
    );

    // Returns immediately — it only requests the dialog. A non-zero status is
    // not fatal: it also reports "already installed"/"already requested", and
    // the poll below is the real check either way.
    match Command::new("xcode-select").arg("--install").output() {
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr);
            let detail = detail.trim();
            if !detail.is_empty() {
                emit_line(app, &format!("==> xcode-select: {}", detail));
            }
        }
        Err(e) => {
            return Err((-1, format!("Failed to request Command Line Tools: {}", e)));
        }
    }

    emit_line(
        app,
        "==> Complete the macOS \"Install Command Line Developer Tools\" prompt to continue.",
    );

    let start = Instant::now();
    let mut ticks: u32 = 0;
    while start.elapsed() < CLT_WAIT_TIMEOUT {
        std::thread::sleep(CLT_POLL_INTERVAL);
        if command_line_tools_installed() {
            emit_line(app, "==> Command Line Tools installed.");
            return Ok(());
        }
        ticks += 1;
        if ticks.is_multiple_of(CLT_HEARTBEAT_EVERY) {
            emit_line(
                app,
                &format!(
                    "==> Waiting for Command Line Tools… ({}m elapsed)",
                    start.elapsed().as_secs() / 60
                ),
            );
        }
    }

    Err((
        -1,
        "Timed out waiting for Command Line Tools. Install them with \
         `xcode-select --install`, then try again."
            .to_string(),
    ))
}
