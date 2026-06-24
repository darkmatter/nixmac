//! Tauri commands for the nixmac account + non-GitHub sync feature.
//!
//! These are thin wrappers over `crate::sync`; all auth/credential logic lives
//! there. Errors are converted to display strings (and reported to Sentry)
//! via [`capture_err`].

use super::helpers::capture_err;
use crate::shared_types::{AuthStatus, SyncRemoteStatus, SyncResult};
use crate::sync;
use tauri::AppHandle;

/// Returns the current authentication state for this device.
#[tauri::command]
pub async fn account_status(app: AppHandle) -> Result<AuthStatus, String> {
    sync::status(&app).map_err(|e| capture_err("account_status", e))
}

/// Signs in to a nixmac account and stores the issued device credentials.
#[tauri::command]
pub async fn account_sign_in(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<AuthStatus, String> {
    sync::sign_in(&app, &email, &password)
        .await
        .map_err(|e| capture_err("account_sign_in", e))
}

/// Signs in to the web-origin nixmac account (Better Auth) and stores the
/// device api-key used for server-brokered GitHub access.
#[tauri::command]
pub async fn account_sign_in_web(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<AuthStatus, String> {
    sync::sign_in_web(&app, &email, &password)
        .await
        .map_err(|e| capture_err("account_sign_in_web", e))
}

/// Creates a web-origin nixmac account and stores the device api-key.
#[tauri::command]
pub async fn account_sign_up_web(
    app: AppHandle,
    name: String,
    email: String,
    password: String,
) -> Result<AuthStatus, String> {
    sync::sign_up_web(&app, &name, &email, &password)
        .await
        .map_err(|e| capture_err("account_sign_up_web", e))
}

/// Signs out, removing the stored account metadata and device secret.
#[tauri::command]
pub async fn account_sign_out(app: AppHandle) -> Result<AuthStatus, String> {
    sync::sign_out(&app).map_err(|e| capture_err("account_sign_out", e))
}

/// Updates the sync server base URL used for account + sync requests.
#[tauri::command]
pub async fn account_set_server_url(app: AppHandle, url: String) -> Result<AuthStatus, String> {
    sync::set_server_url(&app, &url).map_err(|e| capture_err("account_set_server_url", e))
}

/// Returns the server-side sync status for the signed-in account.
#[tauri::command]
pub async fn sync_status(app: AppHandle) -> Result<SyncRemoteStatus, String> {
    sync::remote_status(&app)
        .await
        .map_err(|e| capture_err("sync_status", e))
}

/// Pushes the local configuration snapshot pointer to the sync server.
#[tauri::command]
pub async fn sync_push(app: AppHandle) -> Result<SyncResult, String> {
    sync::push(&app)
        .await
        .map_err(|e| capture_err("sync_push", e))
}

/// Pulls the latest snapshot pointer from the sync server.
#[tauri::command]
pub async fn sync_pull(app: AppHandle) -> Result<SyncResult, String> {
    sync::pull(&app)
        .await
        .map_err(|e| capture_err("sync_pull", e))
}
