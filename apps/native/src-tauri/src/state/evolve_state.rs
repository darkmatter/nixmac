//! Persisted evolve state — drives widget step routing.

use anyhow::Result;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::evolve::session_chat_memory_store;
use crate::observable::{AppDataJson, Observable, Persistence};
use crate::shared_types::{EvolutionState, EvolveState, EvolveStep};
use crate::sqlite_types::Change;

impl EvolveState {
    pub fn recompute_step(&mut self, is_built: bool, has_changes: bool) {
        self.committable = is_built;
        self.step = match (self.evolution_id, is_built, has_changes) {
            (Some(_), true, _) => EvolveStep::Commit,
            (Some(_), false, _) => EvolveStep::Evolve,
            (None, true, true) => EvolveStep::ManualCommit,
            (None, false, true) => EvolveStep::ManualEvolve,
            _ => EvolveStep::Begin,
        };
    }
}

const EVOLVE_STATE_PATH: &str = "evolve-state.json";
pub const EVOLVE_STATE_CHANGED_EVENT: &str = "evolve_state_changed";

fn clear_chat_memory_if_begin(
    step: &EvolveStep,
    preserve_for_conversational_begin: bool,
    clear_fn: impl FnOnce(),
) {
    // WHY this lives in `set()` rather than `clear()`:
    // `clear()` resets to Begin but is not called on every transition back to
    // Begin (e.g. Evolve → Begin when evolution_id is cleared but committable
    // is still true). Placing the memory purge here ensures it fires on ALL
    // routes into Begin, not just the explicit "clear" path.
    if *step == EvolveStep::Begin && !preserve_for_conversational_begin {
        clear_fn();
    }
}

fn deserialize_persisted_state(value: Value) -> Option<EvolveState> {
    serde_json::from_value(value).ok()
}

/// Serialize only the session-owned fields. `step` and `committable` are
/// derived on every recompute and must never be trusted from disk — the
/// loaded defaults hold only until the first recompute corrects them.
fn persisted_value(state: &EvolveState) -> Result<Value> {
    let mut value = serde_json::to_value(state)?;
    if let Some(fields) = value.as_object_mut() {
        fields.remove("step");
        fields.remove("committable");
    }
    Ok(value)
}

fn load_from_persistence(persistence: &dyn Persistence) -> Result<EvolveState> {
    Ok(persistence
        .load()?
        .and_then(deserialize_persisted_state)
        .unwrap_or_default())
}

fn persist_without_managed_observable<R: Runtime>(
    app: &AppHandle<R>,
    state: &EvolveState,
) -> Result<()> {
    let persistence = AppDataJson::for_app(app, EVOLVE_STATE_PATH)?;
    persistence.flush(&persisted_value(state)?)?;
    let _ = app.emit(EVOLVE_STATE_CHANGED_EVENT, state);
    Ok(())
}

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Result<Observable<EvolveState>> {
    let persistence: Arc<dyn Persistence> = Arc::new(AppDataJson::for_app(app, EVOLVE_STATE_PATH)?);
    let initial = load_from_persistence(persistence.as_ref())?;
    Ok(Observable::new(initial)
        .emit_to(app, EVOLVE_STATE_CHANGED_EVENT)
        // Not `.persist_to`: the flushed JSON drops the derived fields.
        .subscribe(move |state| match persisted_value(state) {
            Ok(json) => {
                if let Err(error) = persistence.flush(&json) {
                    log::error!("evolve-state: failed to flush persistence: {error:#}");
                }
            }
            Err(error) => {
                log::error!("evolve-state: failed to serialize for persistence: {error:#}");
            }
        }))
}

/// Load the persisted evolve state, returning `EvolveState::default()` if absent or corrupt.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    if let Some(observable) = app.try_state::<Observable<EvolveState>>() {
        return Ok(observable.read_sync().clone());
    }

    let persistence = AppDataJson::for_app(app, EVOLVE_STATE_PATH)?;
    load_from_persistence(&persistence)
}

/// Clear the session fields when the recorded backup snapshot is no longer
/// anchored at the current HEAD.
///
/// A session (active evolution id, rollback/backup branches, rollback store
/// path) is only valid relative to the commit it started from — the backup
/// commit's parent. When HEAD moves underneath nixmac (manual commits,
/// external tooling), trusting the stale session resurrects a dead "Review"
/// step on a clean repo, and discarding it would restore a snapshot that
/// silently reverts commits nixmac never made.
fn clear_stale_session<R: Runtime>(app: &AppHandle<R>, state: &mut EvolveState) {
    let Some(branch) = state
        .rollback_branch
        .as_deref()
        .or(state.backup_branch.as_deref())
    else {
        // No snapshot recorded — nothing destructive to guard against.
        return;
    };
    let Ok(repo_root) = crate::storage::store::get_repo_root(app) else {
        return;
    };
    let anchor = crate::git::backup_anchor_commit(&repo_root, branch);
    let head = crate::git::get_ref_sha(&repo_root, "HEAD");
    if anchor.is_some() && anchor == head {
        return;
    }
    log::warn!(
        "[evolve-state] session anchor mismatch (branch={branch}, anchor={anchor:?}, head={head:?}); clearing stale session"
    );
    *state = EvolveState::default();
}

/// Recompute `step` and `committable` from build and git states.
///
/// Status is used to compare working tree to that at time of known build
pub fn set<R: Runtime>(
    app: &AppHandle<R>,
    mut state: EvolveState,
    current_changes: &[Change],
) -> Result<EvolveState> {
    clear_stale_session(app, &mut state);
    let is_built = crate::state::build_state::current_state_built(app, current_changes);
    let has_changes = !current_changes.is_empty();
    state.recompute_step(is_built, has_changes);

    // Preserve chat memory whenever we are at Begin and the last evolution
    // outcome was conversational (no edits). This intentionally persists
    // across repeated conversational cycles.
    let preserve_for_conversational_begin = state.step == EvolveStep::Begin
        && matches!(
            state.last_evolution_state.as_ref(),
            Some(EvolutionState::Conversational)
        );

    if let Some(observable) = app.try_state::<Observable<EvolveState>>() {
        let mut guard = observable.write_sync();
        *guard = state.clone();
        drop(guard);
    } else {
        persist_without_managed_observable(app, &state)?;
    }

    // Clear conversational thread memory whenever routing returns to Begin.
    // Doing this can prevent weird conversations where the model references past context
    // that is no longer relevant to the "new" prompt (as the UX looks like a "new chat" UX).
    // Note that `clear` is NOT a suitable place to do this since it is not called
    // on all possible transitions back to Begin (e.g. Evolve -> Begin when evolution_id
    // is cleared but committable is still true).
    clear_chat_memory_if_begin(&state.step, preserve_for_conversational_begin, || {
        session_chat_memory_store().clear()
    });

    Ok(state)
}

/// Reset to idle and persist.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set(app, EvolveState::default(), &[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clear_chat_memory_if_begin_calls_clear() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, false, || {
            cleared = true;
        });
        assert!(cleared);
    }

    #[test]
    fn clear_chat_memory_if_begin_skips_non_begin_steps() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Evolve, false, || {
            cleared = true;
        });
        assert!(!cleared);

        clear_chat_memory_if_begin(&EvolveStep::Commit, false, || {
            cleared = true;
        });
        assert!(!cleared);
    }

    #[test]
    fn clear_chat_memory_if_begin_skips_when_last_state_is_conversational() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, true, || {
            cleared = true;
        });
        assert!(!cleared);
    }

    #[test]
    fn clear_chat_memory_if_begin_clears_for_non_conversational_last_state() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, false, || {
            cleared = true;
        });
        assert!(cleared);
    }

    #[test]
    fn recomputed_begin_triggers_clear_logic() {
        let mut state = EvolveState {
            evolution_id: None,
            committable: true,
            ..Default::default()
        };
        state.recompute_step(true, false);

        let mut cleared = false;
        clear_chat_memory_if_begin(&state.step, false, || {
            cleared = true;
        });

        assert_eq!(state.step, EvolveStep::Begin);
        assert!(cleared);
    }

    #[test]
    fn persisted_value_strips_derived_fields() {
        let state = EvolveState {
            evolution_id: Some(7),
            committable: true,
            step: EvolveStep::Commit,
            rollback_branch: Some("nixmac-evolve/evolution7-changeset1".to_string()),
            ..Default::default()
        };

        let value = persisted_value(&state).expect("serializes");

        assert!(value.get("step").is_none());
        assert!(value.get("committable").is_none());
        assert_eq!(value["evolutionId"], 7);
        assert_eq!(
            value["rollbackBranch"],
            "nixmac-evolve/evolution7-changeset1"
        );

        // A stripped file round-trips: derived fields come back as defaults
        // (recomputed on first use), session fields survive.
        let loaded = deserialize_persisted_state(value).expect("stripped state deserializes");
        assert_eq!(loaded.evolution_id, Some(7));
        assert_eq!(
            loaded.rollback_branch.as_deref(),
            Some("nixmac-evolve/evolution7-changeset1")
        );
        assert_eq!(loaded.step, EvolveStep::Begin);
        assert!(loaded.committable == false);
    }

    #[test]
    fn deserialize_persisted_state_accepts_direct_slice_file() {
        let state = deserialize_persisted_state(json!({
            "evolutionId": 12,
            "currentChangesetId": null,
            "committable": true,
            "backupBranch": null,
            "rollbackBranch": null,
            "rollbackStorePath": null,
            "rollbackChangesetId": null,
            "step": "commit",
            "lastEvolutionState": null
        }))
        .expect("direct state deserializes");

        assert_eq!(state.evolution_id, Some(12));
        assert_eq!(state.step, EvolveStep::Commit);
    }
}
