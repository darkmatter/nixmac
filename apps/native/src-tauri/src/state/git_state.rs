//! Last-known git state — an in-memory mirror of the watched repo's status.
//!
//! Git itself is the source of truth, so the cell is NOT persisted: the
//! watcher recomputes the value on its poll loop, and mutating commands
//! record the status they just produced. Everything else reads the cell via
//! [`get`] or subscribes to [`GIT_STATE_CHANGED_EVENT`].

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::{GitState, GitStatus};

pub const GIT_STATE_CHANGED_EVENT: &str = "git_state_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<GitState> {
    Observable::new(GitState {
        git_status: None,
        external_build_detected: false,
        upstream_update_available: false,
    })
    .emit_to(app, GIT_STATE_CHANGED_EVENT)
}

/// Read the last-known git state.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> GitState {
    app.state::<Observable<GitState>>().read_sync().clone()
}

/// Write the cell atomically, notifying subscribers only when it changes.
pub fn update<R: Runtime>(app: &AppHandle<R>, next: GitState) -> bool {
    let observable = app.state::<Observable<GitState>>();
    observable.update_if_changed(move |current| *current = next)
}

/// Atomically update only the result of the asynchronous upstream check.
pub fn set_upstream_update_available<R: Runtime>(app: &AppHandle<R>, available: bool) -> bool {
    app.state::<Observable<GitState>>()
        .update_if_changed(|state| state.upstream_update_available = available)
}

/// Record a fresh status snapshot, clearing the external-build flag.
///
/// Mutating commands call this after they change the working tree or finish
/// a build nixmac itself initiated — both make any previously detected
/// external build stale.
pub fn update_status<R: Runtime>(app: &AppHandle<R>, status: GitStatus) {
    app.state::<Observable<GitState>>()
        .update_if_changed(move |state| {
            state.git_status = Some(status);
            state.external_build_detected = false;
        });
}
