//! Persistent storage for app settings using Tauri's store plugin.
//!
//! Settings are stored in a JSON file managed by tauri-plugin-store.
//! This provides a simple key-value interface for preferences.

use crate::credential_store::{
    get_with_lazy_migration, set_with_cleanup, CredentialStoreError, KeychainStore,
    SettingsFileStore,
};
use crate::types;
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Store, StoreExt};

const STORE_PATH: &str = "settings.json";
pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

// =============================================================================
// Preference Tab Keys
// =============================================================================

// Confirmation dialog preference keys
pub const CONFIRM_BUILD_KEY: &str = "confirmBuild";
pub const CONFIRM_CLEAR_KEY: &str = "confirmClear";
pub const CONFIRM_ROLLBACK_KEY: &str = "confirmRollback";

// Summarization preference keys
pub const AUTO_SUMMARIZE_ON_FOCUS_KEY: &str = "autoSummarizeOnFocus";

pub const DEFAULT_MAX_ITERATIONS: usize = 25;
const KEYCHAIN_SERVICE: &str = "com.darkmatter.nixmac";

/// Gets a handle to the settings store.
pub fn get_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>> {
    let store = app.store(STORE_PATH)?;
    Ok(store)
}

// =============================================================================
// Configuration Directory
// =============================================================================

/// Gets the flake configuration directory, defaulting to ~/.darwin.
pub fn get_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let store = get_store(app)?;

    if let Some(dir) = store.get("configDir") {
        if let Some(dir_str) = dir.as_str() {
            return Ok(dir_str.to_string());
        }
    }

    let home = dirs::home_dir().unwrap_or_default();
    Ok(home.join(".darwin").to_string_lossy().to_string())
}

pub fn set_config_dir<R: Runtime>(app: &AppHandle<R>, dir: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("configDir", serde_json::json!(dir));
    store.save()?;
    Ok(())
}

/// Creates the config directory if it doesn't exist and returns the path.
pub fn ensure_config_dir_exists<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let dir = get_config_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// =============================================================================
// Host Attribute
// =============================================================================

/// Gets the stored nix-darwin host attribute name.
pub fn get_host_attr<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    let store = get_store(app)?;

    if let Some(attr) = store.get("hostAttr") {
        if let Some(attr_str) = attr.as_str() {
            return Ok(Some(attr_str.to_string()));
        }
    }

    Ok(None)
}

pub fn set_host_attr<R: Runtime>(app: &AppHandle<R>, attr: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("hostAttr", serde_json::json!(attr));
    store.save()?;
    Ok(())
}

/// Reads the host attribute from the legacy file location.
///
/// This provides backwards compatibility with older setups that stored
/// the host name in ~/.config/darwin/host.
pub fn read_host_attr_from_file() -> Option<String> {
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))?;

    let host_file = config_home.join("darwin").join("host");
    std::fs::read_to_string(host_file)
        .ok()
        .map(|s| s.trim().to_string())
}
// =============================================================================
// evolve metadata
// =============================================================================

pub fn set_evolve_metadata<R: Runtime>(app: &AppHandle<R>, metadata: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("evolveMetadata", serde_json::json!(metadata));
    store.save()?;
    Ok(())
}

// =============================================================================
// UI Preferences
// =============================================================================
pub fn get_send_diagnostics<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    let store = get_store(app)?;

    if let Some(send) = store.get("sendDiagnostics") {
        if let Some(send_bool) = send.as_bool() {
            return Ok(send_bool);
        }
    }

    Ok(false)
}

pub fn set_send_diagnostics<R: Runtime>(app: &AppHandle<R>, send: bool) -> Result<()> {
    let store = get_store(app)?;
    store.set("sendDiagnostics", serde_json::json!(send));
    store.save()?;
    Ok(())
}

// =============================================================================
// AI Configuration
// =============================================================================

pub fn get_summary_provider<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "summaryProvider")
}

pub fn set_summary_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("summaryProvider", serde_json::json!(provider));
    store.save()?;
    Ok(())
}

pub fn get_summary_model<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "summaryModel")
}

pub fn set_summary_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("summaryModel", serde_json::json!(model));
    store.save()?;
    Ok(())
}

pub fn get_evolve_provider<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "evolveProvider")
}

pub fn set_evolve_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("evolveProvider", serde_json::json!(provider));
    store.save()?;
    Ok(())
}

pub fn get_evolve_model<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "evolveModel")
}

pub fn set_evolve_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("evolveModel", serde_json::json!(model));
    store.save()?;
    Ok(())
}

// =============================================================================
// API Keys
// =============================================================================

/// Gets the stored OpenRouter API key.
pub fn get_openrouter_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "openrouterApiKey")
}

pub fn set_openrouter_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "openrouterApiKey", key)
}

/// Gets the stored OpenAI API key (for direct OpenAI access).
pub fn get_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "openaiApiKey")
}

pub fn set_openai_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "openaiApiKey", key)
}

/// Gets the stored Ollama API base URL.
pub fn get_ollama_api_base_url<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "ollamaApiBaseUrl")
}

pub fn set_ollama_api_base_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("ollamaApiBaseUrl", serde_json::json!(url));
    store.save()?;
    Ok(())
}

/// Gets the stored vLLM API base URL.
pub fn get_vllm_api_base_url<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "vllmApiBaseUrl")
}

pub fn set_vllm_api_base_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("vllmApiBaseUrl", serde_json::json!(url));
    store.save()?;
    Ok(())
}

/// Gets the stored vLLM API key (optional — vllm direct endpoint may not require one).
pub fn get_vllm_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "vllmApiKey")
}

pub fn set_vllm_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "vllmApiKey", key)
}

/// Gets the effective OpenRouter API key with env-first precedence.
///
/// Priority: `OPENROUTER_API_KEY` environment variable, then keychain-backed settings.
pub fn get_effective_openrouter_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_env_secret(std::env::var("OPENROUTER_API_KEY").ok()),
        || get_openrouter_api_key(app),
    )
}

/// Gets the effective OpenAI API key with env-first precedence.
///
/// Priority: `OPENAI_API_KEY` environment variable, then keychain-backed settings.
pub fn get_effective_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_env_secret(std::env::var("OPENAI_API_KEY").ok()),
        || get_openai_api_key(app),
    )
}

/// Gets the effective vLLM API key with env-first precedence.
///
/// Priority: `VLLM_API_KEY` environment variable, then keychain-backed settings.
pub fn get_effective_vllm_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_env_secret(std::env::var("VLLM_API_KEY").ok()),
        || get_vllm_api_key(app),
    )
}

/// Gets the effective OpenAI/OpenRouter credential and base URL with env-first precedence.
///
/// Priority:
/// 1. `OPENROUTER_API_KEY`
/// 2. `OPENAI_API_KEY`
/// 3. stored OpenRouter key
/// 4. stored OpenAI key
pub fn get_effective_openai_compatible_credential<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<(String, &'static str)>> {
    if let Some(key) = get_effective_openrouter_api_key(app)? {
        return Ok(Some((key, OPENROUTER_BASE_URL)));
    }
    if let Some(key) = get_effective_openai_api_key(app)? {
        return Ok(Some((key, OPENAI_BASE_URL)));
    }
    Ok(None)
}

/// Gets OpenAI/OpenRouter credential from environment variables only (no store access).
///
/// Used when app context is unavailable. Priority:
/// 1. `OPENROUTER_API_KEY`
/// 2. `OPENAI_API_KEY`
pub fn get_env_openai_compatible_credential() -> Option<(String, &'static str)> {
    if let Some(key) = read_non_empty_env("OPENROUTER_API_KEY") {
        return Some((key, OPENROUTER_BASE_URL));
    }
    if let Some(key) = read_non_empty_env("OPENAI_API_KEY") {
        return Some((key, OPENAI_BASE_URL));
    }
    None
}

fn read_non_empty_env(name: &str) -> Option<String> {
    normalize_env_secret(std::env::var(name).ok())
}

fn normalize_env_secret(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_string_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
    get_string_pref_raw(app, key)
}

fn get_string_pref_raw<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
    let store = get_store(app)?;
    if let Some(val) = store.get(key) {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                return Ok(Some(s.to_string()));
            }
        }
    }
    Ok(None)
}

fn delete_pref_raw<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    let store = get_store(app)?;
    store.delete(key);
    store.save()?;
    Ok(())
}

fn resolve_secret_with_env_override<G>(
    env_value: Option<String>,
    fallback: G,
) -> Result<Option<String>>
where
    G: FnOnce() -> Result<Option<String>>,
{
    // If the env var is set, return it immediately without touching the keychain.
    // This avoids OS keychain prompts in dev/CI workflows where credentials are
    // injected via environment. Migration from settings.json → keychain will
    // happen the first time the app runs without the env var set.
    if let Some(value) = env_value {
        return Ok(Some(value));
    }
    fallback()
}

fn keychain_store_for<R: Runtime>(app: &AppHandle<R>, key: &str) -> KeychainStore<R> {
    KeychainStore::new(app.clone(), KEYCHAIN_SERVICE, key)
}

fn legacy_settings_store<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> SettingsFileStore {
    let app_for_get = app.clone();
    let app_for_delete = app.clone();

    SettingsFileStore::new(
        key,
        move || {
            get_string_pref_raw(&app_for_get, key)
                .map_err(|e| CredentialStoreError::Storage(e.to_string()))
        },
        move || {
            delete_pref_raw(&app_for_delete, key)
                .map_err(|e| CredentialStoreError::Storage(e.to_string()))
        },
    )
}

fn get_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<Option<String>> {
    let keychain = keychain_store_for(app, key);
    let legacy = legacy_settings_store(app, key);
    get_with_lazy_migration(&keychain, &legacy).map_err(anyhow::Error::from)
}

fn set_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str, value: &str) -> Result<()> {
    let keychain = keychain_store_for(app, key);
    let legacy = legacy_settings_store(app, key);
    set_with_cleanup(&keychain, &legacy, value).map_err(anyhow::Error::from)
}

fn get_usize_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<usize>> {
    let store = get_store(app)?;
    if let Some(val) = store.get(key) {
        if let Some(n) = val.as_u64() {
            return Ok(Some(n as usize));
        }
    }
    Ok(None)
}

pub fn get_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> Result<bool> {
    let store = get_store(app)?;
    if let Some(val) = store.get(key) {
        if let Some(b) = val.as_bool() {
            return Ok(b);
        }
    }
    Ok(default)
}

pub fn set_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, value: bool) -> Result<()> {
    let store = get_store(app)?;
    store.set(key, serde_json::json!(value));
    store.save()?;
    Ok(())
}

// =============================================================================
// Evolution Limits
// =============================================================================

/// Gets the maximum iterations for evolution (default: 25).
pub fn get_max_iterations<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(get_usize_pref(app, "maxIterations")?.unwrap_or(DEFAULT_MAX_ITERATIONS))
}

pub fn set_max_iterations<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    let store = get_store(app)?;
    store.set("maxIterations", serde_json::json!(max));
    store.save()?;
    Ok(())
}

/// Gets the maximum build attempts for evolution (default: 5).
pub fn get_max_build_attempts<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(get_usize_pref(app, "maxBuildAttempts")?.unwrap_or(5))
}

pub fn set_max_build_attempts<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    let store = get_store(app)?;
    store.set("maxBuildAttempts", serde_json::json!(max));
    store.save()?;
    Ok(())
}

// =============================================================================
// Model Cache
// =============================================================================

/// Gets the cached list of models for a provider.
pub fn get_cached_models<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
) -> Result<Option<Vec<String>>> {
    let store = get_store(app)?;
    let key = format!("cachedModels_{}", provider);

    if let Some(val) = store.get(&key) {
        if let Some(arr) = val.as_array() {
            let models: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            if !models.is_empty() {
                return Ok(Some(models));
            }
        }
    }
    Ok(None)
}

/// Clears the cached models for a provider.
pub fn clear_cached_models<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let store = get_store(app)?;
    let key = format!("cachedModels_{}", provider);
    store.delete(&key);
    store.save()?;
    Ok(())
}

/// Sets the cached list of models for a provider.
pub fn set_cached_models<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
    models: &[String],
) -> Result<()> {
    let store = get_store(app)?;
    let key = format!("cachedModels_{}", provider);
    store.set(&key, serde_json::json!(models));
    store.save()?;
    Ok(())
}

// =============================================================================
// Git Status Cache
// =============================================================================

/// Gets the cached git status.
pub fn get_cached_git_status<R: Runtime>(app: &AppHandle<R>) -> Result<Option<types::GitStatus>> {
    let store = get_store(app)?;

    if let Some(val) = store.get("cachedGitStatus") {
        if let Ok(status) = serde_json::from_value::<types::GitStatus>(val.clone()) {
            return Ok(Some(status));
        }
    }
    Ok(None)
}

/// Sets the cached git status.
pub fn set_cached_git_status<R: Runtime>(
    app: &AppHandle<R>,
    status: &types::GitStatus,
) -> Result<()> {
    let store = get_store(app)?;
    store.set("cachedGitStatus", serde_json::to_value(status)?);
    store.save()?;
    Ok(())
}

// =============================================================================
// Prompt History
// =============================================================================

const MAX_PROMPT_HISTORY: usize = 20;

/// Gets the prompt history (most recent first).
pub fn get_prompt_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<String>> {
    let store = get_store(app)?;

    if let Some(val) = store.get("promptHistory") {
        if let Some(arr) = val.as_array() {
            let history: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            return Ok(history);
        }
    }
    Ok(Vec::new())
}

/// Adds a prompt to the history. Maintains max of 20 entries, most recent first.
pub fn add_to_prompt_history<R: Runtime>(app: &AppHandle<R>, prompt: &str) -> Result<()> {
    let store = get_store(app)?;
    let mut history = get_prompt_history(app)?;

    // Remove if it already exists
    history.retain(|p| p != prompt);

    // Add to front
    history.insert(0, prompt.to_string());

    // Trim
    history.truncate(MAX_PROMPT_HISTORY);

    store.set("promptHistory", serde_json::json!(history));
    store.save()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn env_override_skips_keychain_and_returns_env_value() {
        let fallback_called = AtomicBool::new(false);

        let result = resolve_secret_with_env_override(Some("env-secret".to_string()), || {
            fallback_called.store(true, Ordering::SeqCst);
            Ok(Some("store-secret".to_string()))
        })
        .unwrap();

        // Env var wins and keychain is never touched.
        assert_eq!(result.as_deref(), Some("env-secret"));
        assert!(!fallback_called.load(Ordering::SeqCst));
    }

    #[test]
    fn no_env_uses_fallback_result() {
        let fallback_called = AtomicBool::new(false);

        let result = resolve_secret_with_env_override(None, || {
            fallback_called.store(true, Ordering::SeqCst);
            Ok(Some("store-secret".to_string()))
        })
        .unwrap();

        assert_eq!(result.as_deref(), Some("store-secret"));
        assert!(fallback_called.load(Ordering::SeqCst));
    }

    #[test]
    fn normalize_env_secret_rejects_empty_and_whitespace_values() {
        assert_eq!(normalize_env_secret(None), None);
        assert_eq!(normalize_env_secret(Some("".to_string())), None);
        assert_eq!(normalize_env_secret(Some("   \n\t ".to_string())), None);
    }

    #[test]
    fn normalize_env_secret_trims_and_keeps_non_empty_value() {
        assert_eq!(
            normalize_env_secret(Some("  sk-abc123  ".to_string())),
            Some("sk-abc123".to_string())
        );
    }

    #[test]
    fn empty_env_after_normalization_uses_fallback() {
        let fallback_called = AtomicBool::new(false);

        let result = resolve_secret_with_env_override(
            normalize_env_secret(Some("   \t\n  ".to_string())),
            || {
                fallback_called.store(true, Ordering::SeqCst);
                Ok(Some("store-secret".to_string()))
            },
        )
        .unwrap();

        assert_eq!(result.as_deref(), Some("store-secret"));
        assert!(fallback_called.load(Ordering::SeqCst));
    }
}
