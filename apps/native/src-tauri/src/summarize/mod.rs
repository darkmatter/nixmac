//! Summarization module — AI model calls and pipelines for change analysis and changeset generation.

pub mod build_prompt;
pub mod find_existing;
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

    let found = find_existing::for_changes(&pool, &scope.changes)?;

    if found.map.unsummarized_hashes.is_empty() && found.has_generated_message() {
        return Ok(found.snapshot_id);
    }

    pipelines::whole_diff::analyze(scope.changes, app, Some(base_ref), evolution_id).await
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
    Ok(found_since(app, base_ref)?
        .map(|found| found.map)
        .unwrap_or_default())
}

/// Reconstructs existing summaries (map + cached snapshot) for the changes since
/// `base_ref`, without generating anything new. Returns `None` when there is no
/// summarizable scope (missing ref / no changes).
pub fn found_since<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
) -> Result<Option<find_existing::FoundSummaries>> {
    let pool = app.state::<crate::db::DbPool>();
    let Some(scope) = load_summary_scope(app, base_ref)? else {
        return Ok(None);
    };
    Ok(Some(find_existing::for_changes(&pool, &scope.changes)?))
}

/// Gets the base commit for the current summary or HEAD if no summary exists, so the frontend can use it as a reference point for showing file diffs, etc.
pub fn active_summary_base_ref<R: Runtime>(app: &AppHandle<R>) -> String {
    let session = crate::state::evolve_state::get_session(app);
    let Some(config_dir) = crate::storage::store::get_config_dir(app).ok() else {
        return "HEAD".to_string();
    };

    existing_summary_base_ref(&config_dir, &session).unwrap_or_else(|| "HEAD".to_string())
}

/// Returns the first persisted summary base ref that still exists in the repo.
fn existing_summary_base_ref(
    config_dir: &str,
    session: &crate::shared_types::EvolveSession,
) -> Option<String> {
    // Prefer rollback over backup, but skip refs that were already cleaned up.
    [
        session.rollback_branch.as_deref(),
        session.backup_branch.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find(|base_ref| crate::git::get_ref_sha(config_dir, base_ref).is_some())
    .map(str::to_string)
}

/// Helper method to get the changed files for use in summarization, returning
/// None if the base_ref doesn't exist or there are no changes.
fn load_summary_scope<R: Runtime>(
    app: &AppHandle<R>,
    base_ref: &str,
) -> Result<Option<SummaryScope>> {
    let config_dir = crate::storage::store::get_config_dir(app)?;

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

    Ok(Some(SummaryScope { changes }))
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
    use crate::shared_types::EvolveSession;
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

        let session = EvolveSession {
            rollback_branch: Some("missing-rollback".to_string()),
            backup_branch: Some("existing-backup".to_string()),
            ..EvolveSession::default()
        };

        let config_dir = temp.path().to_string_lossy();

        assert_eq!(
            existing_summary_base_ref(&config_dir, &session),
            Some("existing-backup".to_string())
        );
    }
}
