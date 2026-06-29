#![allow(dead_code)] // Legacy credential migration helpers are retained for upgrade paths.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_keyring::KeyringExt;

#[cfg(test)]
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("keychain operation failed: {0}")]
    Keychain(String),
    #[error("credential store operation failed: {0}")]
    Storage(String),
    #[error("legacy settings store is read-only for writes")]
    LegacyReadOnly,
    #[error("failed to remove legacy plaintext credential: {0}")]
    LegacyCleanup(String),
}

pub trait CredentialStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError>;
    fn set(&self, value: &str) -> Result<(), CredentialStoreError>;
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

pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }
}

impl CredentialStore for FileStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError> {
        match fs::read_to_string(&self.path) {
            Ok(value) => Ok(Some(value)),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
            Err(err) => Err(CredentialStoreError::Storage(err.to_string())),
        }
    }

    fn set(&self, value: &str) -> Result<(), CredentialStoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| CredentialStoreError::Storage(err.to_string()))?;
            set_private_dir_permissions(parent)?;
        }

        let mut options = fs::OpenOptions::new();
        options.create(true).write(true).truncate(true);
        set_private_file_mode(&mut options);

        let mut file = options
            .open(&self.path)
            .map_err(|err| CredentialStoreError::Storage(err.to_string()))?;
        file.write_all(value.as_bytes())
            .map_err(|err| CredentialStoreError::Storage(err.to_string()))?;
        set_private_file_permissions(&self.path)
    }

    fn delete(&self) -> Result<(), CredentialStoreError> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
            Err(err) => Err(CredentialStoreError::Storage(err.to_string())),
        }
    }
}

#[cfg(unix)]
fn set_private_file_mode(options: &mut fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn set_private_file_mode(_options: &mut fs::OpenOptions) {}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), CredentialStoreError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|err| CredentialStoreError::Storage(err.to_string()))
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), CredentialStoreError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), CredentialStoreError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|err| CredentialStoreError::Storage(err.to_string()))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), CredentialStoreError> {
    Ok(())
}

fn is_not_found_keyring_error<E: std::fmt::Display + std::fmt::Debug>(err: &E) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    if msg.contains("no matching entry") || msg.contains("not found") {
        return true;
    }

    format!("{err:?}").to_ascii_lowercase().contains("noentry")
}

pub struct SettingsFileStore {
    name: String,
    getter: Arc<dyn Fn() -> Result<Option<String>, CredentialStoreError> + Send + Sync>,
    deleter: Arc<dyn Fn() -> Result<(), CredentialStoreError> + Send + Sync>,
}

impl SettingsFileStore {
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

#[cfg(test)]
#[derive(Default)]
pub struct InMemoryStore {
    value: Mutex<Option<String>>,
}

#[cfg(test)]
impl InMemoryStore {
    pub fn with_value(value: Option<String>) -> Self {
        Self {
            value: Mutex::new(value),
        }
    }
}

#[cfg(test)]
impl CredentialStore for InMemoryStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError> {
        self.value
            .lock()
            .map(|value| value.clone())
            .map_err(|_| CredentialStoreError::Storage("in-memory store lock poisoned".to_string()))
    }

    fn set(&self, value: &str) -> Result<(), CredentialStoreError> {
        self.value
            .lock()
            .map(|mut current| {
                *current = Some(value.to_string());
            })
            .map_err(|_| CredentialStoreError::Storage("in-memory store lock poisoned".to_string()))
    }

    fn delete(&self) -> Result<(), CredentialStoreError> {
        self.value
            .lock()
            .map(|mut current| {
                *current = None;
            })
            .map_err(|_| CredentialStoreError::Storage("in-memory store lock poisoned".to_string()))
    }
}

pub fn get_with_lazy_migration<K, L>(
    keychain: &K,
    legacy: &L,
) -> Result<Option<String>, CredentialStoreError>
where
    K: CredentialStore,
    L: CredentialStore,
{
    let keychain_get_err = match keychain.get() {
        Ok(Some(value)) => {
            // Keychain already has the credential. Clean up any stale plaintext
            // copy in legacy storage (e.g. from a previous run that wrote to
            // keychain but failed to delete the settings.json entry).
            match legacy.get() {
                Ok(Some(_)) => {
                    if let Err(err) = legacy.delete() {
                        log::warn!(
                            "Failed to clean up stale plaintext credential from settings: {}",
                            err
                        );
                    } else {
                        log::info!(
                            "Cleaned up stale plaintext credential from settings (already in keychain)"
                        );
                    }
                }
                Ok(None) => {}
                Err(err) => {
                    log::warn!("Could not check legacy store during cleanup: {}", err);
                }
            }
            return Ok(Some(value));
        }
        Ok(None) => None,
        Err(err) => Some(err),
    };

    let Some(legacy_value) = legacy.get()? else {
        return match keychain_get_err {
            Some(err) => Err(err),
            None => Ok(None),
        };
    };

    match keychain.set(&legacy_value) {
        Ok(()) => {
            if let Err(err) = legacy.delete() {
                log::warn!(
                    "Credential migrated to keychain but failed to clean up plaintext settings value: {}",
                    err
                );
            }
        }
        Err(err) => {
            log::warn!(
                "Credential migration to keychain failed, keeping legacy settings value in place: {}",
                err
            );
        }
    }

    Ok(Some(legacy_value))
}

pub fn set_with_cleanup<K, L>(
    keychain: &K,
    legacy: &L,
    value: &str,
) -> Result<(), CredentialStoreError>
where
    K: CredentialStore,
    L: CredentialStore,
{
    keychain.set(value)?;
    legacy
        .delete()
        .map_err(|err| CredentialStoreError::LegacyCleanup(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct FailingSetStore;

    impl CredentialStore for FailingSetStore {
        fn get(&self) -> Result<Option<String>, CredentialStoreError> {
            Ok(None)
        }

        fn set(&self, _value: &str) -> Result<(), CredentialStoreError> {
            Err(CredentialStoreError::Storage("set failed".to_string()))
        }

        fn delete(&self) -> Result<(), CredentialStoreError> {
            Ok(())
        }
    }

    #[test]
    fn migrates_legacy_value_to_keychain_and_cleans_plaintext() {
        let keychain = InMemoryStore::default();
        let legacy = InMemoryStore::with_value(Some("legacy-secret".to_string()));

        let value = get_with_lazy_migration(&keychain, &legacy).unwrap();

        assert_eq!(value.as_deref(), Some("legacy-secret"));
        assert_eq!(keychain.get().unwrap().as_deref(), Some("legacy-secret"));
        assert_eq!(legacy.get().unwrap(), None);
    }

    #[test]
    fn returns_legacy_value_if_keychain_migration_write_fails() {
        let keychain = FailingSetStore;
        let legacy = InMemoryStore::with_value(Some("legacy-secret".to_string()));

        let value = get_with_lazy_migration(&keychain, &legacy).unwrap();

        assert_eq!(value.as_deref(), Some("legacy-secret"));
        assert_eq!(legacy.get().unwrap().as_deref(), Some("legacy-secret"));
    }

    #[test]
    fn write_goes_to_keychain_and_removes_legacy_plaintext() {
        let keychain = InMemoryStore::default();
        let legacy = InMemoryStore::with_value(Some("stale".to_string()));

        set_with_cleanup(&keychain, &legacy, "new-secret").unwrap();

        assert_eq!(keychain.get().unwrap().as_deref(), Some("new-secret"));
        assert_eq!(legacy.get().unwrap(), None);
    }

    #[test]
    fn write_failure_does_not_remove_legacy_plaintext() {
        let keychain = FailingSetStore;
        let legacy = InMemoryStore::with_value(Some("legacy-secret".to_string()));

        let result = set_with_cleanup(&keychain, &legacy, "new-secret");

        assert!(result.is_err());
        assert_eq!(legacy.get().unwrap().as_deref(), Some("legacy-secret"));
    }

    #[test]
    fn file_store_round_trips_and_deletes_secret() {
        let temp = tempfile::tempdir().unwrap();
        let path: PathBuf = temp.path().join("openaiApiKey");
        let store = FileStore::new(&path);

        assert_eq!(store.get().unwrap(), None);

        store.set("dev-secret").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("dev-secret"));

        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn file_store_delete_ignores_missing_file() {
        let temp = tempfile::tempdir().unwrap();
        let store = FileStore::new(temp.path().join("missing"));

        store.delete().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_store_uses_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("cache");
        let path = dir.join("openaiApiKey");
        let store = FileStore::new(&path);

        store.set("dev-secret").unwrap();

        let dir_mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }
}
