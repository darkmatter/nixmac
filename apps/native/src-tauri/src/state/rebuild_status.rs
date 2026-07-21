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

/// Clear the last-known rebuild status.
pub fn reset<R: Runtime>(app: &AppHandle<R>) {
    let observable = app.state::<Observable<RebuildStatus>>();
    *observable.write_sync() = RebuildStatus::default();
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds");
        app.manage(load_observable(app.handle()));
        app
    }

    #[test]
    fn reset_clears_last_finished_result() {
        let app = mock_app();
        let handle = app.handle();

        record_end(
            handle,
            &serde_json::json!({
                "ok": true,
                "code": 0,
                "error_type": null,
                "error": null,
                "system_untouched": null,
            }),
        );
        assert_eq!(get(handle).success, Some(true));

        reset(handle);

        assert_eq!(get(handle), RebuildStatus::default());
    }
}
