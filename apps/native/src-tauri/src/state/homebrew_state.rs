//! Last-known Homebrew installation status and guided-install progress.
//!
//! The system is the source of truth (probed via `brew --version`), so the cell
//! is NOT persisted. The guided installer records its phase transitions here;
//! per-line installer output stays on the `homebrew:install:data` stream and is
//! intentionally not mirrored.
//!
//! Owning `installing` here (rather than in component state) is what lets the
//! user leave the Homebrew onboarding step mid-install and come back to a step
//! that still knows a run is in flight.

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::HomebrewInstallState;

pub const HOMEBREW_INSTALL_STATE_CHANGED_EVENT: &str = "homebrew_install_state_changed";

/// Phase reported while waiting on the macOS Command Line Tools install.
pub const PHASE_COMMAND_LINE_TOOLS: &str = "command-line-tools";
/// Phase reported while the Homebrew installer itself is running.
pub const PHASE_INSTALLING: &str = "installing";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<HomebrewInstallState> {
    Observable::new(HomebrewInstallState::default())
        .emit_to(app, HOMEBREW_INSTALL_STATE_CHANGED_EVENT)
}

/// Read the last-known installation status.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> HomebrewInstallState {
    app.state::<Observable<HomebrewInstallState>>()
        .read_sync()
        .clone()
}

/// Mutate the cell; subscribers fire (and `homebrew_install_state_changed`
/// emits) only when the value actually changed.
pub fn update<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut HomebrewInstallState)) {
    let observable = app.state::<Observable<HomebrewInstallState>>();
    let mut next = observable.read_sync().clone();
    f(&mut next);
    if *observable.read_sync() == next {
        return;
    }
    *observable.write_sync() = next;
}

/// Record the start of an install run, clearing any previous run's error.
pub fn record_install_start<R: Runtime>(app: &AppHandle<R>) {
    update(app, |state| {
        state.installing = true;
        state.install_phase = None;
        state.last_error = None;
    });
}

/// Record the current phase of an in-flight run.
pub fn record_phase<R: Runtime>(app: &AppHandle<R>, phase: &str) {
    update(app, |state| {
        state.install_phase = Some(phase.to_string());
    });
}

/// Record the end of an install run.
///
/// `installed` is the caller's fresh probe result, not a translation of the
/// exit code: an installer that exits 0 without leaving a usable `brew` must
/// land here as `installed: false` so the UI never renders success over a
/// missing prerequisite.
pub fn record_install_end<R: Runtime>(app: &AppHandle<R>, installed: bool, error: Option<String>) {
    update(app, |state| {
        state.installing = false;
        state.install_phase = None;
        state.installed = Some(installed);
        state.last_error = error;
    });
}
