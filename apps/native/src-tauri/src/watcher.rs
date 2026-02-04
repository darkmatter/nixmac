//! Git status watcher for detecting config changes.
//!
//! Polls git status at a configurable interval and emits events with GitStatus payload
//! Only one watcher thread runs at a time. When `start_watching` is called:
//! Restarting gives us an immediate poll when window is focused.

use crate::git;
use crate::types::GitStatus;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

/// Set to `false` by `start_watching` to stop the old thread before starting a new one.
static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

/// The directory being watched. Stored globally so we can access it from the thread.
static WATCH_DIR: Mutex<Option<String>> = Mutex::new(None);

/// Holds handle to current watcher so we can wait for it to stop on restart.
static WATCHER_THREAD: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

/// Event payload sent to frontend when git status changes.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusChangedEvent {
    pub status: GitStatus,
}

/// Starts the git status watcher for the given directory.
///
/// ## Parameters
/// - `app_handle`: Tauri's app handle, used to emit events to the frontend
/// - `dir`: The git repository directory to watch
/// - `interval_ms`: How often to poll git status (in milliseconds)
pub fn start_watching<R>(app_handle: AppHandle<R>, dir: String, interval_ms: u64)
where
    R: Runtime + 'static,
{
    // Step 1: Stop any existing watcher and wait for it to fully exit.
    {
        let mut thread_guard = WATCHER_THREAD.lock().unwrap();
        if let Some(old_thread) = thread_guard.take() {
            WATCHER_ACTIVE.store(false, Ordering::SeqCst);
            let _ = old_thread.join();
        }
    }

    // Step 2: Store the directory to watch.
    {
        let mut watch_dir = WATCH_DIR.lock().unwrap();
        *watch_dir = Some(dir.clone());
    }

    // Step 3: Signal that a watcher is now active and spawn the new thread.
    WATCHER_ACTIVE.store(true, Ordering::SeqCst);
    let new_thread = std::thread::spawn(move || {
        // Track the last status JSON to detect changes (only emit when different)
        let mut last_status_json: Option<String> = None;

        loop {
            // Check if we should stop (set by a new call to start_watching)
            if !WATCHER_ACTIVE.load(Ordering::SeqCst) {
                break;
            }

            // Get the current watch directory
            let current_dir = {
                let watch_dir = WATCH_DIR.lock().unwrap();
                watch_dir.clone()
            };

            if let Some(ref dir) = current_dir {
                // Get full git status and emit if changed
                if let Ok(status) = git::status(dir) {
                    if let Ok(status_json) = serde_json::to_string(&status) {
                        if Some(&status_json) != last_status_json.as_ref() {
                            let _ = app_handle
                                .emit("git:status-changed", GitStatusChangedEvent { status });
                            last_status_json = Some(status_json);
                        }
                    }
                }
            }

            // Check periodically (100ms) to break if restart / stop was requested
            let sleep_until = std::time::Instant::now() + Duration::from_millis(interval_ms);
            while std::time::Instant::now() < sleep_until {
                if !WATCHER_ACTIVE.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });

    // Step 4: Store the new thread's handle so restart can join() it
    *WATCHER_THREAD.lock().unwrap() = Some(new_thread);
}

/// Stops the config watcher if running.
pub fn stop_watching() {
    WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    let mut watch_dir = WATCH_DIR.lock().unwrap();
    *watch_dir = None;
}

/// Returns whether the watcher is currently active.
pub fn is_watching() -> bool {
    WATCHER_ACTIVE.load(Ordering::SeqCst)
}
