//! Tauri commands for the nixmac account feature.
//!
//! These are thin wrappers over `crate::sync`; all auth/credential logic lives
//! there. Errors are converted to display strings (and reported to Sentry)
//! via [`capture_err`].

use super::helpers::capture_err;
use crate::shared_types::AuthStatus;
use crate::sync;
use tauri::AppHandle;

/// Returns the current authentication state for this device.
#[tauri::command]
pub async fn account_status(app: AppHandle) -> Result<AuthStatus, String> {
    sync::status(&app).map_err(|e| capture_err("account_status", e))
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

/// Sends a sign-in code for the web-origin nixmac account.
#[tauri::command]
pub async fn account_send_otp(email: String) -> Result<(), String> {
    sync::send_web_sign_in_otp(&email)
        .await
        .map_err(|e| capture_err("account_send_otp", e))
}

/// Verifies a sign-in code and stores the device api-key for GitHub access.
#[tauri::command]
pub async fn account_verify_otp(
    app: AppHandle,
    email: String,
    otp: String,
    name: String,
) -> Result<AuthStatus, String> {
    sync::verify_web_sign_in_otp(&app, &email, &otp, &name)
        .await
        .map_err(|e| capture_err("account_verify_otp", e))
}

/// Signs out, removing the stored account metadata and device API key.
#[tauri::command]
pub async fn account_sign_out(app: AppHandle) -> Result<AuthStatus, String> {
    sync::sign_out(&app).map_err(|e| capture_err("account_sign_out", e))
}
