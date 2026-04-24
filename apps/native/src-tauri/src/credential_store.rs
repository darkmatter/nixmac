use std::sync::Arc;

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

pub struct KeychainStore {
    service: String,
    account: String,
}

impl KeychainStore {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, CredentialStoreError> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| CredentialStoreError::Keychain(e.to_string()))
    }
}

impl CredentialStore for KeychainStore {
    fn get(&self) -> Result<Option<String>, CredentialStoreError> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(value) => {
                log::info!("credential accessed from keychain: {}", self.account);
                Ok(Some(value))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(CredentialStoreError::Keychain(err.to_string())),
        }
    }

    fn set(&self, value: &str) -> Result<(), CredentialStoreError> {
        let entry = self.entry()?;
        entry
            .set_password(value)
            .map_err(|e| CredentialStoreError::Keychain(e.to_string()))
    }

    fn delete(&self) -> Result<(), CredentialStoreError> {
        let entry = self.entry()?;
        match entry.delete_password() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(CredentialStoreError::Keychain(err.to_string())),
        }
    }
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
            log::info!("credential accessed from legacy settings: {}", self.name);
        }
        res
    }

    fn set(&self, _value: &str) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::LegacyReadOnly)
    }

    fn delete(&self) -> Result<(), CredentialStoreError> {
        log::info!("deleting legacy credential from settings: {}", self.name);
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
        Ok(Some(value)) => return Ok(Some(value)),
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
}
