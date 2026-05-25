//! Configurable limits for the evolution loop. Loaded fresh on every run so
//! edits made via the dev-settings UI take effect on the next run.
//!
//! Storage is repo-scoped — values live under `<config_dir>/.nixmac/settings.json`
//! so they ride along with the user's nix config repo across machines.
//!
//! The struct also auto-registers with the global Configurable inventory, so
//! the Tuning section in the Developer settings tab renders these fields
//! without any per-field UI code.

use configurable::Configurable;

#[derive(Configurable, Debug, Clone)]
#[config(
    store_path_fn = crate::storage::configurable_scope::repo_store_path,
    display_name = "Evolution",
    description = "How long the agent will try before giving up.",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_configured_field_defaults() {
        let limits = EvolutionLimits::default();

        assert_eq!(limits.max_iterations, 25);
        assert_eq!(limits.max_build_attempts, 5);
    }
}
