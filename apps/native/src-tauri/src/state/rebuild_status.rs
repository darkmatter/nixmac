//! Last-known darwin-rebuild status — the Observable status slice paired
//! with the `darwin:apply:*` output streams.
//!
//! Holds only the run's lifecycle (running / finished / error class); the
//! line-by-line output intentionally stays on the streams. Not persisted —
//! a fresh process has no rebuild in flight.

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::RebuildStatus;

pub const REBUILD_STATUS_CHANGED_EVENT: &str = "rebuild_status_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<RebuildStatus> {
    Observable::new(RebuildStatus::default()).emit_to(app, REBUILD_STATUS_CHANGED_EVENT)
}

/// Read the last-known rebuild status.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> RebuildStatus {
    app.state::<Observable<RebuildStatus>>().read_sync().clone()
}

/// Record the start of a rebuild stream; clears the previous run's outcome.
pub fn record_start<R: Runtime>(app: &AppHandle<R>) {
    let observable = app.state::<Observable<RebuildStatus>>();
    *observable.write_sync() = RebuildStatus {
        is_running: true,
        ..RebuildStatus::default()
    };
}

/// Record the end of a rebuild stream from the `darwin:apply:end` payload.
pub fn record_end<R: Runtime>(app: &AppHandle<R>, payload: &serde_json::Value) {
    let observable = app.state::<Observable<RebuildStatus>>();
    *observable.write_sync() = RebuildStatus {
        is_running: false,
        success: payload.get("ok").and_then(|v| v.as_bool()),
        exit_code: payload
            .get("code")
            .and_then(|v| v.as_i64())
            .map(|c| c as i32),
        error_type: payload
            .get("error_type")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        error_message: payload
            .get("error")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        system_untouched: payload.get("system_untouched").and_then(|v| v.as_bool()),
    };
}
