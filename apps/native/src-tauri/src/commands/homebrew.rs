use super::helpers::capture_err;
use crate::storage::store;
use crate::{managed_edits, shared_types};
use std::path::Path;
use tauri::AppHandle;

#[tauri::command]
pub async fn homebrew_apply_diff(
    app: AppHandle,
    diff: shared_types::HomebrewState,
) -> Result<shared_types::ConfigEditApplyResult, String> {
    crate::managed_edits::homebrew_adopt::apply_homebrew_diff(&app, diff)
        .await
        .map_err(|e| capture_err("homebrew_apply_diff", e))
}

#[tauri::command]
pub async fn homebrew_get_state_diff(
    app: AppHandle,
) -> Result<shared_types::HomebrewState, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("homebrew_get_state_diff", e))?;

    managed_edits::homebrew_adopt::get_homebrew_state_diff(Path::new(&dir))
        .map_err(|e| capture_err("homebrew_get_state_diff", e))
}
