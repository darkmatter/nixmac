use async_openai::types::CreateChatCompletionResponse;
use chrono::Local;
use log::{error, info};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tokio::task::spawn_blocking;

/// Returns the daily-rotated JSONL path for the given prefix.
///
/// Files land in `~/Library/Application Support/nixmac/logs/{prefix}_YYYY-MM-DD.jsonl`
/// on a Mac.
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
        "NIXMAC_RECORD_COMPLETIONS is set; recording raw {label} completion JSONL to {}",
        path.display()
    );
    true
}

/// Appends a single serialized `CreateChatCompletionResponse` line to the
/// daily JSONL file for `prefix`. No-ops when `record_completions` is false.
///
/// The write is dispatched to a blocking thread via `spawn_blocking` so the
/// Tokio runtime is not stalled. Each append serializes to a single
/// newline-terminated buffer and writes it with `write_all`, which issues one
/// `write(2)` syscall. Combined with `O_APPEND`, this makes each line
/// effectively atomic for the typical response sizes seen here.
pub async fn append_jsonl(
    record_completions: bool,
    prefix: &str,
    response: &CreateChatCompletionResponse,
) {
    if !record_completions {
        return;
    }

    let line = match serde_json::to_string(response) {
        Ok(json) => json,
        Err(e) => {
            error!(
                "Failed to serialize provider response for JSONL recording: {}",
                e
            );
            return;
        }
    };

    let path = log_path_for_today(prefix);
    // Build the complete line buffer before entering spawn_blocking.
    let buf = format!("{line}\n").into_bytes();

    if let Err(e) = spawn_blocking(move || -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(&buf)
    })
    .await
    {
        error!("Failed to append completion JSONL for prefix '{prefix}': {e}");
    }
}
