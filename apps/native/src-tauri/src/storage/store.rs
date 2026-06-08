//! Persistent storage for app settings using Tauri's store plugin.
//!
//! Settings are stored in a JSON file managed by tauri-plugin-store.
//! This provides a simple key-value interface for preferences.

use crate::git::query::repo_root;
use crate::shared_types;
use crate::storage::credential_store::{CredentialStore, KeychainStore};

use anyhow::Result;
use serde::{de::DeserializeOwned, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
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

// Startup scan preference keys
pub const SCAN_HOMEBREW_ON_STARTUP_KEY: &str = "scanHomebrewOnStartup";

// Default-tab preference keys
pub const DEFAULT_TO_DIFF_TAB_KEY: &str = "defaultToDiffTab";

// Developer-mode preference keys
pub const DEVELOPER_MODE_KEY: &str = "developerMode";
pub const PINNED_VERSION_KEY: &str = "pinnedVersion";
pub const UPDATE_CHANNEL_KEY: &str = "updateChannel";

// nixmac account + non-GitHub sync keys
pub const SYNC_SERVER_URL_KEY: &str = "syncServerUrl";
pub const SYNC_ACCOUNT_ID_KEY: &str = "syncAccountId";
pub const SYNC_ACCOUNT_EMAIL_KEY: &str = "syncAccountEmail";
pub const SYNC_KEY_ID_KEY: &str = "syncKeyId";
/// Keychain account name for the per-device HMAC secret. Never written to the
/// plaintext settings store.
pub const SYNC_SECRET_KEYCHAIN_KEY: &str = "nixmacSyncSecret";
/// Default sync server when the user has not configured a custom endpoint.
pub const DEFAULT_SYNC_BASE_URL: &str = "https://sync.nixmac.app";

pub const DEFAULT_MAX_OUTPUT_TOKENS: usize = 32_768;
pub const DEFAULT_MAX_TOKEN_BUDGET: u32 = 50_000;
const KEYCHAIN_SERVICE: &str = "com.darkmatter.nixmac";

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

fn e2e_env_value(name: &str) -> Option<String> {
    if !e2e_mock_system_enabled() {
        return None;
    }
    crate::e2e_runtime::value(name)
}

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
    if let Some(dir) = e2e_env_value("NIXMAC_E2E_CONFIG_DIR") {
        return Ok(dir);
    }

    let store = get_store(app)?;

    if let Some(dir) = store.get("configDir") {
        if let Some(dir_str) = dir.as_str() {
            return Ok(dir_str.to_string());
        }
    }

    let home = dirs::home_dir().unwrap_or_default();
    Ok(home.join(".darwin").to_string_lossy().to_string())
}

/// Gets the git repository root for the current workspace.
///
/// If not stored, it is derived from configDir using `git rev-parse`,
/// then cached into the store for future use.
pub fn get_repo_root<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    // Currently for E2E we only support the git repo being the same as the config dir, so we can skip the git call and just return the config dir.
    if let Some(dir) = e2e_env_value("NIXMAC_E2E_CONFIG_DIR") {
        return Ok(dir);
    }

    let store = get_store(app)?;

    // 1. Fast path: use stored value
    if let Some(root) = store.get("repoRoot") {
        if let Some(root_str) = root.as_str() {
            return Ok(root_str.to_string());
        }
    }

    // 2. Fallback: derive from configDir
    let config_dir = get_config_dir(app)?;
    let repo_root = repo_root(&config_dir);

    // 3. Persist for future calls
    store.set("repoRoot", serde_json::json!(&repo_root));
    store.save()?;

    Ok(repo_root.to_string_lossy().to_string())
}

pub fn set_config_dir<R: Runtime>(app: &AppHandle<R>, dir: &str) -> Result<()> {
    let store = get_store(app)?;
    let repo_root = repo_root(dir);
    store.set("configDir", serde_json::json!(dir));
    store.set("repoRoot", serde_json::json!(repo_root));
    store.save()?;
    Ok(())
}

/// Creates the config directory if it doesn't exist and returns the path.
pub fn ensure_config_dir_exists<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let dir = get_config_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Creates the git repository root directory if it doesn't exist and returns the path.
/// It DOES NOT init the repository.
pub fn ensure_git_repo_folder<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let dir = get_repo_root(app)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// =============================================================================
// Host Attribute
// =============================================================================

/// Gets the stored nix-darwin host attribute name.
pub fn get_host_attr<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    if let Some(attr) = e2e_env_value("NIXMAC_E2E_HOST_ATTR") {
        return Ok(Some(attr));
    }

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
        normalize_env_secret(crate::e2e_runtime::value("OPENROUTER_API_KEY")),
        || get_openrouter_api_key(app),
    )
}

/// Gets the effective OpenAI API key with env-first precedence.
///
/// Priority: `OPENAI_API_KEY` environment variable, then keychain-backed settings.
pub fn get_effective_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_env_secret(crate::e2e_runtime::value("OPENAI_API_KEY")),
        || get_openai_api_key(app),
    )
}

/// Gets the effective vLLM API key with env-first precedence.
///
/// Priority: `VLLM_API_KEY` environment variable, then keychain-backed settings.
pub fn get_effective_vllm_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_env_secret(crate::e2e_runtime::value("VLLM_API_KEY")),
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
    normalize_env_secret(crate::e2e_runtime::value(name))
}

fn normalize_env_secret(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_string_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
    get_string_pref_raw(app, key)
}

/// Reads a value from the store and deserializes it into `T`.
///
/// Returns `Ok(None)` both when the key is absent and when stored JSON fails to
/// deserialize (e.g. after a schema change). Callers that want a default in the
/// failure case can use [`get_json_pref_or`]. If you add a required field to `T`,
/// existing stores will silently fall back to the default — use `#[serde(default)]`
/// on new fields to preserve forward-compatibility.
pub fn get_json_pref<R, T>(app: &AppHandle<R>, key: &str) -> Result<Option<T>>
where
    R: Runtime,
    T: DeserializeOwned,
{
    let store = get_store(app)?;
    Ok(store
        .get(key)
        .and_then(|value| serde_json::from_value(value.clone()).ok()))
}

pub fn get_json_pref_or<R, T>(app: &AppHandle<R>, key: &str, default: T) -> Result<T>
where
    R: Runtime,
    T: DeserializeOwned,
{
    Ok(get_json_pref(app, key)?.unwrap_or(default))
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

pub fn get_string_pref_public<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
    get_string_pref_raw(app, key)
}

pub fn set_json_pref<R, T>(app: &AppHandle<R>, key: &str, value: &T) -> Result<()>
where
    R: Runtime,
    T: Serialize + ?Sized,
{
    let store = get_store(app)?;
    store.set(key, serde_json::to_value(value)?);
    store.save()?;
    Ok(())
}

pub fn set_string_pref<R: Runtime>(app: &AppHandle<R>, key: &str, value: &str) -> Result<()> {
    set_json_pref(app, key, value)
}

pub fn delete_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    delete_pref_raw(app, key)
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

fn get_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<Option<String>> {
    if e2e_mock_system_enabled() {
        return get_string_pref_raw(app, key);
    }

    let keychain = keychain_store_for(app, key);
    keychain.get().map_err(anyhow::Error::from)
}

fn set_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str, value: &str) -> Result<()> {
    if e2e_mock_system_enabled() {
        return set_string_pref(app, key, value);
    }

    let keychain = keychain_store_for(app, key);
    keychain.set(value).map_err(anyhow::Error::from)
}

fn delete_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<()> {
    if e2e_mock_system_enabled() {
        return delete_pref_raw(app, key);
    }

    let keychain = keychain_store_for(app, key);
    keychain.delete().map_err(anyhow::Error::from)
}

pub fn get_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> Result<bool> {
    get_json_pref_or(app, key, default)
}

pub fn set_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, value: bool) -> Result<()> {
    set_json_pref(app, key, &value)
}

// =============================================================================
// nixmac Account + non-GitHub Sync
// =============================================================================
//
// The HMAC secret lives in the OS keychain; account metadata (id, email,
// key id) and the configured server URL live in the plaintext settings store
// since none of it is sensitive on its own.

/// Non-secret metadata describing the signed-in account on this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncAccountMeta {
    pub account_id: String,
    pub email: String,
    pub key_id: String,
}

/// Gets the configured sync server base URL, defaulting to [`DEFAULT_SYNC_BASE_URL`].
pub fn get_sync_server_url<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    if let Some(url) = e2e_env_value("NIXMAC_E2E_SYNC_SERVER_URL") {
        return Ok(url);
    }
    Ok(get_string_pref(app, SYNC_SERVER_URL_KEY)?
        .unwrap_or_else(|| DEFAULT_SYNC_BASE_URL.to_string()))
}

/// Sets the sync server base URL. Trailing slashes are trimmed for consistency.
pub fn set_sync_server_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    set_string_pref(app, SYNC_SERVER_URL_KEY, url.trim_end_matches('/'))
}

/// Reads the stored account metadata, returning `None` unless all fields are present.
pub fn get_sync_account<R: Runtime>(app: &AppHandle<R>) -> Result<Option<SyncAccountMeta>> {
    let account_id = get_string_pref(app, SYNC_ACCOUNT_ID_KEY)?;
    let email = get_string_pref(app, SYNC_ACCOUNT_EMAIL_KEY)?;
    let key_id = get_string_pref(app, SYNC_KEY_ID_KEY)?;
    match (account_id, email, key_id) {
        (Some(account_id), Some(email), Some(key_id)) => Ok(Some(SyncAccountMeta {
            account_id,
            email,
            key_id,
        })),
        _ => Ok(None),
    }
}

/// Persists account metadata after a successful sign-in.
pub fn set_sync_account<R: Runtime>(app: &AppHandle<R>, meta: &SyncAccountMeta) -> Result<()> {
    set_string_pref(app, SYNC_ACCOUNT_ID_KEY, &meta.account_id)?;
    set_string_pref(app, SYNC_ACCOUNT_EMAIL_KEY, &meta.email)?;
    set_string_pref(app, SYNC_KEY_ID_KEY, &meta.key_id)?;
    Ok(())
}

/// Removes account metadata (used on sign-out).
pub fn delete_sync_account<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    delete_pref_raw(app, SYNC_ACCOUNT_ID_KEY)?;
    delete_pref_raw(app, SYNC_ACCOUNT_EMAIL_KEY)?;
    delete_pref_raw(app, SYNC_KEY_ID_KEY)?;
    Ok(())
}

/// Gets the per-device HMAC secret from the keychain.
pub fn get_sync_secret<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY)
}

/// Stores the per-device HMAC secret in the keychain.
pub fn set_sync_secret<R: Runtime>(app: &AppHandle<R>, secret: &str) -> Result<()> {
    set_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY, secret)
}

/// Removes the per-device HMAC secret from the keychain (used on sign-out).
pub fn delete_sync_secret<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    delete_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY)
}

// =============================================================================
// Evolution Limits — repo-scoped (sync via user's nix config repo)
// =============================================================================
//
// These knobs live under `<config_dir>/.nixmac/settings.json` so they ride
// along with the user's nix repo across machines. The matching `Configurable`
// struct lives at `evolve/config.rs`. Both reads and writes go through the
// same repo store so the UI form and the agent loop see the same value.

fn get_repo_store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>> {
    let path = crate::storage::configurable_scope::repo_store_path(app)?;
    let store = app.store(&path)?;
    Ok(store)
}

/// Gets the maximum token budget for evolution (default: 50,000).
pub fn get_max_token_budget<R: Runtime>(app: &AppHandle<R>) -> Result<u32> {
    Ok(get_json_pref(app, "maxTokenBudget")?.unwrap_or(DEFAULT_MAX_TOKEN_BUDGET))
}

pub fn set_max_token_budget<R: Runtime>(app: &AppHandle<R>, max: u32) -> Result<()> {
    let store = get_store(app)?;
    store.set("maxTokenBudget", serde_json::json!(max));
    store.save()?;
    Ok(())
}

/// Gets the maximum build attempts for evolution (default: 5). Repo-scoped.
pub fn get_max_build_attempts<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    if let Some(limits) =
        app.try_state::<crate::state::slice::Slice<crate::evolve::config::EvolutionLimits>>()
    {
        return Ok(limits.read_sync().max_build_attempts);
    }

    let value = get_repo_store(app)
        .ok()
        .and_then(|s| s.get("maxBuildAttempts"))
        .and_then(|v| serde_json::from_value::<usize>(v).ok())
        .unwrap_or(5);
    Ok(value)
}

pub fn set_max_build_attempts<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    if let Some(limits) =
        app.try_state::<crate::state::slice::Slice<crate::evolve::config::EvolutionLimits>>()
    {
        let mut limits = limits.write_sync(app);
        limits.max_build_attempts = max;
        return Ok(());
    }

    let store = get_repo_store(app)?;
    store.set("maxBuildAttempts", serde_json::json!(max));
    store.save()?;
    Ok(())
}

/// Gets the maximum output tokens requested per evolution model call.
pub fn get_max_output_tokens<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(get_json_pref(app, "maxOutputTokens")?.unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS))
}

pub fn set_max_output_tokens<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    let store = get_store(app)?;
    store.set("maxOutputTokens", serde_json::json!(max));
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
pub fn get_cached_git_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<shared_types::GitStatus>> {
    let store = get_store(app)?;

    if let Some(val) = store.get("cachedGitStatus") {
        if let Ok(status) = serde_json::from_value::<shared_types::GitStatus>(val.clone()) {
            return Ok(Some(status));
        }
    }
    Ok(None)
}

/// Sets the cached git status.
pub fn set_cached_git_status<R: Runtime>(
    app: &AppHandle<R>,
    status: &shared_types::GitStatus,
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

    #[test]
    fn e2e_env_value_requires_debug_mock_system_gate() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            "NIXMAC_E2E_MOCK_SYSTEM",
            "NIXMAC_E2E_CONFIG_DIR",
        ]);

        std::env::remove_var("NIXMAC_E2E_MOCK_SYSTEM");
        std::env::set_var("NIXMAC_E2E_CONFIG_DIR", "/tmp/nixmac-e2e-config");
        assert_eq!(e2e_env_value("NIXMAC_E2E_CONFIG_DIR"), None);

        std::env::set_var("NIXMAC_E2E_MOCK_SYSTEM", "1");
        if cfg!(debug_assertions) {
            assert_eq!(
                e2e_env_value("NIXMAC_E2E_CONFIG_DIR").as_deref(),
                Some("/tmp/nixmac-e2e-config")
            );
        } else {
            assert_eq!(e2e_env_value("NIXMAC_E2E_CONFIG_DIR"), None);
        }
    }
}
