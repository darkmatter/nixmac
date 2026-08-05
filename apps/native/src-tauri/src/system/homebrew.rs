//! Homebrew detection and guided installation.
//!
//! Homebrew is an optional prerequisite for nixmac: many users' customizations
//! and migrations depend on `brew`, but non-technical users often arrive without
//! it. This module detects whether Homebrew is present and drives the official
//! installer with streamed progress so onboarding can offer a one-click install.

use crate::shared_types::{HomebrewInstallDataEvent, HomebrewInstallEndEvent};
use crate::state::homebrew_state;
use log::{error, info};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Official Homebrew install script (same one-liner brew.sh documents).
const HOMEBREW_INSTALL_URL: &str =
    "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh";

/// AppleScript's "user cancelled" status, reused as our exit code for a
/// dismissed password dialog. A deliberate cancel is not a failure: it carries
/// no error message, so the step returns to its offer-to-install state instead
/// of the red failed state.
const CANCELLED_EXIT_CODE: i32 = -128;

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

/// Guards against a second concurrent install run: a double invoke would spawn
/// two installers and two password dialogs. The UI disables the button while
/// `installing` is set, but the command has to be safe on its own.
static INSTALL_RUNNING: AtomicBool = AtomicBool::new(false);

/// Clears `INSTALL_RUNNING` when the install thread returns *or* unwinds, so a
/// panic can't wedge the command for the rest of the session.
struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_RUNNING.store(false, Ordering::Release);
    }
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

        // Probe rather than translate the exit code. The installer can exit 0
        // without leaving a usable `brew` — a transient network failure during
        // the fetch used to do exactly that — and "succeeded" must never mean
        // anything less than "the prerequisite is actually present now".
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
            Err((CANCELLED_EXIT_CODE, _)) => {
                info!("[homebrew] install cancelled at the password prompt");
                (false, CANCELLED_EXIT_CODE, None)
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
    // Before anything else: the installer's own CLT path hangs (see
    // `ensure_command_line_tools`). Done ahead of the password prompt so the
    // user isn't asked for credentials and then left waiting on a download.
    ensure_command_line_tools(app)?;

    let needs_sudo = std::env::var("USER").map(|u| u != "root").unwrap_or(true);

    let stop_keepalive = Arc::new(AtomicBool::new(false));
    let mut keepalive = None;
    // Held for the whole install; dropping it tears down the socket and helper.
    let mut askpass = None;
    if needs_sudo {
        let password = prompt_password()?;
        // Validate up front so a wrong password fails here with a clear message
        // rather than surfacing as an opaque installer abort.
        prime_sudo(&password)?;
        askpass = Some(SudoAskpass::new(&password)?);
        keepalive = Some(spawn_sudo_keepalive(stop_keepalive.clone()));
    }

    let result = run_installer_streamed(app, askpass.as_ref().map(SudoAskpass::script_path));

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

/// Serves the user's password to `sudo -A` over a unix socket for the duration
/// of the install.
///
/// The official installer runs its own `sudo` calls in processes we don't
/// control. Priming sudo's credential cache does not help them: macOS scopes
/// the sudo timestamp per-TTY, falling back to per-parent-process when there is
/// no TTY, so a credential cached by our process is invisible to the
/// installer's bash subtree. It therefore fails `sudo -n` and aborts with
/// "Need sudo access on macOS" even for an administrator.
///
/// `install.sh` supports `SUDO_ASKPASS`: when set, it invokes `sudo -A`, which
/// runs a helper program to obtain the password for *every* sudo call. That
/// sidesteps timestamp scoping entirely.
///
/// The password is never written to disk and never appears in argv: the helper
/// script contains only the socket path, and the password is handed over the
/// socket. The socket lives in a `0700` directory, so only this user (and root)
/// can connect. Everything is removed on drop.
struct SudoAskpass {
    dir: PathBuf,
    script: PathBuf,
    stop: Arc<AtomicBool>,
    server: Option<std::thread::JoinHandle<()>>,
}

impl SudoAskpass {
    fn new(password: &str) -> Result<Self, (i32, String)> {
        let fail = |e: std::io::Error| (-1, format!("Failed to set up sudo helper: {}", e));

        // Per-user temp dir (not /tmp) so no other local user can pre-create or
        // reach the socket. Names are kept short: `sockaddr_un.sun_path` is
        // capped near 104 bytes on macOS and the base path is already ~49.
        let dir = std::env::temp_dir().join(format!("nixmac-ap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(fail)?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(fail)?;

        let sock_path = dir.join("s");
        // Bind fails with a confusing EINVAL past the limit; check it ourselves.
        if sock_path.as_os_str().len() >= 100 {
            return Err((
                -1,
                format!(
                    "Temporary path too long for a unix socket ({} bytes): {}",
                    sock_path.as_os_str().len(),
                    sock_path.display()
                ),
            ));
        }
        let listener = UnixListener::bind(&sock_path).map_err(fail)?;
        listener.set_nonblocking(true).map_err(fail)?;

        // The script holds only the socket path — no secret material.
        let script = dir.join("askpass.sh");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nexec /usr/bin/nc -U '{}' < /dev/null\n",
                sock_path.display()
            ),
        )
        .map_err(fail)?;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).map_err(fail)?;

        let password = password.to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_server = stop.clone();
        let server = std::thread::spawn(move || {
            while !stop_server.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // sudo reads a single line from the helper's stdout.
                        let _ = writeln!(stream, "{}", password);
                        let _ = stream.flush();
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            dir,
            script,
            stop,
            server: Some(server),
        })
    }

    fn script_path(&self) -> &Path {
        &self.script
    }
}

impl Drop for SudoAskpass {
    /// Stops serving the password and removes the socket and helper script.
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(server) = self.server.take() {
            let _ = server.join();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
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
            Err((CANCELLED_EXIT_CODE, "Installation cancelled.".to_string()))
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
fn run_installer_streamed(app: &AppHandle, askpass: Option<&Path>) -> Result<(), (i32, String)> {
    homebrew_state::record_phase(app, homebrew_state::PHASE_INSTALLING);

    // Fetch first and fail loudly. Inlining the fetch as `bash -c "$(curl ...)"`
    // silently succeeds when the download fails: the command substitution comes
    // back empty, `bash -c ""` exits 0, and the run reads as a successful
    // install that left no `brew` behind.
    let script = format!(
        r#"script="$(curl -fsSL '{}')" || exit 1
[ -n "$script" ] || exit 1
exec /bin/bash -c "$script""#,
        HOMEBREW_INSTALL_URL
    );

    let mut command = Command::new("/bin/bash");
    command
        .args(["-c", &script])
        .env("NONINTERACTIVE", "1")
        .env("PATH", crate::system::nix::get_nix_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Makes install.sh use `sudo -A`, so its internal sudo calls obtain the
    // password from our helper instead of relying on a cached credential they
    // cannot see. Without this the installer aborts with "Need sudo access".
    if let Some(askpass) = askpass {
        command.env("SUDO_ASKPASS", askpass);
    }

    let mut child = command
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
        Err((
            code,
            format!("Homebrew installer exited with code {}", code),
        ))
    }
}

/// Reads a child pipe line-by-line and emits each line to the frontend log.
fn stream_lines<R: std::io::Read>(app: &AppHandle, pipe: Option<R>) {
    if let Some(pipe) = pipe {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            emit_line(app, &line);
        }
    }
}
