//! Debug-only runtime overrides for local E2E harnesses.
//!
//! GUI apps launched through LaunchServices do not reliably inherit SSH-session
//! environment variables on the MacInCloud runner. The Peekaboo Product Proof
//! harness writes this small, expiring file beside the normal settings store so
//! debug builds can still receive deterministic test controls. Release builds
//! ignore the file.

use serde::Deserialize;
use std::collections::HashMap;
#[allow(unused_imports)]
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[allow(dead_code)]
const RUNTIME_FILE_NAME: &str = "e2e-runtime.json";

#[allow(dead_code)]
const BUNDLE_ID: &str = "com.darkmatter.nixmac";

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct E2eRuntimeFile {
    #[serde(rename = "schemaVersion")]
    schema_version: u64,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "expiresAtUnix")]
    expires_at_unix: u64,
    values: HashMap<String, String>,
}

#[allow(dead_code)]
fn runtime_file_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(
        home.join("Library")
            .join("Application Support")
            .join(BUNDLE_ID)
            .join(RUNTIME_FILE_NAME),
    )
}

#[allow(dead_code)]
fn now_unix() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

#[cfg(debug_assertions)]
fn file_value_from_path(path: PathBuf, name: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let runtime: E2eRuntimeFile = serde_json::from_str(&raw).ok()?;
    if runtime.schema_version != 1 || runtime.session_id.trim().is_empty() {
        return None;
    }
    if now_unix()? > runtime.expires_at_unix {
        return None;
    }
    runtime
        .values
        .get(name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(debug_assertions)]
fn file_value(name: &str) -> Option<String> {
    file_value_from_path(runtime_file_path()?, name)
}

#[cfg(not(debug_assertions))]
fn file_value(_name: &str) -> Option<String> {
    None
}

pub(crate) fn value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| file_value(name))
}

pub(crate) fn enabled(name: &str) -> bool {
    value(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn release_or_missing_file_returns_none() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&["NIXMAC_E2E_SAMPLE"]);
        unsafe { std::env::remove_var("NIXMAC_E2E_SAMPLE") };
        assert_eq!(value("NIXMAC_E2E_SAMPLE"), None);
    }

    #[test]
    fn env_value_takes_precedence() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&["NIXMAC_E2E_SAMPLE"]);
        unsafe { std::env::set_var("NIXMAC_E2E_SAMPLE", " env-value ") };
        assert_eq!(value("NIXMAC_E2E_SAMPLE").as_deref(), Some("env-value"));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn expired_file_is_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("e2e-runtime.json");
        let mut file = fs::File::create(&path).unwrap();
        writeln!(
            file,
            r#"{{"schemaVersion":1,"sessionId":"test","expiresAtUnix":1,"values":{{"NIXMAC_E2E_SAMPLE":"file-value"}}}}"#
        )
        .unwrap();

        assert_eq!(file_value_from_path(path, "NIXMAC_E2E_SAMPLE"), None);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn valid_file_value_is_returned() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("e2e-runtime.json");
        let expires = now_unix().unwrap() + 60;
        let mut file = fs::File::create(&path).unwrap();
        writeln!(
            file,
            r#"{{"schemaVersion":1,"sessionId":"test","expiresAtUnix":{expires},"values":{{"NIXMAC_E2E_SAMPLE":" file-value "}}}}"#
        )
        .unwrap();

        assert_eq!(
            file_value_from_path(path, "NIXMAC_E2E_SAMPLE").as_deref(),
            Some("file-value")
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn invalid_file_metadata_is_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let expires = now_unix().unwrap() + 60;

        for raw in [
            format!(
                r#"{{"schemaVersion":2,"sessionId":"test","expiresAtUnix":{expires},"values":{{"NIXMAC_E2E_SAMPLE":"file-value"}}}}"#
            ),
            format!(
                r#"{{"schemaVersion":1,"sessionId":" ","expiresAtUnix":{expires},"values":{{"NIXMAC_E2E_SAMPLE":"file-value"}}}}"#
            ),
        ] {
            let path = temp
                .path()
                .join(format!("e2e-runtime-{}.json", uuid::Uuid::new_v4()));
            let mut file = fs::File::create(&path).unwrap();
            writeln!(file, "{raw}").unwrap();
            assert_eq!(file_value_from_path(path, "NIXMAC_E2E_SAMPLE"), None);
        }
    }
}
