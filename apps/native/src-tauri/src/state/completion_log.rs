use chrono::{Local, Utc};
use log::{error, info};
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tokio::task::spawn_blocking;

/// Returns the daily-rotated JSONL path for the given prefix.
///
/// Uses `NIXMAC_COMPLETION_LOG_DIR` (resolved through `crate::env`, which
/// checks process env, the build-time profile, and the e2e runtime file)
/// when set, then the hermetic `NIXMAC_APP_DATA_DIR` override (so hermetic
/// runs never write recordings outside their state root), otherwise
/// `~/Library/Application Support/nixmac/logs/{prefix}_YYYY-MM-DD.jsonl` on macOS.
fn log_path_for_today(prefix: &str) -> PathBuf {
    let date = Local::now().format("%Y-%m-%d");
    crate::env::completion_log_dir()
        .map(PathBuf::from)
        .or_else(crate::env::app_data_dir_override)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("nixmac")
        })
        .join("logs")
        .join(format!("{prefix}_{date}.jsonl"))
}

/// Checks `NIXMAC_RECORD_COMPLETIONS`, ensures the log directory exists, and
/// logs the target path. Returns `true` when recording should be enabled.
pub fn init_recording(prefix: &str, label: &str) -> bool {
    if !crate::env::record_completions() {
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
        "NIXMAC_RECORD_COMPLETIONS is set; recording full {label} request/response JSONL to {}",
        path.display()
    );
    true
}

/// Appends a single event JSON line to the daily file for `prefix`.
/// No-ops when `enabled` is false.
///
/// The write is dispatched to a blocking thread via `spawn_blocking` so the
/// Tokio runtime is not stalled. Each append serializes to a single
/// newline-terminated buffer and writes it with `write_all`, which issues one
/// `write(2)` syscall. Combined with `O_APPEND`, this makes each line
/// effectively atomic for the typical response sizes seen here.
pub async fn append_event_jsonl<T: Serialize>(
    enabled: bool,
    prefix: &str,
    provider: &str,
    event: &str,
    payload: &T,
) {
    if !enabled {
        return;
    }

    let line = match serde_json::to_string(&serde_json::json!({
        "ts": Utc::now().to_rfc3339(),
        "provider": provider,
        "event": event,
        "payload": payload,
    })) {
        Ok(json) => json,
        Err(e) => {
            error!(
                "Failed to serialize chat-log payload for provider '{}' event '{}': {}",
                provider, event, e
            );
            return;
        }
    };

    // Mirror the JSONL line to stderr so it appears in the console alongside
    // other `tracing` output. Gated by the same `NIXMAC_RECORD_COMPLETIONS`
    // flag as the file write — no extra env var needed.
    // This swamps other output and therefore is commented out by default, but can be uncommented for debugging.
    //info!("[completion_log] {line}");

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
        error!("Failed to append chat-log JSONL for prefix '{prefix}': {e}");
    }
}
