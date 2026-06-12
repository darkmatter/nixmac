use super::helpers::capture_err;
use crate::state::evolve_state;
use crate::storage::store;
use crate::{git, shared_types};
use tauri::AppHandle;

#[tauri::command]
pub async fn get_evolve_state(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    let state = evolve_state::get(&app).map_err(|e| capture_err("get_evolve_state", e))?;
    // Recompute step from live git status to surface manual changes
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("get_evolve_state", e))?;
    let changes = git::status(&dir).map(|s| s.changes).unwrap_or_default();
    evolve_state::set(&app, state, &changes).map_err(|e| capture_err("get_evolve_state", e))
}

/// Clear evolve state back to idle (called after a successful git commit).
#[tauri::command]
pub async fn clear_evolve_state(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    evolve_state::clear(&app).map_err(|e| capture_err("clear_evolve_state", e))
}

// DEPRECATED: compat aliases for the renamed commands above; delete in
// Stage 5 of docs/2026-06-12-viewmodel-completion-plan.md.

#[tauri::command]
pub async fn routing_state_get(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    get_evolve_state(app).await
}

#[tauri::command]
pub async fn routing_state_clear(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    clear_evolve_state(app).await
}
