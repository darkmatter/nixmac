use crate::storage::store;
#[cfg(debug_assertions)]
use serde::Serialize;
#[cfg(debug_assertions)]
use std::io::Write;
#[cfg(debug_assertions)]
use std::path::Path;
#[cfg(debug_assertions)]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri_plugin_store::StoreExt;

fn clear_tauri_store(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = app.store(path).map_err(|e| e.to_string())?;
    store.clear();
    store.save().map_err(|e| e.to_string())
}

use std::time::Instant;

pub struct TimerGuard {
    name: &'static str,
    start: Instant,
}

impl TimerGuard {
    pub fn new(name: &'static str) -> Self {
        Self {
            name,
            start: Instant::now(),
        }
    }
}

impl Drop for TimerGuard {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed();
        log::debug!("⏱️  [{}] took {:?}", self.name, elapsed);
    }
}

/// Test command to trigger a panic and verify the panic handler works.
/// This will cause a controlled panic that should be caught by the panic handler
/// and trigger the feedback dialog.
///
/// You can run it like this from the JS debug console:
/// window.__TAURI_INTERNALS__.invoke("trigger_test_panic");
///
/// Only available in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn trigger_test_panic() -> Result<(), String> {
    log::warn!("Test panic triggered by user");
    panic!("This is a test panic to verify the panic handler works correctly");
}

/// Sends a test drift notification from the developer settings.
/// Exercises the same code path as the watcher's drift notifications.
#[tauri::command]
pub async fn developer_send_test_notification(app: AppHandle) -> Result<(), String> {
    let developer_mode =
        store::get_bool_pref(&app, store::DEVELOPER_MODE_KEY, false).map_err(|e| e.to_string())?;
    if !developer_mode {
        return Err("Developer mode is required to send test notifications".to_string());
    }

    crate::state::drift_notifications::maybe_notify(None, true);
    Ok(())
}

/// Clears the app's Tauri plugin-store files.
#[tauri::command]
pub async fn developer_clear_tauri_state(app: AppHandle) -> Result<(), String> {
    let developer_mode =
        store::get_bool_pref(&app, store::DEVELOPER_MODE_KEY, false).map_err(|e| e.to_string())?;
    if !developer_mode {
        return Err("Developer mode is required to clear Tauri state".to_string());
    }

    clear_tauri_store(&app, "settings.json")?;
    clear_tauri_store(&app, "evolve-state.json")?;
    clear_tauri_store(&app, "build-state.json")?;
    // Reset the preferences observable too: subscribers persist the defaults
    // to global-preferences.json and notify the frontend of the reset values.
    crate::state::preferences::write(&app, |prefs| {
        *prefs = crate::state::preferences::GlobalPreferences::default();
    })
    .map_err(|e| e.to_string())?;
    // Reset the evolve-state observable (emits `evolve_state_changed`) and
    // broadcast the now-empty prompt history so the frontend mirrors the
    // cleared values without any manual store writes.
    crate::state::evolve_state::clear(&app).map_err(|e| e.to_string())?;
    {
        use tauri::Emitter;
        let _ = app.emit(store::PROMPT_HISTORY_CHANGED_EVENT, Vec::<String>::new());
    }
    Ok(())
}

#[cfg(debug_assertions)]
#[derive(Serialize)]
struct E2eBreadcrumb<'a> {
    timestamp_unix_ms: u128,
    client_timestamp_unix_ms: Option<u128>,
    label: &'a str,
    detail: Option<&'a str>,
}

#[cfg(debug_assertions)]
fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(debug_assertions)]
fn clean_field(value: &str, max_len: usize) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control() || *ch == '\t')
        .take(max_len)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Records frontend boot breadcrumbs for E2E diagnostics.
///
/// This is debug-only and writes only when the E2E runtime file/env provides a
/// diagnostics directory. It lets the launched .app report renderer progress
/// even when it was opened through LaunchServices and stdout is not captured.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn e2e_log_breadcrumb(
    label: String,
    detail: Option<String>,
    client_timestamp_unix_ms: Option<u128>,
) -> Result<(), String> {
    let Some(diagnostics_dir) = crate::e2e_runtime::value("NIXMAC_E2E_DIAGNOSTICS_DIR") else {
        return Ok(());
    };

    write_e2e_breadcrumb(
        Path::new(&diagnostics_dir),
        &label,
        detail.as_deref(),
        client_timestamp_unix_ms,
    )
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn e2e_mark_boot_stage(
    app: AppHandle,
    stage: String,
    client_timestamp_unix_ms: Option<u128>,
) -> Result<(), String> {
    let stage = clean_field(&stage, 80);
    if stage.is_empty() {
        return Ok(());
    }

    if let Some(window) = app.get_webview_window("main") {
        let title = if stage == "mounted" {
            "nixmac".to_string()
        } else {
            format!("nixmac boot:{stage}")
        };
        if let Err(error) = window.set_title(&title) {
            log::warn!("failed to set E2E native boot-stage title: {}", error);
        }
    }

    if let Some(diagnostics_dir) = crate::e2e_runtime::value("NIXMAC_E2E_DIAGNOSTICS_DIR") {
        write_e2e_breadcrumb(
            Path::new(&diagnostics_dir),
            "native boot stage marker",
            Some(&stage),
            client_timestamp_unix_ms,
        )?;
    }

    log::debug!("NIXMAC_E2E native boot stage marker: {}", stage);
    Ok(())
}

#[cfg(debug_assertions)]
fn write_e2e_breadcrumb(
    diagnostics_dir: &Path,
    label: &str,
    detail: Option<&str>,
    client_timestamp_unix_ms: Option<u128>,
) -> Result<(), String> {
    let label = clean_field(label, 160);
    if label.is_empty() {
        return Ok(());
    }
    let detail = detail
        .map(|value| clean_field(value, 1_000))
        .filter(|value| !value.is_empty());

    std::fs::create_dir_all(diagnostics_dir)
        .map_err(|err| format!("failed to create E2E diagnostics directory: {err}"))?;
    let path = diagnostics_dir.join("nixmac-frontend-breadcrumbs.jsonl");

    let entry = E2eBreadcrumb {
        timestamp_unix_ms: now_unix_ms(),
        client_timestamp_unix_ms,
        label: &label,
        detail: detail.as_deref(),
    };
    let line = serde_json::to_string(&entry)
        .map_err(|err| format!("failed to serialize E2E breadcrumb: {err}"))?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| format!("failed to open E2E breadcrumb log: {err}"))?;
    writeln!(file, "{line}").map_err(|err| format!("failed to write E2E breadcrumb: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn writes_sanitized_breadcrumb_jsonl() {
        let temp = tempfile::tempdir().unwrap();

        write_e2e_breadcrumb(
            temp.path(),
            " render\nstart ",
            Some("detail\u{0000}\nvalue"),
            Some(123),
        )
        .unwrap();

        let path = temp.path().join("nixmac-frontend-breadcrumbs.jsonl");
        let raw = std::fs::read_to_string(path).unwrap();
        let line = raw.lines().next().unwrap();
        let value: Value = serde_json::from_str(line).unwrap();

        assert_eq!(value["client_timestamp_unix_ms"], 123);
        assert_eq!(value["label"], "renderstart");
        assert_eq!(value["detail"], "detailvalue");
        assert!(value["timestamp_unix_ms"].as_u64().unwrap() > 0);
    }

    #[test]
    fn appends_breadcrumbs() {
        let temp = tempfile::tempdir().unwrap();

        write_e2e_breadcrumb(temp.path(), "first", None, None).unwrap();
        write_e2e_breadcrumb(temp.path(), "second", None, None).unwrap();

        let path = temp.path().join("nixmac-frontend-breadcrumbs.jsonl");
        let raw = std::fs::read_to_string(path).unwrap();
        assert_eq!(raw.lines().count(), 2);
    }
}
