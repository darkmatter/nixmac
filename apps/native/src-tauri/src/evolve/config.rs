//! Configurable limits for the evolution loop. Loaded fresh on every run so
//! edits made via the dev-settings UI take effect on the next run.

use configurable::Configurable;

#[derive(Configurable, Debug, Clone)]
#[config(store_path = "settings.json")]
pub struct EvolutionLimits {
    #[config(default = 25, key = "maxIterations")]
    pub max_iterations: usize,

    #[config(default = 5, key = "maxBuildAttempts")]
    pub max_build_attempts: usize,
}
