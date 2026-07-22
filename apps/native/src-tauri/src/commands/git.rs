use super::helpers::capture_err;
use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{db, git, shared_types};
use tauri::{AppHandle, Manager, State};

pub async fn fetch_file_diff_contents(
    app: AppHandle,
    filenames: Vec<String>,
) -> Result<std::collections::HashMap<String, shared_types::FileDiffContents>, String> {
    let dir = store::get_repo_root(&app).map_err(|e| capture_err("git_file_diff_contents", e))?;
    Ok(filenames
        .into_iter()
        .map(|f| {
            let (original, modified) = git::query::file_diff_contents(&dir, &f);
            (f, shared_types::FileDiffContents { original, modified })
        })
        .collect())
}

pub async fn create_commit(
    app: AppHandle,
    message: String,
) -> Result<shared_types::CommitResult, String> {
    let db_pool = app.state::<db::DbPool>();
    let dir = store::ensure_git_repo_folder(&app).map_err(|e| capture_err("git_commit", e))?;
    let commit_info = git::commit_all(&dir, &message).map_err(|e| capture_err("git_commit", e))?;

    if let Err(e) = git::tag_commit(
        &dir,
        &format!("nixmac-commit-{}", &commit_info.hash[..8]),
        &commit_info.hash,
        false,
    ) {
        log::warn!("[git_commit] Failed to tag commit: {}", e);
    }

    let now = crate::utils::unix_now();
    match db::commits::upsert_commit(
        &db_pool,
        &commit_info.hash,
        &commit_info.tree_hash,
        Some(&message),
        now,
    ) {
        Ok(id) => log::info!(
            "[git_commit] Saved commit to database (id={}, hash={})",
            id,
            &commit_info.hash[..8]
        ),
        Err(e) => log::error!("[git_commit] Failed to save commit: {}", e),
    }

    if let Ok(current_build_state) = build_state::get(&app) {
        let updated = build_state::BuildState {
            head_commit_hash: Some(commit_info.hash.clone()),
            changeset_id: None,
            ..current_build_state
        };
        if let Err(e) = build_state::set(&app, updated) {
            log::warn!("[git_commit] Failed to update build state: {}", e);
        }
    }

    if let Err(e) = evolve_state::clear(&app) {
        log::error!("[git_commit] Failed to clear evolve state: {}", e);
    }

    if let Err(e) = git::query::status_and_cache(&dir, &app) {
        log::warn!("[git_commit] Failed to refresh git state: {}", e);
    }
    crate::state::change_map::clear(&app);

    Ok(shared_types::CommitResult {
        hash: commit_info.hash,
    })
}

/// Re-derive the mirrored cells after a single-file mutation: refresh the git
/// status cache, recompute the evolve step from the remaining changes, and
/// invalidate the change map so summaries regenerate.
fn refresh_after_single_file_change(app: &AppHandle, dir: &str) {
    match git::query::status_and_cache(dir, app) {
        Ok(status) => {
            evolve_state::refresh(app, &status.changes);
        }
        Err(e) => log::warn!("[git] Failed to refresh git state: {}", e),
    }
    crate::state::change_map::clear(app);
}

/// Commit a single file's change, leaving the rest of the working tree in
/// place. Unlike a full commit this recomputes the evolve step (rather than
/// clearing the session) so any remaining changes keep their state.
pub async fn commit_single_file(
    app: AppHandle,
    filename: String,
    message: String,
) -> Result<shared_types::CommitResult, String> {
    let db_pool = app.state::<db::DbPool>();
    let dir = store::ensure_git_repo_folder(&app).map_err(|e| capture_err("git_commit_file", e))?;
    let commit_info = git::commit_file(&dir, &filename, &message)
        .map_err(|e| capture_err("git_commit_file", e))?;

    if let Err(e) = git::tag_commit(
        &dir,
        &format!("nixmac-commit-{}", &commit_info.hash[..8]),
        &commit_info.hash,
        false,
    ) {
        log::warn!("[git_commit_file] Failed to tag commit: {}", e);
    }

    let now = crate::utils::unix_now();
    if let Err(e) = db::commits::upsert_commit(
        &db_pool,
        &commit_info.hash,
        &commit_info.tree_hash,
        Some(&message),
        now,
    ) {
        log::error!("[git_commit_file] Failed to save commit: {}", e);
    }

    if let Ok(current_build_state) = build_state::get(&app) {
        let updated = build_state::BuildState {
            head_commit_hash: Some(commit_info.hash.clone()),
            changeset_id: None,
            ..current_build_state
        };
        if let Err(e) = build_state::set(&app, updated) {
            log::warn!("[git_commit_file] Failed to update build state: {}", e);
        }
    }

    refresh_after_single_file_change(&app, &dir);

    Ok(shared_types::CommitResult {
        hash: commit_info.hash,
    })
}

/// Discard the working-tree changes for a single file, then refresh state.
pub async fn discard_single_file(
    app: AppHandle,
    filename: String,
) -> Result<shared_types::OkResult, String> {
    let dir =
        store::ensure_git_repo_folder(&app).map_err(|e| capture_err("git_discard_file", e))?;
    git::restore_file(&dir, &filename).map_err(|e| capture_err("git_discard_file", e))?;
    refresh_after_single_file_change(&app, &dir);
    Ok(shared_types::OkResult { ok: true })
}

/// Returns original (HEAD) and modified (working-tree) content for each requested file.
#[tauri::command]
pub async fn git_file_diff_contents(
    app: AppHandle,
    filenames: Vec<String>,
) -> Result<std::collections::HashMap<String, shared_types::FileDiffContents>, String> {
    fetch_file_diff_contents(app, filenames).await
}

/// Returns the last-known git state from the in-memory cell.
///
/// On a cold cell (fresh start, before the watcher's first tick) this seeds
/// the cell once from the real source so hydration never returns an empty
/// mirror. When no config dir is set yet (onboarding) the empty cell value
/// is returned as-is.
#[tauri::command]
pub async fn get_git_state(app: AppHandle) -> Result<shared_types::GitState, String> {
    let state = crate::state::git_state::get(&app);
    if state.git_status.is_some() {
        return Ok(state);
    }
    let Ok(dir) = store::ensure_git_repo_folder(&app) else {
        return Ok(state);
    };
    if let Ok(status) = git::query::status_and_cache(&dir, &app) {
        return Ok(shared_types::GitState {
            git_status: Some(status),
            external_build_detected: false,
            upstream_update_available: state.upstream_update_available,
        });
    }
    Ok(crate::state::git_state::get(&app))
}

/// Returns the current git status of the repo.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<shared_types::GitStatus, String> {
    let dir = store::ensure_git_repo_folder(&app).map_err(|e| capture_err("git_status", e))?;
    let status = git::status(&dir).map_err(|e| capture_err("git_status", e))?;
    Ok(status)
}

/// Returns the current git status and caches it for later comparison.
#[tauri::command]
pub async fn git_status_and_cache(app: AppHandle) -> Result<shared_types::GitStatus, String> {
    let dir =
        store::ensure_git_repo_folder(&app).map_err(|e| capture_err("git_status_and_cache", e))?;
    let status = git::query::status_and_cache(&dir, &app)
        .map_err(|e| capture_err("git_status_and_cache", e))?;
    Ok(status)
}

/// Stages all changes and creates a commit with the given message.
#[tauri::command]
pub async fn git_commit(
    app: AppHandle,
    db_pool: State<'_, db::DbPool>,
    message: String,
) -> Result<shared_types::CommitResult, String> {
    let _ = db_pool;
    create_commit(app, message).await
}
