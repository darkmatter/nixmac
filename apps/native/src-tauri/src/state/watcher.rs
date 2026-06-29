//! Git status watcher for detecting config changes.
//!
//! Polls git status at a configurable interval and writes the git-state and
//! change-map cells, whose subscribers notify the frontend. Change detection
//! compares against the in-memory git-state cell, which is kept in sync by
//! both this watcher and the mutating command paths.

use crate::shared_types::GitState;
use crate::state::{
    build_state, change_map as change_map_state, drift_notifications, evolve_state, git_state,
};
use crate::{db, git, summarize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
            // fire-and-forget join: join() only fails if the thread panicked.
            // We are replacing it regardless; ignoring the panic payload is correct.
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
                    // fire-and-forget: persisting the updated store path to cache.
                    // The in-memory value is already updated above; a write failure
                    // means the next app start will re-detect the path from the filesystem.
                    let _ = build_state::set(&app_handle, bs);
                }
                // If the new path differs from what nixmac built, it's an external build.
                let nixmac_built = build_state::get(&app_handle)
                    .ok()
                    .and_then(|bs| bs.nixmac_built_store_path);
                if live_store_path.is_some() && live_store_path != nixmac_built {
                    external_build_detected = true;
                }
            }

            if let Some(ref dir) = current_dir {
                match git::status(dir) {
                    Ok(status) => {
                        // Compare against the in-memory cell (last-known state).
                        // Both this watcher and the mutating commands write it.
                        let current = git_state::get(&app_handle);
                        let status_changed = current.git_status.as_ref() != Some(&status);

                        if status_changed || external_build_detected {
                            let pool = app_handle.state::<db::DbPool>();
                            let change_map =
                                summarize::find_existing::for_current_state(&pool, dir)
                                    .ok()
                                    .map(summarize::group_existing::from_change_sets)
                                    .unwrap_or_default();
                            // Refresh the derived evolve projection from the new git/build
                            // state; the projection cell emits `evolve_state_changed`.
                            evolve_state::refresh(&app_handle, &status.changes);
                            // Native drift notification (config drift / external build).
                            drift_notifications::maybe_notify(
                                Some(&status),
                                external_build_detected,
                            );
                            // The external-build flag is sticky while the status stays
                            // put (the frontend keeps showing the banner) and clears on
                            // the next status change, matching the pre-cell emissions.
                            let flag = external_build_detected
                                || (current.external_build_detected && !status_changed);
                            // The cell write emits `git_state_changed`; one emit per
                            // slice — frontend listens on its dedicated channel.
                            git_state::update(
                                &app_handle,
                                GitState {
                                    git_status: Some(status),
                                    external_build_detected: flag,
                                },
                            );
                            // The cell write emits `change_map_changed`.
                            change_map_state::update(&app_handle, change_map);
                        }
                    }
                    Err(e) => {
                        // fire-and-forget: error event delivery to frontend.
                        let _ = app_handle.emit("git_state_error", e.to_string());
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
