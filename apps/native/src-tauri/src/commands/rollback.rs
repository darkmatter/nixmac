use super::helpers::capture_err;
use crate::state::evolve_state;
use crate::storage::store;
use crate::{db, git, rebuild, shared_types};
use tauri::{AppHandle, Manager};

/// Restore uncommitted changes.
#[tauri::command]
pub async fn rollback_erase(app: AppHandle) -> Result<shared_types::RollbackResult, String> {
    rebuild::rollback_erase(&app).map_err(|e| capture_err("rollback_erase", e))
}

/// Dry-run build check against the current working tree. Returns `{ passed: bool, output: string }`.
#[tauri::command]
pub async fn darwin_build_check(app: AppHandle) -> Result<shared_types::BuildCheckResult, String> {
    let config_dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("darwin_build_check", e))?;
    let host_attr = store::get_host_attr(&app)
        .map_err(|e| capture_err("darwin_build_check", e))?
        .ok_or_else(|| "No host configured — cannot run build check".to_string())?;

    let (passed, stdout, stderr) = rebuild::dry_run_build_check(&config_dir, &host_attr, false)
        .map_err(|e| capture_err("darwin_build_check", e))?;

    let output = if stderr.is_empty() { stdout } else { stderr };
    Ok(shared_types::BuildCheckResult { passed, output })
}

/// Adopt pre-existing uncommitted changes as a nixmac evolution without AI.
/// Inserts a new evolution DB record and seeds EvolveState so the subsequent AI evolve
/// can link its changeset to the same evolution.
/// The caller must run `darwin_build_check` first and confirm the build passes.
#[tauri::command]
pub async fn darwin_adopt_manual_changes(app: AppHandle) -> Result<i64, String> {
    let config_dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;
    let git_status =
        git::status(&config_dir).map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;
    let branch = git_status.branch.as_deref().unwrap_or("unknown");
    let existing_id = evolve_state::get(&app).ok().and_then(|s| s.evolution_id);
    let pool = app.state::<db::DbPool>();
    let evolution_id = db::evolutions::upsert(&pool, existing_id, branch)
        .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;

    evolve_state::set(
        &app,
        shared_types::EvolveState {
            evolution_id: Some(evolution_id),
            current_changeset_id: None,
            ..Default::default()
        },
        &git_status.changes,
    )
    .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;

    log::info!(
        "[darwin_adopt_manual_changes] evolution record created | id={}",
        evolution_id
    );
    Ok(evolution_id)
}
