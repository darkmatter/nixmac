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

/// Gets the stored nix-darwin host attribute name.
pub fn get_evolve_metadata<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    let store = get_store(app)?;

    if let Some(metadata) = store.get("evolveMetadata") {
        if let Some(metadata_str) = metadata.as_str() {
            return Ok(Some(metadata_str.to_string()));
        }
    }
    Ok(None)
}

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
// OpenAI API Key
// =============================================================================

/// Gets the stored OpenAI API key.
pub fn get_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    let store = get_store(app)?;

    if let Some(key) = store.get("openaiApiKey") {
        if let Some(key_str) = key.as_str() {
            if !key_str.is_empty() {
                return Ok(Some(key_str.to_string()));
            }
        }
    }

    Ok(None)
}

pub fn set_openai_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set("openaiApiKey", serde_json::json!(key));
    store.save()?;
    Ok(())
}
