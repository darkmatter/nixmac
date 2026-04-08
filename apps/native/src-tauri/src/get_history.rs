//! History query: all commits from HEAD with DB metadata and change map.

use anyhow::Result;
use std::collections::HashSet;
use tauri::{AppHandle, Runtime};

pub async fn get_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<crate::shared_types::HistoryItem>> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    let git_commits = crate::git::log(&config_dir, "HEAD", None)?;

    let last_built_sha = crate::git::get_last_built_commit_sha(&config_dir);

    let mut entries = Vec::with_capacity(git_commits.len());

    for (i, git_commit) in git_commits.iter().enumerate() {
        let db_commit =
            crate::db::commits::get_commit_by_hash(&db_path, &git_commit.hash).unwrap_or(None);

        let parent_db = git_commits.get(i + 1).and_then(|parent| {
            crate::db::commits::get_commit_by_hash(&db_path, &parent.hash)
                .ok()
                .flatten()
        });

        let change_map = db_commit.as_ref().zip(parent_db.as_ref()).and_then(|(commit, parent_db)| {
            crate::summarize::find_existing::by_commit_pair(&db_path, commit.id, parent_db.id)
                .ok()
                .flatten()
                .map(|cs| crate::summarize::group_existing::from_change_sets(vec![cs.into()]))
        });

        let raw_changes = git_commits.get(i + 1).and_then(|parent| {
            crate::git::commit_diff(&config_dir, &parent.hash, &git_commit.hash)
                .ok()
                .map(|diff| crate::changes_from_diff::changes_from_diff(&diff, git_commit.created_at, true))
        }).unwrap_or_default();

        let file_count = {
            let unique: HashSet<&str> = raw_changes.iter().map(|c| c.filename.as_str()).collect();
            unique.len()
        };

        let is_built = last_built_sha
            .as_deref()
            .map(|sha| sha == git_commit.hash)
            .unwrap_or(false);

        let tags = crate::git::read_tags(&config_dir, &git_commit.hash);
        let is_base = tags.iter().any(|t| t.starts_with("nixmac-base-"));
        let is_external = !tags.iter().any(|t| {
            t.starts_with("nixmac-commit-") || t.starts_with("nixmac-base-")
        });

        entries.push(crate::shared_types::HistoryItem {
            hash: git_commit.hash.clone(),
            message: git_commit.message.clone(),
            created_at: git_commit.created_at,
            is_built,
            is_base,
            is_external,
            file_count,
            commit: db_commit,
            change_map,
            raw_changes,
        });
    }

    Ok(entries)
}
