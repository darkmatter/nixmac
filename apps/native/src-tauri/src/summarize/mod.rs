//! Summarization module — AI model calls and pipelines for change analysis and changeset generation.

pub mod assignments;
pub mod build_prompt;
pub mod find_existing;
pub mod group_existing;
pub mod model_calls;
pub mod model_output_types;
pub mod pipelines;
pub mod queue_summarizer;
pub mod simplify_grouped;
pub mod sumlog;
pub mod token_budgets;

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

pub async fn new_changeset<R: Runtime>(
    app: &AppHandle<R>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    let db_path = crate::db::get_db_path(app)?;
    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();

    let status = crate::git::status(&config_dir)?;

    let all_changes = status.changes;
    if all_changes.is_empty() {
        return Ok(None);
    }

    let existing = find_existing::for_current_state(&pool, &db_path, &config_dir)?;

    if !existing.iter().any(|e| e.change_set.is_some()) {
        return pipelines::fresh_changeset::analyze(
            all_changes,
            app,
            &db_path,
            None,
            None,
            None,
            evolution_id,
        )
        .await;
    }

    let existing_id = existing
        .iter()
        .filter_map(|e| e.change_set.as_ref().map(|cs| cs.id))
        .next();

    let semantic_map = group_existing::from_change_sets(existing);
    let (missed_changes, unfound) = crate::git::changes_from_diff::filter_by_hashes(
        all_changes,
        &semantic_map.unsummarized_hashes,
    );
    if let Some(unfound_hashes) = unfound {
        log::warn!(
            "[new_changeset] {} missed hash(es) not found in current diff: {:?}",
            unfound_hashes.len(),
            unfound_hashes
        );
    }

    // All current changes are already summarized (e.g. same changes re-made after a discard).
    // Return the existing changeset ID so callers can track it — no new model calls needed.
    if missed_changes.is_empty() {
        return Ok(existing_id);
    }

    let Some(base_commit_id) =
        crate::db::commits::store_head_commit_in_pool(&pool, &config_dir, None)?
    else {
        return Ok(None);
    };

    pipelines::evolved_changeset::analyze(
        semantic_map,
        missed_changes,
        app,
        &db_path,
        None,
        base_commit_id,
        None,
        evolution_id,
    )
    .await
}
