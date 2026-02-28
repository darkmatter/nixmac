//! Panic handler for capturing and reporting Rust panics before the process terminates.
//!
//! This module sets up a custom panic hook that:
//! 1. Captures panic information including backtrace
//! 2. Reports to Sentry if configured
//! 3. Emits an event to the frontend to show the feedback dialog
//! 4. Calls the default panic hook (unwinding proceeds normally)
//!
//! Note: The panic hook itself does not prevent crashes. Panics in Tauri command handlers
//! are caught and contained by Tauri's `#[tauri::command]` wrapper (which uses `catch_unwind`).
//! Panics outside of command contexts will still crash the process, but the user will see
//! the feedback dialog and error details before the crash occurs.

use log::error;
use std::panic;
use tauri::{AppHandle, Emitter, Manager};

/// Panic information sent to the frontend
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanicInfo {
    /// The panic message
    pub message: String,
    /// The location of the panic (file:line:column)
    pub location: Option<String>,
    /// Optional backtrace (if RUST_BACKTRACE is enabled)
    pub backtrace: Option<String>,
    /// Timestamp when the panic occurred
    pub timestamp: String,
}

/// Sets up the custom panic hook for the application.
pub fn setup_panic_hook(app_handle: AppHandle) {
    // Store the default panic hook so we can call it if needed
    let default_hook = panic::take_hook();

    panic::set_hook(Box::new(move |panic_info| {
        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic payload".to_string()
        };

        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()));

        // Capture backtrace if RUST_BACKTRACE is set
        let backtrace = match std::env::var("RUST_BACKTRACE") {
            Ok(val) if val != "0" => Some(format!("{:?}", backtrace::Backtrace::new())),
            _ => None,
        };

        let timestamp = chrono::Utc::now().to_rfc3339();

        // Log the panic
        error!(
            "PANIC CAUGHT: {} at {:?}",
            message,
            location.as_deref().unwrap_or("unknown location")
        );

        if let Some(ref bt) = backtrace {
            error!("Backtrace:\n{}", bt);
        }

        // Report to Sentry with proper metadata
        sentry::with_scope(
            |scope| {
                scope.set_tag("panic", "true");
                if let Some(ref loc) = location {
                    scope.set_tag("panic.location", loc);
                }
                if let Some(ref bt) = backtrace {
                    scope.set_extra("backtrace", serde_json::Value::String(bt.clone()));
                }
                scope.set_level(Some(sentry::Level::Fatal));
            },
            || {
                sentry::capture_message(&format!("Panic: {}", message), sentry::Level::Fatal);
            },
        );

        // Create panic info payload
        let panic_payload = PanicInfo {
            message: message.clone(),
            location: location.clone(),
            backtrace: backtrace.clone(),
            timestamp,
        };

        // Try to emit event to frontend
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Err(e) = window.emit("rust:panic", &panic_payload) {
                error!("Failed to emit panic event to frontend: {}", e);
            } else {
                error!("✅ Panic event emitted to frontend");
            }
        } else {
            error!("❌ Could not get main window to emit panic event");
        }

        // Call the default hook to let Rust proceed with its normal panic unwinding.
        // If this panic happened in a Tauri command handler, the `#[tauri::command]` wrapper
        // will catch the unwind and return an error response. Otherwise, the process will terminate.
        default_hook(panic_info);
    }));

    log::info!("Custom panic handler installed");
}
