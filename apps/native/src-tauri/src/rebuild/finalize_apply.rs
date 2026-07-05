//! Post-build finalization after a successful darwin-rebuild.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{git, shared_types};

async fn prepare(
    app: &AppHandle,
) -> Result<(crate::shared_types::GitStatus, shared_types::EvolveSession)> {
    let repo_root =
        store::ensure_git_repo_folder(app).context("Failed to get git repository root")?;
    let final_status = git::status(&repo_root).context("Failed to get final git status")?;
    // Record the post-build status; the cell write emits `git_state_changed`.
    crate::state::git_state::update_status(app, final_status.clone());
    let current_evolve = evolve_state::get_session(app);
    Ok((final_status, current_evolve))
}

/// Finalize a successful darwin-rebuild. State flows through the cell events
/// (`git_state_changed` from `prepare`, `evolve_state_changed` from the set).
pub async fn finalize_apply(app: &AppHandle) -> Result<()> {
    let (final_status, mut current_evolve) = prepare(app).await?;

    if current_evolve.evolution_id.is_none() {
        // capture pre-build state for next rollback
        let bs = build_state::get(app).ok();
        current_evolve.rollback_store_path =
            bs.as_ref().and_then(|b| b.nixmac_built_store_path.clone());
        current_evolve.rollback_changeset_id = bs.as_ref().and_then(|b| b.changeset_id);
    }

    build_state::record_build(app, &final_status).context("Failed to record build state")?;
    // Mark onboarding's "first build/evolution" gate as satisfied. Best-effort:
    // a bookkeeping failure must not turn a successful build into a failed apply.
    if crate::state::preferences::try_read(app).is_some() {
        if let Err(error) = crate::state::preferences::write(app, |prefs| {
            prefs.onboarding_last_build_at = Some(crate::utils::unix_now());
            // The applied config is live now: onboarding's ownership of the
            // materialized directory ends, restart must never delete it.
            prefs.onboarding_provisional_config_dir = None;
        }) {
            log::warn!("Failed to record onboarding build timestamp: {error:#}");
        }
    }
    evolve_state::set_session(app, current_evolve, &final_status.changes)?;
    Ok(())
}

/// Finalize a rollback store-path activation — restores the pre-evolution build record without a new build.
pub async fn finalize_rollback(
    app: &AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<()> {
    let (final_status, current_evolve) = prepare(app).await?;
    build_state::set_active_build(
        app,
        store_path,
        changeset_id,
        final_status.head_commit_hash.clone(),
    )
    .context("Failed to restore build state")?;
    evolve_state::set_session(app, current_evolve, &final_status.changes)?;
    // The rollback restored an earlier tree: refresh the change-map cell so
    // the mirrored map matches it (emits `change_map_changed`).
    crate::summarize::refresh_change_map(app);
    Ok(())
}
