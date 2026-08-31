//! Last-known darwin-rebuild status — the Observable status slice paired
//! with the `darwin:apply:*` output streams.
//!
//! Holds only the run's lifecycle (running / finished / error class); the
//! line-by-line output intentionally stays on the streams. Not persisted —
//! a fresh process has no rebuild in flight.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::RebuildStatus;

pub const REBUILD_STATUS_CHANGED_EVENT: &str = "rebuild_status_changed";
static OWNED_STORE_PATH_CHANGE: Mutex<Option<String>> = Mutex::new(None);

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<RebuildStatus> {
    Observable::new(RebuildStatus::default()).emit_to(app, REBUILD_STATUS_CHANGED_EVENT)
}

/// Read the last-known rebuild status.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> RebuildStatus {
    app.state::<Observable<RebuildStatus>>().read_sync().clone()
}

/// Clear the last-known rebuild status.
pub fn reset<R: Runtime>(app: &AppHandle<R>) {
    clear_owned_store_path_change();
    let observable = app.state::<Observable<RebuildStatus>>();
    *observable.write_sync() = RebuildStatus::default();
}

/// Record the start of a rebuild stream; clears the previous run's outcome.
pub fn record_start<R: Runtime>(app: &AppHandle<R>) {
    crate::attention::clear_work(app);
    clear_owned_store_path_change();
    let observable = app.state::<Observable<RebuildStatus>>();
    *observable.write_sync() = RebuildStatus {
        is_running: true,
        ..RebuildStatus::default()
    };
}

/// Record the end of a rebuild stream from the `darwin:apply:end` payload.
pub fn record_end<R: Runtime>(app: &AppHandle<R>, payload: &serde_json::Value) {
    if should_clear_owned_store_path_on_end(payload) {
        clear_owned_store_path_change();
    }
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

fn should_clear_owned_store_path_on_end(payload: &serde_json::Value) -> bool {
    payload.get("ok").and_then(|value| value.as_bool()) != Some(true)
}

pub fn expect_owned_store_path_change(store_path: String) {
    match OWNED_STORE_PATH_CHANGE.lock() {
        Ok(mut guard) => *guard = Some(store_path),
        Err(poisoned) => *poisoned.into_inner() = Some(store_path),
    }
}

fn consume_owned_store_path(expected: &mut Option<String>, live: &Option<String>) -> bool {
    let matches = live.is_some() && expected.as_ref() == live.as_ref();
    if matches {
        *expected = None;
    }
    matches
}

pub fn take_owned_store_path_change(live: &Option<String>) -> bool {
    let mut expected = match OWNED_STORE_PATH_CHANGE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    consume_owned_store_path(&mut expected, live)
}

pub fn clear_owned_store_path_change() {
    match OWNED_STORE_PATH_CHANGE.lock() {
        Ok(mut guard) => *guard = None,
        Err(poisoned) => *poisoned.into_inner() = None,
    }
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

    #[test]
    fn only_the_exact_owned_store_path_transition_is_suppressed() {
        let mut expected = Some("/nix/store/owned".to_string());
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/external".to_string())
        ));
        assert_eq!(expected.as_deref(), Some("/nix/store/owned"));

        expected = Some("/nix/store/owned".to_string());
        assert!(consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/owned".to_string())
        ));
        assert_eq!(expected, None);
    }

    #[test]
    fn owned_transition_survives_until_the_delayed_matching_watcher_poll() {
        let mut expected = Some("/nix/store/new-system".to_string());

        // Polls before activation completes must not consume the expectation.
        assert!(!consume_owned_store_path(&mut expected, &None));
        assert_eq!(expected.as_deref(), Some("/nix/store/new-system"));
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/old-system".to_string())
        ));
        assert_eq!(expected.as_deref(), Some("/nix/store/new-system"));

        // The first poll that observes the activated path consumes it once.
        assert!(consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/new-system".to_string())
        ));
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/new-system".to_string())
        ));
    }

    #[test]
    fn successful_end_keeps_expectation_but_failure_releases_it() {
        assert!(!should_clear_owned_store_path_on_end(
            &serde_json::json!({ "ok": true })
        ));
        assert!(should_clear_owned_store_path_on_end(
            &serde_json::json!({ "ok": false })
        ));
        assert!(should_clear_owned_store_path_on_end(&serde_json::json!({})));
    }
}
