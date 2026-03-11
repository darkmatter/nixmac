//! History query: all commits on the main branch with DB metadata, summary, and build status.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn get_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<crate::types::HistoryItem>> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    let main_branch =
        crate::git::get_default_branch(&config_dir).unwrap_or_else(|| "main".to_string());

    // Fetch all commits on the main branch (no limit).
    let git_commits = crate::git::log(&config_dir, &main_branch, None)?;

    // Resolve the last-built SHA once — used to flag is_built per commit.
    let last_built_sha = crate::git::get_last_built_commit_sha(&config_dir);

    let mut entries = Vec::with_capacity(git_commits.len());

    for (i, git_commit) in git_commits.iter().enumerate() {
        let db_commit =
            crate::db::commits::get_commit_by_hash(&db_path, &git_commit.hash).unwrap_or(None);

        let summary = if let Some(ref commit) = db_commit {
            git_commits.get(i + 1).and_then(|parent| {
                crate::db::commits::get_commit_by_hash(&db_path, &parent.hash)
                    .ok()
                    .flatten()
                    .and_then(|parent_db| {
                        crate::db::summaries::get_summary_for_from(
                            &db_path,
                            commit.id,
                            parent_db.id,
                        )
                        .ok()
                        .flatten()
                    })
            })
        } else {
            None
        };

        let is_built = last_built_sha
            .as_deref()
            .map(|sha| sha == git_commit.hash)
            .unwrap_or(false);

        entries.push(crate::types::HistoryItem {
            hash: git_commit.hash.clone(),
            message: git_commit.message.clone(),
            created_at: git_commit.created_at,
            is_built,
            commit: db_commit,
            summary,
        });
    }

    Ok(entries)
}
