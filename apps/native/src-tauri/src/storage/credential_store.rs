use tauri::{AppHandle, Runtime};
use tauri_plugin_keyring::KeyringExt;

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("keychain operation failed: {0}")]
    Keychain(String),
    #[allow(unused)]
    #[error("credential store operation failed: {0}")]
    Storage(String),
    #[allow(unused)]
    #[error("legacy settings store is read-only for writes")]
    LegacyReadOnly,
    #[allow(unused)]
    #[error("failed to remove legacy plaintext credential: {0}")]
    LegacyCleanup(String),
}

pub trait CredentialStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError>;
    fn set(&self, value: &str) -> Result<(), CredentialStoreError>;
    #[allow(unused)]
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

fn is_not_found_keyring_error<E: std::fmt::Display + std::fmt::Debug>(err: &E) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    if msg.contains("no matching entry") || msg.contains("not found") {
        return true;
    }

    format!("{err:?}").to_ascii_lowercase().contains("noentry")
}
