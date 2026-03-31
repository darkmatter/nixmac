//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::{
    git, store,
    types::GitStatus,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub git_status: GitStatus,
}

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    git::restore_all(&config_dir).context("Failed to restore uncommitted changes")?;

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    Ok(RollbackResult {
        git_status: final_status,
    })
}
