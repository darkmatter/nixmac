//! Persisted evolve state — drives widget step routing.

use anyhow::Result;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::evolve::session_chat_memory_store;
pub use crate::shared_types::EvolveState;
use crate::shared_types::EvolveStep;

const EVOLVE_STATE_PATH: &str = "evolve-state.json";
const EVOLVE_STATE_KEY: &str = "evolveState";

fn clear_chat_memory_if_begin(step: &EvolveStep, clear_fn: impl FnOnce()) {
    if *step == EvolveStep::Begin {
        clear_fn();
    }
}

/// Load the persisted evolve state, returning `EvolveState::default()` if absent or corrupt.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    let store = app.store(EVOLVE_STATE_PATH)?;
    if let Some(val) = store.get(EVOLVE_STATE_KEY) {
        if let Ok(state) = serde_json::from_value::<EvolveState>(val.clone()) {
            return Ok(state);
        }
    }
    Ok(EvolveState::default())
}

/// Recompute `step`, persist, and return the updated state.
pub fn set<R: Runtime>(app: &AppHandle<R>, mut state: EvolveState) -> Result<EvolveState> {
    state.recompute_step();

    // Clear conversational thread memory whenever routing returns to Begin.
    // Doing this can prevent weird conversations where the model references past context
    // that is no longer relevant to the "new" prompt (as the UX looks like a "new chat" UX).
    // Note that `clear` is NOT a suitable place to do this since it is not called
    // on all possible transitions back to Begin (e.g. Evolve -> Begin when evolution_id
    // is cleared but committable is still true).
    clear_chat_memory_if_begin(&state.step, || session_chat_memory_store().clear());

    let store = app.store(EVOLVE_STATE_PATH)?;
    store.set(EVOLVE_STATE_KEY, serde_json::to_value(&state)?);
    store.save()?;
    Ok(state)
}

/// Reset to idle and persist.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set(app, EvolveState::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_chat_memory_if_begin_calls_clear() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, || {
            cleared = true;
        });
        assert!(cleared);
    }

    #[test]
    fn clear_chat_memory_if_begin_skips_non_begin_steps() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Evolve, || {
            cleared = true;
        });
        assert!(!cleared);

        clear_chat_memory_if_begin(&EvolveStep::Merge, || {
            cleared = true;
        });
        assert!(!cleared);
    }

    #[test]
    fn recomputed_begin_triggers_clear_logic() {
        let mut state = EvolveState {
            evolution_id: None,
            committable: true,
            ..Default::default()
        };
        state.recompute_step();

        let mut cleared = false;
        clear_chat_memory_if_begin(&state.step, || {
            cleared = true;
        });

        assert_eq!(state.step, EvolveStep::Begin);
        assert!(cleared);
    }
}
