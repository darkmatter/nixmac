use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_SOPS_CONFIG_FILENAME: &str = ".sops.yaml";
const FALLBACK_SOPS_CONFIG_FILENAME: &str = "sops.yaml";

/// Ensure a SOPS config exists in the config root and contains the managed creation rule.
pub fn ensure_sops_config(base: &Path, public_key: &str) -> Result<PathBuf> {
    let config_path = if base.join(DEFAULT_SOPS_CONFIG_FILENAME).exists() {
        base.join(DEFAULT_SOPS_CONFIG_FILENAME)
    } else if base.join(FALLBACK_SOPS_CONFIG_FILENAME).exists() {
        base.join(FALLBACK_SOPS_CONFIG_FILENAME)
    } else {
        base.join(DEFAULT_SOPS_CONFIG_FILENAME)
    };

    let managed = render_sops_config(public_key);
    std::fs::write(&config_path, managed).with_context(|| {
        format!(
            "Failed to write SOPS config at {}",
            config_path.to_string_lossy()
        )
    })?;

    Ok(config_path)
}

/// Ensure the encrypted secret file exists at secrets/<name>.yaml.
pub fn ensure_secret_file(
    base: &Path,
    secret_relative_path: &str,
    initial_content: Option<&str>,
) -> Result<PathBuf> {
    let full_path = base.join(secret_relative_path);

    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create secret directory {}",
                parent.to_string_lossy()
            )
        })?;
    }

    if !full_path.exists() {
        let initial = initial_content.unwrap_or("value: \"\"\n");
        std::fs::write(&full_path, initial).with_context(|| {
            format!(
                "Failed to create initial secret file at {}",
                full_path.to_string_lossy()
            )
        })?;
    }

    Ok(full_path)
}

/// Force the file into valid encrypted state using SOPS.
pub fn encrypt_in_place(
    base: &Path,
    secret_relative_path: &str,
    age_key_file: &Path,
) -> Result<()> {
    let output = Command::new("sops")
        .arg("--encrypt")
        .arg("--in-place")
        .arg(secret_relative_path)
        .env("SOPS_AGE_KEY_FILE", age_key_file)
        .current_dir(base)
        .output()
        .context("Failed to run sops --encrypt --in-place. Ensure sops is installed")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(anyhow!(
        "sops --encrypt --in-place failed for {} (SOPS_AGE_KEY_FILE={}): {}",
        secret_relative_path,
        age_key_file.display(),
        stderr.trim()
    ))
}

/// Open a blocking SOPS editor session. SOPS handles decrypt/edit/re-encrypt.
pub fn edit_secret_blocking(
    base: &Path,
    secret_relative_path: &str,
    age_key_file: &Path,
) -> Result<()> {
    let status = Command::new("sops")
        .arg(secret_relative_path)
        .env("SOPS_AGE_KEY_FILE", age_key_file)
        .current_dir(base)
        .status()
        .context("Failed to run sops editor session")?;

    if status.success() {
        return Ok(());
    }

    Err(anyhow!(
        "sops editor session failed for {} (SOPS_AGE_KEY_FILE={})",
        secret_relative_path,
        age_key_file.display()
    ))
}

fn render_sops_config(public_key: &str) -> String {
    format!(
        "creation_rules:\n  - path_regex: secrets/.*\\.yaml\n    age:\n      - {}\n",
        public_key
    )
}
