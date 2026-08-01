//! Pipeline entry point for generating summaries over a historical commit range.

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

use crate::sqlite_types::Change;

/// Summarize `number` commits starting at `commit_hash` (newest-first),
/// diffing each commit against its parent.
///
/// This walks only the commits in the requested window via
/// [`crate::git::query::log_from_commit`], avoiding the full-log scan the
/// previous implementation performed.
pub async fn from_commit_times_number<R: Runtime>(
    app: &AppHandle<R>,
    commit_hash: &str,
    number: usize,
) -> Result<()> {
    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();

    // `log_from_commit` returns up to `number + 1` commits (the extra one is
    // the parent used as the diff base for the oldest commit in the window).
    let commits = crate::git::query::log_from_commit(&config_dir, commit_hash, number)?;
    if commits.len() < 2 {
        return Ok(());
    }

    let limit = commits.len().saturating_sub(1).min(number);
    for i in 0..limit {
        let file_diffs =
            crate::git::query::commit_diff(&config_dir, &commits[i + 1].hash, &commits[i].hash)?;

        let now = crate::utils::unix_now();

        let all_changes: Vec<Change> = file_diffs
            .into_iter()
            .map(|d| crate::git::file_diff_to_change(d, now, true))
            .collect();

        if all_changes.is_empty() {
            continue;
        }

        // Summaries are content-addressed by change hash, so a commit's summary
        // is reconstructed purely from its changes — no commit rows needed.
        let found = crate::summarize::find_existing::for_changes(&pool, &all_changes)?;

        if found.map.unsummarized_hashes.is_empty() {
            continue;
        }

        let unsummarized_set: std::collections::HashSet<&str> = found
            .map
            .unsummarized_hashes
            .iter()
            .map(String::as_str)
            .collect();
        let changes_to_summarize: Vec<_> = all_changes
            .into_iter()
            .filter(|c| unsummarized_set.contains(c.hash.as_str()))
            .collect();

        if changes_to_summarize.is_empty() {
            continue;
        }

        if let Err(e) = super::whole_diff::analyze(changes_to_summarize, app, None, None).await {
            log::error!("[history] pipeline failed for {}: {}", commits[i].hash, e);
        }
    }

    Ok(())
}
