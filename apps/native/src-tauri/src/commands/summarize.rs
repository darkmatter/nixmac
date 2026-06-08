use super::helpers::capture_err;
use crate::storage::store;
use crate::{git, rebuild};
use tauri::AppHandle;

#[tauri::command]
pub async fn find_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    let base_ref = crate::summarize::active_summary_base_ref(&app);
    crate::summarize::change_map_since(&app, &base_ref)
        .map_err(|e| capture_err("find_change_map", e))
}

/// Walks back `number` commits from `commit_hash`,
/// upserts missing metadata (commits and summaries).
#[tauri::command]
pub async fn generate_history_from(
    app: AppHandle,
    commit_hash: String,
    number: usize,
) -> Result<(), String> {
    crate::summarize::pipelines::history::from_commit_times_number(&app, &commit_hash, number)
        .await
        .map_err(|e| capture_err("generate_history_from", e))
}

/// Summarizes the current working state, running the from-scratch pipeline if
/// no existing summaries are found, or grouping and simplifying existing ones.
/// Returns the updated SemanticChangeMap so the frontend can apply it immediately.
#[tauri::command]
pub async fn summarize_current(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    crate::summarize::new_changeset(&app, None)
        .await
        .map_err(|e| capture_err("summarize_current", e))?;
    crate::summarize::change_map_since(&app, "HEAD")
        .map_err(|e| capture_err("summarize_current", e))
}

/// Returns all commits on the main branch, each paired with optional DB metadata, summary,
/// and build/head status.
#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<Vec<crate::shared_types::HistoryItem>, String> {
    crate::history::get_history(&app)
        .await
        .map_err(|e| capture_err("get_history", e))
}

/// Checks out `target_hash` for history restore rebuild
#[tauri::command]
pub async fn prepare_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("prepare_restore", e))?;
    git::checkout_files_at_commit(&config_dir, &target_hash)
        .map_err(|e| capture_err("prepare_restore", e))?;
    crate::history::historelog::log_prepare(&config_dir);
    Ok(())
}

#[tauri::command]
pub async fn abort_restore(app: AppHandle) -> Result<(), String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("abort_restore", e))?;
    git::restore_all(&config_dir).map_err(|e| capture_err("abort_restore", e))?;
    crate::history::historelog::log_abort(&config_dir);
    Ok(())
}

/// Commits, tags and stores on successful history restore, then records build state.
#[tauri::command]
pub async fn finalize_restore(
    app: AppHandle,
    target_hash: String,
) -> Result<crate::shared_types::GitStatus, String> {
    rebuild::finalize_restore(&app, target_hash)
        .await
        .map_err(|e| capture_err("finalize_restore", e))
}

/// Generates a commit message from the current semantic change map via the pipeline.
#[tauri::command]
pub async fn generate_commit_message(app: AppHandle) -> Result<String, String> {
    crate::summarize::pipelines::commit_message::generate(&app)
        .await
        .map_err(|e| capture_err("generate_commit_message", e))
}
