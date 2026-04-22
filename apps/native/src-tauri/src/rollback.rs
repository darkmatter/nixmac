//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use log::warn;
use tauri::{AppHandle, Runtime};

use crate::{
    evolve_state, git,
    shared_types::RollbackResult,
    store,
};

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    let current_evolve = evolve_state::get(app).unwrap_or_default();
    let rollback_store_path = current_evolve.rollback_store_path.clone();
    let rollback_changeset_id = current_evolve.rollback_changeset_id;

    if let Some(ref branch) = current_evolve.rollback_branch {
        let ref_name = format!("refs/heads/{}", branch);
        if git::get_ref_sha(&config_dir, &ref_name).is_some() {
            git::restore_from_branch_ref(&config_dir, &ref_name)
                .context("Failed to restore from rollback branch")?;
        } else {
            warn!(
                "[rollback] rollback branch {} not found, skipping git restore",
                branch
            );
        }
    }

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);
    let evolve_state = evolve_state::set(app, evolve_state::EvolveState::default(), &final_status.changes)
        .context("Failed to clear evolve state")?;

    Ok(RollbackResult {
        git_status: final_status,
        evolve_state,
        rollback_store_path,
        rollback_changeset_id,
    })
}
