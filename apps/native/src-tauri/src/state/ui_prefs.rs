//! Assembly and partial updates for the settings UI contract.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

use crate::evolve::config;
use crate::shared_types::{UiPrefs, UiPrefsUpdate};
use crate::state::preferences;
use crate::storage::secrets;

pub fn assemble_ui_prefs<R: Runtime>(app: &AppHandle<R>) -> Result<UiPrefs> {
    let global = preferences::try_read(app).unwrap_or_default();
    let limits = config::read_or_default(app);
    let mut prefs = global.to_ui_prefs_base();

    prefs.openrouter_api_key = secrets::get_effective_openrouter_api_key(app)?;
    prefs.openai_api_key = secrets::get_effective_openai_api_key(app)?;
    prefs.openai_compatible_api_key = secrets::get_effective_openai_compatible_api_key(app)?;

    prefs.max_iterations = Some(limits.max_iterations);
    prefs.max_token_budget = Some(limits.max_token_budget);
    prefs.max_build_attempts = Some(limits.max_build_attempts);
    prefs.max_output_tokens = Some(limits.max_output_tokens);

    Ok(prefs)
}

pub fn apply_ui_prefs_update<R: Runtime>(app: &AppHandle<R>, update: &UiPrefsUpdate) -> Result<()> {
    if preferences::try_read(app).is_some() {
        preferences::write(app, |prefs| prefs.apply_ui_update(update))?;
    }

    // Onboarding journey facts live on the OnboardingState slice; the
    // UiPrefsUpdate wire contract keeps carrying them for the frontend.
    if (update.onboarding_mac_scanned_at.is_some() || update.onboarding_login_decided.is_some())
        && crate::state::onboarding::try_read(app).is_some()
    {
        crate::state::onboarding::write(app, |state| {
            if let Some(v) = update.onboarding_mac_scanned_at {
                state.mac_scanned_at = Some(v);
            }
            if let Some(v) = update.onboarding_login_decided {
                state.login_decided = v;
            }
        })?;
    }

    if needs_limits_update(update) {
        config::write(app, |limits| limits.apply_ui_update(update))?;
    }

    apply_secret_updates(app, update)?;

    Ok(())
}

fn needs_limits_update(update: &UiPrefsUpdate) -> bool {
    update.max_iterations.is_some()
        || update.max_token_budget.is_some()
        || update.max_build_attempts.is_some()
        || update.max_output_tokens.is_some()
}

pub fn auto_format_nix_files<R: Runtime>(app: &AppHandle<R>) -> bool {
    preferences::try_read(app).is_some_and(|prefs| prefs.auto_format_nix_files)
}

fn apply_secret_updates<R: Runtime>(app: &AppHandle<R>, update: &UiPrefsUpdate) -> Result<()> {
    if let Some(key) = &update.openrouter_api_key {
        secrets::set_openrouter_api_key(app, key)?;
    }
    if let Some(key) = &update.openai_api_key {
        secrets::set_openai_api_key(app, key)?;
    }
    if let Some(key) = &update.openai_compatible_api_key {
        secrets::set_openai_compatible_api_key(app, key)?;
    }
    Ok(())
}

pub fn host_attr<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.host_attr)
}

pub fn evolve_provider<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.evolve_provider)
}

pub fn evolve_model<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.evolve_model)
}

pub fn summary_provider<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.summary_provider)
}

pub fn summary_model<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.summary_model)
}

pub fn ollama_api_base_url<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.ollama_api_base_url)
}

pub fn openai_compatible_api_base_url<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    preferences::try_read(app).and_then(|prefs| prefs.openai_compatible_api_base_url)
}

pub fn send_diagnostics<R: Runtime>(app: &AppHandle<R>) -> bool {
    preferences::try_read(app).is_some_and(|prefs| prefs.send_diagnostics)
}

pub fn developer_mode<R: Runtime>(app: &AppHandle<R>) -> bool {
    preferences::try_read(app).is_some_and(|prefs| prefs.developer_mode)
}

pub fn experimental_spinning_mascot<R: Runtime>(app: &AppHandle<R>) -> bool {
    preferences::try_read(app).is_some_and(|prefs| prefs.experimental_spinning_mascot)
}

pub fn set_host_attr<R: Runtime>(app: &AppHandle<R>, attr: &str) -> Result<()> {
    let attr = attr.trim().to_string();
    preferences::write(app, move |prefs| {
        prefs.host_attr = if attr.is_empty() { None } else { Some(attr) }
    })
}

pub fn set_evolve_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let provider = provider.to_string();
    preferences::write(app, move |prefs| prefs.evolve_provider = Some(provider))
}

pub fn set_evolve_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    let model = model.to_string();
    preferences::write(app, move |prefs| prefs.evolve_model = Some(model))
}

pub fn set_summary_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let provider = provider.to_string();
    preferences::write(app, move |prefs| prefs.summary_provider = Some(provider))
}

pub fn set_summary_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    let model = model.to_string();
    preferences::write(app, move |prefs| prefs.summary_model = Some(model))
}

pub fn set_ollama_api_base_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    let url = url.to_string();
    preferences::write(app, move |prefs| prefs.ollama_api_base_url = Some(url))
}

pub fn set_max_iterations<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    config::write(app, |limits| limits.max_iterations = max)
}

pub fn set_max_token_budget<R: Runtime>(app: &AppHandle<R>, max: u32) -> Result<()> {
    config::write(app, |limits| limits.max_token_budget = max)
}

pub fn set_max_output_tokens<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    config::write(app, |limits| limits.max_output_tokens = max)
}

pub fn max_iterations<R: Runtime>(app: &AppHandle<R>) -> usize {
    config::read_or_default(app).max_iterations
}

pub fn max_token_budget<R: Runtime>(app: &AppHandle<R>) -> u32 {
    config::read_or_default(app).max_token_budget
}

pub fn max_output_tokens<R: Runtime>(app: &AppHandle<R>) -> usize {
    config::read_or_default(app).max_output_tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_limits_update_detects_limit_fields_only() {
        assert!(!needs_limits_update(&UiPrefsUpdate {
            summary_provider: Some("openai".to_string()),
            ..Default::default()
        }));
        assert!(needs_limits_update(&UiPrefsUpdate {
            max_iterations: Some(10),
            ..Default::default()
        }));
        assert!(!needs_limits_update(&UiPrefsUpdate {
            auto_format_nix_files: Some(true),
            ..Default::default()
        }));
    }
}
