//! Metadata generation for commit history.
//!
//! Walks back N commits from a given hash, upserts each into the DB,
//! and generates AI summaries for pairs that don't already have one.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate_history_from<R: Runtime>(
    app: &AppHandle<R>,
    commit_hash: &str,
    number: usize,
) -> Result<()> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    // Fetch number+1 commits so we have the parent of the oldest commit we want to summarise.
    let commits = crate::git::log(&config_dir, commit_hash, number + 1)?;

    if commits.is_empty() {
        return Ok(());
    }

    // Upsert all commits into the DB and collect their DB ids.
    let mut db_ids: Vec<i64> = Vec::with_capacity(commits.len());
    for commit in &commits {
        let id = crate::db::commits::upsert_commit(
            &db_path,
            &commit.hash,
            &commit.tree_hash,
            commit.message.as_deref(),
            commit.created_at,
        )?;
        db_ids.push(id);
    }

    // For each commit[i] (up to `number`), generate a summary using commits[i+1] as parent.
    let limit = commits.len().saturating_sub(1).min(number);
    for i in 0..limit {
        let commit_id = db_ids[i];
        let base_commit_id = db_ids[i + 1];

        // Skip if summary already exists for this (commit, base) pair.
        if crate::db::summaries::get_summary_for_from(&db_path, commit_id, base_commit_id)?
            .is_some()
        {
            continue;
        }

        let diff = crate::git::commit_diff(&config_dir, &commits[i + 1].hash, &commits[i].hash)?;

        let file_paths: Vec<String> = crate::git::parse_files_from_diff(&diff)
            .into_iter()
            .map(|f| f.path)
            .collect();

        let change_summary =
            match crate::summarize::summarize_changes(&diff, &file_paths, Some(app)).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!(
                        "[generate_history_from] summarize failed for {}: {}",
                        commits[i].hash,
                        e
                    );
                    continue;
                }
            };

        let items: Vec<crate::types::SummaryItem> = change_summary
            .items
            .into_iter()
            .map(|item| crate::types::SummaryItem {
                title: item.title,
                description: item.description,
            })
            .collect();

        let response = crate::types::SummaryResponse {
            items,
            instructions: change_summary.instructions,
            commit_message: String::new(),
            diff: diff.clone(),
        };

        let content_json = serde_json::to_string(&response)?;

        if let Err(e) = crate::db::summaries::insert_summary(
            &db_path,
            commit_id,
            Some(base_commit_id),
            &content_json,
            &diff,
        ) {
            log::error!(
                "[generate_history_from] insert_summary failed for {}: {}",
                commits[i].hash,
                e
            );
        }
    }

    Ok(())
}
