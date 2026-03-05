//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.

use crate::{
    darwin, db, default_config, evolution, feedback, find_summary, git, nix, peek, permissions,
    scanner, store, summarize, types,
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
    store::set_config_dir(&app, &dir).map_err(|e| capture_err("config_set_dir", e))?;
    store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_set_dir", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Opens a native folder picker dialog to select the flake directory.
#[tauri::command]
pub async fn config_pick_dir(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .set_title(
            "Select Configuration Directory - TIP: press '⌘'+'⇧'+'.' to show hidden directories",
        )
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

// =============================================================================
// Git Commands
// =============================================================================

/// Initializes a git repository in the config directory if one doesn't exist.
#[tauri::command]
pub async fn git_init_if_needed(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_init_if_needed", e))?;
    git::init_if_needed(&dir).map_err(|e| capture_err("git_init_if_needed", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Returns the current git status of the config directory.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_status", e))?;
    git::init_if_needed(&dir).map_err(|e| capture_err("git_status", e))?;
    let status = git::status(&dir).map_err(|e| capture_err("git_status", e))?;
    Ok(status)
}

/// Returns the current git status and caches it for later comparison.
#[tauri::command]
pub async fn git_status_and_cache(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("git_status_and_cache", e))?;
    git::init_if_needed(&dir).map_err(|e| capture_err("git_status_and_cache", e))?;
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
pub async fn git_commit(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_commit", e))?;
    let commit_info = git::commit_all(&dir, &message).map_err(|e| capture_err("git_commit", e))?;

    // Save commit to database
    if let Ok(db_path) = db::get_db_path(&app) {
        match db::commits::insert_commit(
            &db_path,
            &commit_info.hash,
            &commit_info.tree_hash,
            &message,
        ) {
            Ok(id) => log::info!(
                "[git_commit] Saved commit to database (id={}, hash={})",
                id,
                &commit_info.hash[..8]
            ),
            Err(e) => log::error!("[git_commit] Failed to save commit: {}", e),
        }
    }

    Ok(serde_json::json!({"ok": true, "hash": commit_info.hash}))
}

/// Stash changes
#[tauri::command]
pub async fn git_stash(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_stash", e))?;
    git::stash(&dir, &message).map_err(|e| capture_err("git_stash", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Stage all changes (git add -A)
#[tauri::command]
pub async fn git_stage_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_stage_all", e))?;
    git::stage_all(&dir).map_err(|e| capture_err("git_stage_all", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Unstage all staged changes (keeps working directory changes)
#[tauri::command]
pub async fn git_unstage_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_unstage_all", e))?;
    git::unstage_all(&dir).map_err(|e| capture_err("git_unstage_all", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Discard all uncommitted changes (restore to HEAD)
#[tauri::command]
pub async fn git_restore_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_restore_all", e))?;
    git::restore_all(&dir).map_err(|e| capture_err("git_restore_all", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Creates and checks out a new branch
#[tauri::command]
pub async fn git_checkout_new_branch(
    app: AppHandle,
    branch_name: String,
) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("git_checkout_new_branch", e))?;
    let created_branch = git::checkout_new_branch(&dir, &branch_name)
        .map_err(|e| capture_err("git_checkout_new_branch", e))?;
    Ok(serde_json::json!({"ok": true, "branch": created_branch}))
}

/// Checks out an existing branch
#[tauri::command]
pub async fn git_checkout_branch(
    app: AppHandle,
    branch_name: String,
) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_checkout_branch", e))?;
    git::checkout_branch(&dir, &branch_name).map_err(|e| capture_err("git_checkout_branch", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Checks out the main branch (tries main, falls back to master)
#[tauri::command]
pub async fn git_checkout_main_branch(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("git_checkout_main_branch", e))?;
    git::checkout_main_branch(&dir).map_err(|e| capture_err("git_checkout_main_branch", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Adds the nixmac-built tag to HEAD
#[tauri::command]
pub async fn git_tag_as_built(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_tag_as_built", e))?;
    git::tag_as_built(&dir).map_err(|e| capture_err("git_tag_as_built", e))?;
    Ok(serde_json::json!({"ok": true}))
}

/// Finalizes an evolve by merging the branch to main
#[tauri::command]
pub async fn git_finalize_evolve(
    app: AppHandle,
    branch_name: String,
    squash: Option<bool>,
    commit_message: Option<String>,
) -> Result<serde_json::Value, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("git_finalize_evolve", e))?;
    git::finalize_evolve(
        &dir,
        &branch_name,
        squash.unwrap_or(false),
        commit_message.as_deref(),
    )
    .map_err(|e| capture_err("git_finalize_evolve", e))?;
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

/// Handles the complete evolution cycle returning the git status and summary to react
#[tauri::command]
pub async fn darwin_evolve(
    app: AppHandle,
    description: String,
) -> Result<serde_json::Value, String> {
    // Reset cancellation flag at the start of a new evolution
    reset_evolve_cancelled();

    let result = evolution::evolve_and_commit(&app, &description)
        .await
        .map_err(|e| capture_err("darwin_evolve", e))?;

    Ok(serde_json::to_value(result).unwrap_or_default())
}

/// Cancel an in-progress evolution operation.
#[tauri::command]
pub async fn darwin_evolve_cancel() -> Result<serde_json::Value, String> {
    EVOLVE_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
    log::info!("Evolution cancellation requested");
    Ok(serde_json::json!({"ok": true, "message": "Cancellation requested"}))
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

/// Finalize a successful darwin-rebuild, commits and records manual changes when detected.
#[tauri::command]
pub async fn finalize_apply(app: AppHandle) -> Result<serde_json::Value, String> {
    let result = crate::finalize_apply::finalize_apply(&app)
        .await
        .map_err(|e| capture_err("finalize_apply", e))?;
    Ok(serde_json::to_value(result).unwrap_or_default())
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

/// Returns the cached summary if available.
#[tauri::command]
pub async fn summary_get_cached(app: AppHandle) -> Result<Option<types::SummaryResponse>, String> {
    store::get_cached_summary(&app).map_err(|e| e.to_string())
}

/// Finds the relevant summary for the current git state, flags availability.
#[tauri::command]
pub async fn find_summary(app: AppHandle) -> Result<Option<types::SummaryResponse>, String> {
    let result = find_summary::find_summary(&app).map_err(|e| e.to_string())?;
    let _ = store::set_summary_available(&app, result.is_some());
    Ok(result)
}

#[tauri::command]
pub async fn summarize_changes(app: AppHandle) -> Result<types::SummaryResponse, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("summarize_changes", e))?;

    // Get git status for diff and file list
    let status = git::status(&dir).map_err(|e| capture_err("summarize_changes", e))?;
    let diff = &status.diff;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    // Try to generate AI summary, but don't fail if it errors (e.g., no API key)
    let (items, instructions, commit_message) =
        match summarize::summarize_for_preview(diff, &file_list, Some(&app)).await {
            Ok((change_summary, msg)) => {
                let items: Vec<types::SummaryItem> = change_summary
                    .items
                    .into_iter()
                    .map(|item| types::SummaryItem {
                        title: item.title,
                        description: item.description,
                    })
                    .collect();
                (items, change_summary.instructions, msg)
            }
            Err(e) => {
                log::error!("[summarize_changes] AI summarization failed: {}", e);
                // Return empty summary on error
                (Vec::new(), String::new(), String::new())
            }
        };

    let response = types::SummaryResponse {
        items,
        instructions,
        commit_message,
        diff: status.diff.clone(),
    };

    // Cache the summary and mark it as available
    let _ = store::set_cached_summary(&app, &response);
    let _ = store::set_summary_available(&app, true);

    Ok(response)
}

/// Generates just a commit message suggestion based on current changes.
#[tauri::command]
pub async fn suggest_commit_message(app: AppHandle) -> Result<String, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("suggest_commit_message", e))?;

    // Get git status which includes diff
    let status = git::status(&dir).map_err(|e| capture_err("suggest_commit_message", e))?;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    let message = summarize::generate_commit_message(&status.diff, &file_list, Some(&app))
        .await
        .map_err(|e| capture_err("suggest_commit_message", e))?;

    Ok(message)
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

    let max_iterations = Some(store::get_max_iterations(&app).unwrap_or(50));
    let max_build_attempts = Some(store::get_max_build_attempts(&app).unwrap_or(5));
    let ollama_api_base_url: Option<String> =
        store::get_ollama_api_base_url(&app).map_err(|e| capture_err("ui_get_prefs", e))?;

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
        send_diagnostics,
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
    if let Some(send_diagnostics) = prefs.get("sendDiagnostics").and_then(|v| v.as_bool()) {
        store::set_send_diagnostics(&app, send_diagnostics)
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
