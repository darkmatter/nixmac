use super::helpers::capture_err;
use crate::{peek, shared_types};
use tauri::AppHandle;

pub async fn show_preview_indicator(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::show_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_show", e))?;
    Ok(shared_types::OkResult::yes())
}

pub async fn hide_preview_indicator(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::hide_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_hide", e))?;
    Ok(shared_types::OkResult::yes())
}

pub async fn update_preview_indicator(
    app: AppHandle,
    state: shared_types::PreviewIndicatorState,
) -> Result<shared_types::OkResult, String> {
    peek::update_preview_indicator(&app, state)
        .map_err(|e| capture_err("preview_indicator_update", e))?;
    Ok(shared_types::OkResult::yes())
}

pub async fn fetch_preview_indicator_state() -> Result<shared_types::PreviewIndicatorState, String>
{
    log::debug!("preview_indicator_get_state called");
    let state = peek::get_preview_indicator_state();
    log::debug!("Current preview indicator state: {:?}", state);
    Ok(state)
}

/// Shows and focuses the main window (used by preview indicator).
#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::show_main_window(&app).map_err(|e| capture_err("show_main_window", e))?;
    Ok(shared_types::OkResult::yes())
}

#[tauri::command]
pub async fn preview_indicator_show(app: AppHandle) -> Result<shared_types::OkResult, String> {
    show_preview_indicator(app).await
}

#[tauri::command]
pub async fn preview_indicator_hide(app: AppHandle) -> Result<shared_types::OkResult, String> {
    hide_preview_indicator(app).await
}

#[tauri::command]
pub async fn preview_indicator_update(
    app: AppHandle,
    state: shared_types::PreviewIndicatorState,
) -> Result<shared_types::OkResult, String> {
    update_preview_indicator(app, state).await
}

#[tauri::command]
pub async fn preview_indicator_get_state() -> Result<shared_types::PreviewIndicatorState, String> {
    fetch_preview_indicator_state().await
}

/// Sets whether there are uncommitted changes (used by Rust to track state).
#[tauri::command]
pub async fn set_has_uncommitted_changes(
    has_changes: bool,
) -> Result<shared_types::OkResult, String> {
    peek::set_has_uncommitted_changes(has_changes);
    Ok(shared_types::OkResult::yes())
}

/// Shows the experimental spinning-mascot indicator window (creates it lazily).
#[tauri::command]
pub async fn evolve_mascot_show(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::show_evolve_mascot(&app).map_err(|e| capture_err("evolve_mascot_show", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Hides the experimental spinning-mascot indicator window.
#[tauri::command]
pub async fn evolve_mascot_hide(app: AppHandle) -> Result<shared_types::OkResult, String> {
    peek::hide_evolve_mascot(&app).map_err(|e| capture_err("evolve_mascot_hide", e))?;
    Ok(shared_types::OkResult::yes())
}
