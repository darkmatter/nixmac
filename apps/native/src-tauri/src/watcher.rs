//! Git status watcher for detecting config changes.
//!
//! Polls git status at a configurable interval and emits `WatcherEvent` to the frontend.
//! Change detection compares current git status against the persisted store cache,
//! which is kept in sync by both this watcher and the evolution/summarize handlers.

use crate::shared_types::WatcherEvent;
use crate::{build_state, db, evolve_state, git, store, summarize};
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
        // Seed the in-memory store path or read the live value.
        let mut last_known_store_path: Option<String> = build_state::get(&app_handle)
            .ok()
            .and_then(|bs| bs.current_nix_store_path)
            .or_else(build_state::read_current_store_path);

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

            // Detect external builds
            let mut external_build_detected = false;
            let live_store_path = build_state::read_current_store_path();
            if live_store_path != last_known_store_path {
                last_known_store_path = live_store_path.clone();
                // Persist so the next app start initialises correctly.
                if let Ok(mut bs) = build_state::get(&app_handle) {
                    bs.current_nix_store_path = live_store_path.clone();
                    let _ = build_state::set(&app_handle, bs);
                }
                // If the new path differs from what nixmac built, it's an external build.
                let nixmac_built = build_state::get(&app_handle)
                    .ok()
                    .and_then(|bs| bs.nixmac_built_store_path);
                if live_store_path.is_some() && live_store_path != nixmac_built {
                    external_build_detected = true;
                    if let Some(ref path) = live_store_path {
                        if let Some(gen) = build_state::read_current_nix_generation() {
                            let _ = build_state::record_external_build(&app_handle, gen, path);
                        }
                    }
                }
            }

            if let Some(ref dir) = current_dir {
                match git::status(dir) {
                    Ok(status) => {
                        // Compare against the store-persisted cache (source of truth).
                        // Both this watcher and evolution/summarize keep the cache in sync.
                        let cached_json = store::get_cached_git_status(&app_handle)
                            .ok()
                            .flatten()
                            .and_then(|s| serde_json::to_string(&s).ok());
                        let current_json = serde_json::to_string(&status).ok();

                        if current_json != cached_json || external_build_detected {
                            let change_map = db::get_db_path(&app_handle)
                                .ok()
                                .and_then(|db_path| {
                                    summarize::find_existing::for_current_state(&db_path, dir).ok()
                                })
                                .map(summarize::group_existing::from_change_sets)
                                .unwrap_or_default();
                            let evolve_state_updated = evolve_state::get(&app_handle)
                                .ok()
                                .and_then(|es| {
                                    evolve_state::set(&app_handle, es, &status.changes).ok()
                                });
                            let _ = app_handle.emit(
                                "git:status-changed",
                                WatcherEvent {
                                    git_status: Some(status.clone()),
                                    change_map: Some(change_map),
                                    evolve_state: evolve_state_updated,
                                    error: None,
                                    external_build_detected,
                                },
                            );
                            let _ = store::set_cached_git_status(&app_handle, &status);
                        }
                    }
                    Err(e) => {
                        let _ = app_handle.emit(
                            "git:status-changed",
                            WatcherEvent {
                                git_status: None,
                                change_map: None,
                                evolve_state: None,
                                error: Some(e.to_string()),
                                external_build_detected: false,
                            },
                        );
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
