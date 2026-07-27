use tauri::AppHandle;

use crate::{commands::helpers::get_hostname_and_config_dir, shared_types::SecretsVault};

/// Returns the secrets and recipients known to the configured repo.
#[tauri::command]
pub async fn load_secrets_vault(app: AppHandle) -> Result<SecretsVault, String> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&app, "load_secrets_vault")?;
    crate::secrets::secrets_management::load_secrets_vault(&host_attr, &config_dir)
        .map_err(|e| format!("Failed to load secrets state: {e}"))
}

/// Decrypts a single secret from the configured repo, returning its plaintext value.
/// Use caution.
#[tauri::command]
pub async fn decrypt_secret(app: AppHandle, secret_id: String) -> Result<String, String> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&app, "decrypt_secret")?;
    crate::secrets::secrets_management::decrypt_secret(&host_attr, &config_dir, &secret_id)
        .map_err(|e| format!("Failed to decrypt secret: {e}"))
}
