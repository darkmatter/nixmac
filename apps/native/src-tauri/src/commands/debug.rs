#[cfg(debug_assertions)]
use crate::shared_types;
use crate::storage::store;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

fn clear_tauri_store(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = app.store(path).map_err(|e| e.to_string())?;
    store.clear();
    store.save().map_err(|e| e.to_string())
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

/// Debug command to capture a Sentry event from the Rust backend.
/// Used to test end-to-end Sentry integration.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn debug_sentry_event() -> Result<shared_types::DebugSentryResult, String> {
    log::info!("[debug_sentry_event] Capturing debug event from Rust backend");

    sentry::capture_message("Debug Sentry event from Rust backend", sentry::Level::Error);

    Ok(shared_types::DebugSentryResult {
        ok: true,
        message: "Debug event captured from Rust".to_string(),
    })
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
    Ok(())
}
