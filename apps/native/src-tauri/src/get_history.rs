//! History query: all commits from HEAD with DB metadata and change map.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn get_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<crate::types::HistoryItem>> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    // Fetch all commits from HEAD backwards (no limit).
    let git_commits = crate::git::log(&config_dir, "HEAD", None)?;

    // Resolve the last-built SHA once — used to flag is_built per commit.
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

        let is_built = last_built_sha
            .as_deref()
            .map(|sha| sha == git_commit.hash)
            .unwrap_or(false);

        let tags = crate::git::read_tags(&config_dir, &git_commit.hash);
        let is_base = tags.iter().any(|t| t.starts_with("nixmac-base-"));
        let is_external = !tags.iter().any(|t| {
            t.starts_with("nixmac-commit-") || t.starts_with("nixmac-base-")
        });

        let file_count = change_map.as_ref().map(|cm| {
            cm.groups.iter().map(|g| g.changes.len()).sum::<usize>() + cm.singles.len()
        }).unwrap_or(0);

        entries.push(crate::types::HistoryItem {
            hash: git_commit.hash.clone(),
            message: git_commit.message.clone(),
            created_at: git_commit.created_at,
            is_built,
            is_base,
            is_external,
            file_count,
            commit: db_commit,
            change_map,
        });
    }

    Ok(entries)
}
