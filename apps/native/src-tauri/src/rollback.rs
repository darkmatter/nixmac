//! Rollback/erase orchestration: restore uncommitted changes.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::{
    evolve_state, git, store,
    types::GitStatus,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub git_status: GitStatus,
    pub evolve_state: evolve_state::EvolveState,
}

pub fn rollback_erase<R: Runtime>(app: &AppHandle<R>) -> Result<RollbackResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    git::restore_all(&config_dir).context("Failed to restore uncommitted changes")?;

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    let evolve_state = evolve_state::clear(app).context("Failed to clear evolve state")?;

    Ok(RollbackResult {
        git_status: final_status,
        evolve_state,
    })
}
