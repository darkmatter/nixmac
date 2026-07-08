//! Typed preference slices split by persistence scope.
//!
//! `GlobalPreferences` are per-device app preferences persisted in the app data
//! directory. Repo-scoped configurable slices are persisted under
//! `<config_dir>/.nixmac/settings.json`.
//!
//! API keys, model caches, prompt history, and other runtime caches are
//! intentionally excluded.

use anyhow::Result;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

use crate::observable::{AppDataJson, Observable, Persistence};
pub use crate::shared_types::GlobalPreferences;

pub(crate) const GLOBAL_PREFERENCES_PATH: &str = "global-preferences.json";

/// Marker key set in the legacy `settings.json` once its preference values
/// have been copied into `global-preferences.json`. The legacy values are
/// left in place (reversible one-shot) but no longer read.
pub(crate) const LEGACY_MIGRATED_MARKER: &str = "globalPreferencesMigratedV1";

pub const GLOBAL_PREFERENCES_CHANGED_EVENT: &str = "global_preferences_changed";

pub fn load_global_observable<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Observable<GlobalPreferences>> {
    let persistence: Arc<dyn Persistence> =
        Arc::new(AppDataJson::for_app(app, GLOBAL_PREFERENCES_PATH)?);
    let mut initial = load_or_default::<GlobalPreferences>(persistence.as_ref())?;

    if migrate_from_legacy_store(app, &mut initial)? {
        persistence.flush(&serde_json::to_value(&initial)?)?;
    }

    Ok(Observable::new(initial)
        .emit_to(app, GLOBAL_PREFERENCES_CHANGED_EVENT)
        .persist_to(persistence))
}

/// Read the current global preferences, or `None` when the observable is not
/// managed (early startup, bare test harnesses). Callers with a legacy
/// fallback should use it in the `None` case.
pub fn try_read<R: Runtime>(app: &AppHandle<R>) -> Option<GlobalPreferences> {
    app.try_state::<Observable<GlobalPreferences>>()
        .map(|obs| obs.read_sync().clone())
}

/// Mutate the global preferences through the observable.
///
/// Applies `f` to a copy and writes it back only when it actually changed,
/// so unchanged writes emit no event and trigger no persistence flush.
/// Errors when the observable is not managed.
pub fn write<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut GlobalPreferences)) -> Result<()> {
    let observable = app
        .try_state::<Observable<GlobalPreferences>>()
        .ok_or_else(|| anyhow::anyhow!("GlobalPreferences observable is not managed"))?;
    let mut next = observable.read_sync().clone();
    f(&mut next);
    if *observable.read_sync() == next {
        return Ok(());
    }
    *observable.write_sync() = next;
    Ok(())
}

/// One-shot copy of the legacy `settings.json` preference values into
/// `prefs`. Returns whether `prefs` should be flushed (first run after the
/// migration shipped). The legacy keys are left in place for reversibility;
/// a marker key prevents re-running.
fn migrate_from_legacy_store<R: Runtime>(
    app: &AppHandle<R>,
    prefs: &mut GlobalPreferences,
) -> Result<bool> {
    let Ok(store) = crate::storage::legacy_kv::get_store(app) else {
        return Ok(false);
    };
    if store
        .get(LEGACY_MIGRATED_MARKER)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Ok(false);
    }

    let mut as_value = serde_json::to_value(&*prefs)?;
    let Some(fields) = as_value.as_object_mut() else {
        return Ok(false);
    };
    for key in fields.keys().cloned().collect::<Vec<_>>() {
        if let Some(legacy) = store.get(&key) {
            fields.insert(key, legacy.clone());
        }
    }
    // Unknown/garbage legacy values fall back to the loaded ones.
    if let Ok(migrated) = serde_json::from_value::<GlobalPreferences>(as_value) {
        *prefs = migrated;
    }

    store.set(LEGACY_MIGRATED_MARKER, serde_json::Value::Bool(true));
    store.save()?;
    Ok(true)
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
    use crate::shared_types::UpdateChannel;
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
            "openaiCompatibleApiBaseUrl": "http://localhost:8000",
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

        let prefs: GlobalPreferences = load_or_default::<GlobalPreferences>(&persistence).unwrap();

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
