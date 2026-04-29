//! Test-only runtime isolation hooks.
//!
//! These are inert in normal app runs. E2E runners can set
//! `NIXMAC_E2E_APP_DATA_DIR` before launching nixmac to keep stores and the DB
//! out of the user's real app-support directory. Release E2E artifacts may also
//! set the explicit `NIXMAC_E2E_MOCK_SYSTEM=1` flag to bypass host system
//! prerequisites while exercising product UI against a signed app bundle.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

pub const E2E_APP_DATA_DIR_ENV: &str = "NIXMAC_E2E_APP_DATA_DIR";
pub const E2E_BYPASS_SINGLE_INSTANCE_ENV: &str = "NIXMAC_E2E_BYPASS_SINGLE_INSTANCE";
pub const E2E_MOCK_SYSTEM_ENV: &str = "NIXMAC_E2E_MOCK_SYSTEM";
pub const E2E_UNATTENDED_AUTH_ENV: &str = "NIXMAC_E2E_UNATTENDED_AUTH";
pub const E2E_ADMIN_PASSWORD_ENV: &str = "NIXMAC_E2E_ADMIN_PASSWORD";

fn e2e_app_data_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }

    std::env::var_os(E2E_APP_DATA_DIR_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(path) = e2e_app_data_dir() {
        std::fs::create_dir_all(&path)
            .with_context(|| format!("Failed to create E2E app data dir {}", path.display()))?;
        return Ok(path);
    }

    let path = app.path().app_data_dir()?;
    std::fs::create_dir_all(&path)
        .with_context(|| format!("Failed to create app data dir {}", path.display()))?;
    Ok(path)
}

pub fn store_path(path: impl AsRef<Path>) -> PathBuf {
    if let Some(app_data_dir) = e2e_app_data_dir() {
        app_data_dir.join(path)
    } else {
        path.as_ref().to_path_buf()
    }
}

pub fn should_bypass_single_instance() -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    std::env::var(E2E_BYPASS_SINGLE_INSTANCE_ENV).unwrap_or_default() == "1"
}

pub fn should_mock_system() -> bool {
    std::env::var(E2E_MOCK_SYSTEM_ENV).unwrap_or_default() == "1" || is_e2e_mode()
}

pub fn unattended_admin_password() -> Option<String> {
    if std::env::var(E2E_UNATTENDED_AUTH_ENV).unwrap_or_default() != "1" {
        return None;
    }

    std::env::var(E2E_ADMIN_PASSWORD_ENV)
        .ok()
        .filter(|value| !value.is_empty())
}

pub fn is_e2e_mode() -> bool {
    cfg!(debug_assertions)
        && (std::env::var_os(E2E_APP_DATA_DIR_ENV)
            .filter(|value| !value.is_empty())
            .is_some()
            || should_bypass_single_instance())
}
