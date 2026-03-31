//! Iterative pipeline — adapts an existing semantic map with new hunks from a changeset.

use anyhow::Result;
use std::path::Path;
use tauri::{AppHandle, Runtime};

use crate::query_return_types::SemanticChangeMap;
use crate::sqlite_types::Change;
use crate::summarize::sumlog as dbg;
use crate::summarize::{assignments, build_prompt, simplify_grouped};

pub async fn analyze<R: Runtime>(
    semantic_map: SemanticChangeMap,
    missed_changes: Vec<Change>,
    app: &AppHandle<R>,
    db_path: &Path,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::grouped_log_semantic_map(&semantic_map);
    dbg::grouped_log_missed_changes(&missed_changes);

    let simplified_map = simplify_grouped::for_hash_placement(&semantic_map);
    let simplified_json = serde_json::to_string_pretty(&simplified_map)
        .map_err(|e| anyhow::anyhow!("failed to serialize simplified map: {}", e))?;

    if missed_changes.is_empty() {
        return Ok(None);
    }

    let short_hashed_changes = crate::changes_from_diff::with_short_hashes(&missed_changes);

    let placement_refs: Vec<&_> = short_hashed_changes.iter().collect();
    let placement_prompt =
        crate::summarize::build_prompt::placement(&placement_refs, &simplified_json);
    dbg::grouped_log_placement_prompt(&placement_prompt);

    let (raw_placements, _usage) =
        crate::summarize::model_calls::map_relations_to_existing(&placement_prompt, Some(app)).await?;

    dbg::grouped_log_placement_output(&raw_placements);

    let mut assignments = assignments::reconcile(&raw_placements, &semantic_map, &missed_changes);

    for a in &mut assignments.evolved {
        let existing = a
            .existing_changes
            .iter()
            .map(simplify_grouped::from_change_with_summary)
            .collect::<Vec<_>>();
        let new_refs: Vec<&Change> = a.new_changes.iter().map(|p| &p.change).collect();
        let new_hashes: Vec<String> =
            a.new_changes.iter().map(|p| p.change.hash.clone()).collect();
        a.prompt = build_prompt::evolve_group(&existing, &new_refs, &new_hashes);
    }
    for a in &mut assignments.new_groups {
        let refs: Vec<&Change> = a.changes.iter().map(|p| &p.change).collect();
        let hashes: Vec<String> = a.changes.iter().map(|p| p.change.hash.clone()).collect();
        a.prompt = build_prompt::new_group(&hashes, &refs);
    }
    for a in &mut assignments.new_singles {
        a.prompt = build_prompt::new_single(&a.pending.change);
    }

    dbg::grouped_log_assignments(&assignments);

    let (change_set_id, queued_ids) = crate::db::store_evolved_changeset::store(
        db_path,
        commit_id,
        base_commit_id,
        commit_message,
        &mut assignments,
        &semantic_map,
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
