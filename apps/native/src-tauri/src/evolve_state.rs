//! Persisted evolve state — drives widget step routing.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const EVOLVE_STATE_PATH: &str = "evolve-state.json";
const EVOLVE_STATE_KEY: &str = "evolveState";

/// Widget step derived from `EvolveState` fields.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EvolveStep {
    #[default]
    Begin,
    Evolve,
    Merge,
}

/// Persisted evolve state stored in `evolve-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveState {
    pub evolution_id: Option<i64>,
    pub current_changeset_id: Option<i64>,
    pub changeset_at_build: Option<i64>,
    pub committable: bool,
    /// Computed from the other fields — always kept in sync by `set`.
    pub step: EvolveStep,
}

impl Default for EvolveState {
    fn default() -> Self {
        Self {
            evolution_id: None,
            current_changeset_id: None,
            changeset_at_build: None,
            committable: false,
            step: EvolveStep::Begin,
        }
    }
}

impl EvolveState {
    fn recompute_step(&mut self) {
        self.step = match (self.evolution_id, self.committable) {
            (None, _) => EvolveStep::Begin,
            (Some(_), false) => EvolveStep::Evolve,
            (Some(_), true) => EvolveStep::Merge,
        };
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
    let store = app.store(EVOLVE_STATE_PATH)?;
    store.set(EVOLVE_STATE_KEY, serde_json::to_value(&state)?);
    store.save()?;
    Ok(state)
}

/// Reset to idle and persist.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set(app, EvolveState::default())
}
