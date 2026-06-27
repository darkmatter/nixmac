//! Application environment configuration.
//!
//! All nixmac-specific environment variables are declared on
//! [`config::NixmacEnvSettings`] via `#[derive(Configurable)]` and resolved
//! from three sources (highest precedence first):
//!
//! 1. Process environment (including debug E2E runtime overrides)
//! 2. Build-time embed (`option_env!`, set by CI/build.rs from env vars and
//!    `apps/native/env.{development,release,e2e}.json`)
//! 3. Field defaults in the derive metadata

pub mod config;
pub mod sources;

pub use crate::env_keys::names as keys;
pub use config::NixmacEnvSettings;

use anyhow::{Context, Result};
use tauri::{AppHandle, Runtime};

fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    (!value.is_empty()).then_some(value)
}

pub fn optional(value: String) -> Option<String> {
    non_empty(value)
}

pub fn settings(config_dir: Option<&str>) -> NixmacEnvSettings {
    NixmacEnvSettings::resolve(config_dir)
}

pub fn settings_for_app<R: Runtime>(app: &AppHandle<R>) -> NixmacEnvSettings {
    let config_dir = crate::storage::store::get_config_dir_if_set(app)
        .ok()
        .flatten();
    NixmacEnvSettings::resolve(config_dir.as_deref())
}

pub fn settings_from_app<R: Runtime>(app_handle: Option<&AppHandle<R>>) -> NixmacEnvSettings {
    if let Some(app) = app_handle {
        settings_for_app(app)
    } else {
        settings(None)
    }
}

pub fn nixmac_env() -> String {
    settings(None).nixmac_env
}

pub fn nixmac_version() -> String {
    settings(None).nixmac_version
}

pub fn sentry_dsn() -> Option<String> {
    non_empty(settings(None).sentry_dsn)
}

#[allow(dead_code)]
pub fn vite_server_url() -> Option<String> {
    non_empty(settings(None).vite_server_url)
}

#[allow(dead_code)]
pub fn submitted_feedback_dsn() -> Option<String> {
    non_empty(settings(None).submitted_feedback_dsn)
}

/// Debug-only E2E mock-system gate shared across store and scanners.
pub fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled(keys::NIXMAC_E2E_MOCK_SYSTEM)
}

/// Debug-only E2E override gated on `NIXMAC_E2E_MOCK_SYSTEM`.
pub(crate) fn e2e_override(name: &str) -> Option<String> {
    if !cfg!(debug_assertions) || !crate::e2e_runtime::enabled(keys::NIXMAC_E2E_MOCK_SYSTEM) {
        return None;
    }
    crate::e2e_runtime::value(name)
}

/// Resolves the nixmac web/API origin (`VITE_SERVER_URL`), with an E2E override.
pub fn web_server_url() -> Result<String> {
    web_server_url_for_config(None)
}

fn web_server_url_for_config(config_dir: Option<&str>) -> Result<String> {
    if let Some(url) = e2e_override(keys::NIXMAC_E2E_WEB_SERVER_URL) {
        return Ok(url.trim_end_matches('/').to_string());
    }
    non_empty(settings(config_dir).vite_server_url)
        .map(|url| url.trim_end_matches('/').to_string())
        .context("nixmac web server URL not configured (VITE_SERVER_URL)")
}

/// Constructs the full feedback submission URL from environment configuration.
pub fn feedback_url() -> Result<String> {
    feedback_url_for_config(None)
}

fn feedback_url_for_config(config_dir: Option<&str>) -> Result<String> {
    let resolved = settings(config_dir);
    let base =
        non_empty(resolved.vite_server_url).context("sending feedback not configured (url)")?;
    let dsn = non_empty(resolved.submitted_feedback_dsn)
        .context("sending feedback not configured (dsn)")?;
    Ok(format!("{base}/api/feedback/{dsn}"))
}

#[allow(dead_code)]
pub fn disable_updater() -> bool {
    settings(None).disable_updater
}

#[allow(dead_code)]
pub fn vite_skip_permissions() -> bool {
    cfg!(debug_assertions) && settings(None).skip_permissions
}

pub fn debug_skip_restore_all() -> bool {
    settings(None).debug_skip_restore_all
}

#[allow(dead_code)]
pub fn default_summary_provider() -> Option<String> {
    non_empty(settings(None).default_summary_provider)
}

#[allow(dead_code)]
pub fn default_evolve_provider() -> Option<String> {
    non_empty(settings(None).default_evolve_provider)
}

pub fn default_summary_model() -> Option<String> {
    non_empty(settings(None).default_summary_model)
}

pub fn default_evolve_model() -> Option<String> {
    non_empty(settings(None).default_evolve_model)
}

#[allow(dead_code)]
pub fn ollama_api_base() -> Option<String> {
    non_empty(settings(None).ollama_api_base)
}

#[allow(dead_code)]
pub fn vllm_api_base() -> Option<String> {
    non_empty(settings(None).vllm_api_base)
}

pub fn openai_api_key() -> Option<String> {
    non_empty(settings(None).openai_api_key)
}

pub fn openrouter_api_key() -> Option<String> {
    non_empty(settings(None).openrouter_api_key)
}

#[allow(dead_code)]
pub fn vllm_api_key() -> Option<String> {
    non_empty(settings(None).vllm_api_key)
}

pub fn openai_api_key_for_app<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    non_empty(settings_for_app(app).openai_api_key)
}

pub fn openrouter_api_key_for_app<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    non_empty(settings_for_app(app).openrouter_api_key)
}

pub fn vllm_api_key_for_app<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    non_empty(settings_for_app(app).vllm_api_key)
}

/// Non-empty trimmed value from runtime env or the E2E runtime file.
#[allow(dead_code)]
pub fn trimmed(name: &str) -> Option<String> {
    sources::trimmed_env(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feedback_url_from_env() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            keys::VITE_SERVER_URL,
            keys::SUBMITTED_FEEDBACK_DSN,
        ]);

        std::env::set_var(keys::VITE_SERVER_URL, "https://example.com");
        std::env::set_var(keys::SUBMITTED_FEEDBACK_DSN, "test-dsn");
        assert_eq!(
            feedback_url().unwrap(),
            "https://example.com/api/feedback/test-dsn"
        );

        std::env::remove_var(keys::VITE_SERVER_URL);
        std::env::remove_var(keys::SUBMITTED_FEEDBACK_DSN);
        assert!(feedback_url().is_err());
    }

    #[test]
    fn e2e_override_requires_debug_mock_system_gate() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            keys::NIXMAC_E2E_MOCK_SYSTEM,
            keys::NIXMAC_E2E_CONFIG_DIR,
        ]);

        std::env::remove_var(keys::NIXMAC_E2E_MOCK_SYSTEM);
        std::env::set_var(keys::NIXMAC_E2E_CONFIG_DIR, "/tmp/nixmac-e2e-config");
        assert_eq!(e2e_override(keys::NIXMAC_E2E_CONFIG_DIR), None);

        std::env::set_var(keys::NIXMAC_E2E_MOCK_SYSTEM, "1");
        assert_eq!(
            e2e_override(keys::NIXMAC_E2E_CONFIG_DIR).as_deref(),
            Some("/tmp/nixmac-e2e-config")
        );

        std::env::remove_var(keys::NIXMAC_E2E_MOCK_SYSTEM);
        assert_eq!(e2e_override(keys::NIXMAC_E2E_CONFIG_DIR), None);
    }
}
