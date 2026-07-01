//! Export and import of typed settings slices
//!
//! Export defaults to *sanitized*. Keychain-backed API keys live outside these
//! slices and are never touched by this flow.
//!
//! Import is wholesale-replace semantics: the file's contents become the new
//! slice values. Fields present in the file but absent from a slice's struct
//! are silently dropped by serde's `deny_unknown_fields`-free deserialization,
//! which means exporting from a newer version and importing into an older one
//! is safe (unknown keys are ignored). The frontend confirms with the user
//! before invoking import.

use super::helpers::capture_err;
use crate::evolve::config::UserPreferences;
use crate::observable::Observable;
use crate::shared_types::{ExportResult, ImportResult};
use crate::state::preferences::GlobalPreferences;
use serde_json::{Map, Value};
use std::borrow::Borrow;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Keys excluded from sanitized export.
const SENSITIVE_KEYS: &[&str] = &["openrouterApiKey", "openaiApiKey", "openaiCompatibleApiKey"];

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

fn merge_export_object(
    output: &mut Map<String, Value>,
    skipped: &mut Vec<String>,
    value: Value,
    include_secrets: bool,
) {
    let Value::Object(entries) = value else {
        return;
    };
    let (mut slice_output, mut slice_skipped) = collect_export_entries(entries, include_secrets);
    output.append(&mut slice_output);
    skipped.append(&mut slice_skipped);
}

fn collect_slice_export_entries(
    app: &AppHandle,
    include_secrets: bool,
) -> Result<(Map<String, Value>, Vec<String>), String> {
    let mut output = Map::new();
    let mut skipped = Vec::new();

    if let Some(global) = app.try_state::<Observable<GlobalPreferences>>() {
        merge_export_object(
            &mut output,
            &mut skipped,
            serde_json::to_value(&*global.read_sync())
                .map_err(|e| capture_err("settings_export", e))?,
            include_secrets,
        );
    }

    if let Some(limits) = app.try_state::<Observable<UserPreferences>>() {
        merge_export_object(
            &mut output,
            &mut skipped,
            serde_json::to_value(&*limits.read_sync())
                .map_err(|e| capture_err("settings_export", e))?,
            include_secrets,
        );
    }

    Ok((output, skipped))
}

/// Opens a save dialog and writes the current `settings.json` (filtered when
/// `include_secrets == false`) as pretty JSON to the chosen path.
/// Returns `None` if the user cancelled the dialog.
#[tauri::command]
pub async fn settings_export(
    app: AppHandle,
    include_secrets: bool,
) -> Result<Option<ExportResult>, String> {
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

    let (output, skipped) = collect_slice_export_entries(&app, include_secrets)?;
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
/// replaces the managed settings slices with it. Returns `None` if the user
/// cancelled the dialog.
#[tauri::command]
pub async fn settings_import(app: AppHandle) -> Result<Option<ImportResult>, String> {
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
    let imported_value = Value::Object(entries.clone());

    let keys_imported = entries.len();

    if let Some(global) = app.try_state::<Observable<GlobalPreferences>>() {
        let prefs = serde_json::from_value::<GlobalPreferences>(imported_value.clone())
            .map_err(|e| capture_err("settings_import", e))?;
        let mut global = global.write_sync();
        *global = prefs;
    }

    if let Some(limits) = app.try_state::<Observable<UserPreferences>>() {
        let prefs = serde_json::from_value::<UserPreferences>(imported_value)
            .map_err(|e| capture_err("settings_import", e))?;
        let mut limits = limits.write_sync();
        *limits = prefs;
    }

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
    fn slice_export_merge_keeps_typed_preference_keys_only() {
        let mut output = Map::new();
        let mut skipped = Vec::new();

        merge_export_object(
            &mut output,
            &mut skipped,
            serde_json::to_value(GlobalPreferences {
                host_attr: Some("macbook".to_string()),
                developer_mode: true,
                auto_format_nix_files: true,
                ..GlobalPreferences::default()
            })
            .unwrap(),
            false,
        );
        merge_export_object(
            &mut output,
            &mut skipped,
            serde_json::to_value(UserPreferences {
                max_iterations: 12,
                max_token_budget: 80_000,
                max_build_attempts: 4,
                max_output_tokens: 16_384,
            })
            .unwrap(),
            false,
        );

        assert_eq!(output.get("hostAttr"), Some(&json!("macbook")));
        assert_eq!(output.get("developerMode"), Some(&json!(true)));
        assert_eq!(output.get("maxIterations"), Some(&json!(12)));
        assert_eq!(output.get("maxBuildAttempts"), Some(&json!(4)));
        assert_eq!(output.get("autoFormatNixFiles"), Some(&json!(true)));
        assert!(!output.contains_key("openaiApiKey"));
        assert!(!output.contains_key("promptHistory"));
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
