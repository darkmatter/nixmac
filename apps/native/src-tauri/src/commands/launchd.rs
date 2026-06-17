use super::helpers::capture_err;
use crate::{
    shared_types::{self, LaunchdItem},
    storage::store,
    system::{launchd_scanner::scan_launchd_items_for_hostname, nix::determine_host_attr},
};
use tauri::AppHandle;

// Helper function to extract the hostname and config_dir from the app handle, returning an error if either is missing.
fn get_hostname_and_config_dir(app: &AppHandle, cmd: &str) -> Result<(String, String), String> {
    let hostname = determine_host_attr(app).unwrap_or_default();
    let config_dir: String =
        store::ensure_config_dir_exists(app).map_err(|e| capture_err(cmd, e))?;

    if hostname.is_empty() {
        log::warn!("No hostname configured, skipping launchd scan");
        return Err("No hostname configured".to_string());
    }

    Ok((hostname, config_dir))
}

/// Scans the system for launchd items that are configured but not managed by nix.
#[tauri::command]
pub async fn scan_launchd_items(app: AppHandle) -> Result<Vec<LaunchdItem>, String> {
    // 0. Get the configured hostname and config.
    let (hostname, config_dir) = get_hostname_and_config_dir(&app, "scan_launchd_items")?;

    // If we didn't get a hostname back, skip the scan.
    if hostname.is_empty() {
        log::warn!("No hostname configured, skipping launchd scan");
        return Ok(vec![]);
    }

    // Run on a blocking thread since it invokes blocking subprocesses (nix, brew).
    tauri::async_runtime::spawn_blocking(move || {
        scan_launchd_items_for_hostname(&hostname, &config_dir)
            .map_err(|e| capture_err("scan_launchd_items", e))
    })
    .await
    .map_err(|e| capture_err("scan_launchd_items", e))?
}

// Applies the given launchd items to the system to be managed by nix.
#[tauri::command]
pub async fn apply_launchd_items(
    app: AppHandle,
    items: Vec<LaunchdItem>,
) -> Result<shared_types::ConfigEditApplyResult, String> {
    // 0. Get the configured hostname and config.
    let (_hostname, _config_dir) = get_hostname_and_config_dir(&app, "apply_launchd_items")?;

    crate::system::launchd_scanner::apply_launchd_items_to_flake(&app, items)
        .await
        .map_err(|e| capture_err("apply_launchd_items", e))
}
