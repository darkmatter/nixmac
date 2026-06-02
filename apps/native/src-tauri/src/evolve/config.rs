//! Repo-scoped configurable limits for the evolution loop.
//!
//! Storage is repo-scoped — values live under `<config_dir>/.nixmac/settings.json`
//! so they ride along with the user's nix config repo across machines.
//!
//! The struct is managed as a `Slice<EvolutionLimits>` at startup and registered
//! with the slice registry so Developer settings can render and update it
//! without opening store files directly.

use anyhow::Result;
use configurable::Configurable;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

use crate::state::preferences;
use crate::state::slice::{
    Persistence, RegisteredSliceConfig, RepoScopedJson, Slice, SliceRegistry,
};

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
        default = 25,
        key = "maxIterations",
        label = "Max iterations",
        range = 1..=200,
        help = "API calls before the agent stops. Lower = faster/cheaper but may not finish complex changes.",
    )]
    pub max_iterations: usize,

    #[config(
        default = 5,
        key = "maxBuildAttempts",
        label = "Max build attempts",
        range = 1..=20,
        help = "Failed builds before giving up on a run.",
    )]
    pub max_build_attempts: usize,
}

// Matches the `#[config(default = ...)]` values above. Used as the fallback
// in evolve::mod when EvolutionLimits::load fails (e.g. config_dir not yet
// set during onboarding); deriving `Default` would produce zeros, which
// would be wrong here.
impl Default for EvolutionLimits {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            max_build_attempts: 5,
        }
    }
}

pub fn load_slice<R: Runtime>(app: &AppHandle<R>) -> Result<Slice<EvolutionLimits>> {
    let persistence: Arc<dyn Persistence> =
        match crate::storage::configurable_scope::repo_store_path(app) {
            Ok(path) => Arc::new(RepoScopedJson::new(path)),
            Err(_) => Arc::new(preferences::VolatileJson),
        };
    let initial = preferences::load_or_default::<EvolutionLimits>(persistence.as_ref())?;

    Ok(Slice::new(
        EVOLUTION_LIMITS_CHANGED_EVENT,
        initial,
        persistence,
    ))
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

        assert_eq!(limits.max_iterations, 25);
        assert_eq!(limits.max_build_attempts, 5);
    }

    #[test]
    fn unknown_fields_do_not_change_limits() {
        let limits: EvolutionLimits = serde_json::from_value(serde_json::json!({
            "maxIterations": 11,
            "maxBuildAttempts": 3,
            "developerMode": true
        }))
        .expect("limits deserialize");

        assert_eq!(
            limits,
            EvolutionLimits {
                max_iterations: 11,
                max_build_attempts: 3,
            }
        );
    }
}
