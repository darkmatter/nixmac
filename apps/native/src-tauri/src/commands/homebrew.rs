use super::helpers::{capture_err, get_hostname_and_config_dir};
use crate::{managed_edits, shared_types};
use std::path::Path;
use tauri::AppHandle;

#[tauri::command]
pub async fn homebrew_apply_diff(
    app: AppHandle,
    diff: shared_types::HomebrewState,
) -> Result<shared_types::ConfigEditApplyResult, String> {
    let (hostname, _) = get_hostname_and_config_dir(&app, "homebrew_apply_diff")?;

    crate::managed_edits::homebrew_adopt::apply_homebrew_diff(&app, &hostname, diff)
        .await
        .map_err(|e| capture_err("homebrew_apply_diff", e))
}

#[tauri::command]
pub async fn homebrew_get_state_diff(
    app: AppHandle,
) -> Result<shared_types::HomebrewState, String> {
    let (hostname, dir) = get_hostname_and_config_dir(&app, "homebrew_get_state_diff")?;

    managed_edits::homebrew_adopt::get_homebrew_state_diff(Path::new(&dir), &hostname)
        .map_err(|e| capture_err("homebrew_get_state_diff", e))
}

#[tauri::command]
pub async fn homebrew_add_items(
    app: AppHandle,
    items: Vec<shared_types::HomebrewItem>,
) -> Result<shared_types::ConfigEditApplyResult, String> {
    crate::managed_edits::homebrew_adopt::add_homebrew_items(&app, items)
        .await
        .map_err(|e| capture_err("homebrew_add_items", e))
}
