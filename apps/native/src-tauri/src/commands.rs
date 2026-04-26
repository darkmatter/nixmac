//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.

use crate::{
    darwin, db, default_config, editor, evolution, evolve_state, feedback, finalize_restore, git,
    lsp, nix, peek, permissions, rollback, scanner, shared_types, store, types, utils,
};
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// =============================================================================
// Helpers
// =============================================================================
fn capture_err<E: std::fmt::Display>(cmd: &str, e: E) -> String {
    // Only send the command name to Sentry to avoid leaking chat or user data.
    sentry::capture_message(cmd, sentry::Level::Error);
    e.to_string()
}

// =============================================================================
// Configuration Commands
// =============================================================================

/// Returns the current configuration including the flake directory and host attribute.
#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_get", e))?;
    let host_attr = store::get_host_attr(&app)
        .map_err(|e| capture_err("config_get", e))?
        .or_else(store::read_host_attr_from_file);

    Ok(types::Config {
        config_dir,
        host_attr,
    })
}

/// Sets the nix-darwin host attribute (e.g., "Coopers-MacBook-Pro").
#[tauri::command]
pub async fn config_set_host_attr(
    app: AppHandle,
    host: String,
) -> Result<serde_json::Value, String> {
    store::set_host_attr(&app, &host).map_err(|e| capture_err("config_set_host_attr", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets the flake configuration directory path.
#[tauri::command]
pub async fn config_set_dir(app: AppHandle, dir: String) -> Result<serde_json::Value, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("config_set_dir", e))?;

    // Require that the provided path already exists and is a directory.
    // If we don't, then we'll always silently create directories even when
    // the user is making typos trying to set the path, which is particularly
    // annoying when dealing with hidden directories like ~/.darwin-ish things.
    let p = normalized_dir.as_path();
    if !p.exists() || !p.is_dir() {
        return Err(format!(
            "Directory does not exist: {}",
            normalized_dir.display()
        ));
    }

    store::set_config_dir(&app, &normalized_dir.to_string_lossy())
        .map_err(|e| capture_err("config_set_dir", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Opens a native folder picker dialog to select the flake directory.
#[tauri::command]
pub async fn config_pick_dir(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    // Try to open the picker at the currently configured directory
    let default_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_pick_dir", e))?;
    let result = dialog
        .file()
        .set_title(
            "Select Configuration Directory - TIP: press '⌘'+'⇧'+'.' to show hidden directories",
        )
        .set_directory(std::path::PathBuf::from(default_dir))
        .blocking_pick_folder();

    if let Some(path) = result {
        let dir = path.to_string();
        store::set_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_pick_dir", e))?;
        return Ok(Some(dir));
    }

    Ok(None)
}

/// Checks if a flake.nix exists in the config directory
#[tauri::command]
pub async fn flake_exists(app: AppHandle) -> Result<bool, String> {
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("flake_exists", e))?;
    Ok(Path::new(&dir).join("flake.nix").exists())
}

/// Checks if a flake.nix exists at the provided directory path
#[tauri::command]
pub async fn flake_exists_at(_app: AppHandle, dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("flake_exists_at", e))?;
    Ok(normalized_dir.join("flake.nix").exists())
}

/// Checks whether the provided path exists and is a directory.
#[tauri::command]
pub async fn path_exists(_app: AppHandle, dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("path_exists", e))?;
    Ok(normalized_dir.exists() && normalized_dir.is_dir())
}

/// Normalizes a user-provided directory path for validation and persistence.
///
/// Behavior:
/// - trims surrounding whitespace
/// - expands a leading `~` or `~/...` to the user's home directory
/// - resolves relative paths against the current working directory
#[tauri::command]
pub async fn path_normalize(_app: AppHandle, input: String) -> Result<String, String> {
    let normalized =
        utils::normalize_dir_input(&input).map_err(|e| capture_err("path_normalize", e))?;
    Ok(normalized.to_string_lossy().into_owned())
}

/// Creates a new nix-darwin configuration from the bundled template.
#[tauri::command]
pub async fn bootstrap_default_config(app: AppHandle, hostname: String) -> Result<(), String> {
    default_config::bootstrap(&app, &hostname)
}

// =============================================================================
// Feedback Commands
// =============================================================================

/// Gathers feedback metadata based on user opt-in flags.
/// Delegates to the feedback module for comprehensive data collection.
#[tauri::command]
pub async fn feedback_gather_metadata(
    app: AppHandle,
    request: types::FeedbackMetadataRequest,
) -> Result<types::FeedbackMetadata, String> {
    feedback::gather_metadata(&app, request).map_err(|e| capture_err("feedback_gather_metadata", e))
}

/// Submits feedback: tries to POST, saves to disk on failure, flushes pending.
#[tauri::command]
pub async fn feedback_submit(app: AppHandle, payload: String) -> Result<bool, String> {
    feedback::submit(&app, payload)
        .await
        .map_err(|e| capture_err("feedback_submit", e))
}

// =============================================================================
// TESTING / DEBUG Commands
// TODO: Consider removing or gating behind a debug flag in production builds.
// =============================================================================

/// Test command to trigger a panic and verify the panic handler works.
/// This will cause a controlled panic that should be caught by the panic handler
/// and trigger the feedback dialog.
///
/// You can run it like this from the JS debug console:
/// window.__TAURI_INTERNALS__.invoke("trigger_test_panic");
///
/// Only available in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn trigger_test_panic() -> Result<(), String> {
    log::warn!("Test panic triggered by user");
    panic!("This is a test panic to verify the panic handler works correctly");
}

/// Debug command to capture a Sentry event from the Rust backend.
/// Used to test end-to-end Sentry integration.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn debug_sentry_event() -> Result<serde_json::Value, String> {
    log::info!("[debug_sentry_event] Capturing debug event from Rust backend");

    sentry::capture_message("Debug Sentry event from Rust backend", sentry::Level::Error);

    Ok(serde_json::json!({"ok": true, "message": "Debug event captured from Rust"}))
}

// =============================================================================
// Git Commands
// =============================================================================

/// Initializes a git repository in the config directory if one doesn't exist.
#[tauri::command]
pub async fn git_init_repo(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_init_repo", e))?;
    git::init_repo(&dir).map_err(|e| capture_err("git_init_repo", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Returns the current git status of the config directory.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_status", e))?;
    let status = git::status(&dir).map_err(|e| capture_err("git_status", e))?;
    Ok(status)
}

/// Returns the current git status and caches it for later comparison.
#[tauri::command]
pub async fn git_status_and_cache(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("git_status_and_cache", e))?;
    let status =
        git::status_and_cache(&dir, &app).map_err(|e| capture_err("git_status_and_cache", e))?;
    Ok(status)
}

/// Returns the cached git status if available.
#[tauri::command]
pub async fn git_cached(app: AppHandle) -> Result<Option<types::GitStatus>, String> {
    git::cached(&app).map_err(|e| capture_err("git_cached", e))
}

/// Stages all changes and creates a commit with the given message.
#[tauri::command]
pub async fn git_commit(app: AppHandle, message: String) -> Result<CommitResult, String> {
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

    // Save commit to database
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
    if let Ok(current_build_state) = crate::build_state::get(&app) {
        let updated = crate::build_state::BuildState {
            head_commit_hash: Some(commit_info.hash.clone()),
            changeset_id: None,
            ..current_build_state
        };
        if let Err(e) = crate::build_state::set(&app, updated) {
            log::warn!("[git_commit] Failed to update build state: {}", e);
        }
    }

    // Evolution complete — reset state back to idle.
    let evolve_state = evolve_state::clear(&app).unwrap_or_else(|e| {
        log::error!("[git_commit] Failed to clear evolve state: {}", e);
        evolve_state::EvolveState::default()
    });

    Ok(CommitResult {
        hash: commit_info.hash,
        evolve_state,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub evolve_state: evolve_state::EvolveState,
}

/// Stash changes
#[tauri::command]
pub async fn git_stash(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_stash", e))?;
    git::stash(&dir, &message).map_err(|e| capture_err("git_stash", e))?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Darwin/Nix Commands
// =============================================================================

/// Global flag to signal evolution cancellation.
static EVOLVE_CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Check if evolution has been cancelled.
pub fn is_evolve_cancelled() -> bool {
    EVOLVE_CANCELLED.load(std::sync::atomic::Ordering::SeqCst)
}

/// Reset the cancellation flag.
fn reset_evolve_cancelled() {
    EVOLVE_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Global sender for the currently pending agent question.
static ONGOING_QUESTION: std::sync::OnceLock<
    tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>,
> = std::sync::OnceLock::new();

pub type QuestionResponseReceiver = tokio::sync::oneshot::Receiver<String>;

fn ongoing_question_slot(
) -> &'static tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>> {
    ONGOING_QUESTION.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Send a user's answer to the evolve loop's pending question.
pub async fn send_question_response(answer: String) -> anyhow::Result<()> {
    let tx = {
        let slot = ongoing_question_slot();
        let mut guard = slot.lock().await;
        guard.take()
    };

    match tx {
        Some(tx) => tx
            .send(answer)
            .map_err(|_| anyhow::anyhow!("Question response receiver dropped")),
        None => Err(anyhow::anyhow!("No pending question to answer")),
    }
}

/// Register a pending question before notifying the UI, so fast answers cannot
/// arrive before the backend is ready to receive them.
pub async fn prepare_question_response() -> QuestionResponseReceiver {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let slot = ongoing_question_slot();
    let mut guard = slot.lock().await;
    *guard = Some(tx);
    rx
}

/// Clear the pending question response sender when the evolve loop stops waiting.
pub async fn clear_pending_question_response() {
    let slot = ongoing_question_slot();
    let mut guard = slot.lock().await;
    guard.take();
}

/// Wait for a prepared user response receiver.
pub async fn wait_for_prepared_question_response(rx: QuestionResponseReceiver) -> Option<String> {
    rx.await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn question_response_slot_accepts_answer_and_rejects_after_clear() {
        clear_pending_question_response().await;

        let rx = prepare_question_response().await;

        send_question_response("yes".to_string())
            .await
            .expect("prepared question should accept an answer");

        assert_eq!(
            wait_for_prepared_question_response(rx).await,
            Some("yes".to_string())
        );

        let _rx = prepare_question_response().await;

        clear_pending_question_response().await;

        let err = send_question_response("too late".to_string())
            .await
            .expect_err("cleared question should reject a late answer");

        assert!(err.to_string().contains("No pending question to answer"));
    }
}

/// Handles the complete evolution cycle returning the git status and summary to react
#[tauri::command]
pub async fn darwin_evolve(
    app: AppHandle,
    description: String,
) -> Result<serde_json::Value, String> {
    // Reset cancellation flag at the start of a new evolution
    reset_evolve_cancelled();

    let result = match evolution::backup_evolve_and_record_changeset(&app, &description).await {
        Ok(result) => result,
        Err(failure) => {
            let is_cancelled = is_evolve_cancelled()
                || failure
                    .error
                    .to_ascii_lowercase()
                    .contains("cancelled by user");

            if is_cancelled {
                log::info!(
                    "[darwin_evolve] cancelled after {} iterations and {} build attempts",
                    failure.telemetry.iterations,
                    failure.telemetry.build_attempts
                );
                // Don't send to Sentry if it was a user-initiated cancellation
                return Err(failure.error);
            }

            log::warn!(
                "[darwin_evolve] failed after {} iterations and {} build attempts",
                failure.telemetry.iterations,
                failure.telemetry.build_attempts
            );
            return Err(capture_err("darwin_evolve", failure.error));
        }
    };

    Ok(serde_json::to_value(result).unwrap_or_default())
}

/// Cancel an in-progress evolution operation.
#[tauri::command]
pub async fn darwin_evolve_cancel() -> Result<serde_json::Value, String> {
    EVOLVE_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
    log::info!("Evolution cancellation requested");
    Ok(serde_json::json!({"ok": true, "message": "Cancellation requested"}))
}

/// Respond to an agent question during evolution.
#[tauri::command]
pub async fn darwin_evolve_answer(answer: String) -> Result<serde_json::Value, String> {
    log::info!("User answered agent question: {}", answer);
    send_question_response(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Legacy non-streaming apply command. Returns immediately with a hint to use streaming.
#[tauri::command]
pub async fn darwin_apply(
    app: AppHandle,
    host_override: Option<String>,
) -> Result<types::ApplyResult, String> {
    let _dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("darwin_apply", e))?;
    let _host = host_override
        .or_else(|| nix::determine_host_attr(&app))
        .ok_or_else(|| "Host attribute not found".to_string())?;

    Ok(types::ApplyResult {
        ok: true,
        code: Some(0),
        stdout: Some("Use darwin_apply_stream_start for streaming output".to_string()),
        stderr: None,
    })
}

/// Starts a streaming darwin-rebuild switch operation.
/// Progress is emitted via `darwin:apply:data` events, completion via `darwin:apply:end`.
#[tauri::command]
pub async fn darwin_apply_stream_start(
    app: AppHandle,
    host_override: Option<String>,
) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_apply_stream_start", e))?;

    let stored_attr = nix::determine_host_attr(&app);
    let discovered_hosts = nix::list_darwin_hosts(&dir).ok();

    log::info!(
        "[apply] config_dir={}, host_override={:?}, stored={:?}, discovered={:?}",
        dir,
        host_override,
        stored_attr,
        discovered_hosts
    );

    let host = host_override
        .or(stored_attr)
        .or_else(|| {
            let hosts = discovered_hosts.as_ref()?;
            (hosts.len() == 1).then(|| hosts[0].clone())
        })
        .ok_or_else(|| {
            "Host attribute not found. Set a host in Settings or ensure your flake defines exactly one darwinConfiguration.".to_string()
        })?;

    darwin::apply_stream(&app, &dir, &host)
        .map_err(|e| capture_err("darwin_apply_stream_start", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Used by rollback to restore a previous nix store without a full rebuild.
#[tauri::command]
pub async fn darwin_activate_store_path(
    app: AppHandle,
    store_path: String,
) -> Result<serde_json::Value, String> {
    darwin::activate_store_path_stream(&app, store_path)
        .map(|_| serde_json::json!({"ok": true}))
        .map_err(|e| capture_err("darwin_activate_store_path", e))
}

/// Placeholder for canceling an in-progress apply operation.
#[tauri::command]
pub async fn darwin_apply_stream_cancel(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;

    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to add files to git: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let date = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let output = Command::new("git")
        .args(["checkout", "-b", &format!("canceled-{}", date)])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout canceled commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let output = Command::new("git")
        .args(["commit", "-m", &format!("Canceled commit: {}", commit_hash)])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to commit canceled commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // check out prev branch
    let output = Command::new("git")
        .args(["checkout", "-"])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout previous branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // TODO: Implement actual cancellation by tracking the child process
    Ok(serde_json::json!({"ok": true}))
}

/// Finalize a successful build
#[tauri::command]
pub async fn finalize_apply(app: AppHandle) -> Result<crate::finalize_apply::ApplyResult, String> {
    crate::finalize_apply::finalize_apply(&app)
        .await
        .map_err(|e| capture_err("finalize_apply", e))
}

/// Finalize a rollback store-path activation — restores the pre-evolution build record.
#[tauri::command]
pub async fn finalize_rollback(
    app: AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<crate::finalize_apply::ApplyResult, String> {
    crate::finalize_apply::finalize_rollback(&app, store_path, changeset_id)
        .await
        .map_err(|e| capture_err("finalize_rollback", e))
}

#[tauri::command]
pub async fn flake_installed_apps(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("flake_installed_apps", e))?;

    // Same host resolution logic as apply
    let host = nix::determine_host_attr(&app)
        .or_else(|| {
            let hosts = nix::list_darwin_hosts(&dir).ok()?;
            if hosts.len() == 1 {
                Some(hosts[0].clone())
            } else {
                None
            }
        })
        .ok_or_else(|| "Host attribute not found".to_string())?;

    let apps = nix::evaluate_installed_apps(&dir, &host)
        .map_err(|e| capture_err("flake_installed_apps", e))?;
    Ok(apps)
}

#[tauri::command]
pub async fn nix_check() -> Result<serde_json::Value, String> {
    let installed = nix::is_nix_installed();
    let version = if installed {
        nix::get_nix_version()
    } else {
        None
    };
    let darwin_rebuild_available = if installed {
        nix::is_darwin_rebuild_available()
    } else {
        false
    };
    Ok(
        serde_json::json!({ "installed": installed, "version": version, "darwin_rebuild_available": darwin_rebuild_available }),
    )
}

#[tauri::command]
pub async fn darwin_rebuild_prefetch(app: AppHandle) -> Result<serde_json::Value, String> {
    nix::prefetch_darwin_rebuild_stream(&app)
        .map_err(|e| capture_err("darwin_rebuild_prefetch", e))?;
    Ok(serde_json::json!({"ok": true}))
}

#[tauri::command]
pub async fn nix_install_start(app: AppHandle) -> Result<serde_json::Value, String> {
    nix::install_nix_stream(&app).map_err(|e| capture_err("nix_install_start", e))?;
    Ok(serde_json::json!({"ok": true}))
}

#[tauri::command]
pub async fn finalize_flake_lock(app: AppHandle) -> Result<serde_json::Value, String> {
    default_config::finalize_flake_lock(&app)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Lists all darwinConfigurations defined in the flake.
#[tauri::command]
pub async fn flake_list_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("flake_list_hosts", e))?;
    let hosts = nix::list_darwin_hosts(&dir).map_err(|e| capture_err("flake_list_hosts", e))?;
    Ok(hosts)
}

// =============================================================================
// Summarization Commands
// =============================================================================

#[tauri::command]
pub async fn find_change_map(
    app: AppHandle,
) -> Result<crate::shared_types::SemanticChangeMap, String> {
    let db_path = db::get_db_path(&app).map_err(|e| capture_err("find_change_map", e))?;
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("find_change_map", e))?;
    let change_sets = crate::summarize::find_existing::for_current_state(&db_path, &dir)
        .map_err(|e| capture_err("find_change_map", e))?;
    Ok(crate::summarize::group_existing::from_change_sets(
        change_sets,
    ))
}

/// Walks back `number` commits from `commit_hash`,
/// upserts missing metadata (commits and summaries).
#[tauri::command]
pub async fn generate_history_from(
    app: AppHandle,
    commit_hash: String,
    number: usize,
) -> Result<(), String> {
    crate::summarize::pipelines::history::from_commit_times_number(&app, &commit_hash, number)
        .await
        .map_err(|e| capture_err("generate_history_from", e))
}

/// Summarizes the current working state, running the from-scratch pipeline if
/// no existing summaries are found, or grouping and simplifying existing ones.
#[tauri::command]
pub async fn summarize_current(app: AppHandle) -> Result<(), String> {
    crate::summarize::new_changeset(&app, None)
        .await
        .map(|_| ())
        .map_err(|e| capture_err("summarize_current", e))
}

/// Returns all commits on the main branch, each paired with optional DB metadata, summary,
/// and build/head status.
#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<Vec<crate::shared_types::HistoryItem>, String> {
    crate::get_history::get_history(&app)
        .await
        .map_err(|e| capture_err("get_history", e))
}

/// Checks out `target_hash` for history restore rebuild
#[tauri::command]
pub async fn prepare_restore(app: AppHandle, target_hash: String) -> Result<(), String> {
    let config_dir =
        store::get_config_dir(&app).map_err(|e| capture_err("prepare_restore", e))?;
    git::checkout_files_at_commit(&config_dir, &target_hash)
        .map_err(|e| capture_err("prepare_restore", e))?;
    crate::historelog::log_prepare(&config_dir);
    Ok(())
}

#[tauri::command]
pub async fn abort_restore(app: AppHandle) -> Result<(), String> {
    let config_dir =
        store::get_config_dir(&app).map_err(|e| capture_err("abort_restore", e))?;
    git::restore_all(&config_dir).map_err(|e| capture_err("abort_restore", e))?;
    crate::historelog::log_abort(&config_dir);
    Ok(())
}

/// Commits, tags and stores on successful history restore, then records build state.
#[tauri::command]
pub async fn finalize_restore(
    app: AppHandle,
    target_hash: String,
) -> Result<crate::types::GitStatus, String> {
    finalize_restore::finalize_restore(&app, target_hash)
        .await
        .map_err(|e| capture_err("finalize_restore", e))
}

/// Generates a commit message from the current semantic change map via the pipeline.
#[tauri::command]
pub async fn generate_commit_message(app: AppHandle) -> Result<String, String> {
    crate::summarize::pipelines::commit_message::generate(&app)
        .await
        .map_err(|e| capture_err("generate_commit_message", e))
}

// =============================================================================
// UI Preference Commands
// =============================================================================

/// Returns all UI preferences.
#[tauri::command]
pub async fn ui_get_prefs(app: AppHandle) -> Result<types::UiPrefs, String> {
    let openrouter_api_key =
        store::get_openrouter_api_key(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let openai_api_key =
        store::get_openai_api_key(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let send_diagnostics =
        store::get_send_diagnostics(&app).map_err(|e| capture_err("ui_get_prefs", e))?;

    let evolve_provider =
        store::get_evolve_provider(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let evolve_model = store::get_evolve_model(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let summary_provider =
        store::get_summary_provider(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let summary_model =
        store::get_summary_model(&app).map_err(|e| capture_err("ui_get_prefs", e))?;

    let max_iterations =
        Some(store::get_max_iterations(&app).unwrap_or(store::DEFAULT_MAX_ITERATIONS));
    let max_build_attempts = Some(store::get_max_build_attempts(&app).unwrap_or(5));
    let ollama_api_base_url: Option<String> =
        store::get_ollama_api_base_url(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let vllm_api_base_url: Option<String> =
        store::get_vllm_api_base_url(&app).map_err(|e| capture_err("ui_get_prefs", e))?;
    let vllm_api_key: Option<String> =
        store::get_vllm_api_key(&app).map_err(|e| capture_err("ui_get_prefs", e))?;

    let confirm_build = store::get_bool_pref(&app, store::CONFIRM_BUILD_KEY, true)
        .map_err(|e| capture_err("ui_get_prefs", e))?;
    let confirm_clear = store::get_bool_pref(&app, store::CONFIRM_CLEAR_KEY, true)
        .map_err(|e| capture_err("ui_get_prefs", e))?;
    let confirm_rollback = store::get_bool_pref(&app, store::CONFIRM_ROLLBACK_KEY, true)
        .map_err(|e| capture_err("ui_get_prefs", e))?;

    Ok(types::UiPrefs {
        openrouter_api_key,
        openai_api_key,

        evolve_provider,
        evolve_model,
        summary_provider,
        summary_model,

        max_iterations,
        max_build_attempts,

        ollama_api_base_url,
        vllm_api_base_url,
        vllm_api_key,
        send_diagnostics,

        confirm_build,
        confirm_clear,
        confirm_rollback,
    })
}

/// Updates UI preferences from a partial JSON object.
#[tauri::command]
pub async fn ui_set_prefs(
    app: AppHandle,
    prefs: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let Some(openrouter_api_key) = prefs.get("openrouterApiKey").and_then(|v| v.as_str()) {
        store::set_openrouter_api_key(&app, openrouter_api_key)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(openai_api_key) = prefs.get("openaiApiKey").and_then(|v| v.as_str()) {
        store::set_openai_api_key(&app, openai_api_key)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(evolve_provider) = prefs.get("evolveProvider").and_then(|v| v.as_str()) {
        store::set_evolve_provider(&app, evolve_provider)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(evolve_model) = prefs.get("evolveModel").and_then(|v| v.as_str()) {
        store::set_evolve_model(&app, evolve_model).map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(summary_provider) = prefs.get("summaryProvider").and_then(|v| v.as_str()) {
        store::set_summary_provider(&app, summary_provider)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(summary_model) = prefs.get("summaryModel").and_then(|v| v.as_str()) {
        store::set_summary_model(&app, summary_model)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_iterations) = prefs.get("maxIterations").and_then(|v| v.as_u64()) {
        store::set_max_iterations(&app, max_iterations as usize)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_build_attempts) = prefs.get("maxBuildAttempts").and_then(|v| v.as_u64()) {
        store::set_max_build_attempts(&app, max_build_attempts as usize)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(ollama_api_base_url) = prefs.get("ollamaApiBaseUrl").and_then(|v| v.as_str()) {
        store::set_ollama_api_base_url(&app, ollama_api_base_url)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(vllm_api_base_url) = prefs.get("vllmApiBaseUrl").and_then(|v| v.as_str()) {
        store::set_vllm_api_base_url(&app, vllm_api_base_url)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(vllm_api_key) = prefs.get("vllmApiKey").and_then(|v| v.as_str()) {
        store::set_vllm_api_key(&app, vllm_api_key).map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(send_diagnostics) = prefs.get("sendDiagnostics").and_then(|v| v.as_bool()) {
        store::set_send_diagnostics(&app, send_diagnostics)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_build) = prefs
        .get(store::CONFIRM_BUILD_KEY)
        .and_then(|v| v.as_bool())
    {
        store::set_bool_pref(&app, store::CONFIRM_BUILD_KEY, confirm_build)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_clear) = prefs
        .get(store::CONFIRM_CLEAR_KEY)
        .and_then(|v| v.as_bool())
    {
        store::set_bool_pref(&app, store::CONFIRM_CLEAR_KEY, confirm_clear)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_rollback) = prefs
        .get(store::CONFIRM_ROLLBACK_KEY)
        .and_then(|v| v.as_bool())
    {
        store::set_bool_pref(&app, store::CONFIRM_ROLLBACK_KEY, confirm_rollback)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }

    Ok(serde_json::json!({"ok": true}))
}

/// Gets the cached list of models for a provider.
#[tauri::command]
pub async fn get_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<Option<Vec<String>>, String> {
    store::get_cached_models(&app, &provider).map_err(|e| capture_err("get_cached_models", e))
}

/// Clears the cached models for a provider.
#[tauri::command]
pub async fn clear_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<serde_json::Value, String> {
    store::clear_cached_models(&app, &provider)
        .map_err(|e| capture_err("clear_cached_models", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets the cached list of models for a provider.
#[tauri::command]
pub async fn set_cached_models(
    app: AppHandle,
    provider: String,
    models: Vec<String>,
) -> Result<serde_json::Value, String> {
    store::set_cached_models(&app, &provider, &models)
        .map_err(|e| capture_err("set_cached_models", e))?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Prompt History Commands
// =============================================================================

/// Gets the prompt history in reverse chron order.
#[tauri::command]
pub async fn get_prompt_history(app: AppHandle) -> Result<Vec<String>, String> {
    store::get_prompt_history(&app).map_err(|e| capture_err("get_prompt_history", e))
}

/// Adds a prompt to the history.
#[tauri::command]
pub async fn add_to_prompt_history(
    app: AppHandle,
    prompt: String,
) -> Result<serde_json::Value, String> {
    store::add_to_prompt_history(&app, &prompt)
        .map_err(|e| capture_err("add_to_prompt_history", e))?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Window Commands
// =============================================================================

/// Shows and focuses the main window (used by preview indicator).
#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_main_window(&app).map_err(|e| capture_err("show_main_window", e))?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Preview Indicator Commands
// =============================================================================

/// Shows the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_show(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_show", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Hides the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_hide(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::hide_preview_indicator(&app).map_err(|e| capture_err("preview_indicator_hide", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Updates the preview indicator state.
#[tauri::command]
pub async fn preview_indicator_update(
    app: AppHandle,
    state: peek::PreviewIndicatorState,
) -> Result<serde_json::Value, String> {
    peek::update_preview_indicator(&app, state)
        .map_err(|e| capture_err("preview_indicator_update", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets whether there are uncommitted changes (used by Rust to track state).
#[tauri::command]
pub async fn set_has_uncommitted_changes(has_changes: bool) -> Result<serde_json::Value, String> {
    peek::set_has_uncommitted_changes(has_changes);
    Ok(serde_json::json!({"ok": true}))
}

/// Gets the current preview indicator state (for window to call on mount).
#[tauri::command]
pub async fn preview_indicator_get_state() -> Result<peek::PreviewIndicatorState, String> {
    log::debug!("preview_indicator_get_state called");
    let state = peek::get_preview_indicator_state();
    log::debug!("Current preview indicator state: {:?}", state);
    Ok(state)
}

// =============================================================================
// Permissions Commands
// =============================================================================

/// Check all macOS permissions and return their current status.
#[tauri::command]
pub async fn permissions_check_all() -> Result<permissions::PermissionsState, String> {
    Ok(permissions::check_all_permissions())
}

/// Request a specific permission by ID.
/// For programmatic permissions (desktop, documents), this triggers the OS prompt.
/// For manual permissions (full-disk), this opens System Settings.
#[tauri::command]
pub async fn permissions_request(permission_id: String) -> Result<permissions::Permission, String> {
    permissions::request_permission(&permission_id)
        .map_err(|e| capture_err("permissions_request", e))
}

/// Check if all required permissions are granted.
#[tauri::command]
pub async fn permissions_all_required_granted() -> Result<bool, String> {
    Ok(permissions::all_required_permissions_granted())
}

// =============================================================================
// System Defaults Scanner Commands
// =============================================================================

/// Returns a recommended prompt based on the user's current macOS settings.
#[tauri::command]
pub async fn get_recommended_prompt() -> Result<Option<scanner::RecommendedPrompt>, String> {
    Ok(scanner::recommend_prompt())
}

/// Scans macOS system defaults and returns settings that differ from factory defaults.
#[tauri::command]
pub async fn scan_system_defaults(app: AppHandle) -> Result<scanner::SystemDefaultsScan, String> {
    // Check if system-defaults.nix already exists in the config dir
    if let Ok(dir) = store::get_config_dir(&app) {
        let nix_path = std::path::Path::new(&dir)
            .join("modules")
            .join("darwin")
            .join("system-defaults.nix");
        if nix_path.exists() {
            // Already applied — return empty scan so the CTA stays hidden
            return Ok(scanner::SystemDefaultsScan {
                defaults: vec![],
                total_scanned: 0,
            });
        }
    }
    Ok(scanner::scan_system_defaults())
}

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates a git branch, commits, and caches a summary.
#[tauri::command]
pub async fn apply_system_defaults(
    app: AppHandle,
    defaults: Vec<scanner::SystemDefault>,
) -> Result<serde_json::Value, String> {
    crate::apply_system_defaults::apply_system_defaults(&app, defaults)
        .await
        .map_err(|e| capture_err("apply_system_defaults", e))
}

// =============================================================================
// Rollback Commands
// =============================================================================

/// Restore uncommitted changes.
#[tauri::command]
pub async fn rollback_erase(app: AppHandle) -> Result<shared_types::RollbackResult, String> {
    rollback::rollback_erase(&app).map_err(|e| capture_err("rollback_erase", e))
}

/// Dry-run build check against the current working tree. Returns `{ passed: bool, output: string }`.
#[tauri::command]
pub async fn darwin_build_check(app: AppHandle) -> Result<serde_json::Value, String> {
    let config_dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("darwin_build_check", e))?;
    let host_attr = store::get_host_attr(&app)
        .map_err(|e| capture_err("darwin_build_check", e))?
        .ok_or_else(|| "No host configured — cannot run build check".to_string())?;

    let (passed, stdout, stderr) = darwin::dry_run_build_check(&config_dir, &host_attr, false)
        .map_err(|e| capture_err("darwin_build_check", e))?;

    let output = if stderr.is_empty() { stdout } else { stderr };
    Ok(serde_json::json!({ "passed": passed, "output": output }))
}

/// Adopt pre-existing uncommitted changes as a nixmac evolution without AI.
/// Inserts a new evolution DB record and seeds EvolveState so the subsequent AI evolve
/// can link its changeset to the same evolution.
/// The caller must run `darwin_build_check` first and confirm the build passes.
#[tauri::command]
pub async fn darwin_adopt_manual_changes(app: AppHandle) -> Result<i64, String> {
    let config_dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;
    let git_status =
        git::status(&config_dir).map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;
    let db_path =
        db::get_db_path(&app).map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;
    let branch = git_status.branch.as_deref().unwrap_or("unknown");
    let existing_id = evolve_state::get(&app).ok().and_then(|s| s.evolution_id);
    let evolution_id = db::evolutions::upsert(&db_path, existing_id, branch)
        .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;

    evolve_state::set(
        &app,
        evolve_state::EvolveState {
            evolution_id: Some(evolution_id),
            current_changeset_id: None,
            ..Default::default()
        },
        &git_status.changes,
    )
    .map_err(|e| capture_err("darwin_adopt_manual_changes", e))?;

    log::info!(
        "[darwin_adopt_manual_changes] evolution record created | id={}",
        evolution_id
    );
    Ok(evolution_id)
}

// =============================================================================
// Updater Commands
// =============================================================================

/// Safely relaunch the app after the Tauri updater has installed a new bundle.
///
/// On macOS, the updater atomically swaps the `.app` bundle on disk by moving
/// the old bundle aside and placing the new one at the original path.  The
/// standard `relaunch()` / `app.request_restart()` path re-execs the binary
/// path that was cached when the process first started, which can resolve to
/// the old (now moved-aside) bundle in certain timing windows and therefore
/// relaunch the stale version.
///
/// This command sidesteps that by calling `open -n <bundle_path>`, which asks
/// macOS LaunchServices to open the bundle at its *current* installed location,
/// always picking up the freshly-written bundle.  We then exit the current
/// (old) process so the single-instance gate does not block the new instance.
#[tauri::command]
pub fn relaunch_after_update(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("[updater] failed to resolve current executable path: {e}"))?;

    // Walk up from <Bundle>.app/Contents/MacOS/<binary> → <Bundle>.app
    let bundle_path = exe
        .parent() // …/Contents/MacOS/
        .and_then(|p| p.parent()) // …/Contents/
        .and_then(|p| p.parent()) // …/<Bundle>.app/
        .ok_or_else(|| {
            format!("[updater] cannot derive .app bundle path from executable path: {exe:?}")
        })?
        .to_path_buf();

    log::info!("[updater] relaunching updated app bundle: {bundle_path:?}");

    // `open -n` forces a fresh launch from the bundle's current location on
    // disk even if the current process is still alive.  Because we call
    // `app.exit(0)` immediately afterward, the old process will have exited
    // before the new instance reaches the single-instance check.
    std::process::Command::new("open")
        .args([
            "-n",
            bundle_path
                .to_str()
                .ok_or("[updater] app bundle path contains non-UTF-8 characters")?,
        ])
        .spawn()
        .map_err(|e| format!("[updater] failed to open updated bundle via 'open -n': {e}"))?;

    // Exit the current (old) process cleanly.
    app.exit(0);

    // `app.exit` schedules an exit through the Tauri event loop and returns
    // (it does not call std::process::exit directly), so we must return Ok here.
    Ok(())
}

// =============================================================================
// CLI Tool Detection
// =============================================================================

/// Check which CLI tools (claude, codex, opencode) are available in PATH.
/// Returns a map of tool name → available boolean.
#[tauri::command]
pub async fn check_cli_tools() -> Result<std::collections::HashMap<String, bool>, String> {
    use crate::providers::cli::augmented_path;
    let path = augmented_path();
    let tools = ["claude", "codex", "opencode"];
    let mut result = std::collections::HashMap::new();
    for tool in &tools {
        let found = std::process::Command::new("which")
            .arg(tool)
            .env("PATH", &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        result.insert(tool.to_string(), found);
    }
    Ok(result)
}

/// List available models for a CLI tool (currently only opencode supports this).
#[tauri::command]
pub async fn list_cli_models(tool: String) -> Result<Vec<String>, String> {
    use crate::providers::cli::augmented_path;
    if tool != "opencode" {
        return Ok(vec![]);
    }
    let path = augmented_path();
    let output = Command::new("opencode")
        .arg("models")
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to run 'opencode models': {e}"))?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let models: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(models)
}

// =============================================================================
// Evolve State Commands
// =============================================================================

#[tauri::command]
pub async fn routing_state_get(app: AppHandle) -> Result<evolve_state::EvolveState, String> {
    let state = evolve_state::get(&app).map_err(|e| capture_err("routing_state_get", e))?;
    // Recompute step from live git status to surface manual changes
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("routing_state_get", e))?;
    let changes = git::status(&dir)
        .map(|s| s.changes)
        .unwrap_or_default();
    evolve_state::set(&app, state, &changes).map_err(|e| capture_err("routing_state_get", e))
}

/// Clear evolve state back to idle (called after a successful git commit).
#[tauri::command]
pub async fn routing_state_clear(app: AppHandle) -> Result<evolve_state::EvolveState, String> {
    evolve_state::clear(&app).map_err(|e| capture_err("routing_state_clear", e))
}

// =============================================================================
// Editor Commands
// =============================================================================

/// Read a file relative to the config directory.
#[tauri::command]
pub async fn editor_read_file(app: AppHandle, rel_path: String) -> Result<String, String> {
    editor::read_file(&app, &rel_path).await
}

/// Write a file relative to the config directory.
#[tauri::command]
pub async fn editor_write_file(
    app: AppHandle,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    editor::write_file(&app, &rel_path, &content).await
}

/// List files in the config directory.
#[tauri::command]
pub async fn editor_list_files(app: AppHandle) -> Result<Vec<editor::FileEntry>, String> {
    editor::list_files(&app).await
}

// =============================================================================
// LSP Commands
// =============================================================================

/// Start the nixd LSP server.
#[tauri::command]
pub async fn lsp_start(app: AppHandle) -> Result<(), String> {
    lsp::start(&app).await
}

/// Send a JSON-RPC message to nixd.
#[tauri::command]
pub async fn lsp_send(message: String) -> Result<(), String> {
    lsp::send(&message).await
}

/// Stop the nixd LSP server.
#[tauri::command]
pub async fn lsp_stop() -> Result<(), String> {
    lsp::stop().await
}
