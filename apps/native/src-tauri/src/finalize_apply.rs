//! Post-build finalization after a successful darwin-rebuild.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{build_state, evolve_state, git, store, types::GitStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub git_status: GitStatus,
    pub evolve_state: evolve_state::EvolveState,
}

async fn prepare(app: &AppHandle) -> Result<(crate::types::GitStatus, evolve_state::EvolveState)> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;
    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);
    let current_evolve = evolve_state::get(app).unwrap_or_default();
    Ok((final_status, current_evolve))
}

/// Finalize a successful darwin-rebuild.
pub async fn finalize_apply(app: &AppHandle) -> Result<ApplyResult> {
    let (final_status, mut current_evolve) = prepare(app).await?;

    if current_evolve.evolution_id.is_none() {
        // Capture the currently-active store path as the "Undo last build" target.
        let bs = build_state::get(app).ok();
        current_evolve.manual_rollback_store_path = bs.as_ref().and_then(|b| b.nixmac_built_store_path.clone());
    }

    build_state::record_build(app, &final_status).context("Failed to record build state")?;
    let evolve_state = evolve_state::set(app, current_evolve, &final_status.changes)?;
    Ok(ApplyResult { git_status: final_status, evolve_state })
}

/// Finalize a rollback store-path activation
pub async fn finalize_rollback(
    app: &AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<ApplyResult> {
    let (final_status, mut current_evolve) = prepare(app).await?;
    build_state::set_active_build(app, store_path.clone(), changeset_id, final_status.head_commit_hash.clone())
        .context("Failed to restore build state")?;
    // manual_rollback_store_path survives if distinct
    if current_evolve.manual_rollback_store_path.is_some() && current_evolve.manual_rollback_store_path == store_path {
        current_evolve.manual_rollback_store_path = None;
    }
    current_evolve.rollback_store_path = None;
    current_evolve.rollback_changeset_id = None;
    let evolve_state = evolve_state::set(app, current_evolve, &final_status.changes)?;
    Ok(ApplyResult { git_status: final_status, evolve_state })
}
