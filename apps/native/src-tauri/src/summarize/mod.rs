//! Summarization module — AI model calls and pipelines for change analysis and changeset generation.

pub mod build_prompt;
pub mod find_existing;
pub mod group_existing;
pub mod model_calls;
pub mod pipelines;
pub mod sumlog;
pub mod token_budgets;

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

pub async fn new_changeset<R: Runtime>(
    app: &AppHandle<R>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();

    let status = crate::git::status(&config_dir)?;
    let all_changes = status.changes;
    if all_changes.is_empty() {
        return Ok(None);
    }

    let existing = find_existing::for_current_state(&pool, &config_dir)?;
    let existing_id = existing
        .iter()
        .filter_map(|e| e.change_set.as_ref().map(|cs| cs.id))
        .next();

    let has_generated_message = existing.iter().any(|entry| {
        entry
            .change_set
            .as_ref()
            .and_then(|cs| cs.generated_commit_message.as_deref())
            .is_some_and(|message| !message.trim().is_empty())
    });

    let semantic_map = group_existing::from_change_sets(existing);

    if semantic_map.unsummarized_hashes.is_empty() && has_generated_message {
        return Ok(existing_id);
    }

    let Some(base_commit_id) =
        crate::db::commits::store_head_commit(&pool, &config_dir, None)?
    else {
        return Ok(None);
    };

    pipelines::whole_diff::analyze(
        all_changes,
        app,
        None,
        Some(base_commit_id),
        None,
        evolution_id,
    )
    .await
}
