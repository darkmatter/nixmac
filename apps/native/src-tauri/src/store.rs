//! Persistent storage for app settings using Tauri's store plugin.
//!
//! Settings are stored in a JSON file managed by tauri-plugin-store.
//! This provides a simple key-value interface for preferences.

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Store, StoreExt};

const STORE_PATH: &str = "settings.json";

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

pub fn get_window_shadow<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    let store = get_store(app)?;

    if let Some(shadow) = store.get("windowShadow") {
        if let Some(shadow_bool) = shadow.as_bool() {
            return Ok(shadow_bool);
        }
    }

    Ok(false) // Default: no shadow for cleaner widget look
}

pub fn set_window_shadow<R: Runtime>(app: &AppHandle<R>, shadow: bool) -> Result<()> {
    let store = get_store(app)?;
    store.set("windowShadow", serde_json::json!(shadow));
    store.save()?;
    Ok(())
}

pub fn get_floating_footer<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    let store = get_store(app)?;

    if let Some(footer) = store.get("floatingFooter") {
        if let Some(footer_bool) = footer.as_bool() {
            return Ok(footer_bool);
        }
    }

    Ok(true) // Default: floating footer enabled
}

pub fn set_floating_footer<R: Runtime>(app: &AppHandle<R>, footer: bool) -> Result<()> {
    let store = get_store(app)?;
    store.set("floatingFooter", serde_json::json!(footer));
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
    get_string_pref(app, "openrouterApiKey")
}

pub fn set_openrouter_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("openrouterApiKey", serde_json::json!(key));
    store.save()?;
    Ok(())
}

/// Gets the stored OpenAI API key (for direct OpenAI access).
pub fn get_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_string_pref(app, "openaiApiKey")
}

pub fn set_openai_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("openaiApiKey", serde_json::json!(key));
    store.save()?;
    Ok(())
}

/// Gets the appropriate API key based on provider.
/// For "openai" provider, prefers OpenRouter key, falls back to OpenAI key.
/// For "ollama" provider, returns None (no key needed).
pub fn get_api_key_for_provider<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
) -> Result<Option<String>> {
    match provider {
        "ollama" => Ok(None),
        "openai" | _ => {
            // Try OpenRouter key first, then fall back to OpenAI key
            if let Some(key) = get_openrouter_api_key(app)? {
                return Ok(Some(key));
            }
            get_openai_api_key(app)
        }
    }
}

fn get_string_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
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

fn get_usize_pref<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<usize>> {
    let store = get_store(app)?;
    if let Some(val) = store.get(key) {
        if let Some(n) = val.as_u64() {
            return Ok(Some(n as usize));
        }
    }
    Ok(None)
}

// =============================================================================
// Evolution Limits
// =============================================================================

/// Gets the maximum iterations for evolution (default: 50).
pub fn get_max_iterations<R: Runtime>(app: &AppHandle<R>) -> Result<usize> {
    Ok(get_usize_pref(app, "maxIterations")?.unwrap_or(50))
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
