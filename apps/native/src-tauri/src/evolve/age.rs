use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::process::Command;

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
    let key_path = home.join(SOPS_AGE_KEYS_RELATIVE_PATH);

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

fn derive_public_key(key_path: &PathBuf) -> Result<String> {
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