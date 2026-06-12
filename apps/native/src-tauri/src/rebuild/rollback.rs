//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use log::warn;
use tauri::{AppHandle, Runtime};

use crate::state::evolve_state;
use crate::storage::store;
use crate::{
    git,
    shared_types::{EvolveState, RollbackResult},
};

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let repo_root =
        store::ensure_git_repo_folder(app).context("Failed to get git repository root")?;

    let current_evolve = evolve_state::get(app).unwrap_or_default();
    let rollback_store_path = current_evolve.rollback_store_path.clone();
    let rollback_changeset_id = current_evolve.rollback_changeset_id;

    if let Some(ref branch) = current_evolve.rollback_branch {
        let ref_name = format!("refs/heads/{}", branch);
        if git::get_ref_sha(&repo_root, &ref_name).is_some() {
            git::restore_from_branch_ref(&repo_root, &ref_name)
                .context("Failed to restore from rollback branch")?;
        } else {
            warn!(
                "[rollback] rollback branch {} not found, skipping git restore",
                branch
            );
        }
    }

    let final_status = git::status(&repo_root).context("Failed to get final git status")?;
    // Record the post-rollback status; the cell write emits `git_state_changed`.
    crate::state::git_state::update_status(app, final_status.clone());
    evolve_state::set(app, EvolveState::default(), &final_status.changes)
        .context("Failed to clear evolve state")?;
    // The restore changed the working tree: refresh the change-map cell so the
    // mirrored map matches it (emits `change_map_changed`).
    crate::summarize::refresh_change_map(app);

    Ok(RollbackResult {
        rollback_store_path,
        rollback_changeset_id,
    })
}
