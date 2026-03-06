//! Rollback/erase orchestration: restore uncommitted changes and return to main.

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::{
    db, find_summary, git, store,
    types::{GitStatus, SummaryResponse},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub git_status: GitStatus,
    pub summary: Option<SummaryResponse>,
}

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>, keep_branch: bool) -> Result<RollbackResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    // Capture branch name before any git changes
    let pre_status = git::status(&config_dir).context("Failed to get git status")?;
    let branch_name = pre_status.branch.clone();
    let is_on_main = branch_name
        .as_deref()
        .map(|b| b == "main" || b == "master")
        .unwrap_or(false);

    git::restore_all(&config_dir).context("Failed to restore uncommitted changes")?;

    if !is_on_main {
        git::checkout_main_branch(&config_dir).context("Failed to checkout main branch")?;
    }

    if !keep_branch {
        if let Some(branch) = branch_name.filter(|b| b != "main" && b != "master") {
            let db_path = db::get_db_path(app).context("Failed to get database path")?;
            match db::operations::delete_evolution_by_branch(&db_path, &branch) {
                Ok(()) => {
                    if let Err(e) = git::delete_branch(&config_dir, &branch) {
                        tracing::warn!("Failed to delete branch {branch}: {e}");
                    }
                }
                Err(e) => tracing::warn!("Failed to purge branch records for {branch}: {e}"),
            }
        }
    }

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    // Load main's last commit summary (what the user is landing on)
    let summary = find_summary::find_summary(app).ok().flatten();

    Ok(RollbackResult {
        git_status: final_status,
        summary,
    })
}
