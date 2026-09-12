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
static OWNED_STORE_PATH_CHANGE: Mutex<Option<OwnedStorePathChange>> = Mutex::new(None);

#[derive(Debug, PartialEq, Eq)]
struct OwnedStorePathChange {
    path: String,
    completed: bool,
}

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
    {
        let mut expected = OWNED_STORE_PATH_CHANGE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        finish_owned_store_path_change(&mut expected, payload);
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

fn finish_owned_store_path_change(
    expected: &mut Option<OwnedStorePathChange>,
    payload: &serde_json::Value,
) {
    if payload.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        if let Some(expected) = expected
            && payload.get("store_path").and_then(|value| value.as_str())
                == Some(expected.path.as_str())
        {
            expected.completed = true;
        }
    } else {
        *expected = None;
    }
}

pub fn expect_owned_store_path_change(store_path: String) {
    let expected = Some(OwnedStorePathChange {
        path: store_path,
        completed: false,
    });
    match OWNED_STORE_PATH_CHANGE.lock() {
        Ok(mut guard) => *guard = expected,
        Err(poisoned) => *poisoned.into_inner() = expected,
    }
}

fn consume_owned_store_path(
    expected: &mut Option<OwnedStorePathChange>,
    live: &Option<String>,
) -> bool {
    let (Some(pending), Some(live)) = (expected.as_ref(), live.as_ref()) else {
        return false;
    };
    let matches = pending.path == *live;
    // Before completion the system can still report the previous path. After
    // success, a different observed path means another build has superseded it.
    if matches || pending.completed {
        *expected = None;
    }
    matches
}

fn sample_owned_store_path_change(
    tracker: &Mutex<Option<OwnedStorePathChange>>,
    read_live: impl FnOnce() -> Option<String>,
) -> (Option<String>, bool) {
    // Serialize sampling with completion. Reading before taking this lock
    // could turn a pre-completion old-path sample into a completed mismatch.
    let mut expected = match tracker.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let live = read_live();
    let owned = consume_owned_store_path(&mut expected, &live);
    (live, owned)
}

pub fn read_owned_store_path_change() -> (Option<String>, bool) {
    sample_owned_store_path_change(
        &OWNED_STORE_PATH_CHANGE,
        super::build_state::read_current_store_path,
    )
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

    fn pending(path: &str) -> Option<OwnedStorePathChange> {
        Some(OwnedStorePathChange {
            path: path.to_string(),
            completed: false,
        })
    }

    fn success(path: &str) -> serde_json::Value {
        serde_json::json!({ "ok": true, "store_path": path })
    }

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
        let mut expected = pending("/nix/store/owned");
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/external".to_string())
        ));
        assert_eq!(expected, pending("/nix/store/owned"));

        expected = pending("/nix/store/owned");
        assert!(consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/owned".to_string())
        ));
        assert_eq!(expected, None);
    }

    #[test]
    fn owned_transition_survives_until_the_delayed_matching_watcher_poll() {
        let mut expected = pending("/nix/store/new-system");

        // Polls before activation completes must not consume the expectation.
        assert!(!consume_owned_store_path(&mut expected, &None));
        assert_eq!(expected, pending("/nix/store/new-system"));
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/old-system".to_string())
        ));
        assert_eq!(expected, pending("/nix/store/new-system"));

        finish_owned_store_path_change(&mut expected, &success("/nix/store/new-system"));

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
        let mut expected = pending("/nix/store/owned");
        finish_owned_store_path_change(&mut expected, &success("/nix/store/owned"));
        assert_eq!(
            expected,
            Some(OwnedStorePathChange {
                path: "/nix/store/owned".to_string(),
                completed: true,
            })
        );
        for payload in [serde_json::json!({ "ok": false }), serde_json::json!({})] {
            let mut expected = pending("/nix/store/owned");
            finish_owned_store_path_change(&mut expected, &payload);
            assert_eq!(expected, None);
        }
    }

    #[test]
    fn intervening_external_build_expires_the_completed_owned_path() {
        let mut expected = pending("/nix/store/a");
        finish_owned_store_path_change(&mut expected, &success("/nix/store/a"));

        // A completed while unfocused, but the next watcher poll first sees B.
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/b".to_string())
        ));
        assert_eq!(expected, None);
        // A later external rollback to A must not inherit the old ownership,
        // including after the user acknowledges B as the active build.
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/a".to_string())
        ));
    }

    #[test]
    fn an_unavailable_post_completion_read_does_not_prove_an_intervening_build() {
        let mut expected = pending("/nix/store/a");
        finish_owned_store_path_change(&mut expected, &success("/nix/store/a"));
        assert!(!consume_owned_store_path(&mut expected, &None));
        assert!(consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/a".to_string())
        ));
    }

    #[test]
    fn completion_does_not_rearm_an_owned_path_already_observed_during_activation() {
        let mut expected = pending("/nix/store/a");
        assert!(consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/a".to_string())
        ));
        finish_owned_store_path_change(&mut expected, &success("/nix/store/a"));
        assert_eq!(expected, None);
        assert!(!consume_owned_store_path(
            &mut expected,
            &Some("/nix/store/a".to_string())
        ));
    }

    #[test]
    fn another_activations_success_cannot_complete_the_pending_owner() {
        for payload in [success("/nix/store/a"), serde_json::json!({ "ok": true })] {
            let mut expected = pending("/nix/store/b");
            finish_owned_store_path_change(&mut expected, &payload);
            assert!(!consume_owned_store_path(
                &mut expected,
                &Some("/nix/store/a".to_string())
            ));
            assert_eq!(expected, pending("/nix/store/b"));
        }
    }

    #[test]
    fn sampling_cannot_cross_activation_completion() {
        let tracker = Mutex::new(pending("/nix/store/a"));
        let (live, owned) = sample_owned_store_path_change(&tracker, || {
            // record_end needs this same lock to mark completion. It cannot
            // settle between an old-path read and classification of that read.
            assert!(matches!(
                tracker.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ));
            Some("/nix/store/old".to_string())
        });
        assert_eq!(live.as_deref(), Some("/nix/store/old"));
        assert!(!owned);
        assert_eq!(*tracker.lock().unwrap(), pending("/nix/store/a"));

        finish_owned_store_path_change(&mut tracker.lock().unwrap(), &success("/nix/store/a"));
        assert!(sample_owned_store_path_change(&tracker, || Some("/nix/store/a".to_string())).1);
    }
}
