//! macOS permission checking for nixmac.
//!
//! This module provides functionality to check and request various
//! macOS permissions required for proper operation of nix-darwin.
//!
//! Permissions checked:
//! - Desktop folder access
//! - Documents folder access
//! - Full Disk Access (FDA) - required for darwin-rebuild over SSH
//! - Administrator privileges (sudo access)

use anyhow::Result;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Permission status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    Granted,
    Denied,
    Pending,
    Unknown,
}

/// Individual permission state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub id: String,
    pub name: String,
    pub description: String,
    pub required: bool,
    pub can_request_programmatically: bool,
    pub status: PermissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

/// All permissions state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsState {
    pub permissions: Vec<Permission>,
    pub all_required_granted: bool,
    pub checked_at: Option<i64>,
}

impl Default for PermissionsState {
    fn default() -> Self {
        Self {
            permissions: get_default_permissions(),
            all_required_granted: false,
            checked_at: None,
        }
    }
}

/// Get the default permissions list with initial pending status
fn get_default_permissions() -> Vec<Permission> {
    vec![
        Permission {
            id: "desktop".to_string(),
            name: "Desktop Folder Access".to_string(),
            description: "Required to manage and sync desktop files and configurations".to_string(),
            required: true,
            can_request_programmatically: true,
            status: PermissionStatus::Pending,
            instructions: None,
        },
        Permission {
            id: "documents".to_string(),
            name: "Documents Folder Access".to_string(),
            description: "Required to access and manage configuration files stored in Documents"
                .to_string(),
            required: true,
            can_request_programmatically: true,
            status: PermissionStatus::Pending,
            instructions: None,
        },
        Permission {
            id: "admin".to_string(),
            name: "Administrator Privileges".to_string(),
            description: "Required to install system packages and modify system configurations"
                .to_string(),
            required: true,
            can_request_programmatically: false,
            status: PermissionStatus::Pending,
            instructions: Some("You will be prompted for your password when needed".to_string()),
        },
        Permission {
            id: "full-disk".to_string(),
            name: "Full Disk Access".to_string(),
            description: "Required for darwin-rebuild to apply system changes".to_string(),
            required: true,
            can_request_programmatically: false,
            status: PermissionStatus::Pending,
            instructions: Some(
                "Go to System Settings → Privacy & Security → Full Disk Access, then add nixmac to the list"
                    .to_string(),
            ),
        },
    ]
}

/// Check if we have access to the Desktop folder
fn check_desktop_access() -> PermissionStatus {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return PermissionStatus::Unknown,
    };

    let desktop = home.join("Desktop");
    check_folder_access(&desktop)
}

/// Check if we have access to the Documents folder
fn check_documents_access() -> PermissionStatus {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return PermissionStatus::Unknown,
    };

    let documents = home.join("Documents");
    check_folder_access(&documents)
}

/// Check if we have access to a folder by trying to list its contents
fn check_folder_access(path: &PathBuf) -> PermissionStatus {
    match fs::read_dir(path) {
        Ok(_) => PermissionStatus::Granted,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                PermissionStatus::Denied
            } else if e.kind() == std::io::ErrorKind::NotFound {
                // Folder doesn't exist, consider this as granted (not a permission issue)
                PermissionStatus::Granted
            } else {
                warn!("Unknown error checking access to {:?}: {}", path, e);
                PermissionStatus::Unknown
            }
        }
    }
}

/// Check if we have Full Disk Access
/// This is done by trying to access restricted system files/folders
/// Note: This check is imperfect - the definitive check happens via JS plugin
fn check_full_disk_access() -> PermissionStatus {
    // For local development with the frontend, set VITE_NIXMAC_SKIP_PERMISSIONS=true to skip this check
    // and assume Full Disk Access is granted. not be formally installed such that the setting is available.
    if std::env::var("VITE_NIXMAC_SKIP_PERMISSIONS").is_ok() {
        debug!("VITE_NIXMAC_SKIP_PERMISSIONS is set, assuming Full Disk Access granted");
        return PermissionStatus::Granted;
    }

    // Try to access the TCC database (requires FDA)
    let tcc_path = PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db");

    // Also try user's Library folders that require FDA
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return PermissionStatus::Unknown,
    };

    // ~/Library/Mail is a good test for FDA
    let mail_path = home.join("Library").join("Mail");

    // Try both paths - if either works, we likely have FDA
    let can_access_tcc = fs::metadata(&tcc_path).is_ok();
    let can_access_mail = fs::read_dir(&mail_path).is_ok();

    if can_access_tcc || can_access_mail {
        debug!("Full Disk Access appears to be granted");
        PermissionStatus::Granted
    } else {
        // Can't determine - might be denied or just no Mail folder
        // Keep as Pending - the JS plugin will give a definitive answer
        debug!("Full Disk Access check inconclusive");
        PermissionStatus::Pending
    }
}

/// Check if the current user has administrator privileges
fn check_admin_privileges() -> PermissionStatus {
    // Check if user is in the admin group
    let output = Command::new("id").args(["-Gn"]).output();

    match output {
        Ok(out) => {
            let groups = String::from_utf8_lossy(&out.stdout);
            if groups.contains("admin") || groups.contains("wheel") {
                debug!("User has admin privileges");
                PermissionStatus::Granted
            } else {
                debug!("User does not have admin privileges");
                PermissionStatus::Denied
            }
        }
        Err(e) => {
            warn!("Failed to check admin privileges: {}", e);
            PermissionStatus::Unknown
        }
    }
}

/// Check all permissions and return the current state
pub fn check_all_permissions() -> PermissionsState {
    // In CI/E2E mode, skip all permission checks and report everything as granted.
    // The E2E test environment may not have FDA granted and can't obtain it programmatically.
    if std::env::var("NIXMAC_SKIP_PERMISSIONS").unwrap_or_default() == "1" {
        info!("NIXMAC_SKIP_PERMISSIONS=1: reporting all permissions as granted");
        let mut permissions = get_default_permissions();
        for perm in &mut permissions {
            perm.status = PermissionStatus::Granted;
        }
        return PermissionsState {
            permissions,
            all_required_granted: true,
            checked_at: Some(chrono::Utc::now().timestamp()),
        };
    }

    let mut permissions = get_default_permissions();
    let mut all_required_granted = true; // assume true until proven otherwise

    // Fill in each permission status and update all_required_granted on the fly
    for perm in &mut permissions {
        perm.status = match perm.id.as_str() {
            "desktop" => check_desktop_access(),
            "documents" => check_documents_access(),
            "admin" => check_admin_privileges(),
            "full-disk" => check_full_disk_access(),
            _ => PermissionStatus::Unknown,
        };

        // If this permission is required and not granted, mark all_required_granted as false
        if perm.required && perm.status != PermissionStatus::Granted {
            all_required_granted = false;
        }
    }

    // Single log summarizing all permissions
    let summary: Vec<String> = permissions
        .iter()
        .map(|p| format!("{}={:?}", p.id, p.status))
        .collect();

    let now = chrono::Utc::now();
    info!(
        "Permissions checked at {}: {}. All required granted: {}",
        now.to_rfc3339(),
        summary.join(", "),
        all_required_granted
    );

    PermissionsState {
        permissions,
        all_required_granted,
        checked_at: Some(now.timestamp()),
    }
}

/// Request a specific permission
/// For programmatic permissions (desktop, documents), this triggers the OS prompt
/// For manual permissions (FDA, admin), this returns instructions
pub fn request_permission(permission_id: &str) -> Result<Permission> {
    info!("Requesting permission: {}", permission_id);

    match permission_id {
        "desktop" => {
            // Try to create a temp file in Desktop to trigger the permission prompt
            let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home directory"))?;
            let desktop = home.join("Desktop");
            let test_file = desktop.join(".nixmac-permission-test");

            // Try to create and immediately delete a test file
            match fs::write(&test_file, "test") {
                Ok(_) => {
                    let _ = fs::remove_file(&test_file);
                    Ok(Permission {
                        id: "desktop".to_string(),
                        name: "Desktop Folder Access".to_string(),
                        description: "Required to manage and sync desktop files and configurations"
                            .to_string(),
                        required: true,
                        can_request_programmatically: true,
                        status: PermissionStatus::Granted,
                        instructions: None,
                    })
                }
                Err(_) => Ok(Permission {
                    id: "desktop".to_string(),
                    name: "Desktop Folder Access".to_string(),
                    description: "Required to manage and sync desktop files and configurations"
                        .to_string(),
                    required: true,
                    can_request_programmatically: true,
                    status: PermissionStatus::Denied,
                    instructions: None,
                }),
            }
        }
        "documents" => {
            // Try to create a temp file in Documents to trigger the permission prompt
            let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home directory"))?;
            let documents = home.join("Documents");
            let test_file = documents.join(".nixmac-permission-test");

            // Try to create and immediately delete a test file
            match fs::write(&test_file, "test") {
                Ok(_) => {
                    let _ = fs::remove_file(&test_file);
                    Ok(Permission {
                        id: "documents".to_string(),
                        name: "Documents Folder Access".to_string(),
                        description:
                            "Required to access and manage configuration files stored in Documents"
                                .to_string(),
                        required: true,
                        can_request_programmatically: true,
                        status: PermissionStatus::Granted,
                        instructions: None,
                    })
                }
                Err(_) => Ok(Permission {
                    id: "documents".to_string(),
                    name: "Documents Folder Access".to_string(),
                    description:
                        "Required to access and manage configuration files stored in Documents"
                            .to_string(),
                    required: true,
                    can_request_programmatically: true,
                    status: PermissionStatus::Denied,
                    instructions: None,
                }),
            }
        }
        "admin" => {
            // Can't request this programmatically, just re-check status
            Ok(Permission {
                id: "admin".to_string(),
                name: "Administrator Privileges".to_string(),
                description: "Required to install system packages and modify system configurations"
                    .to_string(),
                required: true,
                can_request_programmatically: false,
                status: check_admin_privileges(),
                instructions: Some(
                    "You will be prompted for your password when needed".to_string(),
                ),
            })
        }
        "full-disk" => {
            // Open System Settings to FDA page
            let _ = Command::new("open")
                .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
                .spawn();

            // Re-check the status
            Ok(Permission {
                id: "full-disk".to_string(),
                name: "Full Disk Access".to_string(),
                description: "Required for darwin-rebuild to apply system changes".to_string(),
                required: false,
                can_request_programmatically: false,
                status: check_full_disk_access(),
                instructions: Some(
                    "Go to System Settings → Privacy & Security → Full Disk Access, then add nixmac to the list"
                        .to_string(),
                ),
            })
        }
        _ => Err(anyhow::anyhow!("Unknown permission: {}", permission_id)),
    }
}

/// Check if all required permissions are granted
pub fn all_required_permissions_granted() -> bool {
    let state: PermissionsState = check_all_permissions();
    state.all_required_granted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_desktop_access() {
        let status = check_desktop_access();
        // Should return some valid status
        assert!(matches!(
            status,
            PermissionStatus::Granted | PermissionStatus::Denied | PermissionStatus::Unknown
        ));
    }

    #[test]
    fn test_check_admin_privileges() {
        let status = check_admin_privileges();
        // Should return some valid status
        assert!(matches!(
            status,
            PermissionStatus::Granted | PermissionStatus::Denied | PermissionStatus::Unknown
        ));
    }

    #[test]
    fn test_check_all_permissions() {
        let state = check_all_permissions();
        assert_eq!(state.permissions.len(), 4);
        assert!(state.checked_at.is_some());
    }
}
