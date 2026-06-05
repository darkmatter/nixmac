//! Repo-scoped configurable limits for the evolution loop.
//!
//! Storage is repo-scoped — values live under `<config_dir>/.nixmac/settings.json`
//! so they ride along with the user's nix config repo across machines.
//!
//! The struct is managed as an `Observable<EvolutionLimits>` at startup and
//! registered with the slice registry so Developer settings can render and
//! update it without opening store files directly.

use anyhow::Result;
use configurable::Configurable;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

use crate::observable::{ConfiguredRepoScopedJson, Observable, Persistence};
use crate::state::preferences;
use crate::state::slice::{RegisteredSliceConfig, SliceRegistry};

pub const EVOLUTION_LIMITS_CHANGED_EVENT: &str = "evolution_limits_changed";

#[derive(Configurable, Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
#[config(
    scope = "repo",
    display_name = "Evolution",
    description = "How long the agent will try before giving up."
)]
pub struct EvolutionLimits {
    #[config(
        default = 50_000,
        key = "maxTokenBudget",
        label = "Token budget",
        range = 1_000..=1_000_000,
        help = "Provider-reported tokens before stopping. Lower = faster/cheaper, may not finish complex changes.",
    )]
    pub max_token_budget: u32,

    #[config(
        default = 5,
        key = "maxBuildAttempts",
        label = "Max build attempts",
        range = 1..=20,
        help = "Failed builds before giving up on a run.",
    )]
    pub max_build_attempts: usize,

    #[config(
        default = 32_768,
        key = "maxOutputTokens",
        label = "Max output tokens",
        range = 1_024..=262_144,
        help = "Completion tokens requested from the evolution model. Lower if a local model rejects requests for exceeding its context window.",
    )]
    pub max_output_tokens: usize,
}

// Matches the `#[config(default = ...)]` values above. Used as the fallback
// in evolve::mod when EvolutionLimits::load fails (e.g. config_dir not yet
// set during onboarding); deriving `Default` would produce zeros, which
// would be wrong here.
impl Default for EvolutionLimits {
    fn default() -> Self {
        Self {
            max_token_budget: 50_000,
            max_build_attempts: 5,
            max_output_tokens: 32_768,
        }
    }
}

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Result<Observable<EvolutionLimits>> {
    let persistence: Arc<dyn Persistence> = Arc::new(ConfiguredRepoScopedJson::new(app.clone()));
    let initial = preferences::load_or_default::<EvolutionLimits>(persistence.as_ref())?;
    Ok(Observable::new(initial)
        .emit_to(app, EVOLUTION_LIMITS_CHANGED_EVENT)
        .persist_to(persistence))
}

pub fn register_slice_config(registry: &SliceRegistry) -> Result<()> {
    registry.register(RegisteredSliceConfig {
        name: "EvolutionLimits",
        schema_fn: EvolutionLimits::__configurable_schema_wry,
        set_field_fn: EvolutionLimits::__configurable_set_field_wry,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_configured_field_defaults() {
        let limits = EvolutionLimits::default();

        assert_eq!(limits.max_token_budget, 50_000);
        assert_eq!(limits.max_build_attempts, 5);
        assert_eq!(limits.max_output_tokens, 32_768);
    }

    #[test]
    fn unknown_fields_do_not_change_limits() {
        let limits: EvolutionLimits = serde_json::from_value(serde_json::json!({
            "maxTokenBudget": 80_000,
            "maxBuildAttempts": 3,
            "maxOutputTokens": 16_384,
            "developerMode": true
        }))
        .expect("limits deserialize");

        assert_eq!(
            limits,
            EvolutionLimits {
                max_token_budget: 80_000,
                max_build_attempts: 3,
                max_output_tokens: 16_384,
            }
        );
    }

    #[test]
    fn missing_fields_use_defaults() {
        let limits: EvolutionLimits =
            serde_json::from_value(serde_json::json!({})).expect("limits deserialize");

        assert_eq!(limits.max_token_budget, 50_000);
        assert_eq!(limits.max_build_attempts, 5);
        assert_eq!(limits.max_output_tokens, 32_768);
    }
}
