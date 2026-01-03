//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.

use crate::{darwin, git, nix, peek, store, summarize, types, watcher};
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// =============================================================================
// Configuration Commands
// =============================================================================

/// Returns the current configuration including the flake directory and host attribute.
#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| e.to_string())?;
    let host_attr = store::get_host_attr(&app)
        .map_err(|e| e.to_string())?
        .or_else(|| store::read_host_attr_from_file());

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
    store::set_host_attr(&app, &host).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets the flake configuration directory path.
#[tauri::command]
pub async fn config_set_dir(app: AppHandle, dir: String) -> Result<serde_json::Value, String> {
    store::set_config_dir(&app, &dir).map_err(|e| e.to_string())?;
    store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Opens a native folder picker dialog to select the flake directory.
#[tauri::command]
pub async fn config_pick_dir(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog();
    let result = dialog
        .file()
        .set_title("Select Configuration Directory")
        .blocking_pick_folder();

    if let Some(path) = result {
        let dir = path.to_string();
        store::set_config_dir(&app, &dir).map_err(|e| e.to_string())?;
        store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
        return Ok(Some(dir));
    }

    Ok(None)
}

// =============================================================================
// Git Commands
// =============================================================================

/// Initializes a git repository in the config directory if one doesn't exist.
#[tauri::command]
pub async fn git_init_if_needed(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    git::init_if_needed(&dir).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Returns the current git status of the config directory.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    git::init_if_needed(&dir).map_err(|e| e.to_string())?;
    let status = git::status(&dir).map_err(|e| e.to_string())?;
    Ok(status)
}

/// Stages all changes and creates a commit with the given message.
#[tauri::command]
pub async fn git_commit(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    git::commit_all(&dir, &message).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Stash changes
#[tauri::command]
pub async fn git_stash(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    git::stash(&dir, &message).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Stage all changes (git add -A)
#[tauri::command]
pub async fn git_stage_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    git::stage_all(&dir).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Darwin/Nix Commands
// =============================================================================

/// Uses AI (codex) to propose configuration changes based on a description.
#[tauri::command]
pub async fn darwin_evolve(
    app: AppHandle,
    description: String,
) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    let evolution = darwin::start_evolve(&app, &dir, &description)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(evolution).unwrap_or_default())
}

/// Legacy non-streaming apply command. Returns immediately with a hint to use streaming.
#[tauri::command]
pub async fn darwin_apply(
    app: AppHandle,
    host_override: Option<String>,
) -> Result<types::ApplyResult, String> {
    let _dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
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
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;

    // Determine which host to build for:
    // 1. Use explicit override if provided
    // 2. Fall back to stored host attribute
    // 3. Auto-select if there's only one host defined in the flake
    let host = host_override
        .or_else(|| nix::determine_host_attr(&app))
        .or_else(|| {
            let hosts = nix::list_darwin_hosts(&dir).ok()?;
            if hosts.len() == 1 {
                Some(hosts[0].clone())
            } else {
                None
            }
        })
        .ok_or_else(|| "Host attribute not found".to_string())?;

    darwin::apply_stream(&app, &dir, &host).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

/// Placeholder for canceling an in-progress apply operation.
#[tauri::command]
pub async fn darwin_apply_stream_cancel(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;

    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout previous branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // TODO: Implement actual cancellation by tracking the child process
    Ok(serde_json::json!({"ok": true}))
}

pub async fn evaluate_flake(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    let output = Command::new("nix")
        .args(["eval", "--json", ".#darwinConfigurations"])
        .current_dir(dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Failed to evaluate flake: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let flake = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(flake)
}

#[tauri::command]
pub async fn flake_installed_apps(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;

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

    let apps = nix::evaluate_installed_apps(&dir, &host).map_err(|e| e.to_string())?;
    Ok(apps)
}

/// Lists all darwinConfigurations defined in the flake.
#[tauri::command]
pub async fn flake_list_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    let hosts = nix::list_darwin_hosts(&dir).map_err(|e| e.to_string())?;
    Ok(hosts)
}

// =============================================================================
// Summarization Commands
// =============================================================================

/// Generates a human-readable summary of the current working changes.
/// Uses a fast model for quick response times.
#[tauri::command]
pub async fn summarize_changes(app: AppHandle) -> Result<types::SummaryResponse, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;

    // Get git diff
    let diff_output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| e.to_string())?;

    let diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // Count additions and deletions from diff
    let (additions, deletions) = count_diff_changes(&diff);

    // Get list of changed files
    let status = git::status(&dir).map_err(|e| e.to_string())?;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    // Generate both summary and commit message in parallel
    let (change_summary, commit_message) = summarize::summarize_for_preview(&diff, &file_list)
        .await
        .map_err(|e| e.to_string())?;

    // Convert summarize::SummaryItem to types::SummaryItem
    let items: Vec<types::SummaryItem> = change_summary
        .items
        .into_iter()
        .map(|item| types::SummaryItem {
            title: item.title,
            description: item.description,
        })
        .collect();

    Ok(types::SummaryResponse {
        items,
        instructions: change_summary.instructions,
        commit_message,
        files_changed: file_list.len(),
        diff_lines: diff.lines().count(),
        additions,
        deletions,
    })
}

/// Count additions and deletions from a unified diff.
fn count_diff_changes(diff: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;

    for line in diff.lines() {
        // Skip diff headers (--- and +++)
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        // Count added lines
        if line.starts_with('+') {
            additions += 1;
        }
        // Count deleted lines
        else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

/// Generates just a commit message suggestion based on current changes.
#[tauri::command]
pub async fn suggest_commit_message(app: AppHandle) -> Result<String, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;

    // Get git diff
    let diff_output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(|e| e.to_string())?;

    let diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // Get list of changed files
    let status = git::status(&dir).map_err(|e| e.to_string())?;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    let message = summarize::generate_commit_message(&diff, &file_list)
        .await
        .map_err(|e| e.to_string())?;

    Ok(message)
}

// =============================================================================
// UI Preference Commands
// =============================================================================

/// Returns all UI preferences.
#[tauri::command]
pub async fn ui_get_prefs(app: AppHandle) -> Result<types::UiPrefs, String> {
    let floating_footer = store::get_floating_footer(&app).map_err(|e| e.to_string())?;
    let window_shadow = store::get_window_shadow(&app).map_err(|e| e.to_string())?;
    let openai_api_key = store::get_openai_api_key(&app).map_err(|e| e.to_string())?;

    Ok(types::UiPrefs {
        floating_footer,
        window_shadow,
        openai_api_key,
    })
}

/// Updates UI preferences from a partial JSON object.
#[tauri::command]
pub async fn ui_set_prefs(
    app: AppHandle,
    prefs: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let Some(floating_footer) = prefs.get("floatingFooter").and_then(|v| v.as_bool()) {
        store::set_floating_footer(&app, floating_footer).map_err(|e| e.to_string())?;
    }
    if let Some(window_shadow) = prefs.get("windowShadow").and_then(|v| v.as_bool()) {
        store::set_window_shadow(&app, window_shadow).map_err(|e| e.to_string())?;
    }
    if let Some(openai_api_key) = prefs.get("openaiApiKey").and_then(|v| v.as_str()) {
        store::set_openai_api_key(&app, openai_api_key).map_err(|e| e.to_string())?;
    }

    Ok(serde_json::json!({"ok": true}))
}

/// Toggles the window shadow effect.
#[tauri::command]
pub async fn ui_set_window_shadow(app: AppHandle, on: bool) -> Result<serde_json::Value, String> {
    store::set_window_shadow(&app, on).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Preview Indicator Commands
// =============================================================================

/// Shows the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_show(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_preview_indicator(&app)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Hides the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_hide(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::hide_preview_indicator(&app)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Updates the preview indicator state.
#[tauri::command]
pub async fn preview_indicator_update(
    app: AppHandle,
    state: peek::PreviewIndicatorState,
) -> Result<serde_json::Value, String> {
    peek::update_preview_indicator(&app, state)?;
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
// Rebuild Overlay Commands
// =============================================================================

/// Shows the rebuild overlay window (full-screen semi-transparent overlay).
#[tauri::command]
pub async fn rebuild_overlay_show(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_rebuild_overlay(&app)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Hides the rebuild overlay window.
#[tauri::command]
pub async fn rebuild_overlay_hide(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::hide_rebuild_overlay(&app)?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Config Watcher Commands
// =============================================================================

/// Starts watching the config directory for changes.
/// Emits `config:changed` events when files are modified.
#[tauri::command]
pub async fn watcher_start(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(|e| e.to_string())?;
    watcher::start_watching(app, dir);
    Ok(serde_json::json!({"ok": true}))
}

/// Stops watching the config directory.
#[tauri::command]
pub async fn watcher_stop() -> Result<serde_json::Value, String> {
    watcher::stop_watching();
    Ok(serde_json::json!({"ok": true}))
}

/// Returns whether the watcher is currently active.
#[tauri::command]
pub async fn watcher_is_active() -> Result<bool, String> {
    Ok(watcher::is_watching())
}
