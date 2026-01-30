//! Config directory watcher for detecting file changes.
//!
//! Uses git's native diff-index command for efficient change detection.
//! This is extremely low-overhead as git uses file stat metadata rather
//! than reading file contents.

use crate::git;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Polling interval for checking changes (milliseconds)
const POLL_INTERVAL_MS: u64 = 500;

/// Enable debug logging
const DEBUG_LOGGING: bool = false;

macro_rules! watcher_log {
    ($($arg:tt)*) => {
        if DEBUG_LOGGING {
            eprintln!("[watcher] {}", format!($($arg)*));
        }
    };
}

// Track if watcher is active
static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

// Store the config directory being watched
static WATCH_DIR: Mutex<Option<String>> = Mutex::new(None);

/// Event payload sent to frontend when config changes are detected
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangedEvent {
    /// Whether there are any uncommitted changes
    pub has_changes: bool,
}

/// Starts the config watcher for the given directory.
/// If a watcher is already running, it will be stopped first.
pub fn start_watching<R: Runtime>(app: AppHandle<R>, dir: String)
where
    R: 'static,
{
    // Stop any existing watcher
    stop_watching();

    // Store the directory to watch
    {
        let mut watch_dir = WATCH_DIR.lock().unwrap();
        *watch_dir = Some(dir.clone());
    }

    WATCHER_ACTIVE.store(true, Ordering::SeqCst);
    watcher_log!("Starting config watcher for: {}", dir);

    std::thread::spawn(move || {
        let mut last_has_changes: Option<bool> = None;

        loop {
            if !WATCHER_ACTIVE.load(Ordering::SeqCst) {
                watcher_log!("Watcher stopped");
                break;
            }

            // Get the current watch directory
            let current_dir = {
                let watch_dir = WATCH_DIR.lock().unwrap();
                watch_dir.clone()
            };

            if let Some(ref dir) = current_dir {
                // Fast check using git diff-index
                let has_changes = git::has_changes_fast(dir);

                // Only emit if state changed
                if last_has_changes != Some(has_changes) {
                    watcher_log!(
                        "Change detected: has_changes={} (was {:?})",
                        has_changes,
                        last_has_changes
                    );

                    last_has_changes = Some(has_changes);

                    // Emit event to frontend
                    if let Some(window) = app.get_webview_window("main") {
                        let event = ConfigChangedEvent { has_changes };
                        if let Err(e) = window.emit("config:changed", &event) {
                            watcher_log!("Failed to emit config:changed event: {}", e);
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// Stops the config watcher if running.
pub fn stop_watching() {
    if WATCHER_ACTIVE.swap(false, Ordering::SeqCst) {
        watcher_log!("Stopping config watcher");
    }

    // Clear the watch directory
    let mut watch_dir = WATCH_DIR.lock().unwrap();
    *watch_dir = None;
}

/// Returns whether the watcher is currently active.
pub fn is_watching() -> bool {
    WATCHER_ACTIVE.load(Ordering::SeqCst)
}
