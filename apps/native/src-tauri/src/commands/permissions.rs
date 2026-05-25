use super::helpers::capture_err;
use crate::{shared_types, system::permissions};

/// Check all macOS permissions and return their current status.
#[tauri::command]
pub async fn permissions_check_all() -> Result<shared_types::PermissionsState, String> {
    Ok(permissions::check_all_permissions())
}

/// Request a specific permission by ID.
/// For programmatic permissions (desktop, documents), this triggers the OS prompt.
/// For manual permissions (full-disk), this opens System Settings.
#[tauri::command]
pub async fn permissions_request(
    permission_id: String,
) -> Result<shared_types::Permission, String> {
    permissions::request_permission(&permission_id)
        .map_err(|e| capture_err("permissions_request", e))
}

