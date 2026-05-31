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

#[cfg(test)]
mod tests {
    use super::EvolutionLimits;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri_plugin_store::StoreExt;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build(mock_context(noop_assets()))
            .expect("failed to build mock tauri app")
    }

    // An empty store must fall back to the per-field `#[config(default = ...)]`
    // values. These defaults are the contract the evolution loop relies on as its
    // own hardcoded fallback in mod.rs (25 iterations / 5 build attempts).
    #[test]
    fn load_returns_documented_defaults_when_store_is_empty() {
        let app = mock_app();

        let limits = EvolutionLimits::load(app.handle()).expect("load should succeed");

        assert_eq!(limits.max_iterations, 25);
        assert_eq!(limits.max_build_attempts, 5);
    }

    // Values persisted under the camelCased store keys must override the defaults,
    // proving the dev-settings hot-reload path the struct documents actually works.
    #[test]
    fn load_prefers_stored_values_over_defaults() {
        let app = mock_app();
        let store = app.store("settings.json").expect("store should open");
        store.set("maxIterations", serde_json::json!(50));
        store.set("maxBuildAttempts", serde_json::json!(9));

        let limits = EvolutionLimits::load(app.handle()).expect("load should succeed");

        assert_eq!(limits.max_iterations, 50);
        assert_eq!(limits.max_build_attempts, 9);
    }

    // Malformed JSON for a key (schema drift) must degrade gracefully to the
    // default rather than erroring, matching `read_field`'s deserialize-or-none.
    #[test]
    fn load_falls_back_to_default_on_type_mismatch() {
        let app = mock_app();
        let store = app.store("settings.json").expect("store should open");
        store.set("maxIterations", serde_json::json!("not-a-number"));

        let limits = EvolutionLimits::load(app.handle()).expect("load should succeed");

        assert_eq!(limits.max_iterations, 25);
    }
}
