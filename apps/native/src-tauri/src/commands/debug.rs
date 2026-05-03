use crate::shared_types;

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
