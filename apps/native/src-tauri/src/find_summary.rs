use anyhow::Result;
use tauri::{AppHandle, Runtime};

use crate::{db, git, store, types::SummaryResponse};

/// set to true for some debug logging
const VERBOSE: bool = false;

macro_rules! log {
    ($($arg:tt)*) => {
        if VERBOSE {
            eprintln!("[find_summary] {}", format!($($arg)*));
        }
    };
}

/// Find the appropriate summary for the current git state in sqlite or cache.
///
/// Logic:
/// - Clean head: look up summary in DB by HEAD commit hash; if not found, fall through to cache check
/// - Otherwise: return cached summary if its diff matches.
///
/// Returns `None` if no relevant summary exists.
pub fn find_summary<R: Runtime>(app: &AppHandle<R>) -> Result<Option<SummaryResponse>> {
    let config_dir = store::get_config_dir(app)?;
    let db_path = db::get_db_path(app)?;
    let status = git::status(&config_dir)?;

    log!(
        "clean_head={} head={:?}",
        status.clean_head,
        status.head_commit_hash
    );

    if status.clean_head {
        if let Some(hash) = &status.head_commit_hash {
            let result = db::summaries::get_summary_by_commit_hash(&db_path, hash)?;
            log!(
                "db lookup for {hash}: {}",
                if result.is_some() {
                    "found"
                } else {
                    "not found"
                }
            );
            if result.is_some() {
                return Ok(result);
            }
        }
    }

    if let Some(cached) = store::get_cached_summary(app).ok().flatten() {
        if cached.diff == status.diff {
            return Ok(Some(cached));
        }
        log!(
            "cached diff mismatch\n--- cached ({} bytes) ---\n{}\n--- current ({} bytes) ---\n{}",
            cached.diff.len(),
            cached.diff,
            status.diff.len(),
            status.diff
        );
    }

    Ok(None)
}
