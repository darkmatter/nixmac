use crate::state::{evolve_state, watcher};
use crate::storage::store;
use crate::system::nix::{self, determine_host_attr};
use crate::{git, shared_types};
use tauri::AppHandle;

pub(super) fn wrap_result_and_capture_err<T, E: std::fmt::Display>(
    ctx: &str,
    res: Result<T, E>,
) -> Result<T, String> {
    res.map_err(|e| {
        tracing::error!(context = ctx, error = %e, "command error");
        e.to_string()
    })
}

pub(super) fn capture_err<E: std::fmt::Display>(cmd: &str, e: E) -> String {
    tracing::error!(command = cmd, error = %e, "command error");
    e.to_string()
}

/// Initializes app state after switching to a new config directory:
/// caches git status, starts the file watcher, resets evolve state, and lists hosts.
pub(super) fn handle_new_config_dir(
    app: &AppHandle,
    dir: &str,
) -> Result<(shared_types::EvolveState, Option<Vec<String>>), String> {
    let git_status = git::status(dir).ok();
    let changes = git_status
        .as_ref()
        .map(|s| s.changes.clone())
        .unwrap_or_default();
    if let Some(ref s) = git_status {
        crate::state::git_state::update_status(app, s.clone());
    }
    watcher::start_watching(app.clone(), dir.to_string(), 2500);
    let evolve_state = evolve_state::set(app, shared_types::EvolveState::default(), &changes)
        .map_err(|e| e.to_string())?;
    let hosts = nix::list_darwin_hosts(dir).ok();
    Ok((evolve_state, hosts))
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
