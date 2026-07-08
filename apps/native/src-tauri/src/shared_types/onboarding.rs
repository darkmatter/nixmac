use serde::{Deserialize, Serialize};
use specta::Type;

/// Backend-owned onboarding lifecycle state.
///
/// Whether the onboarding flow is shown is gated by this latch, not by
/// re-deriving completion from preference facts: "the user finished
/// onboarding" is a historical fact about a journey, and current state
/// (a cleared host during a settings edit, a revoked permission) can
/// regress while the journey stays finished. The step machine *inside*
/// the flow keeps deriving progress from durable facts.
///
/// Hydrated via `onboarding.getState`; every mutation emits
/// `onboarding_state_changed` with the full struct as payload.
/// See `docs/2026-07-08-onboarding-state-ownership.md`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct OnboardingState {
    /// Timestamp (unix secs) the user completed onboarding. Set when the
    /// celebration is dismissed (validated against a successful first build),
    /// reconciled at startup for profiles that finished before the latch
    /// existed, and cleared by "Restart setup".
    #[specta(type = Option<f64>)]
    pub completed_at: Option<i64>,
}
