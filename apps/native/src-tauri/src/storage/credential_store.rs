use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_keyring::KeyringExt;

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum CredentialStoreError {
    #[error("keychain operation failed: {0}")]
    Keychain(String),
    #[error("credential store operation failed: {0}")]
    Storage(String),
    #[error("legacy settings store is read-only for writes")]
    LegacyReadOnly,
}

pub trait CredentialStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError>;
    fn set(&self, value: &str) -> Result<(), CredentialStoreError>;
    #[allow(dead_code)]
    fn delete(&self) -> Result<(), CredentialStoreError>;
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

    fn delete(&self) -> Result<(), CredentialStoreError> {
        match self
            .app
            .keyring()
            .delete_password(&self.service, &self.account)
        {
            Ok(()) => Ok(()),
            Err(e) if is_not_found_keyring_error(&e) => Ok(()),
            Err(e) => Err(CredentialStoreError::Keychain(e.to_string())),
        }
    }
}

#[allow(dead_code)]
fn is_not_found_keyring_error<E: std::fmt::Display + std::fmt::Debug>(err: &E) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    if msg.contains("no matching entry") || msg.contains("not found") {
        return true;
    }

    format!("{err:?}").to_ascii_lowercase().contains("noentry")
}

#[allow(dead_code)]
pub struct SettingsFileStore {
    name: String,
    getter: Arc<dyn Fn() -> Result<Option<String>, CredentialStoreError> + Send + Sync>,
    deleter: Arc<dyn Fn() -> Result<(), CredentialStoreError> + Send + Sync>,
}

impl SettingsFileStore {
    #[allow(dead_code)]
    pub fn new<G, D>(name: impl Into<String>, getter: G, deleter: D) -> Self
    where
        G: Fn() -> Result<Option<String>, CredentialStoreError> + Send + Sync + 'static,
        D: Fn() -> Result<(), CredentialStoreError> + Send + Sync + 'static,
    {
        Self {
            name: name.into(),
            getter: Arc::new(getter),
            deleter: Arc::new(deleter),
        }
    }
}

impl CredentialStore for SettingsFileStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError> {
        let res = (self.getter)();
        if let Ok(Some(_)) = &res {
            log::debug!("credential accessed from legacy settings: {}", self.name);
        }
        res
    }

    fn set(&self, _value: &str) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::LegacyReadOnly)
    }

    fn delete(&self) -> Result<(), CredentialStoreError> {
        log::debug!("deleting legacy credential from settings: {}", self.name);
        (self.deleter)()
    }
}
