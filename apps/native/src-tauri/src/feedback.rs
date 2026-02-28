//! Feedback metadata gathering for user submissions.
//!
//! Collects diagnostic information based on user opt-in preferences collected
//! from the frontend.
//! All collection respects the ShareOptions flags provided by the user.

use crate::{git, nix, secret_scanner, store, types};
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
            // Return pretty-printed JSON for readability (will be redacted in gather_metadata)
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

    // Will be redacted in gather_metadata
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

            // Will be redacted in gather_metadata
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
        // Will be redacted in gather_metadata
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

    // Will be redacted in gather_metadata
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

/// Gather usage statistics from persistent storage.
/// Returns current evolution counts, success rate, and average iterations.
pub fn gather_usage_stats(app: &AppHandle) -> types::FeedbackUsageStats {
    crate::statistics::get_usage_statistics(app).unwrap_or_else(|e| {
        warn!("Failed to retrieve usage statistics: {}", e);
        // Return default stats on error
        types::FeedbackUsageStats {
            total_evolutions: None,
            success_rate: None,
            avg_iterations: None,
            last_computed_at: Some(Utc::now().to_rfc3339()),
            extra: Some(serde_json::json!({
                "error": format!("Failed to load stats: {}", e)
            })),
        }
    })
}

// =============================================================================
// Redaction Helper
// =============================================================================

/// Redact all sensitive information from the feedback metadata struct
fn redact_metadata(metadata: types::FeedbackMetadata, app: &AppHandle) -> types::FeedbackMetadata {
    let scanner = secret_scanner::SecretScanner::global(app);
    let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, scanner);

    if !redacted_fields.is_empty() {
        debug!(
            "Redacted sensitive fields from feedback metadata: {:?}",
            redacted_fields
        );
    }

    metadata
}

fn redact_metadata_with_scanner(
    mut metadata: types::FeedbackMetadata,
    scanner: &secret_scanner::SecretScanner,
) -> (types::FeedbackMetadata, Vec<&'static str>) {
    let mut redacted_fields: Vec<&'static str> = Vec::new();

    // Redact all string fields
    if let Some(ref mut content) = metadata.evolution_log_content {
        let (redacted, changed) = scanner.redact_string(content);
        if changed {
            redacted_fields.push("evolution_log_content");
        }
        *content = redacted;
    }
    if let Some(ref mut content) = metadata.changed_nix_files_diff {
        let (redacted, changed) = scanner.redact_string(content);
        if changed {
            redacted_fields.push("changed_nix_files_diff");
        }
        *content = redacted;
    }
    if let Some(ref mut content) = metadata.nix_config_snapshot {
        let (redacted, changed) = scanner.redact_string(content);
        if changed {
            redacted_fields.push("nix_config_snapshot");
        }
        *content = redacted;
    }
    if let Some(ref mut content) = metadata.build_error_output {
        let (redacted, changed) = scanner.redact_string(content);
        if changed {
            redacted_fields.push("build_error_output");
        }
        *content = redacted;
    }
    if let Some(ref mut content) = metadata.app_logs_content {
        let (redacted, changed) = scanner.redact_string(content);
        if changed {
            redacted_fields.push("app_logs_content");
        }
        *content = redacted;
    }

    // Redact JSON fields
    if let Some(ref mut state) = metadata.current_app_state_snapshot {
        let (redacted, changed) = scanner.redact_json(state.clone());
        if changed {
            redacted_fields.push("current_app_state_snapshot");
        }
        *state = redacted;
    }
    if let Some(ref mut info) = metadata.ai_provider_model_info {
        // Convert to JSON, redact, convert back
        if let Ok(json) = serde_json::to_value(&*info) {
            let (redacted, changed) = scanner.redact_json(json);
            if changed {
                redacted_fields.push("ai_provider_model_info");
            }
            if let Ok(redacted_info) = serde_json::from_value(redacted) {
                *info = redacted_info;
            }
        }
    }

    (metadata, redacted_fields)
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
        panic_details: None, // Panic details are captured on the frontend
    };

    // Gather system information
    if share.system_info {
        metadata.system_info = Some(gather_system_info(app));
    }

    // Gather current app state
    if share.current_app_state {
        metadata.current_app_state_snapshot = Some(gather_app_state(app, &request.feedback_type));
    }

    // Gather usage statistics from persistent store
    if share.usage_stats {
        metadata.usage_stats = Some(gather_usage_stats(app));
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

    // Redact all collected metadata
    let metadata = redact_metadata(metadata, app);
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::{redact_metadata_with_scanner, types};
    use crate::secret_scanner::SecretScanner;
    use serde_json::json;

    fn test_scanner() -> SecretScanner {
        let toml = r#"
[[rules]]
id = "test-token"
regex = "token=([A-Za-z0-9]+)"
"#;
        SecretScanner::from_toml(toml)
    }

    fn test_scanner_no_rules() -> SecretScanner {
        let toml = r#"rules = []"#;
        SecretScanner::from_toml(toml)
    }

    fn empty_metadata() -> types::FeedbackMetadata {
        types::FeedbackMetadata {
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
            panic_details: None,
        }
    }

    #[test]
    fn redacts_string_fields() {
        let scanner = test_scanner();
        let mut metadata = empty_metadata();
        metadata.evolution_log_content = Some("token=abc123".to_string());
        metadata.changed_nix_files_diff = Some("no secrets here".to_string());
        metadata.build_error_output = Some("token=xyz".to_string());

        let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, &scanner);

        assert!(redacted_fields.contains(&"evolution_log_content"));
        assert!(redacted_fields.contains(&"build_error_output"));
        assert!(!redacted_fields.contains(&"changed_nix_files_diff"));
        assert!(metadata
            .evolution_log_content
            .unwrap()
            .contains("[REDACTED]"));
        assert_eq!(metadata.changed_nix_files_diff.unwrap(), "no secrets here");
        assert!(metadata.build_error_output.unwrap().contains("[REDACTED]"));
    }

    #[test]
    fn redacts_json_fields() {
        let scanner = test_scanner();
        let mut metadata = empty_metadata();
        metadata.current_app_state_snapshot = Some(json!({
            "token": "token=abc123",
            "nested": { "value": "token=xyz" }
        }));
        metadata.ai_provider_model_info = Some(types::FeedbackAiProviderModelInfo {
            evolve_provider: Some("token=abc123".to_string()),
            evolve_model: None,
            summary_provider: None,
            summary_model: None,
            total_tokens: None,
            latency_ms: None,
            iterations: None,
            build_attempts: None,
        });

        let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, &scanner);

        assert!(redacted_fields.contains(&"current_app_state_snapshot"));
        assert!(redacted_fields.contains(&"ai_provider_model_info"));

        let state = metadata.current_app_state_snapshot.unwrap();
        assert!(state
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("[REDACTED]"));
        assert!(state
            .get("nested")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("[REDACTED]"));

        let info = metadata.ai_provider_model_info.unwrap();
        assert!(info.evolve_provider.unwrap().contains("[REDACTED]"));
    }

    #[test]
    fn no_redaction_returns_empty_list() {
        let scanner = test_scanner();
        let mut metadata = empty_metadata();
        metadata.evolution_log_content = Some("safe text".to_string());

        let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, &scanner);

        assert!(redacted_fields.is_empty());
        assert_eq!(metadata.evolution_log_content.unwrap(), "safe text");
    }

    #[test]
    fn redacts_high_entropy_strings() {
        let scanner = test_scanner_no_rules();
        let mut metadata = empty_metadata();
        let token = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let high_entropy = format!("This log has a secret in it: {token} see how that works?");
        metadata.evolution_log_content = Some(high_entropy.to_string());

        let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, &scanner);

        assert!(redacted_fields.contains(&"evolution_log_content"));
        let content = metadata.evolution_log_content.unwrap();
        assert!(content.contains("High Entropy"));
        assert!(!content.contains(token));
        assert_eq!(
            content,
            "This log has a secret in it: [REDACTED (High Entropy)] see how that works?"
        );
    }

    #[test]
    fn redacts_high_entropy_json_values() {
        let scanner = test_scanner_no_rules();
        let mut metadata = empty_metadata();
        let token = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let message = format!("prefix {token} suffix");

        metadata.current_app_state_snapshot = Some(json!({
            "message": message,
            "nested": { "note": format!("before {token} after") }
        }));

        let (metadata, redacted_fields) = redact_metadata_with_scanner(metadata, &scanner);

        assert!(redacted_fields.contains(&"current_app_state_snapshot"));

        let state = metadata.current_app_state_snapshot.unwrap();
        assert_eq!(
            state.get("message").and_then(|v| v.as_str()).unwrap(),
            "prefix [REDACTED (High Entropy)] suffix"
        );
        assert_eq!(
            state
                .get("nested")
                .and_then(|v| v.get("note"))
                .and_then(|v| v.as_str())
                .unwrap(),
            "before [REDACTED (High Entropy)] after"
        );
    }
}
