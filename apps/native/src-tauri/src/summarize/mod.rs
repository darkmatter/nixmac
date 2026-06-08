//! Summarization module — AI model calls and pipelines for change analysis and changeset generation.

pub mod build_prompt;
pub mod find_existing;
pub mod group_existing;
pub mod model_calls;
pub mod pipelines;
pub mod sumlog;
pub mod token_budgets;

use crate::shared_types::SemanticChangeMap;
use crate::sqlite_types::Change;
use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

struct SummaryScope {
    changes: Vec<Change>,
    base_commit_id: i64,
    hashes: Vec<String>,
}

/// Summarizes all the changes for the given evolution. This is a wrapper function
/// that just gets a summary from there to the HEAD.
pub async fn new_changeset<R: Runtime>(
    app: &AppHandle<R>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    summarize_since(app, "HEAD", evolution_id).await
}

/// Summarizes all changes since `base_ref`, returning the ID of the generated changeset if any.
/// If `base_ref` is "HEAD", this will summarize all uncommitted changes.
pub async fn summarize_since<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    let pool = app.state::<crate::db::DbPool>();
    let Some(scope) = load_summary_scope(app, base_ref)? else {
        return Ok(None);
    };

    let existing = vec![find_existing::by_base_with_hashes(
        &pool,
        scope.base_commit_id,
        &scope.hashes,
    )?];
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

    pipelines::whole_diff::analyze(
        scope.changes,
        app,
        None,
        Some(scope.base_commit_id),
        Some(base_ref),
        None,
        evolution_id,
    )
    .await
}

/// Returns a summary of all changes since `base_ref`, without generating anything new.
pub fn change_map_since<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
) -> Result<SemanticChangeMap> {
    Ok(group_existing::from_change_sets(found_change_sets_since(
        app, base_ref,
    )?))
}

/// Returns all changesets found since `base_ref`, without generating anything new.
pub fn found_change_sets_since<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
) -> Result<Vec<find_existing::FoundSetForCurrent>> {
    let pool = app.state::<crate::db::DbPool>();
    let Some(scope) = load_summary_scope(app, base_ref)? else {
        return Ok(vec![]);
    };
    let found = find_existing::by_base_with_hashes(&pool, scope.base_commit_id, &scope.hashes)?;
    Ok(vec![found])
}

/// Gets the base commit for the current summary or HEAD if no summary exists, so the frontend can use it as a reference point for showing file diffs, etc.
pub fn active_summary_base_ref<R: Runtime>(app: &AppHandle<R>) -> String {
    crate::state::evolve_state::get(app)
        .ok()
        .and_then(|state| state.rollback_branch.or(state.backup_branch))
        .unwrap_or_else(|| "HEAD".to_string())
}

/// Gets the commit for `base_ref` and stores it in the DB if not already present, returning its ID.
fn store_base_ref_commit(
    pool: &crate::db::DbPool,
    config_dir: &str,
    base_ref: &str,
) -> Result<Option<i64>> {
    let Some(hash) = crate::git::get_ref_sha(config_dir, base_ref) else {
        return Ok(None);
    };
    let tree_ref = format!("{base_ref}^{{tree}}");
    let Some(tree_hash) = crate::git::get_ref_sha(config_dir, &tree_ref) else {
        return Ok(None);
    };
    let now = crate::utils::unix_now();
    Ok(Some(crate::db::commits::upsert_commit(
        pool, &hash, &tree_hash, None, now,
    )?))
}

/// Helper method to get the changed files and base commit for use in summarization, returning None if the base_ref doesn't exist or there are no changes.
fn load_summary_scope<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
) -> Result<Option<SummaryScope>> {
    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();

    if base_ref == "HEAD" && !crate::git::query::has_head_commit(&config_dir) {
        return Ok(None);
    }

    let changes = changes_since_ref(&config_dir, base_ref)?;
    if changes.is_empty() {
        return Ok(None);
    }

    let Some(base_commit_id) = store_base_ref_commit(&pool, &config_dir, base_ref)? else {
        return Ok(None);
    };
    let hashes = changes.iter().map(|change| change.hash.clone()).collect();

    Ok(Some(SummaryScope {
        changes,
        base_commit_id,
        hashes,
    }))
}

fn changes_since_ref(config_dir: &str, base_ref: &str) -> Result<Vec<Change>> {
    crate::git::query::changes_since_ref(config_dir, base_ref).map(|diffs| {
        diffs
            .into_iter()
            .map(|diff| crate::git::file_diff_to_change(diff, 0, false))
            .collect()
    })
}
