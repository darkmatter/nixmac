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

/// Write the cell — and notify subscribers — when `next` differs from the
/// current value. Returns whether a write happened.
pub fn update<R: Runtime>(app: &AppHandle<R>, next: GitState) -> bool {
    let observable = app.state::<Observable<GitState>>();
    if *observable.read_sync() == next {
        return false;
    }
    *observable.write_sync() = next;
    true
}

/// Record a fresh status snapshot, clearing the external-build flag.
///
/// Mutating commands call this after they change the working tree or finish
/// a build nixmac itself initiated — both make any previously detected
/// external build stale.
pub fn update_status<R: Runtime>(app: &AppHandle<R>, status: GitStatus) -> bool {
    let upstream_update_available = get(app).upstream_update_available;
    update(
        app,
        GitState {
            git_status: Some(status),
            external_build_detected: false,
            upstream_update_available,
        },
    )
}
