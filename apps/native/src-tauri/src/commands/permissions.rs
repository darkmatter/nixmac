use super::helpers::capture_err;
use crate::state::permissions_state;
use crate::{shared_types, system::permissions};
use tauri::AppHandle;

/// Returns the last-known permissions from the in-memory cell, without
/// probing the OS. `None` means permissions were never checked; call
/// `refresh_permissions` to probe.
#[tauri::command]
pub async fn get_permissions(
    app: AppHandle,
) -> Result<Option<shared_types::PermissionsState>, String> {
    Ok(permissions_state::get(&app))
}

/// Probe all macOS permissions and record the result; the cell write emits
/// `permissions_changed`.
#[tauri::command]
pub async fn refresh_permissions(app: AppHandle) -> Result<(), String> {
    permissions_state::refresh(&app);
    Ok(())
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
