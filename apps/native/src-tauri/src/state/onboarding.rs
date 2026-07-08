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

    let last_build_at = preferences::try_read(app).and_then(|prefs| prefs.onboarding_last_build_at);
    if reconcile_completion(&mut initial, last_build_at) {
        persistence.flush(&serde_json::to_value(&initial)?)?;
    }

    Ok(Observable::new(initial)
        .emit_to(app, ONBOARDING_STATE_CHANGED_EVENT)
        .persist_to(persistence))
}

/// Latch completion for profiles that finished onboarding without the latch:
/// pre-latch installs (migration) and apps killed between the first successful
/// build and the celebration dismiss (crash recovery). A successful apply is
/// the final durable gate, so its timestamp doubles as the completion moment.
/// Returns whether the state changed.
pub(crate) fn reconcile_completion(
    state: &mut OnboardingState,
    last_build_at: Option<i64>,
) -> bool {
    if state.completed_at.is_some() {
        return false;
    }
    let Some(last_build_at) = last_build_at else {
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
        let mut state = OnboardingState::default();
        assert!(reconcile_completion(&mut state, Some(1751967600)));
        assert_eq!(state.completed_at, Some(1751967600));
    }

    #[test]
    fn reconciliation_is_a_noop_without_a_build() {
        let mut state = OnboardingState::default();
        assert!(!reconcile_completion(&mut state, None));
        assert_eq!(state.completed_at, None);
    }

    #[test]
    fn reconciliation_never_overwrites_an_existing_latch() {
        let mut state = OnboardingState {
            completed_at: Some(100),
        };
        assert!(!reconcile_completion(&mut state, Some(200)));
        assert_eq!(state.completed_at, Some(100));
    }
}
