use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate_history_from<R: Runtime>(
    app: &AppHandle<R>,
    commit_hash: &str,
    number: usize,
) -> Result<()> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    let commits = crate::git::log(&config_dir, commit_hash, Some(number + 1))?;

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

        if crate::db::summaries::get_summary_for_from(&db_path, commit_id, base_commit_id)?
            .is_some()
        {
            continue;
        }

        let diff = crate::git::commit_diff(&config_dir, &commits[i + 1].hash, &commits[i].hash)?;

        let all_changes = crate::changes_from_diff::changes_from_diff(&diff, commits[i].created_at);

        let (sensitive_or_opaque, changes): (Vec<_>, Vec<_>) = all_changes
            .into_iter()
            .partition(crate::changes_from_diff::is_sensitive_or_opaque);

        let result = match crate::summarize_pipeline::run(
            changes,
            sensitive_or_opaque,
            commits[i].message.as_deref(),
            Some(app),
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!(
                    "[generate_history_from] pipeline failed for {}: {}",
                    commits[i].hash,
                    e
                );
                continue;
            }
        };

        if let Err(e) = crate::store_changeset::store_change_set(
            &db_path,
            Some(commit_id),
            Some(base_commit_id),
            commits[i].message.as_deref().unwrap_or(""),
            &result,
        ) {
            log::error!(
                "[generate_history_from] store_change_set failed for {}: {}",
                commits[i].hash,
                e
            );
        }
    }

    Ok(())
}
