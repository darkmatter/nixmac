use serde::{Deserialize, Serialize};
use specta::Type;

/// Auto-update channel selected for release-mode builds.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Develop,
}

/// User interface preferences.
///
/// Non-secret fields are synced to settings.json via tauri-plugin-store. API
/// keys are loaded from the encrypted app secrets blob.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    /// OpenRouter API key stored in encrypted app secrets.
    pub openrouter_api_key: Option<String>,
    /// OpenAI API key stored in encrypted app secrets.
    pub openai_api_key: Option<String>,
    /// Base URL for Ollama-compatible local models.
    pub ollama_api_base_url: Option<String>,
    /// Base URL for vLLM-compatible model servers.
    pub vllm_api_base_url: Option<String>,
    /// API key for vLLM-compatible model servers.
    pub vllm_api_key: Option<String>,
    /// Provider used for change summaries.
    pub summary_provider: Option<String>,
    /// Model used for change summaries.
    pub summary_model: Option<String>,
    /// Provider used for AI evolution.
    pub evolve_provider: Option<String>,
    /// Model used for AI evolution.
    pub evolve_model: Option<String>,
    /// Maximum agent iterations per evolution.
    pub max_iterations: Option<usize>,
    /// Maximum build attempts per evolution.
    pub max_build_attempts: Option<usize>,
    /// Whether diagnostic feedback may be sent.
    pub send_diagnostics: bool,
    /// Whether to confirm before running build/apply.
    pub confirm_build: bool,
    /// Whether to confirm before clearing changes.
    pub confirm_clear: bool,
    /// Whether to confirm before rollback.
    pub confirm_rollback: bool,
    /// Whether to auto-summarize changes when the app regains focus.
    pub auto_summarize_on_focus: bool,
    /// Whether Homebrew state should be scanned on app startup.
    pub scan_homebrew_on_startup: bool,
    /// Whether the change view defaults to the Diff tab instead of Summary.
    pub default_to_diff_tab: bool,
    /// Whether developer-only UI/actions are enabled.
    pub developer_mode: bool,
    /// Version pinned by the user, when update pinning is active.
    pub pinned_version: Option<String>,
    /// Auto-update channel used when no explicit version pin is active.
    pub update_channel: UpdateChannel,
}

/// Partial update to UI preferences — every field is optional so the caller
/// can send only the fields they wish to change.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefsUpdate {
    /// OpenRouter API key update.
    pub openrouter_api_key: Option<String>,
    /// OpenAI API key update.
    pub openai_api_key: Option<String>,
    /// Evolution provider update.
    pub evolve_provider: Option<String>,
    /// Evolution model update.
    pub evolve_model: Option<String>,
    /// Summary provider update.
    pub summary_provider: Option<String>,
    /// Summary model update.
    pub summary_model: Option<String>,
    /// Maximum iteration count update.
    pub max_iterations: Option<usize>,
    /// Maximum build-attempt count update.
    pub max_build_attempts: Option<usize>,
    /// Ollama base URL update.
    pub ollama_api_base_url: Option<String>,
    /// vLLM base URL update.
    pub vllm_api_base_url: Option<String>,
    /// vLLM API key update.
    pub vllm_api_key: Option<String>,
    /// Diagnostics sharing preference update.
    pub send_diagnostics: Option<bool>,
    /// Build confirmation preference update.
    pub confirm_build: Option<bool>,
    /// Clear confirmation preference update.
    pub confirm_clear: Option<bool>,
    /// Rollback confirmation preference update.
    pub confirm_rollback: Option<bool>,
    /// Focus auto-summary preference update.
    pub auto_summarize_on_focus: Option<bool>,
    /// Startup Homebrew scan preference update.
    pub scan_homebrew_on_startup: Option<bool>,
    /// Default-to-diff-tab preference update.
    pub default_to_diff_tab: Option<bool>,
    /// Developer mode preference update.
    pub developer_mode: Option<bool>,
    /// `None` -> field not sent; `Some(None)` -> clear the pinned version.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    pub pinned_version: Option<Option<String>>,
    /// Auto-update channel preference update.
    pub update_channel: Option<UpdateChannel>,
}

/// Lightweight update metadata returned by the channel-aware updater command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Channel whose manifest produced this update.
    pub channel: UpdateChannel,
    /// Version advertised by the channel manifest.
    pub version: String,
    /// Release notes from the channel manifest, when available.
    pub notes: Option<String>,
}

#[allow(dead_code)]
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        val: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match val {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Ok(Some(Option::deserialize(d)?))
    }
}
