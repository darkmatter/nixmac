use async_openai::types::CreateChatCompletionResponse;
use chrono::Local;
use log::{error, info};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Returns the daily-rotated JSONL path for the given prefix.
///
/// Files land in `~/Library/Application Support/nixmac/logs/{prefix}_YYYY-MM-DD.jsonl`.
pub fn log_path_for_today(prefix: &str) -> PathBuf {
    let date = Local::now().format("%Y-%m-%d");
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("nixmac")
        .join("logs")
        .join(format!("{prefix}_{date}.jsonl"))
}

/// Checks `NIXMAC_RECORD_COMPLETIONS`, ensures the log directory exists, and
/// logs the target path. Returns `true` when recording should be enabled.
pub fn init_recording(prefix: &str, label: &str) -> bool {
    if std::env::var_os("NIXMAC_RECORD_COMPLETIONS").is_none() {
        return false;
    }

    let path = log_path_for_today(prefix);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            error!(
                "Failed to create completion-recording log directory {}: {}",
                parent.display(),
                e
            );
            return false;
        }
    }

    info!(
        "NIXMAC_RECORD_COMPLETIONS is set; recording raw {label} completion JSONL to {} (daily rotated)",
        path.display()
    );
    true
}

/// Appends a single serialized `CreateChatCompletionResponse` line to the
/// daily JSONL file for `prefix`. No-ops when `record_completions` is false.
pub fn append_jsonl(record_completions: bool, prefix: &str, response: &CreateChatCompletionResponse) {
    if !record_completions {
        return;
    }

    let path = log_path_for_today(prefix);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            error!(
                "Failed to create completion-recording log directory {}: {}",
                parent.display(),
                e
            );
            return;
        }
    }

    let line = match serde_json::to_string(response) {
        Ok(json) => json,
        Err(e) => {
            error!("Failed to serialize provider response for JSONL recording: {}", e);
            return;
        }
    };

    let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => file,
        Err(e) => {
            error!("Failed to open completion-recording file {}: {}", path.display(), e);
            return;
        }
    };

    if let Err(e) = writeln!(file, "{}", line) {
        error!("Failed to append completion JSONL to {}: {}", path.display(), e);
    }
}
