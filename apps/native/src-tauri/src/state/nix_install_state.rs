//! Last-known nix / darwin-rebuild installation status.
//!
//! The system is the source of truth (probed via `nix --version` and PATH
//! checks), so the cell is NOT persisted. The installer and prefetch flows
//! record their phase transitions here; per-tick download progress stays on
//! the `nix:install:progress` stream and is intentionally not mirrored.

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::NixInstallState;

pub const NIX_INSTALL_STATE_CHANGED_EVENT: &str = "nix_install_state_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<NixInstallState> {
    Observable::new(NixInstallState::default()).emit_to(app, NIX_INSTALL_STATE_CHANGED_EVENT)
}

/// Read the last-known installation status.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> NixInstallState {
    app.state::<Observable<NixInstallState>>()
        .read_sync()
        .clone()
}

/// Mutate the cell; subscribers fire (and `nix_install_state_changed` emits)
/// only when the value actually changed.
pub fn update<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut NixInstallState)) {
    let observable = app.state::<Observable<NixInstallState>>();
    let mut next = observable.read_sync().clone();
    f(&mut next);
    if *observable.read_sync() == next {
        return;
    }
    *observable.write_sync() = next;
}

/// Record the end of an install run.
pub fn record_install_end<R: Runtime>(
    app: &AppHandle<R>,
    ok: bool,
    darwin_rebuild_available: Option<bool>,
    error: Option<String>,
) {
    update(app, |state| {
        state.installing = false;
        state.install_phase = None;
        if ok {
            state.installed = Some(true);
        }
        if let Some(available) = darwin_rebuild_available {
            state.darwin_rebuild_available = Some(available);
        }
        state.last_error = error;
    });
}
