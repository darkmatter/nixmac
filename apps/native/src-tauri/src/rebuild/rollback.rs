//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use log::warn;
use tauri::{AppHandle, Runtime};

use crate::state::{evolve_state, git_state};
use crate::storage::store;
use crate::{
    git,
    shared_types::{EvolveSession, RollbackResult},
};

fn restore_worktree(repo_root: &str, current_evolve: &EvolveSession) -> Result<()> {
    if let Some(ref branch) = current_evolve.rollback_branch {
        let ref_name = format!("refs/heads/{}", branch);
        if git::get_ref_sha(repo_root, &ref_name).is_some() {
            // Never restore a snapshot taken on a different commit: that
            // would silently revert commits made outside this session. The
            // stale-session check in evolve_state::set clears such sessions;
            // this guards the race where one is still loaded.
            let anchor = git::backup_anchor_commit(repo_root, branch);
            let head = git::get_ref_sha(repo_root, "HEAD");
            if anchor.is_none() || anchor != head {
                anyhow::bail!(
                    "Refusing to discard: the session's backup snapshot predates \
                     commits made outside nixmac. Restart the evolve flow instead."
                );
            }
            git::restore_from_branch_ref(repo_root, &ref_name)
                .context("Failed to restore from rollback branch")?;
        } else {
            warn!(
                "[rollback] rollback branch {} not found, skipping git restore",
                branch
            );
        }
    } else if current_evolve.evolution_id.is_none() {
        // Manual drift has no evolution snapshot to restore. Discarding it
        // means restoring the index and working tree to HEAD and removing
        // non-ignored untracked files.
        git::restore_all(repo_root).context("Failed to discard manual changes")?;
    }
    Ok(())
}

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let repo_root =
        store::ensure_git_repo_folder(app).context("Failed to get git repository root")?;

    let current_evolve = evolve_state::get_session(app);
    let rollback_store_path = current_evolve.rollback_store_path.clone();
    let rollback_changeset_id = current_evolve.rollback_changeset_id;

    restore_worktree(&repo_root, &current_evolve)?;

    let final_status = git::status(&repo_root).context("Failed to get final git status")?;
    // Any rebuild-needed evaluation started before the restore describes the
    // discarded tree. Clear it and reject late results from that tree.
    git_state::invalidate_rebuild_needed(app);
    // Record the post-rollback status; the cell write emits `git_state_changed`.
    crate::state::git_state::update_status(app, final_status.clone());
    evolve_state::set_session(app, EvolveSession::default(), &final_status.changes)
        .context("Failed to clear evolve state")?;
    // The restore changed the working tree: refresh the change-map cell so the
    // mirrored map matches it (emits `change_map_changed`).
    crate::summarize::refresh_change_map(app);

    Ok(RollbackResult {
        rollback_store_path,
        rollback_changeset_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    #[test]
    fn manual_drift_discard_restores_head_and_removes_untracked_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(temp_dir.path()).unwrap();
        fs::write(temp_dir.path().join("configuration.nix"), "original\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("configuration.nix")).unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();

        fs::write(temp_dir.path().join("configuration.nix"), "changed\n").unwrap();
        fs::write(temp_dir.path().join("new-file.nix"), "untracked\n").unwrap();

        restore_worktree(temp_dir.path().to_str().unwrap(), &EvolveSession::default()).unwrap();

        assert_eq!(
            fs::read_to_string(temp_dir.path().join("configuration.nix")).unwrap(),
            "original\n"
        );
        assert!(!temp_dir.path().join("new-file.nix").exists());
    }
}
