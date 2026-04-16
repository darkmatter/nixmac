//! Persisted evolve state — drives widget step routing.

use anyhow::Result;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::sqlite_types::Change;

pub use crate::shared_types::{EvolveState, EvolveStep};

impl EvolveState {
    pub fn recompute_step(&mut self, is_built: bool, has_changes: bool) {
        self.committable = is_built;
        self.step = match (self.evolution_id, is_built, has_changes) {
            (Some(_), true, _)  => EvolveStep::Commit,
            (Some(_), false, _) => EvolveStep::Evolve,
            (None, true, true)  => EvolveStep::ManualCommit,
            (None, false, true) => EvolveStep::ManualEvolve,
            _                   => EvolveStep::Begin,
        };
    }
}

const EVOLVE_STATE_PATH: &str = "evolve-state.json";
const EVOLVE_STATE_KEY: &str = "evolveState";

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

/// Recompute `step` and `committable` from build and git states.
///
/// Status is used to compare working tree to that at time of known build
pub fn set<R: Runtime>(
    app: &AppHandle<R>,
    mut state: EvolveState,
    current_changes: &[Change],
) -> Result<EvolveState> {
    let is_built = crate::build_state::current_state_built(app, current_changes);
    let has_changes = !current_changes.is_empty();
    state.recompute_step(is_built, has_changes);
    let store = app.store(EVOLVE_STATE_PATH)?;
    store.set(EVOLVE_STATE_KEY, serde_json::to_value(&state)?);
    store.save()?;
    Ok(state)
}

/// Reset to idle and persist.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set(app, EvolveState::default(), &[])
}
