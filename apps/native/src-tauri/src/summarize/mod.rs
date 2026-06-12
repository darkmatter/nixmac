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

/// Wrapper function to summarize changes since HEAD.
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

/// Recompute the change map for the active summary base ref and record it in
/// the change-map cell (which emits `change_map_changed`). Used by mutating
/// commands whose effects invalidate the last-known map.
pub fn refresh_change_map<R: Runtime>(app: &AppHandle<R>) {
    let base_ref = active_summary_base_ref(app);
    match change_map_since(app, &base_ref) {
        Ok(map) => {
            crate::state::change_map::update(app, map);
        }
        Err(e) => log::warn!("[change_map] refresh failed: {}", e),
    }
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
    let Some(state) = crate::state::evolve_state::get(app).ok() else {
        return "HEAD".to_string();
    };
    let Some(config_dir) = crate::storage::store::get_config_dir(app).ok() else {
        return "HEAD".to_string();
    };

    existing_summary_base_ref(&config_dir, &state).unwrap_or_else(|| "HEAD".to_string())
}

/// Returns the first persisted summary base ref that still exists in the repo.
fn existing_summary_base_ref(
    config_dir: &str,
    state: &crate::shared_types::EvolveState,
) -> Option<String> {
    // Prefer rollback over backup, but skip refs that were already cleaned up.
    [
        state.rollback_branch.as_deref(),
        state.backup_branch.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find(|base_ref| crate::git::get_ref_sha(config_dir, base_ref).is_some())
    .map(str::to_string)
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

    if crate::git::get_ref_sha(&config_dir, base_ref).is_none() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_types::EvolveState;
    use std::fs;
    use std::path::Path;

    /// Creates a temporary git repository with one committed README.
    fn repo_with_initial_commit() -> (tempfile::TempDir, git2::Oid) {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let repo = git2::Repository::init(temp.path()).expect("init repo");

        fs::write(temp.path().join("README.md"), "hello\n").expect("write file");

        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("README.md")).expect("stage file");
        index.write().expect("write index");

        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");
        let commit_id = repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("create commit");

        drop(tree);
        drop(repo);

        (temp, commit_id)
    }

    #[test]
    fn existing_summary_base_ref_skips_missing_refs() {
        let (temp, commit_id) = repo_with_initial_commit();
        let repo = git2::Repository::discover(temp.path()).expect("open repo");
        let commit = repo.find_commit(commit_id).expect("find commit");
        repo.branch("existing-backup", &commit, false)
            .expect("create branch");

        let state = EvolveState {
            rollback_branch: Some("missing-rollback".to_string()),
            backup_branch: Some("existing-backup".to_string()),
            ..EvolveState::default()
        };

        let config_dir = temp.path().to_string_lossy();

        assert_eq!(
            existing_summary_base_ref(&config_dir, &state),
            Some("existing-backup".to_string())
        );
    }
}
