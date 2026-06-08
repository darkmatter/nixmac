//! Session transcript logging for evolution sessions.
//!
//! Each evolution creates a JSONL file under the OS data-local directory
//! (`nixmac/sessions/`) capturing redacted structural data for the prompt,
//! evolve events, and final result. On macOS `dirs::data_local_dir()` resolves to
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
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::system::secret_scanner::SecretScanner;

/// The active session log path, set when an evolution starts and cleared when
/// it finishes. `None` means no session is currently recording.
static SESSION_LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static SESSION_LOG_SCANNER: OnceLock<SecretScanner> = OnceLock::new();

const OMITTED_SESSION_FIELD: &str = "[REDACTED: omitted from session log]";
const OMITTED_SESSION_STRING: &str = "[REDACTED: string omitted from session log]";

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

fn normalize_session_key(key: &str) -> String {
    key.chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn should_omit_session_field(key: &str) -> bool {
    let normalized = normalize_session_key(key);

    matches!(
        normalized.as_str(),
        "raw"
            | "diff"
            | "original"
            | "modified"
            | "content"
            | "messages"
            | "request"
            | "response"
            | "requestbody"
            | "responsebody"
            | "patch"
            | "search"
            | "replace"
            | "changednixfilesdiff"
            | "builderroroutput"
            | "applogscontent"
            | "modelresponse"
    ) || normalized.contains("apikey")
        || normalized.contains("accesstoken")
        || normalized.contains("authtoken")
        || normalized.contains("password")
        || normalized.contains("credential")
        || normalized.contains("secret")
        || normalized.contains("token")
}

fn is_safe_session_metadata_string(key: Option<&str>, value: &str) -> bool {
    let Some(key) = key else {
        return false;
    };
    let normalized = normalize_session_key(key);
    if !matches!(
        normalized.as_str(),
        "eventtype" | "state" | "category" | "tool" | "changetype" | "status" | "summarytype"
    ) {
        return false;
    }

    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}

fn sanitize_session_value(value: &mut Value, key: Option<&str>) {
    match value {
        Value::Object(map) => {
            for (nested_key, nested_value) in map.iter_mut() {
                if should_omit_session_field(nested_key) {
                    *nested_value = Value::String(OMITTED_SESSION_FIELD.to_string());
                } else {
                    sanitize_session_value(nested_value, Some(nested_key));
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_session_value(item, key);
            }
        }
        Value::String(text) => {
            if is_safe_session_metadata_string(key, text) {
                let (redacted, changed) = session_log_scanner().redact_string(text);
                *text = if changed {
                    OMITTED_SESSION_STRING.to_string()
                } else {
                    redacted
                };
            } else {
                *text = OMITTED_SESSION_STRING.to_string();
            }
        }
        _ => {}
    }
}

fn sanitize_payload_for_session_log(payload: &Value) -> Value {
    let mut sanitized = payload.clone();
    sanitize_session_value(&mut sanitized, None);
    let (sanitized, _) = session_log_scanner().redact_json(sanitized);
    sanitized
}

/// Appends a JSON line to the session log file.
///
/// Dispatched to a blocking thread to avoid stalling the Tokio runtime. The
/// line is serialized to a single newline-terminated buffer and written with
/// `write_all`, which (combined with `O_APPEND`) keeps each line effectively
/// atomic for the small payloads seen here.
pub async fn append_event(path: &PathBuf, event_type: &str, payload: &serde_json::Value) {
    let payload = sanitize_payload_for_session_log(payload);
    let line = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "event": event_type,
        "data": payload,
    });
    let buf = format!("{line}\n").into_bytes();
    let path = path.clone();

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
    use super::{
        append_event, sanitize_payload_for_session_log, OMITTED_SESSION_FIELD,
        OMITTED_SESSION_STRING,
    };
    use serde_json::json;

    #[test]
    fn session_log_sanitizer_omits_prompt_text_but_keeps_shape() {
        let payload = json!({
            "description": "install the app with identifiable phrase cactus-river-731",
            "telemetry": {
                "iterations": 2,
                "buildAttempts": 1,
                "totalTokens": 1234,
                "state": "generated"
            }
        });

        let sanitized = sanitize_payload_for_session_log(&payload);
        let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized payload");

        assert_eq!(sanitized["description"], OMITTED_SESSION_STRING);
        assert_eq!(sanitized["telemetry"]["iterations"], 2);
        assert_eq!(sanitized["telemetry"]["buildAttempts"], 1);
        assert_eq!(sanitized["telemetry"]["totalTokens"], 1234);
        assert_eq!(sanitized["telemetry"]["state"], "generated");
        assert!(!serialized.contains("cactus-river-731"));
    }

    #[test]
    fn session_log_sanitizer_omits_raw_diff_and_content_fields() {
        let payload = json!({
            "raw": "provider error containing prompt cactus-river-731",
            "summary": "safe-looking summary that still came from the model",
            "eventType": "buildFail",
            "iteration": 3,
            "gitStatus": {
                "branch": "user/private-branch-name",
                "diff": "+password = \"super-secret\"",
                "files": [
                    {
                        "path": "secrets/example.yaml",
                        "changeType": "edited"
                    }
                ],
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
                        "summary": {
                            "title": "Configure private service",
                            "description": "mentions secret super-secret",
                            "status": "DONE"
                        }
                    }
                ]
            }
        });

        let sanitized = sanitize_payload_for_session_log(&payload);
        let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized payload");

        assert_eq!(sanitized["raw"], OMITTED_SESSION_FIELD);
        assert_eq!(sanitized["summary"], OMITTED_SESSION_STRING);
        assert_eq!(sanitized["eventType"], "buildFail");
        assert_eq!(sanitized["iteration"], 3);
        assert_eq!(sanitized["gitStatus"]["diff"], OMITTED_SESSION_FIELD);
        assert_eq!(
            sanitized["gitStatus"]["files"][0]["path"],
            OMITTED_SESSION_STRING
        );
        assert_eq!(sanitized["gitStatus"]["files"][0]["changeType"], "edited");
        assert_eq!(
            sanitized["changeMap"]["groups"][0]["summary"]["status"],
            "DONE"
        );
        assert!(!serialized.contains("cactus-river-731"));
        assert!(!serialized.contains("super-secret"));
        assert!(!serialized.contains("api_key"));
        assert!(!serialized.contains("private-branch-name"));
        assert!(serialized.matches(OMITTED_SESSION_FIELD).count() >= 3);
    }

    #[test]
    fn session_log_sanitizer_omits_secret_bearing_field_names() {
        let payload = json!({
            "openAiApiKey": "sk-abcdefghijklmnopqrstuvwx",
            "nested": {
                "accessToken": "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
                "status": "QUEUED"
            }
        });

        let sanitized = sanitize_payload_for_session_log(&payload);
        let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized payload");

        assert_eq!(sanitized["openAiApiKey"], OMITTED_SESSION_FIELD);
        assert_eq!(sanitized["nested"]["accessToken"], OMITTED_SESSION_FIELD);
        assert_eq!(sanitized["nested"]["status"], "QUEUED");
        assert!(!serialized.contains("sk-"));
        assert!(!serialized.contains("ghp_"));
    }

    #[tokio::test]
    async fn append_event_persists_sanitized_jsonl() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let path = temp.path().join("session.jsonl");
        std::fs::File::create(&path).expect("create session log");
        let payload = json!({
            "description": "prompt with identifiable phrase cactus-river-731",
            "eventType": "start",
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
        assert_eq!(line["data"]["description"], OMITTED_SESSION_STRING);
        assert_eq!(line["data"]["eventType"], "start");
        assert_eq!(line["data"]["raw"], OMITTED_SESSION_FIELD);
        assert_eq!(line["data"]["gitStatus"]["diff"], OMITTED_SESSION_FIELD);

        let serialized = line.to_string();
        assert!(!serialized.contains("cactus-river-731"));
        assert!(!serialized.contains("sk-abcdefghijklmnopqrstuvwx"));
        assert!(!serialized.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
    }
}
