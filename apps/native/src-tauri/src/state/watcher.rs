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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Set to `false` by `start_watching` to stop the old thread before starting a new one.
static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Invalidates results from checks started by an older watcher instance.
static WATCHER_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The directory being watched. Stored globally so we can access it from the thread.
static WATCH_DIR: Mutex<Option<String>> = Mutex::new(None);

/// Holds handle to current watcher so we can wait for it to stop on restart.
static WATCHER_THREAD: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

/// Last auto-update check by watched directory.
///
/// This is process-global rather than thread-local so focus-driven watcher
/// restarts do not reset the five-minute throttle.
static LAST_AUTO_UPDATE_CHECK: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Check the upstream git repo for new commits that we might be able to pull
/// every 5 minutes.
const AUTO_UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Git auto-update mode preference values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitAutoUpdateMode {
    Off,
    Confirm,
    Automatic,
}

/// Git auto-update mode preference implementation.
/// TODO: Move to real system preference when ready to hook up to UI.
impl GitAutoUpdateMode {
    fn from_env() -> Self {
        Self::from_value(std::env::var("NIXMAC_GIT_AUTO_UPDATE_MODE").ok().as_deref())
    }

    fn from_value(value: Option<&str>) -> Self {
        match value {
            Some("confirm") => Self::Confirm,
            Some("automatic") => Self::Automatic,
            Some(value) if !value.is_empty() && value != "off" => {
                log::warn!("[watcher] ignoring invalid NIXMAC_GIT_AUTO_UPDATE_MODE value: {value}");
                Self::Off
            }
            _ => Self::Off,
        }
    }
}

fn should_check_auto_update(dir: &str, now: Instant) -> bool {
    let mut last_check = LAST_AUTO_UPDATE_CHECK.lock().unwrap();

    if let Some((last_dir, checked_at)) = last_check.as_ref()
        && last_dir == dir
        && now.duration_since(*checked_at) < AUTO_UPDATE_CHECK_INTERVAL
    {
        return false;
    }

    *last_check = Some((dir.to_string(), now));
    true
}

/// Stops the git status watcher, if one is running, and waits for it to exit.
/// Used when the config directory is cleared (onboarding reset) — without a
/// directory there is nothing to poll, and polling a deleted one would emit
/// a `git_state_error` on every tick.
pub fn stop_watching() {
    let mut thread_guard = WATCHER_THREAD.lock().unwrap();
    WATCHER_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(old_thread) = thread_guard.take() {
        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
        // fire-and-forget join, as in `start_watching`: a panicked watcher is
        // being discarded either way.
        let _ = old_thread.join();
    }
    *WATCH_DIR.lock().unwrap() = None;
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
    let mut thread_guard = WATCHER_THREAD.lock().unwrap();
    let repository_changed = WATCH_DIR.lock().unwrap().as_deref() != Some(dir.as_str());
    let generation = if repository_changed {
        WATCHER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        WATCHER_GENERATION.load(Ordering::SeqCst)
    };

    // Step 1: Stop any existing watcher and wait for it to fully exit.
    if let Some(old_thread) = thread_guard.take() {
        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
        // fire-and-forget join: join() only fails if the thread panicked.
        // We are replacing it regardless; ignoring the panic payload is correct.
        let _ = old_thread.join();
    }

    // Step 2: Store the directory to watch.
    {
        let mut watch_dir = WATCH_DIR.lock().unwrap();
        *watch_dir = Some(dir.clone());
    }

    // If the repository changed, reset the upstream update available flag so the next check can re-evaluate it.
    if repository_changed {
        git_state::set_upstream_update_available(&app_handle, false);
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
                            // The cell write emits `git_state_changed`; one emit per
                            // slice — frontend listens on its dedicated channel. Derive
                            // the sticky external-build flag from the live cell while its
                            // write lock is held so another writer cannot be clobbered.
                            app_handle
                                .state::<crate::observable::Observable<GitState>>()
                                .update_if_changed(move |state| {
                                    let live_status_changed =
                                        state.git_status.as_ref() != Some(&status);
                                    let flag = external_build_detected
                                        || (state.external_build_detected && !live_status_changed);
                                    state.git_status = Some(status);
                                    state.external_build_detected = flag;
                                });
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
            let auto_update_mode = GitAutoUpdateMode::from_env();
            while std::time::Instant::now() < sleep_until {
                if !WATCHER_ACTIVE.load(Ordering::SeqCst) {
                    break;
                }

                // Detect upstream git commits we may want to offer to pull.
                // This is a fire-and-forget, best-effort check; if it fails,
                // we just try again on the next scheduled check.
                if auto_update_mode != GitAutoUpdateMode::Off
                    && let Some(dir) = current_dir.clone()
                    && should_check_auto_update(&dir, Instant::now())
                {
                    // Use a separate thread so we don't block the crazy-fast 100ms loop. The check itself is a git fetch
                    // which is more like order-of-seconds (usually about 1-2 seconds in practice).
                    let check_app_handle = app_handle.clone();
                    std::thread::spawn(move || {
                        let decision = git::auto_update::check_auto_update(&dir);
                        log::debug!("[watcher] git auto-update check result: {:?}", decision);
                        if let Ok(decision) = decision {
                            let available = matches!(
                                decision,
                                git::auto_update::AutoUpdateDecision::UpdateAndRebuild { .. }
                            );
                            // Hold WATCH_DIR through the state write so a repository
                            // switch cannot race the validation below.
                            let watch_dir = WATCH_DIR.lock().unwrap();
                            if WATCHER_GENERATION.load(Ordering::SeqCst) == generation
                                && watch_dir.as_deref() == Some(dir.as_str())
                            {
                                git_state::set_upstream_update_available(
                                    &check_app_handle,
                                    available,
                                );
                            } else {
                                log::debug!(
                                    "[watcher] discarding stale git auto-update result for {dir}"
                                );
                            }
                        }
                    });
                }

                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });

    // Step 4: Store the new thread's handle so restart can join() it
    *thread_guard = Some(new_thread);
}

#[cfg(test)]
mod tests {
    use super::GitAutoUpdateMode;

    #[test]
    fn parses_auto_update_mode() {
        assert_eq!(GitAutoUpdateMode::from_value(None), GitAutoUpdateMode::Off);
        assert_eq!(
            GitAutoUpdateMode::from_value(Some("")),
            GitAutoUpdateMode::Off
        );
        assert_eq!(
            GitAutoUpdateMode::from_value(Some("off")),
            GitAutoUpdateMode::Off
        );
        assert_eq!(
            GitAutoUpdateMode::from_value(Some("confirm")),
            GitAutoUpdateMode::Confirm
        );
        assert_eq!(
            GitAutoUpdateMode::from_value(Some("automatic")),
            GitAutoUpdateMode::Automatic
        );
        assert_eq!(
            GitAutoUpdateMode::from_value(Some("invalid")),
            GitAutoUpdateMode::Off
        );
    }
}
