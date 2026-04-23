use async_openai::types::CreateChatCompletionResponse;
use chrono::Local;
use log::{error, info};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tokio::task::spawn_blocking;

const RECORD_COMPLETIONS_ENV: &str = "NIXMAC_RECORD_COMPLETIONS";
const COMPLETION_LOG_DIR_ENV: &str = "NIXMAC_COMPLETION_LOG_DIR";
const MAX_COMPLETION_LOG_BYTES: u64 = 50 * 1024 * 1024;

fn completion_log_dir() -> PathBuf {
    if let Some(path) = std::env::var_os(COMPLETION_LOG_DIR_ENV).filter(|value| !value.is_empty())
    {
        return PathBuf::from(path);
    }

    if cfg!(debug_assertions) {
        if let Some(app_data_dir) = std::env::var_os(crate::e2e_support::E2E_APP_DATA_DIR_ENV)
            .filter(|value| !value.is_empty())
        {
            return PathBuf::from(app_data_dir).join("completion-logs");
        }
    }

    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nixmac")
        .join("logs")
}

/// Returns the daily-rotated JSONL path for the given prefix.
pub fn log_path_for_today(prefix: &str) -> PathBuf {
    let date = Local::now().format("%Y-%m-%d");
    completion_log_dir().join(format!("{prefix}_{date}.jsonl"))
}

/// Checks `NIXMAC_RECORD_COMPLETIONS`, ensures the log directory exists, and
/// logs the target path. Returns `true` when recording should be enabled.
pub fn init_recording(prefix: &str, label: &str) -> bool {
    if std::env::var_os(RECORD_COMPLETIONS_ENV).is_none() {
        return false;
    }

    if !cfg!(debug_assertions) && std::env::var_os(COMPLETION_LOG_DIR_ENV).is_none() {
        error!(
            "{RECORD_COMPLETIONS_ENV} ignored in release build without explicit {COMPLETION_LOG_DIR_ENV}"
        );
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
        "{RECORD_COMPLETIONS_ENV} is set; recording raw {label} completion JSONL to {}",
        path.display()
    );
    true
}

/// Appends a single serialized `CreateChatCompletionResponse` line to the
/// daily JSONL file for `prefix`. No-ops when `record_completions` is false.
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
    let buf = format!("{line}\n").into_bytes();

    if let Err(e) = spawn_blocking(move || -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if let Ok(metadata) = std::fs::metadata(&path) {
            if metadata.len() >= MAX_COMPLETION_LOG_BYTES {
                return Ok(());
            }
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(&buf)
    })
    .await
    {
        error!("Failed to append completion JSONL for prefix '{prefix}': {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clear_env() {
        std::env::remove_var(RECORD_COMPLETIONS_ENV);
        std::env::remove_var(COMPLETION_LOG_DIR_ENV);
        std::env::remove_var(crate::e2e_support::E2E_APP_DATA_DIR_ENV);
    }

    #[test]
    fn init_recording_is_disabled_without_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();

        assert!(!init_recording("test", "test provider"));
    }

    #[test]
    fn log_path_uses_explicit_completion_log_dir() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(COMPLETION_LOG_DIR_ENV, dir.path());

        let path = log_path_for_today("evolve");

        assert!(path.starts_with(dir.path()));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("evolve_"));
        clear_env();
    }

    #[test]
    fn log_path_uses_e2e_app_data_dir_when_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(crate::e2e_support::E2E_APP_DATA_DIR_ENV, dir.path());

        let path = log_path_for_today("summary");

        assert!(path.starts_with(dir.path().join("completion-logs")));
        clear_env();
    }
}
