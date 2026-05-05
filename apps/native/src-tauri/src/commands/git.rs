use super::helpers::capture_err;
use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{db, git, shared_types};
use tauri::AppHandle;

/// Initializes a git repository in the config directory if one doesn't exist.
#[tauri::command]
pub async fn git_init_repo(app: AppHandle) -> Result<shared_types::OkResult, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_init_repo", e))?;
    git::init_repo(&dir).map_err(|e| capture_err("git_init_repo", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Returns original (HEAD) and modified (working-tree) content for each requested file.
#[tauri::command]
pub async fn git_file_diff_contents(
    app: AppHandle,
    filenames: Vec<String>,
) -> Result<std::collections::HashMap<String, shared_types::FileDiffContents>, String> {
    let dir =
        store::get_config_dir(&app).map_err(|e| capture_err("git_file_diff_contents", e))?;
    Ok(filenames
        .into_iter()
        .map(|f| {
            let (original, modified) = git::exec::file_diff_contents(&dir, &f);
            (f, shared_types::FileDiffContents { original, modified })
        })
        .collect())
}

/// Returns the current git status of the config directory.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<shared_types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_status", e))?;
    let status = git::status(&dir).map_err(|e| capture_err("git_status", e))?;
    Ok(status)
}

/// Returns the current git status and caches it for later comparison.
#[tauri::command]
pub async fn git_status_and_cache(app: AppHandle) -> Result<shared_types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("git_status_and_cache", e))?;
    let status =
        git::status_and_cache(&dir, &app).map_err(|e| capture_err("git_status_and_cache", e))?;
    Ok(status)
}

/// Returns the cached git status if available.
#[tauri::command]
pub async fn git_cached(app: AppHandle) -> Result<Option<shared_types::GitStatus>, String> {
    git::cached(&app).map_err(|e| capture_err("git_cached", e))
}

/// Stages all changes and creates a commit with the given message.
#[tauri::command]
pub async fn git_commit(
    app: AppHandle,
    message: String,
) -> Result<shared_types::CommitResult, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_commit", e))?;
    let commit_info = git::commit_all(&dir, &message).map_err(|e| capture_err("git_commit", e))?;

    if let Err(e) = git::tag_commit(
        &dir,
        &format!("nixmac-commit-{}", &commit_info.hash[..8]),
        &commit_info.hash,
        false,
    ) {
        log::warn!("[git_commit] Failed to tag commit: {}", e);
    }

    if let Ok(db_path) = db::get_db_path(&app) {
        let now = crate::utils::unix_now();
        match db::commits::upsert_commit(
            &db_path,
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
    }

    // Update build state: new HEAD hash, no changeset (working tree is now clean).
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

    let evolve_state = evolve_state::clear(&app).unwrap_or_else(|e| {
        log::error!("[git_commit] Failed to clear evolve state: {}", e);
        shared_types::EvolveState::default()
    });

    Ok(shared_types::CommitResult {
        hash: commit_info.hash,
        evolve_state,
    })
}

/// Stashes all uncommitted changes with the given message.
#[tauri::command]
pub async fn git_stash(app: AppHandle, message: String) -> Result<shared_types::OkResult, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_stash", e))?;
    git::stash(&dir, &message).map_err(|e| capture_err("git_stash", e))?;
    Ok(shared_types::OkResult::yes())
}
