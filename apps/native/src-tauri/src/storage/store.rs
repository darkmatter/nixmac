//! Persistent storage for app settings using Tauri's store plugin.
//!
//! Settings are stored in a JSON file managed by tauri-plugin-store.
//! This provides a simple key-value interface for preferences.

use crate::git::query::repo_root;
use crate::shared_types;
use crate::storage::{
    credential_store::{CredentialStore, CredentialStoreError, KeychainStore, SettingsFileStore},
    secret_blob::{
        decode_data_key, decrypt_payload, encrypt_payload, generate_encoded_data_key,
        SecretBlobPayload,
    },
};

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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

pub const DEFAULT_MAX_ITERATIONS: usize = 25;
pub const DEFAULT_MAX_OUTPUT_TOKENS: usize = 32_768;
pub const DEFAULT_MAX_TOKEN_BUDGET: u32 = 50_000;
const KEYCHAIN_SERVICE: &str = "com.darkmatter.nixmac";
const SECRET_DATA_KEY_ACCOUNT: &str = "appSecretsDataKey.v1";
const SECRET_BLOB_FILE: &str = "app-secrets.v1.json";
const SECRET_PREF_KEYS: &[&str] = &["openrouterApiKey", "openaiApiKey", "vllmApiKey"];

#[derive(Clone)]
struct SecretBlobState {
    blob_path: PathBuf,
    data_key: [u8; 32],
    payload: SecretBlobPayload,
}

static SECRET_BLOB_CACHE: Lazy<Mutex<Option<SecretBlobState>>> = Lazy::new(|| Mutex::new(None));

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
    // injected via environment. Migration into the encrypted secrets blob will
    // happen the first time the app runs without the env var set.
    if let Some(value) = env_value {
        return Ok(Some(value));
    }
    fallback()
}

fn keychain_store_for<R: Runtime>(app: &AppHandle<R>, key: &str) -> KeychainStore<R> {
    KeychainStore::new(app.clone(), KEYCHAIN_SERVICE, key)
}

fn data_key_store_for<R: Runtime>(app: &AppHandle<R>) -> KeychainStore<R> {
    KeychainStore::new(app.clone(), KEYCHAIN_SERVICE, SECRET_DATA_KEY_ACCOUNT)
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

fn secret_blob_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let app_data = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory for encrypted secrets")?;
    fs::create_dir_all(&app_data)?;
    Ok(app_data.join(SECRET_BLOB_FILE))
}

fn lock_secret_blob_cache() -> Result<std::sync::MutexGuard<'static, Option<SecretBlobState>>> {
    SECRET_BLOB_CACHE
        .lock()
        .map_err(|_| anyhow!("secret blob cache lock poisoned"))
}

fn read_or_create_data_key<R: Runtime>(
    key_store: &KeychainStore<R>,
    blob_exists: bool,
) -> Result<[u8; 32]> {
    match key_store.get().map_err(anyhow::Error::from)? {
        Some(encoded) => decode_data_key(&encoded).map_err(anyhow::Error::from),
        None if blob_exists => Err(anyhow!(
            "encrypted secrets blob exists but the keychain data key is missing"
        )),
        None => {
            let encoded = generate_encoded_data_key();
            key_store.set(&encoded).map_err(anyhow::Error::from)?;
            decode_data_key(&encoded).map_err(anyhow::Error::from)
        }
    }
}

fn read_secret_blob_state<R: Runtime>(
    app: &AppHandle<R>,
    blob_path: &Path,
) -> Result<SecretBlobState> {
    let blob_exists = blob_path.exists();
    let data_key = read_or_create_data_key(&data_key_store_for(app), blob_exists)?;
    let payload = if blob_exists {
        let encrypted = fs::read_to_string(blob_path)
            .with_context(|| format!("failed to read encrypted secrets blob at {blob_path:?}"))?;
        decrypt_payload(&encrypted, &data_key).map_err(anyhow::Error::from)?
    } else {
        SecretBlobPayload::default()
    };

    Ok(SecretBlobState {
        blob_path: blob_path.to_path_buf(),
        data_key,
        payload,
    })
}

fn persist_secret_blob_state(state: &SecretBlobState) -> Result<()> {
    if let Some(parent) = state.blob_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let encrypted =
        encrypt_payload(&state.payload, &state.data_key).map_err(anyhow::Error::from)?;
    let temp_path = state.blob_path.with_extension("json.tmp");
    fs::write(&temp_path, format!("{encrypted}\n"))
        .with_context(|| format!("failed to write encrypted secrets blob at {temp_path:?}"))?;
    fs::rename(&temp_path, &state.blob_path).with_context(|| {
        format!(
            "failed to replace encrypted secrets blob at {:?}",
            state.blob_path
        )
    })?;
    Ok(())
}

struct LegacyMigration {
    payload_changed: bool,
    old_keychain_scan_complete: bool,
}

fn merge_legacy_secrets<R: Runtime>(
    app: &AppHandle<R>,
    payload: &mut SecretBlobPayload,
) -> Result<LegacyMigration> {
    if payload.legacy_keychain_migration_complete {
        return Ok(LegacyMigration {
            payload_changed: false,
            old_keychain_scan_complete: true,
        });
    }

    let mut payload_changed = false;
    let mut old_keychain_scan_complete = true;
    for &key in SECRET_PREF_KEYS {
        if payload.secrets.contains_key(key) {
            continue;
        }
        let old_keychain = keychain_store_for(app, key);
        match old_keychain.get() {
            Ok(Some(value)) => {
                payload.secrets.insert(key.to_string(), value);
                payload_changed = true;
            }
            Ok(None) => {}
            Err(err) => {
                old_keychain_scan_complete = false;
                log::warn!(
                    "Failed to inspect legacy per-key keychain item {} during secret blob migration: {}",
                    key,
                    err
                );
            }
        }
    }

    for &key in SECRET_PREF_KEYS {
        if payload.secrets.contains_key(key) {
            continue;
        }
        let Some(value) = get_string_pref_raw(app, key)? else {
            continue;
        };
        payload.secrets.insert(key.to_string(), value);
        payload_changed = true;
    }

    Ok(LegacyMigration {
        payload_changed,
        old_keychain_scan_complete,
    })
}

fn cleanup_legacy_secret_stores<R: Runtime>(app: &AppHandle<R>) -> bool {
    let mut cleanup_complete = true;
    for &key in SECRET_PREF_KEYS {
        let legacy = legacy_settings_store(app, key);
        if let Err(err) = legacy.delete() {
            cleanup_complete = false;
            log::warn!(
                "Failed to remove legacy plaintext secret {} after blob migration: {}",
                key,
                err
            );
        }

        let old_keychain = keychain_store_for(app, key);
        if let Err(err) = old_keychain.delete() {
            cleanup_complete = false;
            log::warn!(
                "Failed to remove legacy per-key keychain item {} after blob migration: {}",
                key,
                err
            );
        }
    }
    cleanup_complete
}

fn load_secret_blob_state<R: Runtime>(app: &AppHandle<R>) -> Result<SecretBlobState> {
    let blob_path = secret_blob_path(app)?;
    if let Some(cached) = lock_secret_blob_cache()?
        .as_ref()
        .filter(|state| state.blob_path == blob_path)
        .cloned()
    {
        return Ok(cached);
    }

    let mut state = read_secret_blob_state(app, &blob_path)?;
    let migration = merge_legacy_secrets(app, &mut state.payload)?;

    if migration.payload_changed {
        persist_secret_blob_state(&state)?;
    }

    if migration.old_keychain_scan_complete && cleanup_legacy_secret_stores(app) {
        if !state.payload.legacy_keychain_migration_complete {
            state.payload.legacy_keychain_migration_complete = true;
            persist_secret_blob_state(&state)?;
        }
    }

    *lock_secret_blob_cache()? = Some(state.clone());
    Ok(state)
}

fn cache_secret_blob_state(state: SecretBlobState) -> Result<()> {
    *lock_secret_blob_cache()? = Some(state);
    Ok(())
}

pub fn clear_secret_blob_cache() -> Result<()> {
    *lock_secret_blob_cache()? = None;
    Ok(())
}

pub fn delete_secret_blob_file<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let blob_path = secret_blob_path(app)?;
    if blob_path.exists() {
        fs::remove_file(&blob_path)
            .with_context(|| format!("failed to remove encrypted secrets blob at {blob_path:?}"))?;
    }
    clear_secret_blob_cache()
}

fn get_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<Option<String>> {
    if e2e_mock_system_enabled() {
        return get_string_pref_raw(app, key);
    }

    let state = load_secret_blob_state(app)?;
    Ok(state.payload.secrets.get(key).cloned())
}

fn set_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str, value: &str) -> Result<()> {
    if e2e_mock_system_enabled() {
        return set_string_pref(app, key, value);
    }

    let mut state = load_secret_blob_state(app)?;
    state
        .payload
        .secrets
        .insert(key.to_string(), value.to_string());
    persist_secret_blob_state(&state)?;
    cache_secret_blob_state(state)?;

    let legacy = legacy_settings_store(app, key);
    if let Err(err) = legacy.delete() {
        log::warn!(
            "Failed to remove legacy plaintext secret {} after blob write: {}",
            key,
            err
        );
    }
    let old_keychain = keychain_store_for(app, key);
    if let Err(err) = old_keychain.delete() {
        log::warn!(
            "Failed to remove legacy per-key keychain item {} after blob write: {}",
            key,
            err
        );
    }
    Ok(())
}

#[allow(dead_code)]
fn get_usize_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<usize>> {
    get_json_pref(app, key)
}

pub fn get_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> Result<bool> {
    get_json_pref_or(app, key, default)
}

pub fn set_bool_pref<R: Runtime>(app: &AppHandle<R>, key: &str, value: bool) -> Result<()> {
    set_json_pref(app, key, &value)
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

/// Gets the maximum iterations for evolution (default: 25). Repo-scoped.
pub fn get_max_iterations<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    if let Some(limits) =
        app.try_state::<crate::state::slice::Slice<crate::evolve::config::EvolutionLimits>>()
    {
        return Ok(limits.read_sync().max_iterations);
    }

    let value = get_repo_store(app)
        .ok()
        .and_then(|s| s.get("maxIterations"))
        .and_then(|v| serde_json::from_value::<usize>(v).ok())
        .unwrap_or(DEFAULT_MAX_ITERATIONS);
    Ok(value)
}

pub fn set_max_iterations<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    if let Some(limits) =
        app.try_state::<crate::state::slice::Slice<crate::evolve::config::EvolutionLimits>>()
    {
        let mut limits = limits.write_sync(app);
        limits.max_iterations = max;
        return Ok(());
    }

    let store = get_repo_store(app)?;
    store.set("maxIterations", serde_json::json!(max));
    store.save()?;
    Ok(())
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
