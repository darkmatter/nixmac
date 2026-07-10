//! Per-provider default models, embedded from `apps/native/shared/ai-defaults.json`.
//!
//! That JSON is the single source of truth shared with the frontend
//! (`src/lib/providers/ai-defaults.ts`) — edit the JSON, not this module.

use std::sync::OnceLock;

use serde::Deserialize;

const RAW_DEFAULTS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/ai-defaults.json"
));

#[derive(Debug, Deserialize)]
struct AiDefaultsFile {
    providers: ProviderDefaults,
}

/// Declaring every provider as a required field makes serde reject a JSON
/// that drops one, keeping the file in sync with what the frontend expects.
#[derive(Debug, Deserialize)]
struct ProviderDefaults {
    nixmac: ProviderModelDefaults,
    openrouter: ProviderModelDefaults,
    openai: ProviderModelDefaults,
    #[allow(dead_code)]
    ollama: ProviderModelDefaults,
    #[allow(dead_code)]
    openai_compatible: ProviderModelDefaults,
    #[allow(dead_code)]
    claude: ProviderModelDefaults,
    #[allow(dead_code)]
    codex: ProviderModelDefaults,
    #[allow(dead_code)]
    opencode: ProviderModelDefaults,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelDefaults {
    evolve_model: String,
    summary_model: String,
}

fn providers() -> &'static ProviderDefaults {
    static PROVIDERS: OnceLock<ProviderDefaults> = OnceLock::new();
    PROVIDERS.get_or_init(|| {
        // The JSON is embedded at compile time and covered by the unit test
        // below, so a parse failure can only come from an unbuildable tree.
        serde_json::from_str::<AiDefaultsFile>(RAW_DEFAULTS)
            .expect("shared/ai-defaults.json must parse")
            .providers
    })
}

pub fn openrouter_evolve_model() -> &'static str {
    &providers().openrouter.evolve_model
}

pub fn openrouter_summary_model() -> &'static str {
    &providers().openrouter.summary_model
}

pub fn openai_evolve_model() -> &'static str {
    &providers().openai.evolve_model
}

pub fn openai_summary_model() -> &'static str {
    &providers().openai.summary_model
}

/// The nixmac hosted service routes `"auto"` server-side; the settings UI
/// additionally defaults summaries to the JSON's `summaryModel` ("flash").
pub fn nixmac_model() -> &'static str {
    &providers().nixmac.evolve_model
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_defaults_json_parses_with_known_providers() {
        assert!(openrouter_evolve_model().contains('/'));
        assert!(openrouter_summary_model().contains('/'));
        assert!(!openai_evolve_model().is_empty());
        assert!(!openai_summary_model().is_empty());
        assert!(!nixmac_model().is_empty());
    }
}
