//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.

use crate::{darwin, git, nix, peek, permissions, store, summarize, template, types, watcher};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// =============================================================================
// Helpers
// =============================================================================
fn capture_err<E: std::fmt::Display>(e: E) -> String {
    sentry::capture_message(&e.to_string(), sentry::Level::Error);
    e.to_string()
}

// =============================================================================
// Configuration Commands
// =============================================================================

/// Returns the current configuration including the flake directory and host attribute.
#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(capture_err)?;
    let host_attr = store::get_host_attr(&app)
        .map_err(capture_err)?
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
    store::set_host_attr(&app, &host).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets the flake configuration directory path.
#[tauri::command]
pub async fn config_set_dir(app: AppHandle, dir: String) -> Result<serde_json::Value, String> {
    store::set_config_dir(&app, &dir).map_err(capture_err)?;
    store::ensure_config_dir_exists(&app).map_err(capture_err)?;
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
        store::set_config_dir(&app, &dir).map_err(capture_err)?;
        store::ensure_config_dir_exists(&app).map_err(capture_err)?;
        return Ok(Some(dir));
    }

    Ok(None)
}

/// Checks if a flake.nix exists in the config directory
#[tauri::command]
pub async fn flake_exists(app: AppHandle) -> Result<bool, String> {
    let dir = store::get_config_dir(&app).map_err(capture_err)?;
    Ok(Path::new(&dir).join("flake.nix").exists())
}

/// Helper function to detect the Darwin platform (aarch64 or x86_64)
fn detect_darwin_platform() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "aarch64-darwin"
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        "x86_64-darwin"
    }
}

#[tauri::command]
pub async fn bootstrap_default_config(app: AppHandle, hostname: String) -> Result<(), String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    let path = Path::new(&dir);

    if path.join("flake.nix").exists() {
        return Err("Directory already contains flake.nix".to_string());
    }

    // Initialize flake from template
    let init_result = Command::new("nix")
        .args(["flake", "init", "-t", "github:darkmatter/nixmac"])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(capture_err)?;

    if !init_result.status.success() {
        return Err(format!(
            "Failed to initialize flake: {}",
            String::from_utf8_lossy(&init_result.stderr)
        ));
    }

    // Build template context with configuration values
    let mut context = template::TemplateContext::new();
    context
        .insert_str("hostname", &hostname)
        .insert_str("platform", detect_darwin_platform());

    // Process all template files in the directory
    for entry in fs::read_dir(path).map_err(capture_err)? {
        let entry = entry.map_err(capture_err)?;
        let file_path = entry.path();

        if file_path.is_file() {
            if let Some(ext) = file_path.extension() {
                if ext == "nix" {
                    // Read and render the template
                    let content = fs::read_to_string(&file_path).map_err(capture_err)?;

                    let rendered =
                        template::render_string(&content, &context).map_err(capture_err)?;

                    fs::write(&file_path, rendered).map_err(capture_err)?;
                }
            }
        }
    }

    git::init_if_needed(&dir).map_err(capture_err)?;

    git::stage_all(&dir).map_err(capture_err)?;

    let flake_lock_result = Command::new("nix")
        .args(["flake", "lock"])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(capture_err)?;
    if !flake_lock_result.status.success() {
        return Err(format!(
            "Failed to generate flake.lock: {}",
            String::from_utf8_lossy(&flake_lock_result.stderr)
        ));
    }

    git::stage_all(&dir).map_err(capture_err)?;
    git::commit_all(&dir, "Initial nix-darwin configuration").map_err(capture_err)?;

    Ok(())
}

// =============================================================================
// Git Commands
// =============================================================================

/// Initializes a git repository in the config directory if one doesn't exist.
#[tauri::command]
pub async fn git_init_if_needed(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::init_if_needed(&dir).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Returns the current git status of the config directory.
#[tauri::command]
pub async fn git_status(app: AppHandle) -> Result<types::GitStatus, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::init_if_needed(&dir).map_err(capture_err)?;
    let status = git::status(&dir).map_err(capture_err)?;
    Ok(status)
}

/// Stages all changes and creates a commit with the given message.
#[tauri::command]
pub async fn git_commit(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::commit_all(&dir, &message).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Stash changes
#[tauri::command]
pub async fn git_stash(app: AppHandle, message: String) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::stash(&dir, &message).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Stage all changes (git add -A)
#[tauri::command]
pub async fn git_stage_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::stage_all(&dir).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Unstage all staged changes (keeps working directory changes)
#[tauri::command]
pub async fn git_unstage_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::unstage_all(&dir).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Discard all uncommitted changes (restore to HEAD)
#[tauri::command]
pub async fn git_restore_all(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    git::restore_all(&dir).map_err(capture_err)?;
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

/// Uses AI (codex) to propose configuration changes based on a description.
#[tauri::command]
pub async fn darwin_evolve(
    app: AppHandle,
    description: String,
) -> Result<serde_json::Value, String> {
    // Reset cancellation flag at the start of a new evolution
    reset_evolve_cancelled();

    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    let evolution = darwin::start_evolve(&app, &dir, &description)
        .await
        .map_err(capture_err)?;
    Ok(serde_json::to_value(evolution).unwrap_or_default())
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
    let _dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
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
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;

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

    darwin::apply_stream(&app, &dir, &host).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Placeholder for canceling an in-progress apply operation.
#[tauri::command]
pub async fn darwin_apply_stream_cancel(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;

    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(&dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(capture_err)?;
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
        .map_err(capture_err)?;
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
        .map_err(capture_err)?;
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
        .map_err(capture_err)?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout previous branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // TODO: Implement actual cancellation by tracking the child process
    Ok(serde_json::json!({"ok": true}))
}

#[tauri::command]
pub async fn flake_installed_apps(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;

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

    let apps = nix::evaluate_installed_apps(&dir, &host).map_err(capture_err)?;
    Ok(apps)
}

/// Lists all darwinConfigurations defined in the flake.
#[tauri::command]
pub async fn flake_list_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    let hosts = nix::list_darwin_hosts(&dir).map_err(capture_err)?;
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

/// Generates a human-readable summary of the current working changes.
/// Uses a fast model for quick response times.
#[tauri::command]
/// Gets a full diff including both tracked changes and untracked files.
/// Untracked files are formatted as diffs showing the entire file as added.
fn get_full_diff(dir: &str) -> Result<String, String> {
    // Get git diff for tracked files
    let diff_output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(capture_err)?;

    let mut diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // Also get untracked files and show their contents as diffs
    let untracked_output = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()
        .map_err(capture_err)?;

    let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

    for file in untracked_files.lines() {
        if file.is_empty() {
            continue;
        }
        let file_path = std::path::Path::new(dir).join(file);
        if let Ok(contents) = std::fs::read_to_string(&file_path) {
            // Format as a diff showing the entire file as added
            diff.push_str(&format!("\ndiff --git a/{} b/{}\n", file, file));
            diff.push_str("new file mode 100644\n");
            diff.push_str("--- /dev/null\n");
            diff.push_str(&format!("+++ b/{}\n", file));
            let line_count = contents.lines().count();
            diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
            for line in contents.lines() {
                diff.push_str(&format!("+{}\n", line));
            }
        }
    }

    Ok(diff)
}

#[tauri::command]
pub async fn summarize_changes(app: AppHandle) -> Result<types::SummaryResponse, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;

    let diff = get_full_diff(&dir)?;

    // Count additions and deletions from diff
    let (additions, deletions) = count_diff_changes(&diff);

    // Get list of changed files
    let status = git::status(&dir).map_err(capture_err)?;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    // Try to generate AI summary, but don't fail if it errors (e.g., no API key)
    let (items, instructions, commit_message) =
        match summarize::summarize_for_preview(&diff, &file_list, Some(&app)).await {
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
                eprintln!("[summarize_changes] AI summarization failed: {}", e);
                // Return empty summary but still include the diff
                (Vec::new(), String::new(), String::new())
            }
        };

    let response = types::SummaryResponse {
        items,
        instructions,
        commit_message,
        files_changed: file_list.len(),
        diff_lines: diff.lines().count(),
        additions,
        deletions,
        diff,
    };

    // Cache the summary for future app launches
    if let Err(e) = store::set_cached_summary(&app, &response) {
        eprintln!("[summarize_changes] Failed to cache summary: {}", e);
    }

    Ok(response)
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
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;

    let diff = get_full_diff(&dir)?;

    // Get list of changed files
    let status = git::status(&dir).map_err(capture_err)?;
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    let message = summarize::generate_commit_message(&diff, &file_list, Some(&app))
        .await
        .map_err(capture_err)?;

    Ok(message)
}

// =============================================================================
// UI Preference Commands
// =============================================================================

/// Returns all UI preferences.
#[tauri::command]
pub async fn ui_get_prefs(app: AppHandle) -> Result<types::UiPrefs, String> {
    let floating_footer = store::get_floating_footer(&app).map_err(capture_err)?;
    let window_shadow = store::get_window_shadow(&app).map_err(capture_err)?;
    let openrouter_api_key = store::get_openrouter_api_key(&app).map_err(capture_err)?;
    let openai_api_key = store::get_openai_api_key(&app).map_err(capture_err)?;

    let evolve_provider = store::get_evolve_provider(&app).map_err(capture_err)?;
    let evolve_model = store::get_evolve_model(&app).map_err(capture_err)?;
    let summary_provider = store::get_summary_provider(&app).map_err(capture_err)?;
    let summary_model = store::get_summary_model(&app).map_err(capture_err)?;

    let max_iterations = Some(store::get_max_iterations(&app).unwrap_or(50));
    let max_build_attempts = Some(store::get_max_build_attempts(&app).unwrap_or(5));
    let ollama_api_base_url: Option<String> =
        store::get_ollama_api_base_url(&app).map_err(capture_err)?;

    Ok(types::UiPrefs {
        floating_footer,
        window_shadow,
        openrouter_api_key,
        openai_api_key,

        evolve_provider,
        evolve_model,
        summary_provider,
        summary_model,

        max_iterations,
        max_build_attempts,

        ollama_api_base_url,
    })
}

/// Updates UI preferences from a partial JSON object.
#[tauri::command]
pub async fn ui_set_prefs(
    app: AppHandle,
    prefs: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let Some(floating_footer) = prefs.get("floatingFooter").and_then(|v| v.as_bool()) {
        store::set_floating_footer(&app, floating_footer).map_err(capture_err)?;
    }
    if let Some(window_shadow) = prefs.get("windowShadow").and_then(|v| v.as_bool()) {
        store::set_window_shadow(&app, window_shadow).map_err(capture_err)?;
    }
    if let Some(openrouter_api_key) = prefs.get("openrouterApiKey").and_then(|v| v.as_str()) {
        store::set_openrouter_api_key(&app, openrouter_api_key).map_err(capture_err)?;
    }
    if let Some(openai_api_key) = prefs.get("openaiApiKey").and_then(|v| v.as_str()) {
        store::set_openai_api_key(&app, openai_api_key).map_err(capture_err)?;
    }
    if let Some(evolve_provider) = prefs.get("evolveProvider").and_then(|v| v.as_str()) {
        store::set_evolve_provider(&app, evolve_provider).map_err(capture_err)?;
    }
    if let Some(evolve_model) = prefs.get("evolveModel").and_then(|v| v.as_str()) {
        store::set_evolve_model(&app, evolve_model).map_err(capture_err)?;
    }
    if let Some(summary_provider) = prefs.get("summaryProvider").and_then(|v| v.as_str()) {
        store::set_summary_provider(&app, summary_provider).map_err(capture_err)?;
    }
    if let Some(summary_model) = prefs.get("summaryModel").and_then(|v| v.as_str()) {
        store::set_summary_model(&app, summary_model).map_err(capture_err)?;
    }
    if let Some(max_iterations) = prefs.get("maxIterations").and_then(|v| v.as_u64()) {
        store::set_max_iterations(&app, max_iterations as usize).map_err(capture_err)?;
    }
    if let Some(max_build_attempts) = prefs.get("maxBuildAttempts").and_then(|v| v.as_u64()) {
        store::set_max_build_attempts(&app, max_build_attempts as usize).map_err(capture_err)?;
    }
    if let Some(ollama_api_base_url) = prefs.get("ollamaApiBaseUrl").and_then(|v| v.as_str()) {
        store::set_ollama_api_base_url(&app, ollama_api_base_url).map_err(capture_err)?;
    }

    Ok(serde_json::json!({"ok": true}))
}

/// Toggles the window shadow effect.
#[tauri::command]
pub async fn ui_set_window_shadow(app: AppHandle, on: bool) -> Result<serde_json::Value, String> {
    store::set_window_shadow(&app, on).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Gets the cached list of models for a provider.
#[tauri::command]
pub async fn get_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<Option<Vec<String>>, String> {
    store::get_cached_models(&app, &provider).map_err(capture_err)
}

/// Clears the cached models for a provider.
#[tauri::command]
pub async fn clear_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<serde_json::Value, String> {
    store::clear_cached_models(&app, &provider).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Sets the cached list of models for a provider.
#[tauri::command]
pub async fn set_cached_models(
    app: AppHandle,
    provider: String,
    models: Vec<String>,
) -> Result<serde_json::Value, String> {
    store::set_cached_models(&app, &provider, &models).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Window Commands
// =============================================================================

/// Shows and focuses the main window (used by preview indicator).
#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_main_window(&app).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

// =============================================================================
// Preview Indicator Commands
// =============================================================================

/// Shows the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_show(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::show_preview_indicator(&app).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Hides the preview indicator window.
#[tauri::command]
pub async fn preview_indicator_hide(app: AppHandle) -> Result<serde_json::Value, String> {
    peek::hide_preview_indicator(&app).map_err(capture_err)?;
    Ok(serde_json::json!({"ok": true}))
}

/// Updates the preview indicator state.
#[tauri::command]
pub async fn preview_indicator_update(
    app: AppHandle,
    state: peek::PreviewIndicatorState,
) -> Result<serde_json::Value, String> {
    peek::update_preview_indicator(&app, state).map_err(capture_err)?;
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
// Config Watcher Commands
// =============================================================================

/// Starts watching the config directory for changes.
/// Emits `config:changed` events when files are modified.
#[tauri::command]
pub async fn watcher_start(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = store::ensure_config_dir_exists(&app).map_err(capture_err)?;
    watcher::start_watching(app, dir, 2500);
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
    permissions::request_permission(&permission_id).map_err(capture_err)
}

/// Check if all required permissions are granted.
#[tauri::command]
pub async fn permissions_all_required_granted() -> Result<bool, String> {
    Ok(permissions::all_required_permissions_granted())
}
