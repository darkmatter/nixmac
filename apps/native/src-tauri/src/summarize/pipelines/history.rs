//! Pipeline entry point for generating summaries over a historical commit range.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn from_commit_times_number<R: Runtime>(
    app: &AppHandle<R>,
    commit_hash: &str,
    number: usize,
) -> Result<()> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    let all_commits = crate::git::log(&config_dir, "HEAD", None)?;
    let start = match all_commits.iter().position(|c| c.hash == commit_hash) {
        Some(i) => i,
        None => return Ok(()),
    };
    let commits: Vec<_> = all_commits.into_iter().skip(start).take(number + 1).collect();

    if commits.is_empty() {
        return Ok(());
    }

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

    let limit = commits.len().saturating_sub(1).min(number);
    for i in 0..limit {
        let commit_id = db_ids[i];
        let base_commit_id = db_ids[i + 1];

        let diff = crate::git::commit_diff(&config_dir, &commits[i + 1].hash, &commits[i].hash)?;
        let now = crate::utils::unix_now();
        let all_changes = crate::changes_from_diff::changes_from_diff(&diff, now, true);
        let (_, changes): (Vec<_>, Vec<_>) = all_changes
            .into_iter()
            .partition(crate::changes_from_diff::is_sensitive_or_opaque);

        let diff_hashes: Vec<String> = changes.iter().map(|c| c.hash.clone()).collect();

        let found = crate::summarize::find_existing::by_base_with_hashes(
            &db_path,
            base_commit_id,
            &diff_hashes,
        )?;

        let has_changeset = found.change_set.is_some();
        let semantic_map = crate::summarize::group_existing::from_change_sets(vec![found]);

        if has_changeset && semantic_map.unsummarized_hashes.is_empty() {
            // fully covered — all changes have summaries
            continue;
        }

        if has_changeset {
            // partially covered — evolve with unsummarized changes
            let unsummarized_set: std::collections::HashSet<&str> =
                semantic_map.unsummarized_hashes.iter().map(String::as_str).collect();
            let missed_changes: Vec<_> = changes
                .into_iter()
                .filter(|c| unsummarized_set.contains(c.hash.as_str()))
                .collect();
            if let Err(e) = super::evolved_changeset::analyze(
                semantic_map,
                missed_changes,
                app,
                &db_path,
                Some(commit_id),
                base_commit_id,
                commits[i].message.as_deref(),
                None,
            )
            .await
            {
                log::error!(
                    "[history] evolved pipeline failed for {}: {}",
                    commits[i].hash,
                    e
                );
            }
        } else {
            // no changeset yet — run fresh
            if let Err(e) = super::fresh_changeset::analyze(
                changes,
                app,
                &db_path,
                Some(commit_id),
                Some(base_commit_id),
                commits[i].message.as_deref(),
                None,
            )
            .await
            {
                log::error!(
                    "[history] pipeline failed for {}: {}",
                    commits[i].hash,
                    e
                );
            }
        }
    }

    Ok(())
}
