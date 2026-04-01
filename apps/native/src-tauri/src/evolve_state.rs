//! Persisted evolve state — drives widget step routing.

use anyhow::Result;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

pub use crate::shared_types::EvolveState;

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

/// Recompute `step`, persist, and return the updated state.
pub fn set<R: Runtime>(app: &AppHandle<R>, mut state: EvolveState) -> Result<EvolveState> {
    state.recompute_step();
    let store = app.store(EVOLVE_STATE_PATH)?;
    store.set(EVOLVE_STATE_KEY, serde_json::to_value(&state)?);
    store.save()?;
    Ok(state)
}

/// Reset to idle and persist.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set(app, EvolveState::default())
}
