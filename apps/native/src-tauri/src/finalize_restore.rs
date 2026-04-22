//! Post-restore finalization: commit, tag, record in DB, then record build state.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::{build_state, db, git, store, types::GitStatus};

/// Finalize a successful history restore.
///
/// Commits the restored files, tags the commit, links it to its origin in the
/// DB, and records build state (replaces the old `git::tag_as_built` call).
pub async fn finalize_restore(app: &AppHandle, target_hash: String) -> Result<GitStatus> {
    let config_dir = store::get_config_dir(app).context("Failed to get config directory")?;

    let label = &target_hash[..target_hash.len().min(8)];
    let info = git::commit_all(&config_dir, &format!("Restore commit {label}"))
        .context("Failed to commit restored files")?;

    crate::historelog::log_finalize(&info.hash);

    if let Err(e) = git::tag_commit(
        &config_dir,
        &format!("nixmac-commit-{}", &info.hash[..8]),
        &info.hash,
        false,
    ) {
        log::warn!("[finalize_restore] Failed to tag commit: {}", e);
    }

    // Record restore origin in DB
    if let Ok(db_path) = db::get_db_path(app) {
        let commit_hash = info.hash.clone();
        let origin = target_hash.clone();
        match tokio::task::spawn_blocking(move || {
            db::restore_commits::insert(&db_path, &commit_hash, &origin)
        })
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log::warn!("[finalize_restore] Failed to record restore origin: {}", e),
            Err(e) => log::warn!("[finalize_restore] Failed to record restore origin (panic): {}", e),
        }
    }

    let git_status = git::status(&config_dir).context("Failed to get git status after restore")?;
    let _ = store::set_cached_git_status(app, &git_status);

    build_state::record_build(app, &git_status)
        .context("Failed to record build state after restore")?;

    Ok(git_status)
}
