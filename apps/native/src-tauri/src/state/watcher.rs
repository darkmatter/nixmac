//! Git status watcher for detecting config changes.
//!
//! Polls git status at a configurable interval and writes the git-state and
//! change-map cells, whose subscribers notify the frontend. Change detection
//! compares against the in-memory git-state cell, which is kept in sync by
//! both this watcher and the mutating command paths.

use crate::shared_types::{GitAutoUpdate, GitState};
use crate::state::{
    build_state, change_map as change_map_state, drift_notifications, evolve_state, git_state,
    preferences,
};
use crate::system::nix;
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

/// Last rebuild-needed check by watched directory.
static LAST_REBUILD_NEEDED_CHECK: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Check the upstream git repo for new commits that we might be able to pull
/// every 5 minutes.
const AUTO_UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Check if we need to suggest a darwin-rebuild switch to the user (if the current working tree is newer than the last build)
/// every 1 minute.
const REBUILD_NEEDED_CHECK_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitAutoUpdateMode {
    Off,
    Confirm,
    Automatic,
}

impl GitAutoUpdateMode {
    fn resolve(override_value: Option<&str>, preference: GitAutoUpdate) -> Self {
        override_value
            .map(Self::from_override)
            .unwrap_or(match preference {
                GitAutoUpdate::Off => Self::Off,
                GitAutoUpdate::Confirm => Self::Confirm,
                GitAutoUpdate::Automatic => Self::Automatic,
            })
    }

    fn from_override(value: &str) -> Self {
        match value {
            "confirm" => Self::Confirm,
            "automatic" => Self::Automatic,
            value if !value.is_empty() && value != "off" => {
                log::warn!("[watcher] ignoring invalid NIXMAC_GIT_AUTO_UPDATE_MODE value: {value}");
                Self::Off
            }
            _ => Self::Off,
        }
    }
}

fn git_auto_update_mode<R: Runtime>(app_handle: &AppHandle<R>) -> GitAutoUpdateMode {
    let override_value = std::env::var("NIXMAC_GIT_AUTO_UPDATE_MODE").ok();
    let preference = preferences::try_read(app_handle)
        .map(|prefs| prefs.git_auto_update)
        .unwrap_or_default();
    GitAutoUpdateMode::resolve(override_value.as_deref(), preference)
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

fn should_check_rebuild_needed(dir: &str, now: Instant) -> bool {
    let mut last_check = LAST_REBUILD_NEEDED_CHECK.lock().unwrap();

    if let Some((last_dir, checked_at)) = last_check.as_ref()
        && last_dir == dir
        && now.duration_since(*checked_at) < REBUILD_NEEDED_CHECK_INTERVAL
    {
        return false;
    }

    *last_check = Some((dir.to_string(), now));
    true
}

fn check_for_external_build<R: Runtime>(
    app_handle: &AppHandle<R>,
    last_known_store_path: &mut Option<String>,
) -> bool {
    let live_store_path = build_state::read_current_store_path();
    if live_store_path == *last_known_store_path {
        return false;
    }

    *last_known_store_path = live_store_path.clone();
    if let Ok(mut build_state) = build_state::get(app_handle) {
        build_state.current_nix_store_path = live_store_path.clone();
        let _ = build_state::set(app_handle, build_state);
    }

    let nixmac_built = build_state::get(app_handle)
        .ok()
        .and_then(|state| state.nixmac_built_store_path);
    live_store_path.is_some() && live_store_path != nixmac_built
}

fn check_git_status<R: Runtime>(
    app_handle: &AppHandle<R>,
    dir: &str,
    external_build_detected: bool,
) {
    let status = match git::status(dir) {
        Ok(status) => status,
        Err(error) => {
            let _ = app_handle.emit("git_state_error", error.to_string());
            return;
        }
    };

    let current = git_state::get(app_handle);
    let status_changed = current.git_status.as_ref() != Some(&status);
    if !status_changed && !external_build_detected {
        return;
    }

    evolve_state::refresh(app_handle, &status.changes);
    let change_map = if status.clean_head {
        Default::default()
    } else {
        let pool = app_handle.state::<db::DbPool>();
        summarize::find_existing::for_current_state(&pool, dir)
            .ok()
            .map(summarize::group_existing::from_change_sets)
            .unwrap_or_default()
    };
    drift_notifications::maybe_notify(Some(&status), external_build_detected);
    app_handle
        .state::<crate::observable::Observable<GitState>>()
        .update_if_changed(move |state| {
            let live_status_changed = state.git_status.as_ref() != Some(&status);
            let flag =
                external_build_detected || (state.external_build_detected && !live_status_changed);
            state.git_status = Some(status);
            state.external_build_detected = flag;
        });
    change_map_state::update(app_handle, change_map);
}

fn check_upstream<R: Runtime + 'static>(app_handle: &AppHandle<R>, dir: &str, generation: u64) {
    if git_auto_update_mode(app_handle) == GitAutoUpdateMode::Off
        || !should_check_auto_update(dir, Instant::now())
    {
        return;
    }

    let check_app_handle = app_handle.clone();
    let dir = dir.to_string();
    std::thread::spawn(move || {
        let decision = git::auto_update::check_auto_update(&dir);
        log::debug!("[watcher] git auto-update check result: {:?}", decision);
        if let Ok(decision) = decision {
            let available = matches!(
                decision,
                git::auto_update::AutoUpdateDecision::UpdateAndRebuild { .. }
            );
            let watch_dir = WATCH_DIR.lock().unwrap();
            if WATCHER_GENERATION.load(Ordering::SeqCst) == generation
                && watch_dir.as_deref() == Some(dir.as_str())
            {
                git_state::set_upstream_update_available(&check_app_handle, available);
            } else {
                log::debug!("[watcher] discarding stale git auto-update result for {dir}");
            }
        }
    });
}

fn check_rebuild_needed<R: Runtime + 'static>(
    app_handle: &AppHandle<R>,
    dir: &str,
    generation: u64,
) {
    if !should_check_rebuild_needed(dir, Instant::now()) {
        return;
    }
    let Some(hostname) = nix::determine_host_attr(app_handle) else {
        return;
    };

    let check_app_handle = app_handle.clone();
    let dir = dir.to_string();
    let rebuild_check_revision = git_state::rebuild_needed_check_revision();
    std::thread::spawn(move || match nix::is_rebuild_needed(&hostname, &dir) {
        Ok(needed) => {
            log::debug!(
                "[watcher] rebuild-needed check result for {dir} on {hostname}: {}",
                if needed { "needed" } else { "not needed" }
            );
            let watch_dir = WATCH_DIR.lock().unwrap();
            if WATCHER_GENERATION.load(Ordering::SeqCst) == generation
                && watch_dir.as_deref() == Some(dir.as_str())
                && nix::determine_host_attr(&check_app_handle).as_deref() == Some(&hostname)
            {
                if !git_state::set_rebuild_needed_from_check(
                    &check_app_handle,
                    rebuild_check_revision,
                    needed,
                ) {
                    log::debug!(
                        "[watcher] discarding rebuild-needed result invalidated by a successful build"
                    );
                }
            } else {
                log::debug!("[watcher] discarding stale rebuild-needed result for {dir}");
            }
        }
        Err(error) => log::warn!("[watcher] rebuild-needed check failed: {error:#}"),
    });
}

fn wait_for_next_poll<R: Runtime + 'static>(
    app_handle: &AppHandle<R>,
    dir: Option<&str>,
    interval_ms: u64,
    generation: u64,
) {
    let sleep_until = Instant::now() + Duration::from_millis(interval_ms);
    while Instant::now() < sleep_until && WATCHER_ACTIVE.load(Ordering::SeqCst) {
        if let Some(dir) = dir {
            check_upstream(app_handle, dir, generation);
            check_rebuild_needed(app_handle, dir, generation);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
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
        git_state::set_rebuild_needed(&app_handle, false);
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

            let external_build_detected =
                check_for_external_build(&app_handle, &mut last_known_store_path);

            if let Some(ref dir) = current_dir {
                check_git_status(&app_handle, dir, external_build_detected);
            }

            wait_for_next_poll(&app_handle, current_dir.as_deref(), interval_ms, generation);
        }
    });

    // Step 4: Store the new thread's handle so restart can join() it
    *thread_guard = Some(new_thread);
}

#[cfg(test)]
mod tests {
    use super::GitAutoUpdateMode;
    use crate::shared_types::GitAutoUpdate;

    #[test]
    fn stored_auto_update_mode_is_used_without_an_environment_override() {
        assert_eq!(
            GitAutoUpdateMode::resolve(None, GitAutoUpdate::Confirm),
            GitAutoUpdateMode::Confirm
        );
    }

    #[test]
    fn environment_auto_update_mode_overrides_the_stored_preference() {
        assert_eq!(
            GitAutoUpdateMode::resolve(Some("automatic"), GitAutoUpdate::Off),
            GitAutoUpdateMode::Automatic
        );
        assert_eq!(
            GitAutoUpdateMode::resolve(Some("off"), GitAutoUpdate::Confirm),
            GitAutoUpdateMode::Off
        );
    }

    #[test]
    fn parses_auto_update_mode() {
        assert_eq!(GitAutoUpdateMode::from_override(""), GitAutoUpdateMode::Off);
        assert_eq!(
            GitAutoUpdateMode::from_override("off"),
            GitAutoUpdateMode::Off
        );
        assert_eq!(
            GitAutoUpdateMode::from_override("confirm"),
            GitAutoUpdateMode::Confirm
        );
        assert_eq!(
            GitAutoUpdateMode::from_override("automatic"),
            GitAutoUpdateMode::Automatic
        );
        assert_eq!(
            GitAutoUpdateMode::from_override("invalid"),
            GitAutoUpdateMode::Off
        );
    }
}
