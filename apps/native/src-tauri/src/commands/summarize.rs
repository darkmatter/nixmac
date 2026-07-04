use super::helpers::capture_err;
use crate::storage::store;
use crate::{git, rebuild};
use tauri::AppHandle;

pub async fn fetch_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    if let Some(map) = crate::state::change_map::get(&app) {
        return Ok(map);
    }
    let base_ref = crate::summarize::active_summary_base_ref(&app);
    let map = crate::summarize::change_map_since(&app, &base_ref)
        .map_err(|e| capture_err("get_change_map", e))?;
    crate::state::change_map::update(&app, map.clone());
    Ok(map)
}

pub async fn refresh_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    let base_ref = crate::summarize::active_summary_base_ref(&app);
    let map = crate::summarize::change_map_since(&app, &base_ref)
        .map_err(|e| capture_err("find_change_map", e))?;
    crate::state::change_map::update(&app, map.clone());
    Ok(map)
}

pub async fn run_generate_history_from(
    app: AppHandle,
    commit_hash: String,
    number: usize,
) -> Result<(), String> {
    crate::summarize::pipelines::history::from_commit_times_number(&app, &commit_hash, number)
        .await
        .map_err(|e| capture_err("generate_history_from", e))
}

pub async fn run_summarize_current(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    crate::summarize::new_changeset(&app, None)
        .await
        .map_err(|e| capture_err("summarize_current", e))?;
    let map = crate::summarize::change_map_since(&app, "HEAD")
        .map_err(|e| capture_err("summarize_current", e))?;
    crate::state::change_map::update(&app, map.clone());
    Ok(map)
}

pub async fn fetch_history(
    app: AppHandle,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<crate::shared_types::HistoryPage, String> {
    crate::history::get_history(&app, limit, offset)
        .await
        .map_err(|e| capture_err("get_history", e))
}

pub async fn run_prepare_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("prepare_restore", e))?;
    git::checkout_files_at_commit(&config_dir, &target_hash)
        .map_err(|e| capture_err("prepare_restore", e))?;
    crate::history::historelog::log_prepare(&config_dir);
    Ok(())
}

pub async fn run_abort_restore(app: AppHandle) -> Result<(), String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("abort_restore", e))?;
    git::restore_all(&config_dir).map_err(|e| capture_err("abort_restore", e))?;
    crate::history::historelog::log_abort(&config_dir);
    Ok(())
}

pub async fn run_finalize_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    rebuild::finalize_restore(&app, target_hash)
        .await
        .map(|_| ())
        .map_err(|e| capture_err("finalize_restore", e))
}

pub async fn run_generate_commit_message(app: AppHandle) -> Result<String, String> {
    crate::summarize::pipelines::commit_message::generate(&app)
        .await
        .map_err(|e| capture_err("generate_commit_message", e))
}

#[tauri::command]
pub async fn get_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    fetch_change_map(app).await
}

#[tauri::command]
pub async fn find_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    refresh_change_map(app).await
}

#[tauri::command]
pub async fn generate_history_from(
    app: AppHandle,
    commit_hash: String,
    number: usize,
) -> Result<(), String> {
    run_generate_history_from(app, commit_hash, number).await
}

#[tauri::command]
pub async fn summarize_current(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    run_summarize_current(app).await
}

#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<crate::shared_types::HistoryPage, String> {
    fetch_history(app, None, None).await
}

#[tauri::command]
pub async fn prepare_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    run_prepare_restore(app, target_hash).await
}

#[tauri::command]
pub async fn abort_restore(app: AppHandle) -> Result<(), String> {
    run_abort_restore(app).await
}

#[tauri::command]
pub async fn finalize_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    run_finalize_restore(app, target_hash).await
}

#[tauri::command]
pub async fn generate_commit_message(app: AppHandle) -> Result<String, String> {
    run_generate_commit_message(app).await
}
