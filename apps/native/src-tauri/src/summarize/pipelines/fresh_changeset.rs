//! Fresh changeset pipeline — groups incoming hunks from scratch into a new semantic map.

use anyhow::Result;
use std::path::Path;
use tauri::{AppHandle, Runtime};

use crate::sqlite_types::Change;
use crate::summarize::assignments;
use crate::summarize::sumlog as dbg;
use crate::summarize::build_prompt;

pub async fn analyze<R: Runtime>(
    changes: Vec<Change>,
    app: &AppHandle<R>,
    db_path: &Path,
    commit_id: Option<i64>,
    base_commit_id: Option<i64>,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::new_log_changes(&changes);

    if changes.is_empty() {
        return Ok(None);
    }

    let config_dir = crate::store::get_config_dir(app)?;
    let Some(base_commit_id) =
        crate::db::commits::store_head_commit(db_path, &config_dir, base_commit_id)?
    else {
        return Ok(None);
    };

    let short_hashed_changes = crate::changes_from_diff::with_short_hashes(&changes);
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
        let short_hashes: Vec<String> = a.changes.iter()
            .map(|c| c.change.hash[..crate::changes_from_diff::SHORT_HASH_LEN].to_string())
            .collect();
        let resolved: Vec<&Change> = a.changes.iter().map(|c| &c.change).collect();
        a.prompt = build_prompt::new_group(&short_hashes, &resolved);
    }

    dbg::new_log_assignments(&assignments);

    if assignments.new_groups.is_empty() && assignments.new_singles.is_empty() {
        return Ok(None);
    }

    let (change_set_id, queued_ids) = crate::db::store_new_changeset::store(
        db_path,
        commit_id,
        base_commit_id,
        commit_message,
        &mut assignments,
        evolution_id,
    )?;

    if !queued_ids.is_empty() {
        let app2 = app.clone();
        let db2 = db_path.to_path_buf();
        tauri::async_runtime::spawn(async move {
            let _ = crate::summarize::queue_summarizer::process(Some(queued_ids), app2, db2).await;
        });
    }

    Ok(Some(change_set_id))
}
