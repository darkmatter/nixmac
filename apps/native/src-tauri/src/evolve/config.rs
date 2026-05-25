//! Configurable limits for the evolution loop. Loaded fresh on every run so
//! edits made via the dev-settings UI take effect on the next run.
//!
//! Storage is repo-scoped — values live under `<config_dir>/.nixmac/settings.json`
//! so they ride along with the user's nix config repo across machines.

use configurable::Configurable;

#[derive(Configurable, Debug, Clone)]
#[config(store_path_fn = crate::storage::configurable_scope::repo_store_path)]
pub struct EvolutionLimits {
    #[config(default = 25, key = "maxIterations")]
    pub max_iterations: usize,

    #[config(default = 5, key = "maxBuildAttempts")]
    pub max_build_attempts: usize,
}
