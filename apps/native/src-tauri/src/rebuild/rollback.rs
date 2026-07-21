//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use log::warn;
use tauri::{AppHandle, Runtime};

use crate::state::evolve_state;
use crate::storage::store;
use crate::{
    git,
    shared_types::{EvolveSession, RollbackResult},
};

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let repo_root =
        store::ensure_git_repo_folder(app).context("Failed to get git repository root")?;

    let current_evolve = evolve_state::get_session(app);
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
    } else {
        // No session snapshot — the changes are manual drift. Discarding means
        // restoring the working tree to HEAD, same as the per-file discard but
        // across the repository.
        git::restore_all(&repo_root).context("Failed to restore working tree to HEAD")?;
    }

    let final_status = git::status(&repo_root).context("Failed to get final git status")?;
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
    use crate::observable::Observable;
    use crate::shared_types::GlobalPreferences;
    use std::fs;
    use std::path::Path;
    use tauri::Manager;
    use tempfile::TempDir;

    /// Mock app with everything `rollback_erase` touches managed: preferences
    /// pointing at `repo_dir`, the given evolve session, the git/change-map
    /// cells, and a temp-file DbPool for the change-map refresh.
    fn mock_app(
        repo_dir: &Path,
        session: EvolveSession,
        db_dir: &Path,
    ) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds");
        let repo = repo_dir.to_string_lossy().to_string();
        app.manage(Observable::new(GlobalPreferences {
            config_dir: Some(repo.clone()),
            repo_root: Some(repo),
            ..GlobalPreferences::default()
        }));
        app.manage(Observable::new(session));
        app.manage(crate::state::git_state::load_observable(app.handle()));
        app.manage(crate::state::change_map::load_observable(app.handle()));
        let pool =
            tauri::async_runtime::block_on(crate::db::init_pool_at_path(&db_dir.join("nixmac.db")))
                .expect("test db pool");
        app.manage(pool);
        app
    }

    #[test]
    fn discards_manual_drift_without_a_session_snapshot() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        crate::git::init::init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        git::commit_all(&repo_dir_str, "initial").unwrap();

        // Manual drift: a tracked edit plus an untracked file, no evolve session.
        fs::write(repo_dir.join("flake.nix"), "{ drift = true; }\n").unwrap();
        fs::write(repo_dir.join("untracked.nix"), "{ }\n").unwrap();

        let app = mock_app(&repo_dir, EvolveSession::default(), temp_dir.path());
        let result = rollback_erase(app.handle()).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ }\n",
            "tracked drift is restored to HEAD"
        );
        assert!(
            !repo_dir.join("untracked.nix").exists(),
            "untracked drift is removed"
        );
        assert!(
            git::status(&repo_dir_str).unwrap().changes.is_empty(),
            "worktree is clean after discard"
        );
        assert_eq!(result.rollback_store_path, None);
        assert_eq!(result.rollback_changeset_id, None);
    }

    #[test]
    fn restores_the_session_snapshot_instead_of_head_when_one_exists() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        crate::git::init::init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ base = true; }\n").unwrap();
        git::commit_all(&repo_dir_str, "initial").unwrap();

        // Snapshot the session state (change A), then drift further past it.
        fs::write(repo_dir.join("flake.nix"), "{ a = true; }\n").unwrap();
        let branch = git::create_evolution_backup(&repo_dir_str, Some(1), 1)
            .unwrap()
            .expect("backup branch created");
        fs::write(repo_dir.join("flake.nix"), "{ b = true; }\n").unwrap();
        fs::write(repo_dir.join("untracked.nix"), "{ }\n").unwrap();

        let session = EvolveSession {
            rollback_branch: Some(branch),
            ..EvolveSession::default()
        };
        let app = mock_app(&repo_dir, session, temp_dir.path());
        rollback_erase(app.handle()).unwrap();

        // The snapshot (A), not HEAD (base): proves the restore-all fallback
        // didn't take over the session path.
        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ a = true; }\n",
            "session discard restores the snapshot, not HEAD"
        );
        assert!(
            !repo_dir.join("untracked.nix").exists(),
            "files not in the snapshot are removed"
        );
    }
}
