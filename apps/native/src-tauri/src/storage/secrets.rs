//! Keychain-backed secrets with env-first resolution for dev/CI.

use crate::storage::credential_store::{CredentialStore, KeychainStore};
use crate::storage::legacy_kv::{delete_legacy_key, get_legacy_string, set_legacy_string};

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

const KEYCHAIN_SERVICE: &str = "com.darkmatter.nixmac";

pub const SYNC_SECRET_KEYCHAIN_KEY: &str = "nixmacSyncSecret";
pub const DEVICE_API_KEY_KEYCHAIN_KEY: &str = "nixmacDeviceApiKey";

fn normalize_secret(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn resolve_secret_with_env_override<G>(
    env_value: Option<String>,
    fallback: G,
) -> Result<Option<String>>
where
    G: FnOnce() -> Result<Option<String>>,
{
    if let Some(value) = env_value.filter(|s| !s.trim().is_empty()) {
        return Ok(Some(value));
    }
    fallback()
}

fn keychain_store_for<R: Runtime>(app: &AppHandle<R>, key: &str) -> KeychainStore<R> {
    KeychainStore::new(app.clone(), KEYCHAIN_SERVICE, key)
}

fn get_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<Option<String>> {
    if crate::env::e2e_mock_system_enabled() {
        return Ok(normalize_secret(get_legacy_string(app, key)?));
    }

    keychain_store_for(app, key)
        .get()
        .map(normalize_secret)
        .map_err(anyhow::Error::from)
}

fn set_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str, value: &str) -> Result<()> {
    let Some(value) = normalize_secret(Some(value.to_string())) else {
        return delete_secret_pref(app, key);
    };

    if crate::env::e2e_mock_system_enabled() {
        return set_legacy_string(app, key, &value);
    }

    keychain_store_for(app, key)
        .set(&value)
        .map_err(anyhow::Error::from)
}

fn delete_secret_pref<R: Runtime>(app: &AppHandle<R>, key: &'static str) -> Result<()> {
    if crate::env::e2e_mock_system_enabled() {
        return delete_legacy_key(app, key);
    }

    keychain_store_for(app, key)
        .delete()
        .map_err(anyhow::Error::from)
}

pub fn get_openrouter_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "openrouterApiKey")
}

pub fn set_openrouter_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "openrouterApiKey", key)
}

pub fn get_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "openaiApiKey")
}

pub fn set_openai_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "openaiApiKey", key)
}

pub fn get_vllm_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, "vllmApiKey")
}

pub fn set_vllm_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, "vllmApiKey", key)
}

pub fn get_effective_openrouter_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_secret(crate::env::openrouter_api_key_for_app(app)),
        || get_openrouter_api_key(app),
    )
}

pub fn get_effective_openai_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_secret(crate::env::openai_api_key_for_app(app)),
        || get_openai_api_key(app),
    )
}

pub fn get_effective_vllm_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    resolve_secret_with_env_override(
        normalize_secret(crate::env::vllm_api_key_for_app(app)),
        || get_vllm_api_key(app),
    )
}

pub fn get_effective_openai_provider_credential<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<(String, &'static str)>> {
    Ok(get_effective_openai_api_key(app)?.map(|key| (key, OPENAI_BASE_URL)))
}

pub fn get_effective_openrouter_provider_credential<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<(String, &'static str)>> {
    Ok(get_effective_openrouter_api_key(app)?.map(|key| (key, OPENROUTER_BASE_URL)))
}

pub fn get_env_openai_provider_credential() -> Option<(String, &'static str)> {
    crate::env::openai_api_key().map(|key| (key, OPENAI_BASE_URL))
}

pub fn get_env_openrouter_provider_credential() -> Option<(String, &'static str)> {
    crate::env::openrouter_api_key().map(|key| (key, OPENROUTER_BASE_URL))
}

pub fn get_sync_secret<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY)
}

pub fn set_sync_secret<R: Runtime>(app: &AppHandle<R>, secret: &str) -> Result<()> {
    set_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY, secret)
}

pub fn delete_sync_secret<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    delete_secret_pref(app, SYNC_SECRET_KEYCHAIN_KEY)
}

pub fn get_device_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    get_secret_pref(app, DEVICE_API_KEY_KEYCHAIN_KEY)
}

pub fn set_device_api_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    set_secret_pref(app, DEVICE_API_KEY_KEYCHAIN_KEY, key)
}

pub fn delete_device_api_key<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    delete_secret_pref(app, DEVICE_API_KEY_KEYCHAIN_KEY)
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
    fn normalize_secret_rejects_empty_stored_values() {
        assert_eq!(normalize_secret(None), None);
        assert_eq!(normalize_secret(Some("".to_string())), None);
        assert_eq!(normalize_secret(Some("   \n\t ".to_string())), None);
        assert_eq!(
            normalize_secret(Some("  sk-stored  ".to_string())),
            Some("sk-stored".to_string())
        );
    }

    #[test]
    fn env_openai_provider_credential_ignores_openrouter_key() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["OPENROUTER_API_KEY", "OPENAI_API_KEY"]);

        std::env::set_var("OPENROUTER_API_KEY", "sk-or-existing");
        std::env::remove_var("OPENAI_API_KEY");
        assert_eq!(get_env_openai_provider_credential(), None);

        std::env::set_var("OPENAI_API_KEY", " sk-openai-direct ");
        assert_eq!(
            get_env_openai_provider_credential(),
            Some(("sk-openai-direct".to_string(), OPENAI_BASE_URL))
        );
    }

    #[test]
    fn env_openrouter_provider_credential_ignores_openai_key() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["OPENROUTER_API_KEY", "OPENAI_API_KEY"]);

        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::set_var("OPENAI_API_KEY", "sk-openai-existing");
        assert_eq!(get_env_openrouter_provider_credential(), None);

        std::env::set_var("OPENROUTER_API_KEY", " sk-or-direct ");
        assert_eq!(
            get_env_openrouter_provider_credential(),
            Some(("sk-or-direct".to_string(), OPENROUTER_BASE_URL))
        );
    }

    #[test]
    fn empty_env_after_normalization_uses_fallback() {
        let fallback_called = AtomicBool::new(false);

        let result = resolve_secret_with_env_override(
            normalize_secret(Some("   \t\n  ".to_string())),
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
