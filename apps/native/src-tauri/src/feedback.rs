//! Feedback metadata gathering for user submissions.
//!
//! Collects diagnostic information based on user opt-in preferences collected
//! from the frontend.
//! All collection respects the ShareOptions flags provided by the user.

use crate::{git, nix, store, types};
use anyhow::{Context, Result};
use chrono::Utc;
use log::{debug, warn};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

// Number of lines to include when attaching app logs
const APP_LOG_LAST_LINES: usize = 200;

// =============================================================================
// System Information Gathering
// =============================================================================

/// Get macOS version using sw_vers command
fn get_macos_version() -> Option<String> {
    let output = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;

    if output.status.success() {
        String::from_utf8(output.stdout)
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    }
}

/// Gather system information
pub fn gather_system_info(app: &AppHandle) -> types::FeedbackSystemInfo {
    let app_version = app.package_info().version.to_string();
    let os_name = Some(std::env::consts::OS.to_string());
    let arch = Some(std::env::consts::ARCH.to_string());
    let os_version = get_macos_version();
    let nix_version = nix::get_nix_version();

    types::FeedbackSystemInfo {
        os_name,
        os_version,
        arch,
        nix_version,
        app_version: Some(app_version),
    }
}

// =============================================================================
// App Logs Collection
// =============================================================================

/// Get the nixmac logs directory path
fn get_logs_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home).join("Library/Logs/nixmac"))
}

/// Read the last N lines from a file efficiently
fn read_last_n_lines(path: &Path, n: usize) -> Result<String> {
    let content = fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().collect();

    let start = if lines.len() > n { lines.len() - n } else { 0 };
    let last_lines = &lines[start..];

    Ok(last_lines.join("\n"))
}

/// Find the most recent darwin-rebuild log file
fn find_most_recent_darwin_log() -> Option<PathBuf> {
    let log_dir = get_logs_dir().ok()?;

    if !log_dir.exists() {
        return None;
    }

    let mut log_files: Vec<_> = fs::read_dir(&log_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("darwin-rebuild_")
                && entry.file_name().to_string_lossy().ends_with(".log")
        })
        .collect();

    // Sort by modification time, most recent first. Use a comparator that
    // handles `Option<SystemTime>` explicitly so entries with metadata
    // errors (None) don't sort ahead of valid files.
    log_files.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();

        match (ma, mb) {
            (Some(ta), Some(tb)) => tb.cmp(&ta),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });

    // After sorting most-recent-first, take the first entry if present
    log_files.first().map(|entry| entry.path())
}

/// Gather app logs - collects last 200 lines from the most recent darwin-rebuild log
pub fn gather_app_logs() -> Option<String> {
    match find_most_recent_darwin_log() {
        Some(log_path) => {
            debug!("Found most recent log: {:?}", log_path);
            match read_last_n_lines(&log_path, APP_LOG_LAST_LINES) {
                Ok(content) => Some(content),
                Err(e) => {
                    warn!("Failed to read log file: {}", e);
                    None
                }
            }
        }
        None => {
            debug!("No darwin-rebuild logs found");
            None
        }
    }
}

// =============================================================================
// Evolution Log Collection
// =============================================================================

/// Gather the most recent evolution log from stored metadata
pub fn gather_evolution_log(app: &AppHandle) -> Option<String> {
    let store = store::get_store(app).ok()?;

    let metadata = store.get("evolveMetadata")?;
    let metadata_str = metadata.as_str()?;

    // The stored metadata is already a JSON string of the Evolution struct
    // We'll parse it to validate it's proper JSON and return it formatted
    match serde_json::from_str::<Value>(metadata_str) {
        Ok(json) => {
            // Return pretty-printed JSON for readability
            serde_json::to_string_pretty(&json).ok()
        }
        Err(e) => {
            warn!("Failed to parse evolution metadata: {}", e);
            None
        }
    }
}

/// Extract build check error output from evolution metadata (if available).
///
/// Note: this scans stored evolution messages for build-check failures, so it
/// will be empty if no evolve metadata exists or no build check failed.
pub fn extract_build_error_output(app: &AppHandle) -> Option<String> {
    let store = store::get_store(app).ok()?;

    let metadata = store.get("evolveMetadata")?;
    let metadata_str = metadata.as_str()?;

    let json: Value = serde_json::from_str(metadata_str).ok()?;
    let messages = json.get("messages")?.as_array()?;

    let mut last_error: Option<String> = None;
    for message in messages {
        if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
            if content.contains("Build check FAILED") || content.contains("Build check failed") {
                last_error = Some(content.to_string());
            }
        }
    }

    last_error
}

fn extract_evolution_stats(
    app: &AppHandle,
) -> (Option<u32>, Option<i64>, Option<usize>, Option<usize>) {
    let store = match store::get_store(app) {
        Ok(store) => store,
        Err(_) => return (None, None, None, None),
    };

    let metadata = match store.get("evolveMetadata") {
        Some(metadata) => metadata,
        None => return (None, None, None, None),
    };
    let metadata_str = match metadata.as_str() {
        Some(metadata_str) => metadata_str,
        None => return (None, None, None, None),
    };

    let json: Value = match serde_json::from_str(metadata_str) {
        Ok(json) => json,
        Err(_) => return (None, None, None, None),
    };

    let total_tokens = json
        .get("totalTokens")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let iterations = json
        .get("iterations")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);
    let build_attempts = json
        .get("buildAttempts")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    let mut max_timestamp_ms: Option<i64> = None;
    for key in ["toolCalls", "thinking"] {
        if let Some(entries) = json.get(key).and_then(|v| v.as_array()) {
            for entry in entries {
                if let Some(timestamp_ms) = entry.get("timestampMs").and_then(|v| v.as_i64()) {
                    max_timestamp_ms = Some(
                        max_timestamp_ms.map_or(timestamp_ms, |current| current.max(timestamp_ms)),
                    );
                }
            }
        }
    }

    (total_tokens, max_timestamp_ms, iterations, build_attempts)
}

/// Gather AI provider/model details and basic usage/latency stats.
///
/// Note: provider/model come from stored prefs; usage/latency are derived from
/// evolve metadata. If those are missing, this returns None or partial data.
pub fn gather_ai_provider_model_info(
    app: &AppHandle,
) -> Option<types::FeedbackAiProviderModelInfo> {
    let evolve_provider = store::get_evolve_provider(app).ok().flatten();
    let evolve_model = store::get_evolve_model(app).ok().flatten();
    let summary_provider = store::get_summary_provider(app).ok().flatten();
    let summary_model = store::get_summary_model(app).ok().flatten();

    let (total_tokens, latency_ms, iterations, build_attempts) = extract_evolution_stats(app);

    if evolve_provider.is_none()
        && evolve_model.is_none()
        && summary_provider.is_none()
        && summary_model.is_none()
        && total_tokens.is_none()
        && latency_ms.is_none()
        && iterations.is_none()
        && build_attempts.is_none()
    {
        return None;
    }

    Some(types::FeedbackAiProviderModelInfo {
        evolve_provider,
        evolve_model,
        summary_provider,
        summary_model,
        total_tokens,
        latency_ms,
        iterations,
        build_attempts,
    })
}

// =============================================================================
// Nix Config Snapshot
// =============================================================================

/// Recursively find all .nix files in a directory (bounded recursion)
fn find_nix_files(dir: &Path) -> Result<Vec<PathBuf>> {
    const MAX_RECURSION_DEPTH: usize = 20;

    let mut nix_files = Vec::new();

    if !dir.exists() {
        return Ok(nix_files);
    }

    fn visit_dir(path: &Path, files: &mut Vec<PathBuf>, depth: usize) -> Result<()> {
        if depth >= MAX_RECURSION_DEPTH {
            // Stop descending further to avoid potential infinite recursion
            return Ok(());
        }

        if !path.is_dir() {
            return Ok(());
        }

        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                visit_dir(&path, files, depth + 1)?;
            } else if path.extension().and_then(|s| s.to_str()) == Some("nix") {
                files.push(path);
            }
        }
        Ok(())
    }

    visit_dir(dir, &mut nix_files, 0)?;
    Ok(nix_files)
}

/// Read and concatenate all .nix files from the config directory's modules/ folder
pub fn gather_nix_config_snapshot(app: &AppHandle) -> Option<String> {
    let config_dir = store::get_config_dir(app).ok()?;
    let modules_dir = PathBuf::from(&config_dir).join("modules");

    if !modules_dir.exists() {
        debug!("No modules directory found at {:?}", modules_dir);
        return None;
    }

    match find_nix_files(&modules_dir) {
        Ok(nix_files) => {
            if nix_files.is_empty() {
                debug!("No .nix files found in modules directory");
                return None;
            }

            let mut snapshot = String::new();
            snapshot.push_str("# Nix Configuration Snapshot\n");
            snapshot.push_str(&format!("# Collected at: {}\n", Utc::now().to_rfc3339()));
            snapshot.push_str(&format!("# Total files: {}\n\n", nix_files.len()));

            for (idx, file_path) in nix_files.iter().enumerate() {
                // Get relative path from config_dir for cleaner output
                let rel_path = file_path.strip_prefix(&config_dir).unwrap_or(file_path);

                snapshot.push_str(&format!("\n{}\n", "=".repeat(70)));
                snapshot.push_str(&format!(
                    "File {}/{}: {}\n",
                    idx + 1,
                    nix_files.len(),
                    rel_path.display()
                ));
                snapshot.push_str(&format!("{}\n\n", "=".repeat(70)));

                match fs::read_to_string(file_path) {
                    Ok(content) => {
                        snapshot.push_str(&content);
                        snapshot.push('\n');
                    }
                    Err(e) => {
                        snapshot.push_str(&format!("// ERROR: Failed to read file: {}\n", e));
                    }
                }
            }

            Some(snapshot)
        }
        Err(e) => {
            warn!("Failed to find nix files: {}", e);
            None
        }
    }
}

/// Gather a git diff containing only .nix file changes (including untracked).
///
/// Note: this depends on git status/diff; it will be empty when there are no
/// changes, or if the repo hasn't been initialized.
pub fn gather_changed_nix_files_diff(app: &AppHandle) -> Option<String> {
    let config_dir = store::get_config_dir(app).ok()?;
    let diff = git::get_nix_diff(&config_dir).ok()?;
    if diff.trim().is_empty() {
        None
    } else {
        Some(diff)
    }
}

/// Gather a snapshot of key flake.lock input revisions.
///
/// Note: this only includes nixpkgs, nix-darwin, and home-manager entries, and
/// returns None if flake.lock is missing or those nodes are absent.
pub fn gather_flake_inputs_snapshot(app: &AppHandle) -> Option<types::FeedbackFlakeInputsSnapshot> {
    let config_dir = store::get_config_dir(app).ok()?;
    let lock_path = PathBuf::from(config_dir).join("flake.lock");
    let content = fs::read_to_string(lock_path).ok()?;
    let json: Value = serde_json::from_str(&content).ok()?;

    let nodes = json.get("nodes")?.as_object()?;

    let mut nixpkgs: Option<types::FeedbackFlakeInputEntry> = None;
    let mut nix_darwin: Option<types::FeedbackFlakeInputEntry> = None;
    let mut home_manager: Option<types::FeedbackFlakeInputEntry> = None;

    let extract_entry = |locked: &Value| types::FeedbackFlakeInputEntry {
        rev: locked.get("rev").and_then(|v| v.as_str()).map(String::from),
        last_modified: locked.get("lastModified").and_then(|v| v.as_i64()),
        nar_hash: locked
            .get("narHash")
            .and_then(|v| v.as_str())
            .map(String::from),
    };

    for name in ["nixpkgs", "nix-darwin", "home-manager"] {
        if let Some(node) = nodes.get(name) {
            if let Some(locked) = node.get("locked") {
                let entry = extract_entry(locked);
                if entry.rev.is_some() || entry.last_modified.is_some() || entry.nar_hash.is_some()
                {
                    match name {
                        "nixpkgs" => nixpkgs = Some(entry),
                        "nix-darwin" => nix_darwin = Some(entry),
                        "home-manager" => home_manager = Some(entry),
                        _ => {}
                    }
                }
            }
        }
    }

    if nixpkgs.is_none() && nix_darwin.is_none() && home_manager.is_none() {
        None
    } else {
        Some(types::FeedbackFlakeInputsSnapshot {
            nixpkgs,
            nix_darwin,
            home_manager,
        })
    }
}

// =============================================================================
// Current App State
// =============================================================================

/// Gather current application state snapshot
pub fn gather_app_state(app: &AppHandle, feedback_type: &str) -> Value {
    let config_dir = store::get_config_dir(app).ok();
    let host_attr = store::get_host_attr(app).ok().flatten();

    // Get evolution state if available
    let evolution_state: Option<Value> = store::get_store(app)
        .ok()
        .and_then(|store| store.get("evolveMetadata"))
        .and_then(|v| v.as_str().and_then(|s| serde_json::from_str(s).ok()))
        .map(|json: Value| {
            serde_json::json!({
                "hasEvolution": true,
                "state": json.get("state"),
                "iterations": json.get("iterations"),
                "buildAttempts": json.get("buildAttempts"),
            })
        });

    serde_json::json!({
        "configDir": config_dir,
        "hostAttr": host_attr,
        "feedbackType": feedback_type,
        "evolution": evolution_state,
        "timestamp": Utc::now().to_rfc3339(),
    })
}

// =============================================================================
// Usage Stats Collection
// =============================================================================

/// Gather usage statistics
/// NOTE: The app does not currently track usage stats persistently.
/// This returns a placeholder structure for future implementation.
pub fn gather_usage_stats() -> types::FeedbackUsageStats {
    types::FeedbackUsageStats {
        total_evolutions: None,
        success_rate: None,
        avg_iterations: None,
        last_computed_at: Some(Utc::now().to_rfc3339()),
        extra: Some(serde_json::json!({
            "status": "not_implemented",
            "note": "Usage statistics tracking not yet implemented"
        })),
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/// Master function to gather all requested feedback metadata
pub fn gather_metadata(
    app: &AppHandle,
    request: types::FeedbackMetadataRequest,
) -> Result<types::FeedbackMetadata, String> {
    let share = request.share;
    let mut metadata = types::FeedbackMetadata {
        current_app_state_snapshot: None,
        system_info: None,
        usage_stats: None,
        evolution_log_content: None,
        changed_nix_files_diff: None,
        ai_provider_model_info: None,
        build_error_output: None,
        flake_inputs_snapshot: None,
        nix_config_snapshot: None,
        app_logs_content: None,
    };

    // Gather system information
    if share.system_info {
        metadata.system_info = Some(gather_system_info(app));
    }

    // Gather current app state
    if share.current_app_state {
        metadata.current_app_state_snapshot = Some(gather_app_state(app, &request.feedback_type));
    }

    // Gather usage statistics (currently not implemented, returns placeholder)
    if share.usage_stats {
        metadata.usage_stats = Some(gather_usage_stats());
    }

    // Note: prompt text is now collected from the feedback dialog, not gathered from evolution metadata

    // Gather full evolution log
    if share.evolution_log {
        metadata.evolution_log_content = gather_evolution_log(app);
    }

    if share.changed_nix_files {
        metadata.changed_nix_files_diff = gather_changed_nix_files_diff(app);
    }

    if share.ai_provider_model_info {
        metadata.ai_provider_model_info = gather_ai_provider_model_info(app);
    }

    if share.build_error_output {
        metadata.build_error_output = extract_build_error_output(app);
    }

    if share.flake_inputs_snapshot {
        metadata.flake_inputs_snapshot = gather_flake_inputs_snapshot(app);
    }

    // Gather nix configuration snapshot
    if share.nix_config {
        metadata.nix_config_snapshot = gather_nix_config_snapshot(app);
    }

    // Gather application logs
    if share.app_logs {
        metadata.app_logs_content = gather_app_logs();
    }

    Ok(metadata)
}
