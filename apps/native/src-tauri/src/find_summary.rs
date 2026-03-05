use anyhow::Result;
use tauri::{AppHandle, Runtime};

use crate::{db, git, store, types::SummaryResponse};

/// Find the appropriate summary for the current git state in sqlite or cache.
///
/// Logic:
/// - Clean head (no uncommitted changes): look up summary in DB by HEAD commit hash
/// - Uncommitted changes: return cached summary if its diff matches.
///
/// Returns `None` if no relevant summary exists.
pub fn find_summary<R: Runtime>(app: &AppHandle<R>) -> Result<Option<SummaryResponse>> {
    let config_dir = store::get_config_dir(app)?;
    let db_path = db::get_db_path(app)?;
    let status = git::status(&config_dir)?;

    if status.clean_head {
        if let Some(hash) = &status.head_commit_hash {
            return db::summaries::get_summary_by_commit_hash(&db_path, hash);
        }
        return Ok(None);
    }

    if let Some(cached) = store::get_cached_summary(app).ok().flatten() {
        if cached.diff == status.diff {
            return Ok(Some(cached));
        }
    }

    Ok(None)
}
