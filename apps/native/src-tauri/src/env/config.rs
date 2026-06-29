//! Build-time deployment profile via `#[derive(Configurable)]`.
//!
//! Values resolve in order: process env → build-time embed (CI secrets) →
//! `apps/native/env.{development,release,e2e}.json` (selected by `NIXMAC_ENV` at compile time)
//! → field defaults.
//!
//! Keys in those files use the same names as process environment variables
//! (e.g. `VITE_SERVER_URL`), not camelCase.

use anyhow::Result;
use configurable::Configurable;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime};

use crate::observable::Observable;

pub const ENV_SETTINGS_CHANGED_EVENT: &str = "env_settings_changed";

#[derive(Configurable, Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
#[config(
    scope = "env",
    display_name = "Environment",
    description = "Build-time deployment profile from apps/native/env.{development,release,e2e}.json — a checked-in public .env. Keys match environment variable names (e.g. VITE_SERVER_URL). Baked into the app at compile time; process env overrides at runtime. Do not commit secrets."
)]
pub struct NixmacEnvSettings {
    #[config(
        default = "",
        build_embed = true,
        env_var = "VITE_SERVER_URL",
        label = "Web server URL",
        help = "Better Auth / API origin for the nixmac web app."
    )]
    pub vite_server_url: String,

    #[config(
        default = "",
        build_embed = true,
        env_var = "SUBMITTED_FEEDBACK_DSN",
        label = "Feedback DSN",
        help = "Path segment for feedback submission endpoint."
    )]
    pub submitted_feedback_dsn: String,

    #[config(
        default = "",
        build_embed = true,
        env_var = "SENTRY_DSN",
        label = "Sentry DSN",
        help = "Diagnostics export destination."
    )]
    pub sentry_dsn: String,

    #[config(
        default = "prod",
        build_embed = true,
        env_var = "NIXMAC_ENV",
        label = "Deployment environment"
    )]
    pub nixmac_env: String,

    #[config(
        default = "unknown",
        build_embed = true,
        env_var = "NIXMAC_VERSION",
        label = "App version"
    )]
    pub nixmac_version: String,

    #[config(
        default = false,
        env_var = "NIXMAC_DISABLE_UPDATER",
        label = "Disable updater"
    )]
    pub disable_updater: bool,

    #[config(
        default = false,
        env_var = "VITE_NIXMAC_SKIP_PERMISSIONS",
        label = "Skip permissions (debug)"
    )]
    pub skip_permissions: bool,

    #[config(
        default = false,
        env_var = "DEBUG_SKIP_RESTORE_ALL",
        label = "Skip restore on failure (debug)"
    )]
    pub debug_skip_restore_all: bool,

    #[config(
        default = "",
        env_var = "NIXMAC_EVOLUTION_MEMORY_STRATEGY",
        label = "Evolution memory strategy",
        help = "One of: none, retention."
    )]
    pub evolution_memory_strategy: String,

    #[config(
        default = "",
        env_var = "SUMMARY_AI_PROVIDER",
        label = "Default summary provider",
        help = "Used when the user has not chosen a summary provider in Settings."
    )]
    pub default_summary_provider: String,

    #[config(
        default = "",
        env_var = "SUMMARY_MODEL",
        label = "Default summary model",
        help = "Used when the user has not chosen a summary model in Settings."
    )]
    pub default_summary_model: String,

    #[config(
        default = "",
        env_var = "EVOLVE_PROVIDER",
        label = "Default evolve provider",
        help = "Used when the user has not chosen an evolve provider in Settings."
    )]
    pub default_evolve_provider: String,

    #[config(
        default = "",
        env_var = "EVOLVE_MODEL",
        label = "Default evolve model",
        help = "Used when the user has not chosen an evolve model in Settings."
    )]
    pub default_evolve_model: String,

    #[config(default = "", env_var = "OLLAMA_API_BASE", label = "Ollama API base")]
    pub ollama_api_base: String,

    #[config(default = "", env_var = "VLLM_API_BASE", label = "vLLM API base")]
    pub vllm_api_base: String,

    #[config(
        default = "",
        env_var = "OPENAI_API_KEY",
        label = "OpenAI API key",
        help = "Prefer env vars or keychain for secrets; do not commit in env.*.json."
    )]
    pub openai_api_key: String,

    #[config(
        default = "",
        env_var = "OPENROUTER_API_KEY",
        label = "OpenRouter API key",
        help = "Prefer env vars or keychain for secrets; do not commit in env.*.json."
    )]
    pub openrouter_api_key: String,

    #[config(
        default = "",
        env_var = "VLLM_API_KEY",
        label = "vLLM API key",
        help = "Prefer env vars or keychain for secrets; do not commit in env.*.json."
    )]
    pub vllm_api_key: String,

    #[config(
        default = "",
        env_var = "VITE_POSTHOG_KEY",
        label = "PostHog project key",
        help = "Public PostHog project key for client analytics. Prefer CI env override for production."
    )]
    pub vite_posthog_key: String,

    #[config(
        default = "https://us.i.posthog.com",
        env_var = "VITE_POSTHOG_HOST",
        label = "PostHog host"
    )]
    pub vite_posthog_host: String,

    #[config(
        default = false,
        env_var = "VITE_NIXMAC_FILESYSTEM",
        label = "Enable filesystem view"
    )]
    pub vite_nixmac_filesystem: bool,

    #[config(
        default = false,
        env_var = "NIXMAC_RECORD_COMPLETIONS",
        label = "Record AI completion request/response JSONL",
        help = "When true, full request/response payloads for every AI provider call are written to a daily JSONL file and mirrored to stderr."
    )]
    pub record_completions: bool,

    #[config(
        default = "",
        env_var = "NIXMAC_COMPLETION_LOG_DIR",
        label = "Completion log directory",
        help = "Override the directory for AI completion JSONL logs. Defaults to ~/Library/Application Support/nixmac/logs/."
    )]
    pub completion_log_dir: String,

    #[config(
        default = "",
        env_var = "NIXMAC_LOGFILE",
        label = "Rust log file path",
        help = "When set, tracing output is mirrored to this file in addition to stderr."
    )]
    pub logfile: String,
}

impl Default for NixmacEnvSettings {
    fn default() -> Self {
        Self::resolve(None)
    }
}

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Result<Observable<NixmacEnvSettings>> {
    let initial = NixmacEnvSettings::resolve(None);
    Ok(Observable::new(initial).emit_to(app, ENV_SETTINGS_CHANGED_EVENT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_prefers_process_env_over_build_profile() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            "VITE_SERVER_URL",
            "SUMMARY_AI_PROVIDER",
        ]);
        unsafe { std::env::set_var("VITE_SERVER_URL", "https://env.example.com") };
        unsafe { std::env::remove_var("SUMMARY_AI_PROVIDER") };

        let settings = NixmacEnvSettings::resolve(None);
        assert_eq!(settings.vite_server_url, "https://env.example.com");
    }

    #[test]
    fn build_profile_reads_uppercase_env_var_keys() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&["VITE_SERVER_URL"]);
        unsafe { std::env::remove_var("VITE_SERVER_URL") };

        let settings = NixmacEnvSettings::resolve(None);
        assert_eq!(settings.vite_server_url, "https://nixmac.com");
    }
}
