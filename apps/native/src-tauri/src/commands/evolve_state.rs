use super::helpers::capture_err;
use crate::state::evolve_state;
use crate::storage::store;
use crate::{git, shared_types};
use tauri::AppHandle;

#[tauri::command]
pub async fn get_evolve_state(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    // Derive the projection from live git status; `refresh` recomputes
    // step/committable and emits `evolve_state_changed`.
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("get_evolve_state", e))?;
    let changes = git::status(&dir).map(|s| s.changes).unwrap_or_default();
    Ok(evolve_state::refresh(&app, &changes))
}

/// Clear evolve state back to idle (called after a successful git commit).
#[tauri::command]
pub async fn clear_evolve_state(app: AppHandle) -> Result<shared_types::EvolveState, String> {
    evolve_state::clear(&app).map_err(|e| capture_err("clear_evolve_state", e))
}
