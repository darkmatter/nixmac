//! Persistent storage: config paths, legacy KV blobs, and account metadata.
//!
//! Typed per-device preferences live in [`crate::state::preferences`].
//! Repo-scoped evolution limits live in [`crate::evolve::config`].
//! Secrets live in [`crate::storage::secrets`].

use crate::git::query::repo_root;
use crate::state::preferences;
use crate::storage::canonical_config::{self, CANONICAL_CONFIG_DIR};

use anyhow::Result;
use std::path::Path;
use tauri::{AppHandle, Runtime};

pub use crate::storage::legacy_kv::get_json as get_json_pref;
pub use crate::storage::legacy_kv::{get_store, set_json as set_json_pref};
pub use crate::storage::secrets::{
    delete_device_api_key, delete_sync_secret, get_device_api_key,
    get_effective_openai_compatible_api_key, get_effective_openai_provider_credential,
    get_effective_openrouter_provider_credential, get_env_openai_provider_credential,
    get_env_openrouter_provider_credential, get_sync_secret, set_device_api_key,
    set_openai_api_key, set_openrouter_api_key, set_sync_secret,
};

pub const DEFAULT_MAX_ITERATIONS: usize = 25;
pub const DEFAULT_MAX_OUTPUT_TOKENS: usize = 32_768;
pub const DEFAULT_MAX_TOKEN_BUDGET: u32 = 50_000;

pub const SYNC_SERVER_URL_KEY: &str = "syncServerUrl";
pub const SYNC_ACCOUNT_ID_KEY: &str = "syncAccountId";
pub const SYNC_ACCOUNT_EMAIL_KEY: &str = "syncAccountEmail";
pub const SYNC_KEY_ID_KEY: &str = "syncKeyId";
pub const WEB_ACCOUNT_ID_KEY: &str = "webAccountId";
pub const WEB_ACCOUNT_EMAIL_KEY: &str = "webAccountEmail";
pub const DEFAULT_SYNC_BASE_URL: &str = "https://sync.nixmac.app";

pub const PROMPT_HISTORY_CHANGED_EVENT: &str = "prompt_history_changed";

const MAX_PROMPT_HISTORY: usize = 20;

// =============================================================================
// Configuration Directory
// =============================================================================

pub fn get_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    if let Some(dir) = get_config_dir_if_set(app)? {
        return Ok(dir);
    }

    Ok(CANONICAL_CONFIG_DIR.to_string())
}

pub fn get_config_dir_if_set<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    if let Some(dir) = crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR) {
        return Ok(Some(dir));
    }

    if let Some(dir) = preferences::try_read(app).and_then(|prefs| prefs.config_dir) {
        return Ok(Some(dir));
    }

    crate::storage::legacy_kv::get_legacy_string(app, "configDir")
}

pub fn get_repo_root<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    if let Some(dir) = crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_CONFIG_DIR) {
        return Ok(dir);
    }

    if let Some(root) = preferences::try_read(app).and_then(|prefs| prefs.repo_root) {
        return Ok(root);
    }

    let config_dir = get_config_dir(app)?;
    let repo_root = repo_root(&config_dir).to_string_lossy().to_string();
    let persisted = repo_root.clone();
    preferences::write(app, move |prefs| prefs.repo_root = Some(persisted))?;
    Ok(repo_root)
}

pub fn set_config_dir<R: Runtime>(app: &AppHandle<R>, dir: &str) -> Result<()> {
    let repo_root = repo_root(dir).to_string_lossy().to_string();
    let persisted = dir.to_string();
    preferences::write(app, move |prefs| {
        prefs.config_dir = Some(persisted);
        prefs.repo_root = Some(repo_root);
    })
}

pub fn ensure_config_dir_exists<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let dir = get_config_dir(app)?;
    let path = Path::new(&dir);

    if canonical_config::is_canonical_config_path(path) {
        // Creating /etc/nix-darwin itself needs root — a one-time privileged
        // step when the user keeps the config at the canonical path. The
        // convention *link* (config elsewhere) is maintained during apply
        // instead; see canonical_config::canonical_link_pending.
        canonical_config::ensure_canonical_dir_ready().map_err(anyhow::Error::msg)?;
    } else {
        std::fs::create_dir_all(path)?;
    }

    Ok(dir)
}

pub fn ensure_git_repo_folder<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let dir = get_repo_root(app)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// =============================================================================
// Legacy blobs (not part of GlobalPreferences)
// =============================================================================

pub fn set_evolve_metadata<R: Runtime>(app: &AppHandle<R>, metadata: &str) -> Result<()> {
    set_json_pref(app, "evolveMetadata", metadata)
}

// =============================================================================
// nixmac Account + non-GitHub Sync (legacy KV metadata; secrets in keychain)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncAccountMeta {
    pub account_id: String,
    pub email: String,
    pub key_id: String,
}

pub fn get_sync_server_url<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    if let Some(url) = crate::env::e2e_override(crate::env::keys::NIXMAC_E2E_SYNC_SERVER_URL) {
        return Ok(url);
    }
    Ok(
        crate::storage::legacy_kv::get_legacy_string(app, SYNC_SERVER_URL_KEY)?
            .unwrap_or_else(|| DEFAULT_SYNC_BASE_URL.to_string()),
    )
}

pub fn set_sync_server_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    crate::storage::legacy_kv::set_legacy_string(
        app,
        SYNC_SERVER_URL_KEY,
        url.trim_end_matches('/'),
    )
}

pub fn get_sync_account<R: Runtime>(app: &AppHandle<R>) -> Result<Option<SyncAccountMeta>> {
    let account_id = crate::storage::legacy_kv::get_legacy_string(app, SYNC_ACCOUNT_ID_KEY)?;
    let email = crate::storage::legacy_kv::get_legacy_string(app, SYNC_ACCOUNT_EMAIL_KEY)?;
    let key_id = crate::storage::legacy_kv::get_legacy_string(app, SYNC_KEY_ID_KEY)?;
    match (account_id, email, key_id) {
        (Some(account_id), Some(email), Some(key_id)) => Ok(Some(SyncAccountMeta {
            account_id,
            email,
            key_id,
        })),
        _ => Ok(None),
    }
}

pub fn set_sync_account<R: Runtime>(app: &AppHandle<R>, meta: &SyncAccountMeta) -> Result<()> {
    crate::storage::legacy_kv::set_legacy_string(app, SYNC_ACCOUNT_ID_KEY, &meta.account_id)?;
    crate::storage::legacy_kv::set_legacy_string(app, SYNC_ACCOUNT_EMAIL_KEY, &meta.email)?;
    crate::storage::legacy_kv::set_legacy_string(app, SYNC_KEY_ID_KEY, &meta.key_id)?;
    Ok(())
}

pub fn delete_sync_account<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    crate::storage::legacy_kv::delete_legacy_key(app, SYNC_ACCOUNT_ID_KEY)?;
    crate::storage::legacy_kv::delete_legacy_key(app, SYNC_ACCOUNT_EMAIL_KEY)?;
    crate::storage::legacy_kv::delete_legacy_key(app, SYNC_KEY_ID_KEY)?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebAccountMeta {
    pub account_id: String,
    pub email: String,
}

pub fn get_web_account<R: Runtime>(app: &AppHandle<R>) -> Result<Option<WebAccountMeta>> {
    let account_id = crate::storage::legacy_kv::get_legacy_string(app, WEB_ACCOUNT_ID_KEY)?;
    let email = crate::storage::legacy_kv::get_legacy_string(app, WEB_ACCOUNT_EMAIL_KEY)?;
    match (account_id, email) {
        (Some(account_id), Some(email)) => Ok(Some(WebAccountMeta { account_id, email })),
        _ => Ok(None),
    }
}

pub fn set_web_account<R: Runtime>(app: &AppHandle<R>, meta: &WebAccountMeta) -> Result<()> {
    crate::storage::legacy_kv::set_legacy_string(app, WEB_ACCOUNT_ID_KEY, &meta.account_id)?;
    crate::storage::legacy_kv::set_legacy_string(app, WEB_ACCOUNT_EMAIL_KEY, &meta.email)?;
    Ok(())
}

pub fn delete_web_account<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    crate::storage::legacy_kv::delete_legacy_key(app, WEB_ACCOUNT_ID_KEY)?;
    crate::storage::legacy_kv::delete_legacy_key(app, WEB_ACCOUNT_EMAIL_KEY)?;
    Ok(())
}

pub fn github_ready<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    Ok(get_device_api_key(app)?.is_some() && get_web_server_url().is_ok())
}

pub fn get_web_server_url() -> Result<String> {
    crate::env::web_server_url()
}

// =============================================================================
// Model Cache
// =============================================================================

pub fn get_cached_models<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
) -> Result<Option<Vec<String>>> {
    let key = format!("cachedModels_{provider}");
    Ok(get_json_pref(app, &key)?.filter(|models: &Vec<String>| !models.is_empty()))
}

pub fn clear_cached_models<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    let key = format!("cachedModels_{provider}");
    crate::storage::legacy_kv::delete_legacy_key(app, &key)
}

pub fn set_cached_models<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
    models: &[String],
) -> Result<()> {
    let key = format!("cachedModels_{provider}");
    set_json_pref(app, &key, models)
}

// =============================================================================
// Prompt History
// =============================================================================

pub fn get_prompt_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<String>> {
    Ok(get_json_pref(app, "promptHistory")?.unwrap_or_default())
}

pub fn add_to_prompt_history<R: Runtime>(app: &AppHandle<R>, prompt: &str) -> Result<()> {
    let mut history = get_prompt_history(app)?;
    history.retain(|p| p != prompt);
    history.insert(0, prompt.to_string());
    history.truncate(MAX_PROMPT_HISTORY);
    set_json_pref(app, "promptHistory", &history)?;
    use tauri::Emitter;
    let _ = app.emit(PROMPT_HISTORY_CHANGED_EVENT, &history);
    Ok(())
}

// =============================================================================
// Thin re-exports for callers not yet on state::ui_prefs
// =============================================================================

pub fn get_host_attr<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::host_attr(app))
}

pub fn set_host_attr<R: Runtime>(app: &AppHandle<R>, attr: &str) -> Result<()> {
    crate::state::ui_prefs::set_host_attr(app, attr)
}

pub fn get_summary_provider<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::summary_provider(app))
}

pub fn set_summary_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    crate::state::ui_prefs::set_summary_provider(app, provider)
}

pub fn get_summary_model<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::summary_model(app))
}

pub fn set_summary_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    crate::state::ui_prefs::set_summary_model(app, model)
}

pub fn get_evolve_provider<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::evolve_provider(app))
}

pub fn set_evolve_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<()> {
    crate::state::ui_prefs::set_evolve_provider(app, provider)
}

pub fn get_evolve_model<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::evolve_model(app))
}

pub fn set_evolve_model<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<()> {
    crate::state::ui_prefs::set_evolve_model(app, model)
}

pub fn get_ollama_api_base_url<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::ollama_api_base_url(app))
}

pub fn set_ollama_api_base_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<()> {
    crate::state::ui_prefs::set_ollama_api_base_url(app, url)
}

pub fn get_openai_compatible_api_base_url<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<String>> {
    Ok(crate::state::ui_prefs::openai_compatible_api_base_url(app))
}

pub fn get_max_iterations<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(crate::state::ui_prefs::max_iterations(app))
}

pub fn set_max_iterations<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    crate::state::ui_prefs::set_max_iterations(app, max)
}

pub fn get_max_token_budget<R: Runtime>(app: &AppHandle<R>) -> Result<u32> {
    Ok(crate::state::ui_prefs::max_token_budget(app))
}

pub fn set_max_token_budget<R: Runtime>(app: &AppHandle<R>, max: u32) -> Result<()> {
    crate::state::ui_prefs::set_max_token_budget(app, max)
}

pub fn get_max_output_tokens<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(crate::state::ui_prefs::max_output_tokens(app))
}

pub fn set_max_output_tokens<R: Runtime>(app: &AppHandle<R>, max: usize) -> Result<()> {
    crate::state::ui_prefs::set_max_output_tokens(app, max)
}
