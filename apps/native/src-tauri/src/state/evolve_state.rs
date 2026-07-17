//! Evolve session state and its derived UI projection.
//!
//! The only stored state is [`EvolveSession`] — the identity of an active
//! evolution and the bookkeeping to roll it back — held in a single
//! `Observable<EvolveSession>` persisted to `evolve-state.json`.
//!
//! The UI [`EvolveStep`] and the `committable` flag are NOT stored anywhere.
//! They are pure functions of the session plus live build/git state, computed
//! by [`project`] only at the two moments a caller actually needs an
//! [`EvolveState`]: the `get_evolve_state` command (pull) and the
//! `evolve_state_changed` emit (push). This removes the class of bug where a
//! cached step/committable drifts out of sync with the real repository.
//!
//! Mutations funnel through [`set_session`] (the session changed) or
//! [`refresh`] (build/git changed but the session did not — the watcher and
//! build-finalize paths). Both end in [`emit_projection`], the single place
//! that projects, emits, and runs the chat-memory side effect.

use anyhow::Result;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::evolve::session_chat_memory_store;
use crate::observable::{AppDataJson, Observable, Persistence};
use crate::shared_types::{EvolutionState, EvolveSession, EvolveState, EvolveStep};
use crate::sqlite_types::Change;

const EVOLVE_STATE_PATH: &str = "evolve-state.json";
pub const EVOLVE_STATE_CHANGED_EVENT: &str = "evolve_state_changed";

// =============================================================================
// Pure derivation
// =============================================================================

/// Derive the UI step from the session and live build/git state.
fn compute_step(session: &EvolveSession, is_built: bool, has_changes: bool) -> EvolveStep {
    match (session.evolution_id, is_built, has_changes) {
        (Some(_), true, _) => EvolveStep::Commit,
        (Some(_), false, _) => EvolveStep::Evolve,
        (None, true, true) => EvolveStep::ManualCommit,
        (None, false, true) => EvolveStep::ManualEvolve,
        _ => EvolveStep::Begin,
    }
}

/// Join the owned session with the two derived values into the wire type.
pub fn project(session: &EvolveSession, is_built: bool, has_changes: bool) -> EvolveState {
    EvolveState {
        evolution_id: session.evolution_id,
        current_changeset_id: session.current_changeset_id,
        committable: is_built,
        backup_branch: session.backup_branch.clone(),
        rollback_branch: session.rollback_branch.clone(),
        rollback_store_path: session.rollback_store_path.clone(),
        rollback_changeset_id: session.rollback_changeset_id,
        step: compute_step(session, is_built, has_changes),
        last_evolution_state: session.last_evolution_state.clone(),
    }
}

fn live_inputs<R: Runtime>(app: &AppHandle<R>, current_changes: &[Change]) -> (bool, bool) {
    let is_built = crate::state::build_state::current_state_built(app, current_changes);
    let has_changes = !current_changes.is_empty();
    (is_built, has_changes)
}

// =============================================================================
// Chat-memory side effect
// =============================================================================

fn clear_chat_memory_if_begin(
    step: &EvolveStep,
    preserve_for_conversational_begin: bool,
    clear_fn: impl FnOnce(),
) {
    // WHY this lives on the recompute path rather than `clear()`:
    // `clear()` resets to Begin but is not called on every transition back to
    // Begin (e.g. Evolve → Begin when evolution_id is cleared but the tree is
    // still built). Firing here ensures the purge covers ALL routes into Begin.
    if *step == EvolveStep::Begin && !preserve_for_conversational_begin {
        clear_fn();
    }
}

// =============================================================================
// Session persistence (the only stored state)
// =============================================================================

fn deserialize_session(value: Value) -> Option<EvolveSession> {
    serde_json::from_value(value).ok()
}

fn load_session_from_persistence(persistence: &dyn Persistence) -> Result<EvolveSession> {
    Ok(persistence
        .load()?
        .and_then(deserialize_session)
        .unwrap_or_default())
}

/// Construct the persisted session observable. Loaded from `evolve-state.json`;
/// legacy files that still carry `step`/`committable` deserialize fine (the
/// extra keys are ignored).
pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Result<Observable<EvolveSession>> {
    let persistence: Arc<dyn Persistence> = Arc::new(AppDataJson::for_app(app, EVOLVE_STATE_PATH)?);
    let initial = load_session_from_persistence(persistence.as_ref())?;
    Ok(Observable::new(initial).persist_to(persistence))
}

/// Read the owned session — from the managed observable, or straight from disk
/// on the CLI / unmanaged paths.
pub fn get_session<R: Runtime>(app: &AppHandle<R>) -> EvolveSession {
    if let Some(observable) = app.try_state::<Observable<EvolveSession>>() {
        return observable.read_sync().clone();
    }
    AppDataJson::for_app(app, EVOLVE_STATE_PATH)
        .ok()
        .and_then(|persistence| load_session_from_persistence(&persistence).ok())
        .unwrap_or_default()
}

fn write_session<R: Runtime>(app: &AppHandle<R>, session: &EvolveSession) {
    if let Some(observable) = app.try_state::<Observable<EvolveSession>>() {
        *observable.write_sync() = session.clone();
        return;
    }
    // Unmanaged (CLI / bare tests): persist directly.
    if let Ok(persistence) = AppDataJson::for_app(app, EVOLVE_STATE_PATH)
        && let Ok(value) = serde_json::to_value(session)
    {
        let _ = persistence.flush(&value);
    }
}

// =============================================================================
// Stale-session invalidation
// =============================================================================

/// Clear the session when its backup snapshot is no longer anchored at HEAD.
///
/// A session is only valid relative to the commit it started from — the backup
/// commit's parent. When HEAD moves underneath nixmac (manual commits,
/// external tooling), trusting the stale session resurrects a dead "Review"
/// step on a clean repo, and discarding it would restore a snapshot that
/// silently reverts commits nixmac never made.
fn clear_stale_session<R: Runtime>(app: &AppHandle<R>, session: &mut EvolveSession) {
    let Some(branch) = session
        .rollback_branch
        .as_deref()
        .or(session.backup_branch.as_deref())
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
    *session = EvolveSession::default();
}

// =============================================================================
// Projection (computed on demand) + emit
// =============================================================================

/// Project `session` against live build/git state, emit `evolve_state_changed`
/// with the result, and run the chat-memory side effect. The single push point.
fn emit_projection<R: Runtime>(
    app: &AppHandle<R>,
    session: &EvolveSession,
    current_changes: &[Change],
) -> EvolveState {
    let (is_built, has_changes) = live_inputs(app, current_changes);
    let projection = project(session, is_built, has_changes);

    // fire-and-forget: emit returns Err only when no window is listening.
    let _ = app.emit(EVOLVE_STATE_CHANGED_EVENT, &projection);

    let preserve_for_conversational_begin = projection.step == EvolveStep::Begin
        && matches!(
            session.last_evolution_state.as_ref(),
            Some(EvolutionState::Conversational)
        );
    clear_chat_memory_if_begin(&projection.step, preserve_for_conversational_begin, || {
        session_chat_memory_store().clear()
    });

    projection
}

/// Recompute and broadcast the projection from the current (stored) session.
/// Use this when build/git state changed but the session did not — the watcher
/// tick, the build-finalize paths, and the `get_evolve_state` command. Persists
/// the session only if the stale-session check had to clear it.
pub fn refresh<R: Runtime>(app: &AppHandle<R>, current_changes: &[Change]) -> EvolveState {
    let mut session = get_session(app);
    let before = session.clone();
    clear_stale_session(app, &mut session);
    if session != before {
        write_session(app, &session);
    }
    emit_projection(app, &session, current_changes)
}

/// Persist a new owned session and broadcast the freshly derived projection.
pub fn set_session<R: Runtime>(
    app: &AppHandle<R>,
    mut session: EvolveSession,
    current_changes: &[Change],
) -> Result<EvolveState> {
    clear_stale_session(app, &mut session);
    write_session(app, &session);
    Ok(emit_projection(app, &session, current_changes))
}

/// Reset to an idle session and broadcast the derived projection.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<EvolveState> {
    set_session(app, EvolveSession::default(), &[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compute_step_routes_on_session_and_live_state() {
        let active = EvolveSession {
            evolution_id: Some(1),
            ..Default::default()
        };
        let idle = EvolveSession::default();

        // Active evolution: built → Commit, not built → Evolve (regardless of changes).
        assert_eq!(compute_step(&active, true, false), EvolveStep::Commit);
        assert_eq!(compute_step(&active, false, true), EvolveStep::Evolve);
        assert_eq!(compute_step(&active, false, false), EvolveStep::Evolve);

        // No evolution: derived purely from the working tree.
        assert_eq!(compute_step(&idle, true, true), EvolveStep::ManualCommit);
        assert_eq!(compute_step(&idle, false, true), EvolveStep::ManualEvolve);
        assert_eq!(compute_step(&idle, false, false), EvolveStep::Begin);
        // A clean, already-built tree with no session is idle, not committable-manual.
        assert_eq!(compute_step(&idle, true, false), EvolveStep::Begin);
    }

    #[test]
    fn project_joins_session_with_derived_values() {
        let session = EvolveSession {
            evolution_id: Some(7),
            rollback_branch: Some("nixmac-evolve/evolution7-changeset1".to_string()),
            last_evolution_state: Some(EvolutionState::Generated),
            ..Default::default()
        };

        let projection = project(&session, true, false);

        assert_eq!(projection.evolution_id, Some(7));
        assert_eq!(
            projection.rollback_branch.as_deref(),
            Some("nixmac-evolve/evolution7-changeset1")
        );
        assert!(projection.committable);
        assert_eq!(projection.step, EvolveStep::Commit);
        assert_eq!(
            projection.last_evolution_state,
            Some(EvolutionState::Generated)
        );
    }

    #[test]
    fn session_deserializes_from_legacy_file_with_derived_fields() {
        // A pre-split `evolve-state.json` still carries step/committable; the
        // owned session ignores them and reads only the owned fields.
        let session = deserialize_session(json!({
            "evolutionId": 12,
            "currentChangesetId": null,
            "committable": true,
            "backupBranch": null,
            "rollbackBranch": "nixmac-evolve/evolution12-changeset0",
            "rollbackStorePath": null,
            "rollbackChangesetId": null,
            "step": "commit",
            "lastEvolutionState": null
        }))
        .expect("legacy file deserializes into the session");

        assert_eq!(session.evolution_id, Some(12));
        assert_eq!(
            session.rollback_branch.as_deref(),
            Some("nixmac-evolve/evolution12-changeset0")
        );
    }

    #[test]
    fn chat_memory_clears_only_on_non_conversational_begin() {
        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, false, || cleared = true);
        assert!(cleared);

        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Evolve, false, || cleared = true);
        assert!(!cleared);

        let mut cleared = false;
        clear_chat_memory_if_begin(&EvolveStep::Begin, true, || cleared = true);
        assert!(!cleared, "conversational Begin preserves chat memory");
    }
}
