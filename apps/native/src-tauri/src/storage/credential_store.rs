//! macOS Keychain-backed credential storage.
//!
//! API keys and other secrets are stored in the macOS Keychain via
//! `tauri-plugin-keyring` rather than in the plaintext JSON settings file.
//! The `CredentialStore` trait abstracts get/set so the rest of the codebase
//! doesn't need to know the storage mechanism. A future migration could swap
//! `KeychainStore` for a Linux Secret Service implementation without changing
//! callers.

use tauri::{AppHandle, Runtime};
use tauri_plugin_keyring::KeyringExt;

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("keychain operation failed: {0}")]
    Keychain(String),
}

pub trait CredentialStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError>;
    fn set(&self, value: &str) -> Result<(), CredentialStoreError>;
}

pub struct KeychainStore<R: Runtime> {
    app: AppHandle<R>,
    service: String,
    account: String,
}

impl<R: Runtime> KeychainStore<R> {
    pub fn new(app: AppHandle<R>, service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            app,
            service: service.into(),
            account: account.into(),
        }
    }
}

impl<R: Runtime> CredentialStore for KeychainStore<R> {
    fn get(&self) -> Result<Option<String>, CredentialStoreError> {
        let value = self
            .app
            .keyring()
            .get_password(&self.service, &self.account)
            .map_err(|e| CredentialStoreError::Keychain(e.to_string()))?;
        if value.is_some() {
            log::debug!("credential accessed from keychain: {}", self.account);
        }
        Ok(value)
    }

    fn set(&self, value: &str) -> Result<(), CredentialStoreError> {
        self.app
            .keyring()
            .set_password(&self.service, &self.account, value)
            .map_err(|e| CredentialStoreError::Keychain(e.to_string()))
    }
}
