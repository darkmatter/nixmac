//! Post-build finalization after a successful darwin-rebuild.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{evolve_state, git, store, types::GitStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub git_status: GitStatus,
    pub evolve_state: evolve_state::EvolveState,
}

/// Finalize a successful darwin-rebuild.
pub async fn finalize_apply(app: &AppHandle) -> Result<ApplyResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    git::tag_as_built(&config_dir).context("Failed to tag HEAD as built")?;

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    let mut es = evolve_state::get(app).unwrap_or_default();
    es.changeset_at_build = es.current_changeset_id;
    es.committable = true;
    let evolve_state = evolve_state::set(app, es)?;

    Ok(ApplyResult {
        git_status: final_status,
        evolve_state,
    })
}
