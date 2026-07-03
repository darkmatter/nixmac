use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

/// Auto-update channel selected for release-mode builds.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Develop,
}

/// User interface preferences (synced to settings.json via tauri-plugin-store).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    /// OpenRouter API key stored in local app preferences.
    pub openrouter_api_key: Option<String>,
    /// OpenAI API key stored in local app preferences.
    pub openai_api_key: Option<String>,
    /// Base URL for Ollama-compatible local models.
    pub ollama_api_base_url: Option<String>,
    /// Base URL for OpenAI-compatible model servers.
    pub openai_compatible_api_base_url: Option<String>,
    /// API key for OpenAI-compatible model servers.
    pub openai_compatible_api_key: Option<String>,
    /// Provider used for change summaries.
    pub summary_provider: Option<String>,
    /// Model used for change summaries.
    pub summary_model: Option<String>,
    /// Provider used for AI evolution.
    pub evolve_provider: Option<String>,
    /// Model used for AI evolution.
    pub evolve_model: Option<String>,
    /// Legacy maximum agent iterations per evolution.
    pub max_iterations: Option<usize>,
    /// Maximum provider-reported tokens per evolution.
    pub max_token_budget: Option<u32>,
    /// Maximum build attempts per evolution.
    pub max_build_attempts: Option<usize>,
    /// Maximum output tokens requested per evolution model call.
    pub max_output_tokens: Option<usize>,
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
    /// Experimental: spin the nixmac mascot (horizontal-axis flip) in a corner
    /// indicator window while an evolution is running or a build is in progress.
    pub experimental_spinning_mascot: bool,
    /// Whether developer-only UI/actions are enabled.
    pub developer_mode: bool,
    /// Version pinned by the user, when update pinning is active.
    pub pinned_version: Option<String>,
    /// Auto-update channel used when no explicit version pin is active.
    pub update_channel: UpdateChannel,
    /// Developer-only feature flag overrides (flag key → variant string).
    /// `None` or missing key = use PostHog default.
    pub feature_flag_overrides: Option<BTreeMap<String, String>>,
    /// Whether or not to auto-format Nix files when making changes to the flakes.
    pub auto_format_nix_files: bool,
}

/// Partial update to UI preferences — every field is optional so the caller
/// can send only the fields they wish to change.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
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
    /// Legacy maximum iteration count update.
    pub max_iterations: Option<usize>,
    /// Maximum token budget update.
    pub max_token_budget: Option<u32>,
    /// Maximum build-attempt count update.
    pub max_build_attempts: Option<usize>,
    /// Maximum output token count update.
    pub max_output_tokens: Option<usize>,
    /// Ollama base URL update.
    pub ollama_api_base_url: Option<String>,
    /// OpenAI-compatible base URL update.
    pub openai_compatible_api_base_url: Option<String>,
    /// OpenAI-compatible API key update.
    pub openai_compatible_api_key: Option<String>,
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
    /// Experimental spinning-mascot preference update.
    pub experimental_spinning_mascot: Option<bool>,
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
    /// `None` -> field not sent; `Some(None)` -> clear all overrides;
    /// `Some(Some(map))` -> replace overrides with `map`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    pub feature_flag_overrides: Option<Option<BTreeMap<String, String>>>,
    /// Timestamp (unix secs) of the last onboarding "scan this Mac" / customizations review.
    pub onboarding_mac_scanned_at: Option<i64>,
    /// Set true once the user logged in or explicitly chose bring-your-own-key.
    pub onboarding_login_decided: Option<bool>,
    /// Auto-format Nix files after smart edits.
    pub auto_format_nix_files: Option<bool>,
}

/// Preferences local to this app installation.
///
/// Hydrated via `get_global_preferences`; every mutation emits
/// `global_preferences_changed` with the full struct as payload.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalPreferences {
    pub host_attr: Option<String>,
    pub config_dir: Option<String>,
    pub repo_root: Option<String>,
    pub send_diagnostics: bool,
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub ollama_api_base_url: Option<String>,
    pub openai_compatible_api_base_url: Option<String>,
    pub confirm_build: bool,
    pub confirm_clear: bool,
    pub confirm_rollback: bool,
    pub auto_summarize_on_focus: bool,
    pub scan_homebrew_on_startup: bool,
    pub default_to_diff_tab: bool,
    pub experimental_spinning_mascot: bool,
    pub developer_mode: bool,
    pub pinned_version: Option<String>,
    pub update_channel: UpdateChannel,
    pub feature_flag_overrides: Option<BTreeMap<String, String>>,
    /// Timestamp (unix secs) of the last onboarding "scan this Mac" / customizations review.
    #[specta(type = Option<f64>)]
    pub onboarding_mac_scanned_at: Option<i64>,
    /// True once the user logged in or explicitly chose bring-your-own-key during onboarding.
    pub onboarding_login_decided: bool,
    /// Timestamp (unix secs) of the last successful build/evolution apply. Set by `finalize_apply`.
    #[specta(type = Option<f64>)]
    pub onboarding_last_build_at: Option<i64>,
    /// Whether or not to auto-format Nix files when making changes to the flakes.
    pub auto_format_nix_files: bool,
}

impl Default for GlobalPreferences {
    fn default() -> Self {
        Self {
            host_attr: None,
            config_dir: None,
            repo_root: None,
            send_diagnostics: false,
            evolve_provider: None,
            evolve_model: None,
            summary_provider: None,
            summary_model: None,
            ollama_api_base_url: None,
            openai_compatible_api_base_url: None,
            confirm_build: true,
            confirm_clear: true,
            confirm_rollback: true,
            auto_summarize_on_focus: false,
            scan_homebrew_on_startup: true,
            default_to_diff_tab: false,
            experimental_spinning_mascot: false,
            developer_mode: false,
            pinned_version: None,
            update_channel: UpdateChannel::default(),
            feature_flag_overrides: None,
            onboarding_mac_scanned_at: None,
            onboarding_login_decided: false,
            onboarding_last_build_at: None,
            auto_format_nix_files: false,
        }
    }
}

impl GlobalPreferences {
    /// Applies the subset of a UI partial update that maps to global preferences.
    pub fn apply_ui_update(&mut self, update: &UiPrefsUpdate) {
        if let Some(v) = &update.summary_provider {
            self.summary_provider = Some(v.clone());
        }
        if let Some(v) = &update.summary_model {
            self.summary_model = Some(v.clone());
        }
        if let Some(v) = &update.evolve_provider {
            self.evolve_provider = Some(v.clone());
        }
        if let Some(v) = &update.evolve_model {
            self.evolve_model = Some(v.clone());
        }
        if let Some(v) = &update.ollama_api_base_url {
            self.ollama_api_base_url = Some(v.clone());
        }
        if let Some(v) = &update.openai_compatible_api_base_url {
            self.openai_compatible_api_base_url = Some(v.clone());
        }
        if let Some(v) = update.send_diagnostics {
            self.send_diagnostics = v;
        }
        if let Some(v) = update.confirm_build {
            self.confirm_build = v;
        }
        if let Some(v) = update.confirm_clear {
            self.confirm_clear = v;
        }
        if let Some(v) = update.confirm_rollback {
            self.confirm_rollback = v;
        }
        if let Some(v) = update.auto_summarize_on_focus {
            self.auto_summarize_on_focus = v;
        }
        if let Some(v) = update.scan_homebrew_on_startup {
            self.scan_homebrew_on_startup = v;
        }
        if let Some(v) = update.default_to_diff_tab {
            self.default_to_diff_tab = v;
        }
        if let Some(v) = update.experimental_spinning_mascot {
            self.experimental_spinning_mascot = v;
        }
        if let Some(v) = update.developer_mode {
            self.developer_mode = v;
        }
        if let Some(v) = &update.pinned_version {
            self.pinned_version = v.clone();
        }
        if let Some(v) = update.update_channel {
            self.update_channel = v;
        }
        if let Some(v) = &update.feature_flag_overrides {
            self.feature_flag_overrides = v.clone();
        }
        if let Some(v) = update.onboarding_mac_scanned_at {
            self.onboarding_mac_scanned_at = Some(v);
        }
        if let Some(v) = update.onboarding_login_decided {
            self.onboarding_login_decided = v;
        }
        if let Some(v) = update.auto_format_nix_files {
            self.auto_format_nix_files = v;
        }
    }

    /// Builds the non-secret subset of [`UiPrefs`] from global preferences.
    pub fn to_ui_prefs_base(&self) -> UiPrefs {
        UiPrefs {
            openrouter_api_key: None,
            openai_api_key: None,
            ollama_api_base_url: self.ollama_api_base_url.clone(),
            openai_compatible_api_base_url: self.openai_compatible_api_base_url.clone(),
            openai_compatible_api_key: None,
            summary_provider: self.summary_provider.clone(),
            summary_model: self.summary_model.clone(),
            evolve_provider: self.evolve_provider.clone(),
            evolve_model: self.evolve_model.clone(),
            max_iterations: None,
            max_token_budget: None,
            max_build_attempts: None,
            max_output_tokens: None,
            send_diagnostics: self.send_diagnostics,
            confirm_build: self.confirm_build,
            confirm_clear: self.confirm_clear,
            confirm_rollback: self.confirm_rollback,
            auto_summarize_on_focus: self.auto_summarize_on_focus,
            scan_homebrew_on_startup: self.scan_homebrew_on_startup,
            default_to_diff_tab: self.default_to_diff_tab,
            experimental_spinning_mascot: self.experimental_spinning_mascot,
            developer_mode: self.developer_mode,
            pinned_version: self.pinned_version.clone(),
            update_channel: self.update_channel,
            feature_flag_overrides: self.feature_flag_overrides.clone(),
            auto_format_nix_files: self.auto_format_nix_files,
        }
    }
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
