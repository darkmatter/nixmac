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
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "settings.json";

/// Keys excluded from sanitized export. Match what the legacy fallback in
/// store.rs (`set_with_cleanup`) may have left behind in settings.json before
/// the keychain migration. Adding a new sensitive key? Add it here too.
const SENSITIVE_KEYS: &[&str] = &[
    "openrouterApiKey",
    "openaiApiKey",
    "vllmApiKey",
];

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

    let Some(file_path) = app
        .dialog()
        .file()
        .set_title("Export nixmac settings")
        .set_file_name("nixmac-settings.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let store = app
        .store(STORE_PATH)
        .map_err(|e| capture_err("settings_export", e))?;

    let mut output = Map::new();
    let mut skipped: Vec<String> = Vec::new();
    for (key, value) in store.entries() {
        if !include_secrets && SENSITIVE_KEYS.contains(&key.as_str()) {
            skipped.push(key.clone());
            continue;
        }
        output.insert(key.clone(), value.clone());
    }
    let keys_written = output.len();

    let json = serde_json::to_string_pretty(&Value::Object(output))
        .map_err(|e| capture_err("settings_export", e))?;
    let path_str = file_path.to_string();
    std::fs::write(&path_str, json).map_err(|e| capture_err("settings_export", e))?;

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
    let raw = std::fs::read_to_string(&path_str)
        .map_err(|e| capture_err("settings_import", e))?;
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
