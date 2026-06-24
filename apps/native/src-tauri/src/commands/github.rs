//! Tauri commands for the server-brokered GitHub App connection.
//!
//! Thin wrappers over `crate::sync` (which signs requests to the nixmac
//! server). The desktop never holds the App private key or a long-lived token;
//! the server brokers the install and mints short-lived clone tokens. The
//! actual clone lives in `commands::config` next to the other import commands
//! so it can reuse the import helpers.

use super::helpers::capture_err;
use crate::shared_types::{GithubConnectStart, GithubRepo, GithubStatus};
use crate::sync;
use tauri::AppHandle;

/// Starts the GitHub App connect flow; returns the install URL to open.
#[tauri::command]
pub async fn github_connect_start(app: AppHandle) -> Result<GithubConnectStart, String> {
    sync::github_connect_start(&app)
        .await
        .map_err(|e| capture_err("github_connect_start", e))
}

/// Polled while the browser install completes; reports linkage + GitHub login.
#[tauri::command]
pub async fn github_status(app: AppHandle) -> Result<GithubStatus, String> {
    sync::github_status(&app)
        .await
        .map_err(|e| capture_err("github_status", e))
}

/// Lists the repositories the account's installation can access.
#[tauri::command]
pub async fn github_list_repos(app: AppHandle) -> Result<Vec<GithubRepo>, String> {
    sync::github_list_repos(&app)
        .await
        .map_err(|e| capture_err("github_list_repos", e))
}

/// Drops the account↔installation link (the user revokes in GitHub settings).
#[tauri::command]
pub async fn github_disconnect(app: AppHandle) -> Result<(), String> {
    sync::github_disconnect(&app)
        .await
        .map_err(|e| capture_err("github_disconnect", e))
}
