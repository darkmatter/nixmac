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
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::system::secret_scanner::SecretScanner;

/// The active session log path, set when an evolution starts and cleared when
/// it finishes. `None` means no session is currently recording.
static SESSION_LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static SESSION_LOG_SCANNER: OnceLock<SecretScanner> = OnceLock::new();

const OMITTED_SESSION_FIELD: &str = "[REDACTED: omitted from session log]";

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

fn session_log_scanner() -> &'static SecretScanner {
    SESSION_LOG_SCANNER
        .get_or_init(|| SecretScanner::from_toml(include_str!("../../resources/gitleaks.toml")))
}

fn should_omit_session_field(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect::<String>();

    matches!(
        normalized.as_str(),
        "raw"
            | "diff"
            | "original"
            | "modified"
            | "content"
            | "changednixfilesdiff"
            | "builderroroutput"
            | "applogscontent"
    ) || normalized.contains("apikey")
        || normalized.contains("accesstoken")
        || normalized.contains("authtoken")
        || normalized.contains("password")
        || normalized.contains("credential")
        || normalized.contains("secret")
}

fn omit_sensitive_session_fields(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if should_omit_session_field(key) {
                    *nested = Value::String(OMITTED_SESSION_FIELD.to_string());
                } else {
                    omit_sensitive_session_fields(nested);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                omit_sensitive_session_fields(item);
            }
        }
        _ => {}
    }
}

fn sanitize_payload_for_session_log(payload: &Value) -> Value {
    let mut sanitized = payload.clone();
    omit_sensitive_session_fields(&mut sanitized);
    let (sanitized, _) = session_log_scanner().redact_json(sanitized);
    sanitized
}

enum QueueItem {
    Line(PathBuf, &'static str, serde_json::Value),
    /// A flush barrier: acknowledged once every line enqueued before it has
    /// been written.
    Barrier(tokio::sync::oneshot::Sender<()>),
}

static QUEUE: OnceLock<tokio::sync::mpsc::UnboundedSender<QueueItem>> = OnceLock::new();

/// The ordered-writer queue, lazily spawning its single consumer task.
/// Requires a Tokio runtime (every caller runs inside the evolve command
/// context).
fn queue_sender() -> &'static tokio::sync::mpsc::UnboundedSender<QueueItem> {
    QUEUE.get_or_init(|| {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<QueueItem>();
        tokio::spawn(async move {
            while let Some(item) = rx.recv().await {
                match item {
                    QueueItem::Line(path, event_type, payload) => {
                        append_event(&path, event_type, &payload).await;
                    }
                    QueueItem::Barrier(ack) => {
                        let _ = ack.send(());
                    }
                }
            }
        });
        tx
    })
}

/// Queues a JSON line for the session log, preserving emission order.
///
/// High-frequency events (streamed deltas and build chunks every ~120ms)
/// made the previous one-spawned-task-per-event approach a line-order race.
/// A single lazily-spawned writer task drains the queue sequentially, so
/// lines land in the order they were enqueued. Fire-and-forget; await
/// [`flush_ordered`] for a durability point.
pub fn append_event_ordered(path: PathBuf, event_type: &'static str, payload: serde_json::Value) {
    if queue_sender()
        .send(QueueItem::Line(path, event_type, payload))
        .is_err()
    {
        log::warn!("Session log writer task is gone; dropping transcript line");
    }
}

/// Waits until every transcript line enqueued so far has been written, so a
/// caller returning control (and possibly letting the app exit) doesn't lose
/// the tail of the transcript. A no-op when nothing was ever enqueued.
pub async fn flush_ordered() {
    let Some(sender) = QUEUE.get() else {
        return;
    };
    let (ack, done) = tokio::sync::oneshot::channel();
    if sender.send(QueueItem::Barrier(ack)).is_err() {
        return;
    }
    let _ = done.await;
}

/// Appends a JSON line to the session log file.
///
/// Dispatched to a blocking thread to avoid stalling the Tokio runtime. The
/// line is serialized to a single newline-terminated buffer and written with
/// `write_all`, which (combined with `O_APPEND`) keeps each line effectively
/// atomic for the small payloads seen here.
pub async fn append_event(path: &Path, event_type: &str, payload: &serde_json::Value) {
    let payload = sanitize_payload_for_session_log(payload);
    let line = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "event": event_type,
        "data": payload,
    });
    let buf = format!("{line}\n").into_bytes();
    let path = path.to_path_buf();

    match tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut file = OpenOptions::new().append(true).open(&path)?;
        file.write_all(&buf)
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::warn!("Failed to append session log event: {e}"),
        Err(e) => log::warn!("Failed to join session log append task: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{OMITTED_SESSION_FIELD, append_event, sanitize_payload_for_session_log};
    use serde_json::json;

    #[test]
    fn session_log_sanitizer_omits_raw_diff_and_content_fields() {
        let payload = json!({
            "raw": "provider error containing token ghp_1234567890abcdefghijklmnopqrstuvwxyz",
            "summary": "safe summary",
            "gitStatus": {
                "diff": "+password = \"super-secret\"",
                "changes": [
                    {
                        "filename": "secrets/example.yaml",
                        "diff": "+api_key: abcdefghijklmnop"
                    }
                ]
            },
            "changeMap": {
                "groups": [
                    {
                        "changes": [
                            {
                                "filename": "hosts/macbook/default.nix",
                                "diff": "+access_token = \"abcdefghijklmnop\""
                            }
                        ]
                    }
                ]
            }
        });

        let sanitized = sanitize_payload_for_session_log(&payload);
        let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized payload");

        assert!(serialized.contains("\"summary\":\"safe summary\""));
        assert!(!serialized.contains("super-secret"));
        assert!(!serialized.contains("api_key"));
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("provider error containing token"));
        assert!(serialized.matches(OMITTED_SESSION_FIELD).count() >= 4);
    }

    #[test]
    fn session_log_sanitizer_redacts_secret_like_values() {
        let payload = json!({
            "description": "Please configure api_key = sk-abcdefghijklmnopqrstuvwx for the service",
            "nested": {
                "note": "leave normal diagnostic text alone"
            }
        });

        let sanitized = sanitize_payload_for_session_log(&payload);
        let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized payload");

        assert!(serialized.contains("leave normal diagnostic text alone"));
        assert!(!serialized.contains("sk-abcdefghijklmnopqrstuvwx"));
        assert!(serialized.contains("[REDACTED"));
    }

    #[tokio::test]
    async fn append_event_ordered_preserves_emission_order() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let path = temp.path().join("session.jsonl");
        std::fs::File::create(&path).expect("create session log");

        // Compile the secret scanner up front so the drain deadline below
        // measures the writer, not the one-time regex build (seconds in
        // debug builds).
        sanitize_payload_for_session_log(&json!({}));

        const LINES: usize = 50;
        for i in 0..LINES {
            super::append_event_ordered(path.clone(), "evolve_event", json!({ "seq": i }));
        }

        // The flush barrier is the durability point: once it resolves, every
        // line enqueued before it must be on disk, in order.
        super::flush_ordered().await;

        let contents = std::fs::read_to_string(&path).expect("read session log");
        assert_eq!(contents.lines().count(), LINES);
        for (i, line) in contents.lines().enumerate() {
            let parsed: serde_json::Value = serde_json::from_str(line).expect("valid JSON line");
            assert_eq!(parsed["data"]["seq"], i, "line {i} out of order");
        }
    }

    #[tokio::test]
    async fn flush_ordered_is_a_noop_before_anything_was_enqueued() {
        // Must not spawn a writer or hang when the queue was never used.
        // (Other tests may have initialized the global queue already; the
        // no-op branch is only reachable in a fresh process, so this mainly
        // guards against hangs either way.)
        tokio::time::timeout(std::time::Duration::from_secs(5), super::flush_ordered())
            .await
            .expect("flush_ordered must not hang");
    }

    #[tokio::test]
    async fn append_event_persists_sanitized_jsonl() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let path = temp.path().join("session.jsonl");
        std::fs::File::create(&path).expect("create session log");
        let payload = json!({
            "summary": "safe event summary",
            "raw": "raw provider error with api_key = sk-abcdefghijklmnopqrstuvwx",
            "gitStatus": {
                "diff": "+token = \"ghp_1234567890abcdefghijklmnopqrstuvwxyz\""
            }
        });

        append_event(&path, "evolve_event", &payload).await;

        let contents = std::fs::read_to_string(&path).expect("read session log");
        let line: serde_json::Value =
            serde_json::from_str(contents.trim()).expect("session log line is valid JSON");

        assert_eq!(line["event"], "evolve_event");
        assert_eq!(line["data"]["summary"], "safe event summary");
        assert_eq!(line["data"]["raw"], OMITTED_SESSION_FIELD);
        assert_eq!(line["data"]["gitStatus"]["diff"], OMITTED_SESSION_FIELD);

        let serialized = line.to_string();
        assert!(!serialized.contains("sk-abcdefghijklmnopqrstuvwx"));
        assert!(!serialized.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
    }
}
