use crate::state::{evolve_state, watcher};
use crate::storage::store;
use crate::system::nix::determine_host_attr;
use crate::{git, shared_types};
use tauri::AppHandle;

pub(super) fn capture_err<E: std::fmt::Display>(cmd: &str, e: E) -> String {
    tracing::error!(command = cmd, error = %e, "command error");
    e.to_string()
}

/// Initializes app state after switching to a new config directory:
/// caches git status, starts the file watcher, and resets evolve state.
/// The cell writes emit `git_state_changed`/`evolve_state_changed`, and the
/// frontend re-lists hosts when `global_preferences_changed` arrives.
pub(super) fn handle_new_config_dir(app: &AppHandle, dir: &str) -> Result<(), String> {
    let git_status = git::status(dir).ok();
    let changes = git_status
        .as_ref()
        .map(|s| s.changes.clone())
        .unwrap_or_default();
    if let Some(ref s) = git_status {
        crate::state::git_state::update_status(app, s.clone());
    }
    watcher::start_watching(app.clone(), dir.to_string(), 2500);
    evolve_state::set_session(app, shared_types::EvolveSession::default(), &changes)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Helper function to extract the hostname and config_dir from the app handle, returning an error if either is missing.
pub(super) fn get_hostname_and_config_dir(
    app: &AppHandle,
    cmd: &str,
) -> Result<(String, String), String> {
    let hostname = determine_host_attr(app).unwrap_or_default();
    let config_dir: String =
        store::ensure_config_dir_exists(app).map_err(|e| capture_err(cmd, e))?;

    if hostname.is_empty() {
        log::warn!("No hostname configured.");
        return Err("No hostname configured".to_string());
    }

    Ok((hostname, config_dir))
}
