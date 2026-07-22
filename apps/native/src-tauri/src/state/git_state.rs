//! Last-known git state — an in-memory mirror of the watched repo's status.
//!
//! Git itself is the source of truth, so the cell is NOT persisted: the
//! watcher recomputes the value on its poll loop, and mutating commands
//! record the status they just produced. Everything else reads the cell via
//! [`get`] or subscribes to [`GIT_STATE_CHANGED_EVENT`].

use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::{GitState, GitStatus};

pub const GIT_STATE_CHANGED_EVENT: &str = "git_state_changed";

/// Coordinates asynchronous rebuild-needed checks with successful builds.
/// A mutex makes validating a check revision and writing its result atomic
/// with invalidating checks after activation.
static REBUILD_NEEDED_REVISION: Mutex<u64> = Mutex::new(0);

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<GitState> {
    Observable::new(GitState {
        git_status: None,
        external_build_detected: false,
        upstream_update_available: false,
        rebuild_needed: false,
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

/// Atomically update only the result of the asynchronous rebuild-needed check.
pub fn set_rebuild_needed<R: Runtime>(app: &AppHandle<R>, needed: bool) -> bool {
    app.state::<Observable<GitState>>()
        .update_if_changed(|state| state.rebuild_needed = needed)
}

/// Capture the revision an asynchronous rebuild-needed check belongs to.
pub fn rebuild_needed_check_revision() -> u64 {
    *REBUILD_NEEDED_REVISION.lock().unwrap()
}

/// Apply an asynchronous rebuild-needed result only if no successful build
/// has invalidated it since the check began. Returns whether it was accepted.
pub fn set_rebuild_needed_from_check<R: Runtime>(
    app: &AppHandle<R>,
    revision: u64,
    needed: bool,
) -> bool {
    let should_apply = {
        let current_revision = REBUILD_NEEDED_REVISION.lock().unwrap();
        *current_revision == revision
    };
    if !should_apply {
        return false;
    }
    set_rebuild_needed(app, needed);
    true
}

/// Clear the cached rebuild-needed result. Useful to call after the configuration used by an
/// in-flight check has been replaced or discarded. Invalidates older checks
/// so they cannot publish a result derived from the previous working tree.
pub fn invalidate_rebuild_needed<R: Runtime>(app: &AppHandle<R>) {
    {
        let mut revision = REBUILD_NEEDED_REVISION.lock().unwrap();
        *revision = revision.wrapping_add(1);
    }

    set_rebuild_needed(app, false);
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
