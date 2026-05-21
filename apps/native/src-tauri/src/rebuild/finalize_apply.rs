//! Post-build finalization after a successful darwin-rebuild.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{git, shared_types};

async fn prepare(
    app: &AppHandle,
) -> Result<(crate::shared_types::GitStatus, shared_types::EvolveState)> {
    let repo_root =
        store::ensure_git_repo_exists(app).context("Failed to get git repository root")?;
    let final_status = git::status(&repo_root).context("Failed to get final git status")?;
    // fire-and-forget: best-effort cache update. `final_status` is returned directly
    // to the caller; a store write failure here must not abort the finalization.
    let _ = store::set_cached_git_status(app, &final_status);
    let current_evolve = evolve_state::get(app).unwrap_or_default();
    Ok((final_status, current_evolve))
}

/// Finalize a successful darwin-rebuild.
pub async fn finalize_apply(app: &AppHandle) -> Result<shared_types::FinalizeApplyResult> {
    let (final_status, mut current_evolve) = prepare(app).await?;

    if current_evolve.evolution_id.is_none() {
        // capture pre-build state for next rollback
        let bs = build_state::get(app).ok();
        current_evolve.rollback_store_path =
            bs.as_ref().and_then(|b| b.nixmac_built_store_path.clone());
        current_evolve.rollback_changeset_id = bs.as_ref().and_then(|b| b.changeset_id);
    }

    build_state::record_build(app, &final_status).context("Failed to record build state")?;
    let evolve_state = evolve_state::set(app, current_evolve, &final_status.changes)?;
    Ok(shared_types::FinalizeApplyResult {
        git_status: final_status,
        evolve_state,
    })
}

/// Finalize a rollback store-path activation — restores the pre-evolution build record without a new build.
pub async fn finalize_rollback(
    app: &AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<shared_types::FinalizeApplyResult> {
    let (final_status, current_evolve) = prepare(app).await?;
    build_state::set_active_build(
        app,
        store_path,
        changeset_id,
        final_status.head_commit_hash.clone(),
    )
    .context("Failed to restore build state")?;
    let evolve_state = evolve_state::set(app, current_evolve, &final_status.changes)?;
    Ok(shared_types::FinalizeApplyResult {
        git_status: final_status,
        evolve_state,
    })
}
