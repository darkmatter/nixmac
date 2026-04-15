use anyhow::{anyhow, Context, Result};
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

const SOPS_AGE_KEY_FILE_ENV_VAR: &str = "SOPS_AGE_KEY_FILE";
const MACOS_SOPS_AGE_KEYS_RELATIVE_PATH: &str = "Library/Application Support/sops/age/keys.txt";
const SOPS_AGE_KEYS_RELATIVE_PATH: &str = ".config/sops/age/keys.txt";

#[derive(Debug, Clone)]
pub struct AgeKeyInfo {
    pub public_key: String,
    pub key_path: PathBuf,
}

/// Ensure an age private key exists for SOPS and return its public key.
/// NOTE that this depends on age-keygen being installed and available in PATH.
pub fn ensure_age_key() -> Result<AgeKeyInfo> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Unable to determine home directory"))?;
    let key_path = resolve_age_key_path(&home);

    if !key_path.exists() {
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "Failed to create SOPS age key directory at {}",
                    parent.display()
                )
            })?;
        }

        let output = Command::new("age-keygen")
            .arg("-o")
            .arg(&key_path)
            .output()
            .context("Failed to run age-keygen. Ensure age is installed and available in PATH")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "age-keygen failed while creating {}: {}",
                key_path.display(),
                stderr.trim()
            ));
        }
    }

    let public_key = derive_public_key(&key_path)?;
    Ok(AgeKeyInfo {
        public_key,
        key_path,
    })
}

fn find_existing_age_key_path(home: &Path) -> Option<PathBuf> {
    let env_key_path = std::env::var_os(SOPS_AGE_KEY_FILE_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let macos_key_path = home.join(MACOS_SOPS_AGE_KEYS_RELATIVE_PATH);
    let home_key_path = home.join(SOPS_AGE_KEYS_RELATIVE_PATH);

    [env_key_path, Some(macos_key_path), Some(home_key_path)]
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
}

fn resolve_age_key_path(home: &Path) -> PathBuf {
    find_existing_age_key_path(home).unwrap_or_else(|| home.join(SOPS_AGE_KEYS_RELATIVE_PATH))
}

fn derive_public_key(key_path: &Path) -> Result<String> {
    let output = Command::new("age-keygen")
        .arg("-y")
        .arg(key_path)
        .output()
        .context("Failed to derive age public key from existing key file")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "Failed to derive age public key from {}: {}",
            key_path.display(),
            stderr.trim()
        ));
    }

    let public_key = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if public_key.is_empty() {
        return Err(anyhow!(
            "Derived age public key was empty for {}",
            key_path.display()
        ));
    }

    Ok(public_key)
}

#[cfg(test)]
mod tests {
    use super::{
        find_existing_age_key_path, resolve_age_key_path, MACOS_SOPS_AGE_KEYS_RELATIVE_PATH,
        SOPS_AGE_KEYS_RELATIVE_PATH, SOPS_AGE_KEY_FILE_ENV_VAR,
    };
    use std::ffi::OsString;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn write_file(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent directories");
        }
        std::fs::write(path, "AGE-SECRET-KEY-1 test-key\n").expect("write test key file");
    }

    struct EnvVarGuard {
        original: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(value: Option<&Path>) -> Self {
            let original = std::env::var_os(SOPS_AGE_KEY_FILE_ENV_VAR);
            match value {
                Some(path) => std::env::set_var(SOPS_AGE_KEY_FILE_ENV_VAR, path),
                None => std::env::remove_var(SOPS_AGE_KEY_FILE_ENV_VAR),
            }
            Self { original }
        }

        fn set_raw(value: Option<&str>) -> Self {
            let original = std::env::var_os(SOPS_AGE_KEY_FILE_ENV_VAR);
            match value {
                Some(raw) => std::env::set_var(SOPS_AGE_KEY_FILE_ENV_VAR, raw),
                None => std::env::remove_var(SOPS_AGE_KEY_FILE_ENV_VAR),
            }
            Self { original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(original) = &self.original {
                std::env::set_var(SOPS_AGE_KEY_FILE_ENV_VAR, original);
            } else {
                std::env::remove_var(SOPS_AGE_KEY_FILE_ENV_VAR);
            }
        }
    }

    #[test]
    fn find_existing_prefers_env_var_path() {
        let _guard = env_lock().lock().expect("lock env var mutations");
        let temp = tempfile::tempdir().expect("create tempdir");
        let home = temp.path().join("home");

        let env_key = temp.path().join("external-keys.txt");
        let mac_key = home.join(MACOS_SOPS_AGE_KEYS_RELATIVE_PATH);
        let home_key = home.join(SOPS_AGE_KEYS_RELATIVE_PATH);
        write_file(&env_key);
        write_file(&mac_key);
        write_file(&home_key);

        let _env = EnvVarGuard::set(Some(&env_key));
        let resolved = find_existing_age_key_path(&home).expect("resolve existing key path");

        assert_eq!(resolved, env_key);
    }

    #[test]
    fn find_existing_falls_back_to_macos_path_when_env_missing() {
        let _guard = env_lock().lock().expect("lock env var mutations");
        let temp = tempfile::tempdir().expect("create tempdir");
        let home = temp.path().join("home");

        let missing_env = temp.path().join("missing-keys.txt");
        let mac_key = home.join(MACOS_SOPS_AGE_KEYS_RELATIVE_PATH);
        let home_key = home.join(SOPS_AGE_KEYS_RELATIVE_PATH);
        write_file(&mac_key);
        write_file(&home_key);

        let _env = EnvVarGuard::set(Some(&missing_env));
        let resolved = find_existing_age_key_path(&home).expect("resolve existing key path");

        assert_eq!(resolved, mac_key);
    }

    #[test]
    fn find_existing_uses_home_path_when_only_home_exists() {
        let _guard = env_lock().lock().expect("lock env var mutations");
        let temp = tempfile::tempdir().expect("create tempdir");
        let home = temp.path().join("home");

        let home_key = home.join(SOPS_AGE_KEYS_RELATIVE_PATH);
        write_file(&home_key);

        let _env = EnvVarGuard::set(None);
        let resolved = find_existing_age_key_path(&home).expect("resolve existing key path");

        assert_eq!(resolved, home_key);
    }

    #[test]
    fn find_existing_ignores_empty_env_var_value() {
        let _guard = env_lock().lock().expect("lock env var mutations");
        let temp = tempfile::tempdir().expect("create tempdir");
        let home = temp.path().join("home");

        let mac_key = home.join(MACOS_SOPS_AGE_KEYS_RELATIVE_PATH);
        write_file(&mac_key);

        let _env = EnvVarGuard::set_raw(Some(""));
        let resolved = find_existing_age_key_path(&home).expect("resolve existing key path");

        assert_eq!(resolved, mac_key);
    }

    #[test]
    fn resolve_age_key_path_returns_fallback_home_path_when_none_exist() {
        let _guard = env_lock().lock().expect("lock env var mutations");
        let temp = tempfile::tempdir().expect("create tempdir");
        let home = temp.path().join("home");

        let _env = EnvVarGuard::set(None);
        let resolved = resolve_age_key_path(&home);

        assert_eq!(resolved, home.join(SOPS_AGE_KEYS_RELATIVE_PATH));
    }
}
