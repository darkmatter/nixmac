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
            // Never restore a snapshot taken on a different commit: that
            // would silently revert commits made outside this session. The
            // stale-session check in evolve_state::set clears such sessions;
            // this guards the race where one is still loaded.
            let anchor = git::backup_anchor_commit(&repo_root, branch);
            let head = git::get_ref_sha(&repo_root, "HEAD");
            if anchor.is_none() || anchor != head {
                anyhow::bail!(
                    "Refusing to discard: the session's backup snapshot predates \
                     commits made outside nixmac. Restart the evolve flow instead."
                );
            }
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
