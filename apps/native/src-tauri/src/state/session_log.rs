//! Session transcript logging for evolution sessions.
//!
//! Each evolution creates a JSONL file under the OS data-local directory
//! (`nixmac/sessions/`) capturing the user prompt, all evolve events, and the
//! final result. On macOS `dirs::data_local_dir()` resolves to
//! `~/Library/Application Support/`; on Linux it resolves to `~/.local/share/`.
//!
//! The active session path is held in a process-global `Mutex` so the event
//! emission path (`emit_evolve_event`) can append without threading the path
//! through every lifecycle signature. All writes are dispatched to a blocking
//! thread via `spawn_blocking` so the Tokio runtime is never stalled.

use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// The active session log path, set when an evolution starts and cleared when
/// it finishes. `None` means no session is currently recording.
static SESSION_LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Returns the sessions directory path.
///
/// Uses `dirs::data_local_dir()`, which resolves per-platform (macOS:
/// `~/Library/Application Support/`, Linux: `~/.local/share/`).
fn sessions_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nixmac")
        .join("sessions")
}

/// Creates a new session log file and returns its path.
///
/// File name format: `YYYYMMDDHHMMSS_<8-char-uuid>.jsonl`.
pub fn create_session_log() -> Result<PathBuf, String> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sessions dir: {e}"))?;

    let timestamp = Local::now().format("%Y%m%d%H%M%S");
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let filename = format!("{timestamp}_{short_id}.jsonl");
    let path = dir.join(filename);

    // Create the file (empty for now).
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| format!("Failed to create session log: {e}"))?;

    Ok(path)
}

/// Sets the active session log path. Called when an evolution starts.
pub fn set_session_path(path: Option<PathBuf>) {
    *SESSION_LOG_PATH.lock().unwrap() = path;
}

/// Returns a clone of the active session log path, if any.
pub fn active_session_path() -> Option<PathBuf> {
    SESSION_LOG_PATH.lock().unwrap().clone()
}

/// Appends a JSON line to the session log file.
///
/// Dispatched to a blocking thread to avoid stalling the Tokio runtime. The
/// line is serialized to a single newline-terminated buffer and written with
/// `write_all`, which (combined with `O_APPEND`) keeps each line effectively
/// atomic for the small payloads seen here.
pub async fn append_event(path: &PathBuf, event_type: &str, payload: &serde_json::Value) {
    let line = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "event": event_type,
        "data": payload,
    });
    let buf = format!("{line}\n").into_bytes();
    let path = path.clone();

    if let Err(e) = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut file = OpenOptions::new().append(true).open(&path)?;
        file.write_all(&buf)
    })
    .await
    {
        log::warn!("Failed to append session log event: {e}");
    }
}
