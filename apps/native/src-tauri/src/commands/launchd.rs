use super::helpers::capture_err;
use crate::{
    shared_types::LaunchdItem,
    system::{launchd_scanner::scan_launchd_items_for_hostname, nix::determine_host_attr},
};
use tauri::AppHandle;

/// Scans the system for launchd items that are configured but not managed by nix.
#[tauri::command]
pub async fn scan_launchd_items(app: AppHandle) -> Result<Vec<LaunchdItem>, String> {
    // 0. Get the configured hostname.
    let hostname = determine_host_attr(&app).unwrap_or_default();

    // If we didn't get a hostname back, skip the scan.
    if hostname.is_empty() {
        log::warn!("No hostname configured, skipping launchd scan");
        return Ok(vec![]);
    }

    scan_launchd_items_for_hostname(&hostname).map_err(|e| capture_err("scan_launchd_items", e))
}
