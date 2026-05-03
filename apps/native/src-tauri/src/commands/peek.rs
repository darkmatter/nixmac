use super::helpers::capture_err;
use crate::{peek, shared_types};
use tauri::AppHandle;

/// Shows and focuses the main window (used by preview indicator).
#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::show_main_window(&app).map_err(|e| capture_err("show_main_window", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Shows the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_show(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::show_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_show", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Hides the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_hide(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::hide_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_hide", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Updates the preview indicator state.
#[tauri::command]
pub async fn preview_indicator_update(
    app: AppHandle,
    state: shared_types::PreviewIndicatorState,
) -> Result<shared_types::OkResult, String> {
    peek::update_preview_indicator(&app, state)
        .map_err(|e| capture_err("preview_indicator_update", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Sets whether there are uncommitted changes (used by Rust to track state).
#[tauri::command]
pub async fn set_has_uncommitted_changes(
    has_changes: bool,
) -> Result<shared_types::OkResult, String> {
    peek::set_has_uncommitted_changes(has_changes);
    Ok(shared_types::OkResult::yes())
}

/// Gets the current preview indicator state (for window to call on mount).
#[tauri::command]
pub async fn preview_indicator_get_state() -> Result<shared_types::PreviewIndicatorState, String> {
    log::debug!("preview_indicator_get_state called");
    let state = peek::get_preview_indicator_state();
    log::debug!("Current preview indicator state: {:?}", state);
    Ok(state)
}
