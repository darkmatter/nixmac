//! Typed preference slices split by persistence scope.
//!
//! `GlobalPreferences` are per-device app preferences persisted in the app data
//! directory. Repo-scoped configurable slices are persisted under
//! `<config_dir>/.nixmac/settings.json`.
//!
//! API keys, model caches, prompt history, and other runtime caches are
//! intentionally excluded.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

use crate::observable::Observable;
use crate::shared_types::UpdateChannel;
use crate::state::slice::{AppDataJson, Persistence};

const GLOBAL_PREFERENCES_PATH: &str = "global-preferences.json";

pub const GLOBAL_PREFERENCES_CHANGED_EVENT: &str = "global_preferences_changed";

/// Preferences local to this app installation.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalPreferences {
    pub host_attr: Option<String>,
    pub config_dir: Option<String>,
    pub repo_root: Option<String>,
    pub send_diagnostics: bool,
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub ollama_api_base_url: Option<String>,
    pub vllm_api_base_url: Option<String>,
    pub confirm_build: bool,
    pub confirm_clear: bool,
    pub confirm_rollback: bool,
    pub auto_summarize_on_focus: bool,
    pub scan_homebrew_on_startup: bool,
    pub default_to_diff_tab: bool,
    pub experimental_spinning_mascot: bool,
    pub developer_mode: bool,
    pub pinned_version: Option<String>,
    pub update_channel: UpdateChannel,
}

impl Default for GlobalPreferences {
    fn default() -> Self {
        Self {
            host_attr: None,
            config_dir: None,
            repo_root: None,
            send_diagnostics: false,
            evolve_provider: None,
            evolve_model: None,
            summary_provider: None,
            summary_model: None,
            ollama_api_base_url: None,
            vllm_api_base_url: None,
            confirm_build: true,
            confirm_clear: true,
            confirm_rollback: true,
            auto_summarize_on_focus: false,
            scan_homebrew_on_startup: true,
            default_to_diff_tab: false,
            experimental_spinning_mascot: false,
            developer_mode: false,
            pinned_version: None,
            update_channel: UpdateChannel::default(),
        }
    }
}

pub fn load_global_observable<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Observable<GlobalPreferences>> {
    let persistence: Arc<dyn Persistence> =
        Arc::new(AppDataJson::for_app(app, GLOBAL_PREFERENCES_PATH)?);
    let initial = load_or_default::<GlobalPreferences>(persistence.as_ref())?;

    Ok(Observable::new(initial)
        .emit_to(app, GLOBAL_PREFERENCES_CHANGED_EVENT)
        .persist_to(persistence))
}

pub(crate) fn load_or_default<T>(persistence: &dyn Persistence) -> Result<T>
where
    T: Default + for<'de> Deserialize<'de>,
{
    if let Some(value) = persistence.load()? {
        return Ok(serde_json::from_value(value).unwrap_or_default());
    }

    Ok(T::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use serde_json::json;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryPersistence {
        value: Mutex<Option<Value>>,
    }

    impl MemoryPersistence {
        fn with_value(value: Value) -> Self {
            Self {
                value: Mutex::new(Some(value)),
            }
        }
    }

    impl Persistence for MemoryPersistence {
        fn load(&self) -> Result<Option<Value>> {
            Ok(self.value.lock().unwrap().clone())
        }

        fn flush(&self, value: &Value) -> Result<()> {
            *self.value.lock().unwrap() = Some(value.clone());
            Ok(())
        }
    }

    #[test]
    fn global_preferences_load_from_slice_file() {
        let persistence = MemoryPersistence::with_value(json!({
            "hostAttr": "macbook",
            "configDir": "/Users/cm/.darwin",
            "repoRoot": "/Users/cm/.darwin",
            "sendDiagnostics": true,
            "evolveProvider": "openrouter",
            "evolveModel": "anthropic/claude",
            "summaryProvider": "openai",
            "summaryModel": "gpt-5-mini",
            "ollamaApiBaseUrl": "http://localhost:11434",
            "vllmApiBaseUrl": "http://localhost:8000",
            "confirmBuild": false,
            "confirmClear": false,
            "confirmRollback": false,
            "autoSummarizeOnFocus": true,
            "scanHomebrewOnStartup": false,
            "defaultToDiffTab": true,
            "developerMode": true,
            "pinnedVersion": "0.22.0",
            "updateChannel": "develop"
        }));

        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();

        assert_eq!(prefs.host_attr.as_deref(), Some("macbook"));
        assert_eq!(prefs.config_dir.as_deref(), Some("/Users/cm/.darwin"));
        assert_eq!(prefs.evolve_provider.as_deref(), Some("openrouter"));
        assert_eq!(prefs.update_channel, UpdateChannel::Develop);
        assert!(prefs.send_diagnostics);
        assert!(prefs.developer_mode);
    }

    #[test]
    fn global_preferences_default_when_slice_file_is_absent() {
        let persistence = MemoryPersistence::default();
        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();

        assert_eq!(prefs, GlobalPreferences::default());
    }

    #[test]
    fn global_preferences_ignore_unknown_fields() {
        let persistence = MemoryPersistence::with_value(json!({
            "hostAttr": "macbook",
            "developerMode": false,
            "openaiApiKey": "secret",
            "cachedModels_openai": ["gpt-5-mini"],
            "promptHistory": ["do not persist as preferences"]
        }));

        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();

        assert_eq!(prefs.host_attr.as_deref(), Some("macbook"));
        assert!(!prefs.developer_mode);

        let serialized = serde_json::to_value(&prefs).unwrap();
        assert!(serialized.get("openaiApiKey").is_none());
        assert!(serialized.get("cachedModels_openai").is_none());
        assert!(serialized.get("promptHistory").is_none());
    }
}
