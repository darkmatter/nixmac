//! Onboarding lifecycle slice, persisted per-device in the app data directory.
//!
//! Owns the completion latch that gates whether the onboarding flow is shown.
//! Loaded after `GlobalPreferences` so startup reconciliation can read the
//! last-build timestamp.

use anyhow::Result;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

use crate::observable::{AppDataJson, Observable, Persistence};
pub use crate::shared_types::OnboardingState;
use crate::state::preferences;

const ONBOARDING_STATE_PATH: &str = "onboarding-state.json";

pub const ONBOARDING_STATE_CHANGED_EVENT: &str = "onboarding_state_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Result<Observable<OnboardingState>> {
    let persistence: Arc<dyn Persistence> =
        Arc::new(AppDataJson::for_app(app, ONBOARDING_STATE_PATH)?);
    let mut initial = preferences::load_or_default::<OnboardingState>(persistence.as_ref())?;

    let mut changed = false;
    if let Ok(prefs_persistence) = AppDataJson::for_app(app, preferences::GLOBAL_PREFERENCES_PATH) {
        changed |= migrate_from_prefs_file(&mut initial, &prefs_persistence)?;
    }
    changed |= reconcile_completion(&mut initial);
    if changed {
        persistence.flush(&serde_json::to_value(&initial)?)?;
    }

    Ok(Observable::new(initial)
        .emit_to(app, ONBOARDING_STATE_CHANGED_EVENT)
        .persist_to(persistence))
}

/// One-shot copy of the `onboarding*` journey fields that used to live on
/// `GlobalPreferences` into this slice. Values are copied only into unset
/// fields, and the migrated keys are stripped from the preferences file so
/// stale values can never resurrect progress after a later reset (this is
/// what makes the migration single-shot without a marker). Returns whether
/// `state` changed.
pub(crate) fn migrate_from_prefs_file(
    state: &mut OnboardingState,
    prefs_persistence: &dyn Persistence,
) -> Result<bool> {
    let Some(mut raw) = prefs_persistence.load()? else {
        return Ok(false);
    };
    let Some(fields) = raw.as_object_mut() else {
        return Ok(false);
    };

    let mut changed = false;
    if state.mac_scanned_at.is_none() {
        if let Some(v) = fields
            .get("onboardingMacScannedAt")
            .and_then(|v| v.as_i64())
        {
            state.mac_scanned_at = Some(v);
            changed = true;
        }
    }
    if !state.login_decided
        && fields
            .get("onboardingLoginDecided")
            .and_then(|v| v.as_bool())
            == Some(true)
    {
        state.login_decided = true;
        changed = true;
    }
    if state.last_build_at.is_none() {
        if let Some(v) = fields.get("onboardingLastBuildAt").and_then(|v| v.as_i64()) {
            state.last_build_at = Some(v);
            changed = true;
        }
    }
    if state.provisional_config_dir.is_none() {
        if let Some(v) = fields
            .get("onboardingProvisionalConfigDir")
            .and_then(|v| v.as_str())
        {
            state.provisional_config_dir = Some(v.to_string());
            changed = true;
        }
    }

    let mut stripped = false;
    for key in [
        "onboardingMacScannedAt",
        "onboardingLoginDecided",
        "onboardingLastBuildAt",
        "onboardingProvisionalConfigDir",
    ] {
        stripped |= fields.remove(key).is_some();
    }
    if stripped {
        prefs_persistence.flush(&raw)?;
    }

    Ok(changed)
}

/// Latch completion for profiles that finished onboarding without the latch:
/// pre-latch installs (migration) and apps killed between the first successful
/// build and the celebration dismiss (crash recovery). A successful apply is
/// the final durable gate, so its timestamp doubles as the completion moment.
/// Returns whether the state changed.
pub(crate) fn reconcile_completion(state: &mut OnboardingState) -> bool {
    if state.completed_at.is_some() {
        return false;
    }
    let Some(last_build_at) = state.last_build_at else {
        return false;
    };
    state.completed_at = Some(last_build_at);
    true
}

/// Read the current onboarding state, or `None` when the observable is not
/// managed (early startup, bare test harnesses).
pub fn try_read<R: Runtime>(app: &AppHandle<R>) -> Option<OnboardingState> {
    app.try_state::<Observable<OnboardingState>>()
        .map(|obs| obs.read_sync().clone())
}

/// Mutate the onboarding state through the observable.
///
/// Applies `f` to a copy and writes it back only when it actually changed,
/// so unchanged writes emit no event and trigger no persistence flush.
/// Errors when the observable is not managed.
pub fn write<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut OnboardingState)) -> Result<()> {
    let observable = app
        .try_state::<Observable<OnboardingState>>()
        .ok_or_else(|| anyhow::anyhow!("OnboardingState observable is not managed"))?;
    let mut next = observable.read_sync().clone();
    f(&mut next);
    if *observable.read_sync() == next {
        return Ok(());
    }
    *observable.write_sync() = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryPersistence {
        value: Mutex<Option<Value>>,
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
    fn onboarding_state_defaults_when_slice_file_is_absent() {
        let persistence = MemoryPersistence::default();
        let state = preferences::load_or_default::<OnboardingState>(&persistence).unwrap();
        assert_eq!(state, OnboardingState::default());
        assert_eq!(state.completed_at, None);
    }

    #[test]
    fn onboarding_state_roundtrips_camel_case() {
        let persistence = MemoryPersistence {
            value: Mutex::new(Some(json!({ "completedAt": 1751967600 }))),
        };
        let state = preferences::load_or_default::<OnboardingState>(&persistence).unwrap();
        assert_eq!(state.completed_at, Some(1751967600));

        let serialized = serde_json::to_value(&state).unwrap();
        assert_eq!(serialized.get("completedAt"), Some(&json!(1751967600)));
    }

    #[test]
    fn reconciliation_latches_from_last_build() {
        let mut state = OnboardingState {
            last_build_at: Some(1751967600),
            ..OnboardingState::default()
        };
        assert!(reconcile_completion(&mut state));
        assert_eq!(state.completed_at, Some(1751967600));
    }

    #[test]
    fn reconciliation_is_a_noop_without_a_build() {
        let mut state = OnboardingState::default();
        assert!(!reconcile_completion(&mut state));
        assert_eq!(state.completed_at, None);
    }

    #[test]
    fn reconciliation_never_overwrites_an_existing_latch() {
        let mut state = OnboardingState {
            completed_at: Some(100),
            last_build_at: Some(200),
            ..OnboardingState::default()
        };
        assert!(!reconcile_completion(&mut state));
        assert_eq!(state.completed_at, Some(100));
    }

    #[test]
    fn migration_copies_journey_fields_and_strips_them_from_prefs() {
        let prefs = MemoryPersistence {
            value: Mutex::new(Some(json!({
                "configDir": "/Users/cm/.darwin",
                "onboardingMacScannedAt": 10,
                "onboardingLoginDecided": true,
                "onboardingLastBuildAt": 20,
                "onboardingProvisionalConfigDir": "/tmp/prov"
            }))),
        };
        let mut state = OnboardingState::default();

        assert!(migrate_from_prefs_file(&mut state, &prefs).unwrap());
        assert_eq!(state.mac_scanned_at, Some(10));
        assert!(state.login_decided);
        assert_eq!(state.last_build_at, Some(20));
        assert_eq!(state.provisional_config_dir.as_deref(), Some("/tmp/prov"));

        // The prefs file no longer carries the migrated keys, but keeps the rest.
        let stripped = prefs.load().unwrap().unwrap();
        assert_eq!(stripped.get("configDir"), Some(&json!("/Users/cm/.darwin")));
        for key in [
            "onboardingMacScannedAt",
            "onboardingLoginDecided",
            "onboardingLastBuildAt",
            "onboardingProvisionalConfigDir",
        ] {
            assert!(stripped.get(key).is_none(), "{key} should be stripped");
        }

        // A rerun (against the stripped file) is a no-op.
        let mut rerun = OnboardingState::default();
        assert!(!migrate_from_prefs_file(&mut rerun, &prefs).unwrap());
        assert_eq!(rerun, OnboardingState::default());
    }

    #[test]
    fn migration_never_overwrites_recorded_state() {
        let prefs = MemoryPersistence {
            value: Mutex::new(Some(json!({ "onboardingLastBuildAt": 20 }))),
        };
        let mut state = OnboardingState {
            last_build_at: Some(99),
            ..OnboardingState::default()
        };
        assert!(!migrate_from_prefs_file(&mut state, &prefs).unwrap());
        assert_eq!(state.last_build_at, Some(99));
    }

    #[test]
    fn migration_is_a_noop_without_a_prefs_file() {
        let prefs = MemoryPersistence::default();
        let mut state = OnboardingState::default();
        assert!(!migrate_from_prefs_file(&mut state, &prefs).unwrap());
        assert_eq!(state, OnboardingState::default());
    }
}
