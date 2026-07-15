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

const GLOBAL_PREFERENCES_PATH: &str = "global-preferences.json";

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

    let mut dirty = migrate_from_legacy_store(app, &mut initial)?;
    dirty |= migrate_diagnostics_default_on(&mut initial);
    dirty |= migrate_model_scalars_to_maps(&mut initial);
    if dirty {
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

/// One-shot flip to default-on diagnostics for installs that predate the
/// change. Existing installs have `sendDiagnostics: false` persisted (the old
/// default) even though most users never made an explicit choice. Until the
/// one-time consent notice has been acknowledged, `send_diagnostics: false`
/// is treated as "never chose" and flipped on; the notice (shown by the
/// frontend while `diagnostics_notice_acknowledged` is false) discloses this
/// and offers opt-out.
///
/// Known trade-off: pre-change installs where the user *explicitly* toggled
/// diagnostics off are indistinguishable from never-chose (both persisted
/// `false`, and the ack flag didn't exist yet), so those installs get flipped
/// on once and re-disclosed via the notice. Choices made after this shipped
/// are safe: any explicit `send_diagnostics` update also sets the acknowledged
/// flag (see `GlobalPreferences::apply_ui_update`), which makes this a no-op.
fn migrate_diagnostics_default_on(prefs: &mut GlobalPreferences) -> bool {
    if prefs.diagnostics_notice_acknowledged || prefs.send_diagnostics {
        return false;
    }
    prefs.send_diagnostics = true;
    true
}

/// One-shot fold of the deprecated single-model fields into the per-provider
/// maps. `evolve_model`/`summary_model` exist only so settings written by
/// older versions still load; each is moved under the provider it was saved
/// with (an existing map entry wins) and the scalar is cleared. Empty scalars
/// are dropped. Scalars persisted without a provider are left in place: they
/// have no provider to key under.
pub(crate) fn migrate_model_scalars_to_maps(prefs: &mut GlobalPreferences) -> bool {
    fn fold(
        provider: Option<&str>,
        scalar: &mut Option<String>,
        map: &mut std::collections::BTreeMap<String, String>,
    ) -> bool {
        let Some(provider) = provider else {
            return false;
        };
        let Some(model) = scalar.take() else {
            return false;
        };
        if !model.is_empty() {
            map.entry(provider.to_string()).or_insert(model);
        }
        true
    }

    let evolve_provider = prefs.evolve_provider.clone();
    let summary_provider = prefs.summary_provider.clone();
    let mut dirty = fold(
        evolve_provider.as_deref(),
        &mut prefs.evolve_model,
        &mut prefs.evolve_models,
    );
    dirty |= fold(
        summary_provider.as_deref(),
        &mut prefs.summary_model,
        &mut prefs.summary_models,
    );
    dirty
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
    fn global_preferences_provisional_config_dir_roundtrip() {
        // Absent in a pre-existing file -> None; persisted value survives a
        // load/serialize round trip.
        let persistence = MemoryPersistence::with_value(json!({
            "configDir": "/Users/cm/.darwin"
        }));
        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();
        assert_eq!(prefs.onboarding_provisional_config_dir, None);

        let persistence = MemoryPersistence::with_value(json!({
            "configDir": "/Users/cm/.darwin",
            "onboardingProvisionalConfigDir": "/Users/cm/.darwin"
        }));
        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();
        assert_eq!(
            prefs.onboarding_provisional_config_dir.as_deref(),
            Some("/Users/cm/.darwin")
        );
        let serialized = serde_json::to_value(&prefs).unwrap();
        assert_eq!(
            serialized.get("onboardingProvisionalConfigDir"),
            Some(&json!("/Users/cm/.darwin"))
        );
    }

    #[test]
    fn global_preferences_default_when_slice_file_is_absent() {
        let persistence = MemoryPersistence::default();
        let prefs = load_or_default::<GlobalPreferences>(&persistence).unwrap();

        assert_eq!(prefs, GlobalPreferences::default());
    }

    #[test]
    fn diagnostics_default_on_flips_unacknowledged_opt_out() {
        // Pre-change install: persisted false only because the old default
        // was false and the user never saw a consent prompt.
        let mut prefs = GlobalPreferences {
            send_diagnostics: false,
            diagnostics_notice_acknowledged: false,
            ..GlobalPreferences::default()
        };
        assert!(migrate_diagnostics_default_on(&mut prefs));
        assert!(prefs.send_diagnostics);
        // The notice stays un-acknowledged so the frontend still shows it.
        assert!(!prefs.diagnostics_notice_acknowledged);
    }

    #[test]
    fn diagnostics_default_on_respects_explicit_opt_out() {
        let mut prefs = GlobalPreferences {
            send_diagnostics: false,
            diagnostics_notice_acknowledged: true,
            ..GlobalPreferences::default()
        };
        assert!(!migrate_diagnostics_default_on(&mut prefs));
        assert!(!prefs.send_diagnostics);
    }

    #[test]
    fn explicit_send_diagnostics_update_acknowledges_notice() {
        let mut prefs = GlobalPreferences::default();
        prefs.apply_ui_update(&crate::shared_types::UiPrefsUpdate {
            send_diagnostics: Some(false),
            ..Default::default()
        });
        assert!(!prefs.send_diagnostics);
        assert!(prefs.diagnostics_notice_acknowledged);
        // Idempotent at next load: the migration must not flip it back.
        assert!(!migrate_diagnostics_default_on(&mut prefs));
        assert!(!prefs.send_diagnostics);
    }

    #[test]
    fn model_scalar_migration_folds_into_map_and_clears_scalar() {
        let mut prefs = GlobalPreferences {
            evolve_provider: Some("openrouter".to_string()),
            evolve_model: Some("anthropic/claude".to_string()),
            summary_provider: Some("openai".to_string()),
            summary_model: Some("gpt-5-mini".to_string()),
            ..GlobalPreferences::default()
        };

        assert!(migrate_model_scalars_to_maps(&mut prefs));
        assert_eq!(
            prefs.evolve_models.get("openrouter").map(String::as_str),
            Some("anthropic/claude")
        );
        assert_eq!(
            prefs.summary_models.get("openai").map(String::as_str),
            Some("gpt-5-mini")
        );
        assert_eq!(prefs.evolve_model, None);
        assert_eq!(prefs.summary_model, None);
        // Idempotent: nothing left to fold.
        assert!(!migrate_model_scalars_to_maps(&mut prefs));
    }

    #[test]
    fn model_scalar_migration_keeps_existing_map_entry() {
        let mut prefs = GlobalPreferences {
            evolve_provider: Some("openrouter".to_string()),
            evolve_model: Some("stale/model".to_string()),
            evolve_models: [("openrouter".to_string(), "newer/model".to_string())].into(),
            ..GlobalPreferences::default()
        };

        assert!(migrate_model_scalars_to_maps(&mut prefs));
        assert_eq!(
            prefs.evolve_models.get("openrouter").map(String::as_str),
            Some("newer/model")
        );
        assert_eq!(prefs.evolve_model, None);
    }

    #[test]
    fn model_scalar_migration_drops_empty_and_keeps_providerless() {
        // Empty scalar: cleared without creating a map entry.
        let mut prefs = GlobalPreferences {
            evolve_provider: Some("ollama".to_string()),
            evolve_model: Some(String::new()),
            ..GlobalPreferences::default()
        };
        assert!(migrate_model_scalars_to_maps(&mut prefs));
        assert!(prefs.evolve_models.is_empty());
        assert_eq!(prefs.evolve_model, None);

        // No provider to key under: scalar stays untouched.
        let mut prefs = GlobalPreferences {
            evolve_model: Some("orphan".to_string()),
            ..GlobalPreferences::default()
        };
        assert!(!migrate_model_scalars_to_maps(&mut prefs));
        assert_eq!(prefs.evolve_model.as_deref(), Some("orphan"));
    }

    #[test]
    fn model_updates_write_per_provider_map_only() {
        let mut prefs = GlobalPreferences {
            evolve_provider: Some("openrouter".to_string()),
            ..GlobalPreferences::default()
        };
        prefs.apply_ui_update(&crate::shared_types::UiPrefsUpdate {
            evolve_model: Some("anthropic/claude".to_string()),
            ..Default::default()
        });
        assert_eq!(
            prefs.evolve_models.get("openrouter").map(String::as_str),
            Some("anthropic/claude")
        );
        assert_eq!(prefs.evolve_model, None);

        // Switching provider leaves the remembered entry in place; the model
        // sent with the switch keys under the new provider.
        prefs.apply_ui_update(&crate::shared_types::UiPrefsUpdate {
            evolve_provider: Some("openai".to_string()),
            evolve_model: Some("gpt-5".to_string()),
            ..Default::default()
        });
        assert_eq!(
            prefs.evolve_models.get("openrouter").map(String::as_str),
            Some("anthropic/claude")
        );
        assert_eq!(
            prefs.evolve_models.get("openai").map(String::as_str),
            Some("gpt-5")
        );

        // Empty model reverts the current provider to its default.
        prefs.apply_ui_update(&crate::shared_types::UiPrefsUpdate {
            evolve_model: Some(String::new()),
            ..Default::default()
        });
        assert!(!prefs.evolve_models.contains_key("openai"));
        assert_eq!(prefs.current_evolve_model(), None);
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
