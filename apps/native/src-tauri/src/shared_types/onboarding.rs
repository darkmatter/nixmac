use serde::{Deserialize, Serialize};
use specta::Type;

/// Backend-owned onboarding lifecycle state.
///
/// Whether the onboarding flow is shown is gated by the `completed_at` latch,
/// not by re-deriving completion from preference facts: "the user finished
/// onboarding" is a historical fact about a journey, and current state
/// (a cleared host during a settings edit, a revoked permission) can
/// regress while the journey stays finished. The step machine *inside*
/// the flow derives progress from the journey facts recorded here.
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
    /// Timestamp (unix secs) of the last onboarding "scan this Mac" /
    /// customizations review.
    #[specta(type = Option<f64>)]
    pub mac_scanned_at: Option<i64>,
    /// True once the user logged in or explicitly chose bring-your-own-key
    /// during onboarding.
    /// @todo consider if this should be computed - other code computes from the
    /// existence of a device API key (e.g. better-auth). If these 2 values conflict,
    // it would probably result in a bug.
    pub login_decided: bool,
    /// Timestamp (unix secs) of the last successful build/evolution apply.
    /// Set by `finalize_apply`.
    #[specta(type = Option<f64>)]
    pub last_build_at: Option<i64>,
    /// Root directory the app materialized during onboarding (import/scaffold)
    /// and still owns: until the first successful apply clears this, restart
    /// and re-import may wipe and re-create it. Never set for user-selected
    /// pre-existing directories. Backend code paths only.
    pub provisional_config_dir: Option<String>,
}
