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

/// Serializes clone/merge/write operations on the Git-state cell.
static UPDATE_LOCK: Mutex<()> = Mutex::new(());

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
fn update_unlocked<R: Runtime>(app: &AppHandle<R>, next: GitState) -> bool {
    let observable = app.state::<Observable<GitState>>();
    if *observable.read_sync() == next {
        return false;
    }
    *observable.write_sync() = next;
    true
}

pub fn update<R: Runtime>(app: &AppHandle<R>, next: GitState) -> bool {
    let _guard = UPDATE_LOCK.lock().expect("git-state update lock poisoned");
    update_unlocked(app, next)
}

/// Write Git state while atomically preserving the live upstream-update flag.
///
/// Status-producing paths do not own that flag, which is updated by the
/// asynchronous upstream check. Merging it under the write lock prevents
/// either path from restoring a stale cloned value.
pub fn update_preserving_upstream<R: Runtime>(app: &AppHandle<R>, mut next: GitState) -> bool {
    let _guard = UPDATE_LOCK.lock().expect("git-state update lock poisoned");
    next.upstream_update_available = get(app).upstream_update_available;
    update_unlocked(app, next)
}

/// Atomically update only the result of the asynchronous upstream check.
pub fn set_upstream_update_available<R: Runtime>(app: &AppHandle<R>, available: bool) -> bool {
    let _guard = UPDATE_LOCK.lock().expect("git-state update lock poisoned");
    let mut next = get(app);
    next.upstream_update_available = available;
    update_unlocked(app, next)
}

/// Record a fresh status snapshot, clearing the external-build flag.
///
/// Mutating commands call this after they change the working tree or finish
/// a build nixmac itself initiated — both make any previously detected
/// external build stale.
pub fn update_status<R: Runtime>(app: &AppHandle<R>, status: GitStatus) {
    update_preserving_upstream(
        app,
        GitState {
            git_status: Some(status),
            external_build_detected: false,
            upstream_update_available: false,
        },
    );
}
