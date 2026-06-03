//! Fresh changeset pipeline — groups incoming hunks from scratch into a new semantic map.

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

use crate::sqlite_types::Change;
use crate::summarize::assignments;
use crate::summarize::build_prompt;
use crate::summarize::sumlog as dbg;

pub async fn analyze<R: Runtime>(
    changes: Vec<Change>,
    app: &AppHandle<R>,
    commit_id: Option<i64>,
    base_commit_id: Option<i64>,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::new_log_changes(&changes);

    if changes.is_empty() {
        return Ok(None);
    }

    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();
    let Some(base_commit_id) =
        crate::db::commits::store_head_commit_in_pool(&pool, &config_dir, base_commit_id)?
    else {
        return Ok(None);
    };

    let short_hashed_changes = crate::git::changes_from_diff::with_short_hashes(&changes);
    let refs: Vec<&Change> = short_hashed_changes.iter().collect();
    let prompt = build_prompt::new_map(&refs);
    dbg::new_log_prompt(&prompt);

    let (entries, _usage) =
        crate::summarize::model_calls::map_relations(&prompt, Some(app)).await?;
    dbg::new_log_map_output(&entries);

    let mut assignments = assignments::new(&entries, &changes);

    for a in &mut assignments.new_singles {
        a.prompt = build_prompt::new_single(&a.pending.change);
    }
    for a in &mut assignments.new_groups {
        let short_hashes: Vec<String> = a
            .changes
            .iter()
            .map(|c| c.change.hash[..crate::git::changes_from_diff::SHORT_HASH_LEN].to_string())
            .collect();
        let resolved: Vec<&Change> = a.changes.iter().map(|c| &c.change).collect();
        a.prompt = build_prompt::new_group(&short_hashes, &resolved);
    }

    dbg::new_log_assignments(&assignments);

    if assignments.new_groups.is_empty() && assignments.new_singles.is_empty() {
        return Ok(None);
    }

    let (change_set_id, queued_ids) = crate::db::store_new_changeset::store(
        &pool,
        commit_id,
        base_commit_id,
        commit_message,
        &mut assignments,
        evolution_id,
    )?;

    if !queued_ids.is_empty() {
        if let Some(summarizer) =
            app.try_state::<crate::summarize::queue_summarizer::SummarizerState>()
        {
            summarizer.enqueue_ids(queued_ids).await?;
        } else {
            crate::summarize::queue_summarizer::process(
                Some(queued_ids),
                app.clone(),
                pool.inner().clone(),
            )
            .await?;
        }
    }

    Ok(Some(change_set_id))
}
