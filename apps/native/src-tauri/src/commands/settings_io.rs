//! Export and import of the `settings.json` plugin-store as a developer-mode
//! backup/restore feature.
//!
//! Export defaults to *sanitized* — legacy plain-text API keys are stripped
//! unless the user opts in via `include_secrets`. The keychain-backed copies
//! of those keys live outside `settings.json` and are never touched by this
//! flow.
//!
//! Import is wholesale-replace semantics: the file's contents become the new
//! store. Keys absent from the file (including API keys not opted into the
//! export) are cleared from the store. The frontend confirms with the user
//! before invoking import.

use super::helpers::capture_err;
use crate::shared_types::{ExportResult, ImportResult};
use crate::storage::store;
use serde_json::{Map, Value};
use std::borrow::Borrow;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "settings.json";

/// Keys excluded from sanitized export. Match what the legacy fallback in
/// store.rs (`set_with_cleanup`) may have left behind in settings.json before
/// the keychain migration. Adding a new sensitive key? Add it here too.
const SENSITIVE_KEYS: &[&str] = &["openrouterApiKey", "openaiApiKey", "vllmApiKey"];

fn is_sensitive_key(key: &str) -> bool {
    SENSITIVE_KEYS.contains(&key) || key.ends_with("ApiKey")
}

fn collect_export_entries<K, V>(
    entries: impl IntoIterator<Item = (K, V)>,
    include_secrets: bool,
) -> (Map<String, Value>, Vec<String>)
where
    K: AsRef<str>,
    V: Borrow<Value>,
{
    let mut output = Map::new();
    let mut skipped: Vec<String> = Vec::new();
    for (key, value) in entries {
        let key = key.as_ref();
        if !include_secrets && is_sensitive_key(key) {
            skipped.push(key.to_string());
            continue;
        }
        output.insert(key.to_string(), value.borrow().clone());
    }
    (output, skipped)
}

fn require_developer_mode(app: &AppHandle) -> Result<(), String> {
    let dev = store::get_bool_pref(app, store::DEVELOPER_MODE_KEY, false)
        .map_err(|e| capture_err("settings_io", e))?;
    if dev {
        Ok(())
    } else {
        Err("Developer mode is required for settings backup/restore".to_string())
    }
}

/// Opens a save dialog and writes the current `settings.json` (filtered when
/// `include_secrets == false`) as pretty JSON to the chosen path.
/// Returns `None` if the user cancelled the dialog.
#[tauri::command]
pub async fn settings_export(
    app: AppHandle,
    include_secrets: bool,
) -> Result<Option<ExportResult>, String> {
    require_developer_mode(&app)?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Export nixmac settings")
        .set_file_name("nixmac-settings.json")
        .add_filter("JSON", &["json"])
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    let Some(file_path) = rx.await.map_err(|e| capture_err("settings_export", e))? else {
        return Ok(None);
    };

    let store = app
        .store(STORE_PATH)
        .map_err(|e| capture_err("settings_export", e))?;

    let (output, skipped) = collect_export_entries(store.entries(), include_secrets);
    let keys_written = output.len();

    let json = serde_json::to_string_pretty(&Value::Object(output))
        .map_err(|e| capture_err("settings_export", e))?;
    let path_str = file_path.to_string();
    let path_for_write = path_str.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path_for_write, json))
        .await
        .map_err(|e| capture_err("settings_export", e))?
        .map_err(|e| capture_err("settings_export", e))?;

    Ok(Some(ExportResult {
        path: path_str,
        keys_written,
        keys_skipped: skipped,
    }))
}

/// Opens an open dialog, validates the chosen file as a JSON object, and
/// replaces the entire contents of `settings.json` with it. Returns `None`
/// if the user cancelled the dialog.
#[tauri::command]
pub async fn settings_import(app: AppHandle) -> Result<Option<ImportResult>, String> {
    require_developer_mode(&app)?;

    let Some(file_path) = app
        .dialog()
        .file()
        .set_title("Import nixmac settings")
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path_str = file_path.to_string();
    let raw = std::fs::read_to_string(&path_str).map_err(|e| capture_err("settings_import", e))?;
    let parsed: Value =
        serde_json::from_str(&raw).map_err(|e| capture_err("settings_import", e))?;
    let Value::Object(entries) = parsed else {
        return Err("Import file must contain a top-level JSON object".to_string());
    };

    let store = app
        .store(STORE_PATH)
        .map_err(|e| capture_err("settings_import", e))?;
    store.clear();
    let keys_imported = entries.len();
    for (key, value) in entries {
        store.set(key, value);
    }
    store
        .save()
        .map_err(|e| capture_err("settings_import", e))?;

    Ok(Some(ImportResult {
        path: path_str,
        keys_imported,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_types::{ExportResult, ImportResult};
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::future::Future;

    #[test]
    fn sanitized_export_skips_exact_and_camel_case_api_keys() {
        let entries = BTreeMap::from([
            ("model".to_string(), json!("claude")),
            ("openrouterApiKey".to_string(), json!("redacted")),
            ("customApiKey".to_string(), json!("also-redacted")),
        ]);

        let (output, skipped) = collect_export_entries(entries.iter(), false);

        assert_eq!(output.get("model"), Some(&json!("claude")));
        assert!(!output.contains_key("openrouterApiKey"));
        assert!(!output.contains_key("customApiKey"));
        assert_eq!(
            skipped,
            vec!["customApiKey".to_string(), "openrouterApiKey".to_string()]
        );
    }

    #[test]
    fn export_includes_sensitive_keys_when_requested() {
        let entries = BTreeMap::from([
            ("openaiApiKey".to_string(), json!("secret")),
            ("summaryModel".to_string(), json!("gpt-4.1")),
        ]);

        let (output, skipped) = collect_export_entries(entries.iter(), true);

        assert_eq!(output.get("openaiApiKey"), Some(&json!("secret")));
        assert_eq!(output.get("summaryModel"), Some(&json!("gpt-4.1")));
        assert!(skipped.is_empty());
    }

    #[test]
    fn command_signatures_match_frontend_contract() {
        fn assert_export_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle, bool) -> Fut,
            Fut: Future<Output = Result<Option<ExportResult>, String>>,
        {
        }

        fn assert_import_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle) -> Fut,
            Fut: Future<Output = Result<Option<ImportResult>, String>>,
        {
        }

        assert_export_command(settings_export);
        assert_import_command(settings_import);
    }
}
