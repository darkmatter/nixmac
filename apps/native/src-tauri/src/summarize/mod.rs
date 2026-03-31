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
use tauri::{AppHandle, Runtime};

/// Generate a changeset for the current state.
/// Fresh if no existing changes are found, or evolved using existing changes as context.
/// Returns the changeset id, or `None` if no new changes required summarization.
pub async fn new_changeset<R: Runtime>(
    app: &AppHandle<R>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    let db_path = crate::db::get_db_path(app)?;
    let config_dir = crate::store::get_config_dir(app)?;

    let diff = crate::git::status(&config_dir)?.diff;
    if diff.is_empty() {
        return Ok(None);
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    // Truncated diffs — content capped at DIFF_EXCERPT_LINES, sufficient for placement
    let all_changes = crate::changes_from_diff::changes_from_diff(&diff, now, true);

    let existing = find_existing::for_current_state(&db_path, &config_dir)?;

    if existing.is_empty() {
        let (_, changes): (Vec<_>, Vec<_>) = all_changes
            .into_iter()
            .partition(crate::changes_from_diff::is_sensitive_or_opaque);
        return pipelines::fresh_changeset::analyze(
            changes, app, &db_path, None, None, None, evolution_id,
        )
        .await;
    }

    let Some(base_commit_id) =
        crate::db::commits::store_head_commit(&db_path, &config_dir, None)?
    else {
        return Ok(None);
    };

    let semantic_map = group_existing::from_change_sets(existing);
    let (missed_changes, unfound) =
        crate::changes_from_diff::filter_by_hashes(all_changes, &semantic_map.missed_hashes);
    if let Some(unfound_hashes) = unfound {
        log::warn!(
            "[new_changeset] {} missed hash(es) not found in current diff: {:?}",
            unfound_hashes.len(),
            unfound_hashes
        );
    }

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
