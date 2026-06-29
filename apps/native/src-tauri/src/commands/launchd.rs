use super::helpers::{capture_err, get_hostname_and_config_dir};
use crate::{
    shared_types::{self, LaunchdItem},
    system::launchd_scanner::scan_launchd_items_for_hostname,
};
use tauri::AppHandle;

/// Scans the system for launchd items that are configured but not managed by nix.
#[tauri::command]
pub async fn scan_launchd_items(app: AppHandle) -> Result<Vec<LaunchdItem>, String> {
    // Get the configured hostname and config.
    let (hostname, config_dir) = get_hostname_and_config_dir(&app, "scan_launchd_items")?;

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
