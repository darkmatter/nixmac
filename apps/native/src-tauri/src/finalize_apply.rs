//! Post-build finalization after a successful darwin-rebuild.
//!
//! Tags HEAD as built and returns the final git status.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::{git, store, types::GitStatus};

/// Finalize a successful darwin-rebuild.
pub async fn finalize_apply(app: &AppHandle) -> Result<GitStatus> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    git::tag_as_built(&config_dir).context("Failed to tag HEAD as built")?;

    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    Ok(final_status)
}
