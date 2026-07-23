//! macOS permission checking for nixmac.
//!
//! This module provides functionality to check and request various
//! macOS permissions required for proper operation of nix-darwin.
//!
//! Permissions checked:
//! - Desktop folder access
//! - Documents folder access
//! - Full Disk Access (FDA) - required for darwin-rebuild over SSH
//! - App Management - recommended so activation can update managed apps
//! - Administrator privileges (sudo access)

pub(crate) use crate::shared_types::{Permission, PermissionStatus, PermissionsState};
use anyhow::Result;
use log::{debug, info, warn};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

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
    // If NIXMAC_SKIP_PERMISSIONS is set, we skip all permission checks and report everything as granted.
    let mut default_status = PermissionStatus::Pending;
    if e2e_skip_permissions_enabled() {
        info!("NIXMAC_SKIP_PERMISSIONS=1: reporting all permissions as granted");
        default_status = PermissionStatus::Granted;
    }

    vec![
        Permission {
            id: "desktop".to_string(),
            name: "Desktop Folder Access".to_string(),
            description: "Required to manage and sync desktop files and configurations".to_string(),
            required: true,
            can_request_programmatically: true,
            status: default_status,
            instructions: None,
        },
        Permission {
            id: "documents".to_string(),
            name: "Documents Folder Access".to_string(),
            description: "Required to access and manage configuration files stored in Documents"
                .to_string(),
            required: true,
            can_request_programmatically: true,
            status: default_status,
            instructions: None,
        },
        Permission {
            id: "admin".to_string(),
            name: "Administrator Privileges".to_string(),
            description: "Required to install system packages and modify system configurations"
                .to_string(),
            required: true,
            can_request_programmatically: false,
            status: default_status,
            instructions: Some("You will be prompted for your password when needed".to_string()),
        },
        Permission {
            id: "full-disk".to_string(),
            name: "Full Disk Access".to_string(),
            description: "Required for darwin-rebuild to apply system changes".to_string(),
            required: true,
            can_request_programmatically: false,
            status: default_status,
            instructions: Some(
                "First make sure nixmac is in your Applications folder (not running from the install disk image). Then go to System Settings → Privacy & Security → Full Disk Access and add nixmac to the list."
                    .to_string(),
            ),
        },
        app_management_permission(PermissionStatus::Pending),
        privileged_helper_permission(
            default_status,
            "Enable this once per device to allow nixmac to activate already-built system generations unattended.",
        ),
    ]
}

#[cfg(debug_assertions)]
fn e2e_skip_permissions_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_SKIP_PERMISSIONS")
}

#[cfg(debug_assertions)]
fn vite_skip_permissions_enabled() -> bool {
    crate::env::vite_skip_permissions()
}

#[cfg(not(debug_assertions))]
fn e2e_skip_permissions_enabled() -> bool {
    false
}

#[cfg(not(debug_assertions))]
fn vite_skip_permissions_enabled() -> bool {
    false
}

fn skip_permissions_enabled() -> bool {
    vite_skip_permissions_enabled() || e2e_skip_permissions_enabled()
}

fn granted_permissions_state() -> PermissionsState {
    let mut permissions = get_default_permissions();
    for perm in &mut permissions {
        perm.status = PermissionStatus::Granted;
        // Granted here is a debug-build fiction, not a probe result; say so
        // instead of letting the row imply the real thing was verified.
        perm.instructions = Some(
            "Check skipped: this build has VITE_NIXMAC_SKIP_PERMISSIONS enabled, so the real status was not probed."
                .to_string(),
        );
    }
    PermissionsState {
        permissions,
        all_required_granted: true,
        checked_at: Some(chrono::Utc::now().timestamp()),
    }
}

fn granted_folder_permission(id: &str, name: &str, description: &str) -> Permission {
    Permission {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        required: true,
        can_request_programmatically: true,
        status: PermissionStatus::Granted,
        instructions: None,
    }
}

fn privileged_helper_permission(status: PermissionStatus, instructions: &str) -> Permission {
    Permission {
        id: "privileged-helper".to_string(),
        name: "Unattended Sync Helper".to_string(),
        description:
            "Required for unattended device sync to activate builds without a password prompt"
                .to_string(),
        required: true,
        can_request_programmatically: true,
        status,
        instructions: Some(instructions.to_string()),
    }
}

/// App Management (`kTCCServiceSystemPolicyAppBundles`).
///
/// macOS gates modifying another app's signed bundle behind this permission.
/// nix-darwin / home-manager activation trips it whenever it links or copies
/// macOS apps into `/Applications` (e.g. `targets.darwin.copyApps`,
/// `homebrew` casks, or any `system.activationScripts.applications` step), so
/// a build that manages apps fails with the "updating apps over SSH" error
/// without it.
///
/// It is `required: false` (Recommended) on purpose:
/// 1. macOS exposes no public API to probe this service, and the bundled
///    `tauri-plugin-macos-permissions` (2.3.0) has no App Management command,
///    so we cannot reliably observe it being granted. Marking it required
///    would make `all_required_granted` impossible to satisfy and deadlock
///    the onboarding permissions gate forever.
/// 2. Full Disk Access may cover the underlying bundle-modification operation,
///    but the App Management row describes the explicit App Management TCC
///    service. Inferring this row from FDA makes the permissions screen report
///    a false grant.
fn app_management_permission(status: PermissionStatus) -> Permission {
    Permission {
        id: "app-management".to_string(),
        name: "App Management".to_string(),
        description:
            "Recommended so darwin-rebuild can update apps it manages (e.g. linking apps into /Applications)"
                .to_string(),
        required: false,
        can_request_programmatically: false,
        status,
        instructions: Some(
            "Open System Settings → Privacy & Security → App Management and enable nixmac. macOS does not expose a reliable way for nixmac to verify this grant."
                .to_string(),
        ),
    }
}

/// Check if we have access to the Desktop folder
fn check_desktop_access() -> PermissionStatus {
    if e2e_skip_permissions_enabled() {
        return PermissionStatus::Granted;
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return PermissionStatus::Unknown,
    };

    let desktop = home.join("Desktop");
    check_folder_access(&desktop)
}

/// Check if we have access to the Documents folder
fn check_documents_access() -> PermissionStatus {
    if e2e_skip_permissions_enabled() {
        return PermissionStatus::Granted;
    }

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

/// Check if we have Full Disk Access.
///
/// Probes several TCC-gated paths. A successful read on any one is proof of
/// FDA. A PermissionDenied on any one is proof of the opposite — even if the
/// user has nixmac listed and toggled on in System Settings, a stale TCC
/// entry (e.g. codesign requirement mismatch after an update-in-place) can
/// leave the grant silently inactive, and reads will fail with
/// PermissionDenied. Only if every probe path is missing (NotFound) do we
/// fall back to Pending.
fn check_full_disk_access() -> PermissionStatus {
    if vite_skip_permissions_enabled() {
        debug!("VITE_NIXMAC_SKIP_PERMISSIONS is set, assuming Full Disk Access granted");
        return PermissionStatus::Granted;
    }
    if e2e_skip_permissions_enabled() {
        debug!("E2E permission skip enabled, assuming Full Disk Access granted");
        return PermissionStatus::Granted;
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return PermissionStatus::Unknown,
    };

    // (path, is_dir). Ordered by how reliably the path exists on a typical
    // macOS install. The Safari probes match what tauri-plugin-macos-permissions
    // checks so our result stays consistent with the JS plugin.
    let probes: [(PathBuf, bool); 5] = [
        (home.join("Library/Safari/Bookmarks.plist"), false),
        (home.join("Library/Safari"), true),
        (home.join("Library/Containers/com.apple.stocks"), true),
        (home.join("Library/Mail"), true),
        (
            PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db"),
            false,
        ),
    ];

    let mut saw_denied = false;
    for (path, is_dir) in &probes {
        let result = if *is_dir {
            fs::read_dir(path).map(|_| ())
        } else {
            fs::metadata(path).map(|_| ())
        };
        match result {
            Ok(_) => {
                debug!("Full Disk Access granted (probe succeeded: {:?})", path);
                return PermissionStatus::Granted;
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                debug!("Full Disk Access denied (probe blocked: {:?})", path);
                saw_denied = true;
            }
            Err(_) => {}
        }
    }

    if saw_denied {
        PermissionStatus::Denied
    } else {
        debug!("Full Disk Access check inconclusive — no probe path existed");
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
    // Debug/test environments may not have TCC permissions granted and cannot
    // obtain them programmatically, so the skip flags satisfy the whole gate.
    if skip_permissions_enabled() {
        info!("permission skip enabled: reporting all permissions as granted");
        return granted_permissions_state();
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
            "app-management" => check_app_management(),
            "privileged-helper" => {
                let (status, detail) = check_privileged_helper();
                // Keep the default instructions when healthy; surface what is
                // actually wrong otherwise.
                if let Some(detail) = detail {
                    perm.instructions = Some(detail);
                }
                status
            }
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
            if e2e_skip_permissions_enabled() {
                return Ok(granted_folder_permission(
                    "desktop",
                    "Desktop Folder Access",
                    "Required to manage and sync desktop files and configurations",
                ));
            }
            // Try to create a temp file in Desktop to trigger the permission prompt
            let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home directory"))?;
            let desktop = home.join("Desktop");
            let test_file = desktop.join(".nixmac-permission-test");

            // Try to create and immediately delete a test file
            match fs::write(&test_file, "test") {
                Ok(_) => {
                    // fire-and-forget: cleanup of the permission-probe temp file; benign if gone.
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
            if e2e_skip_permissions_enabled() {
                return Ok(granted_folder_permission(
                    "documents",
                    "Documents Folder Access",
                    "Required to access and manage configuration files stored in Documents",
                ));
            }
            // Try to create a temp file in Documents to trigger the permission prompt
            let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home directory"))?;
            let documents = home.join("Documents");
            let test_file = documents.join(".nixmac-permission-test");

            // Try to create and immediately delete a test file
            match fs::write(&test_file, "test") {
                Ok(_) => {
                    // fire-and-forget: cleanup of permission-probe temp file; benign if gone.
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
            // Open System Settings to FDA page.
            // fire-and-forget: `open` spawn; failure (e.g. open not in PATH) is not
            // actionable here — we fall through and re-check the status below.
            let _ = Command::new("open")
                .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
                .spawn();

            // Re-check the status
            Ok(Permission {
                id: "full-disk".to_string(),
                name: "Full Disk Access".to_string(),
                description: "Required for darwin-rebuild to apply system changes".to_string(),
                required: true,
                can_request_programmatically: false,
                status: check_full_disk_access(),
                instructions: Some(
                    "First make sure nixmac is in your Applications folder (not running from the install disk image). Then go to System Settings → Privacy & Security → Full Disk Access and add nixmac to the list."
                        .to_string(),
                ),
            })
        }
        "app-management" => {
            // Deep-link to the App Management privacy pane. macOS cannot grant
            // this programmatically, so we mirror the Full Disk Access flow:
            // open the exact Settings anchor and re-probe afterwards.
            // fire-and-forget: `open` spawn failure is not actionable here.
            let _ = Command::new("open")
                .args([
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles",
                ])
                .spawn();

            Ok(app_management_permission(check_app_management()))
        }
        "privileged-helper" => {
            // SMAppService registration requires the helper binary and its
            // LaunchDaemon plist to be embedded inside the .app bundle
            // (Contents/MacOS/nixmac-helper and
            // Contents/Library/LaunchDaemons/com.darkmatter.nixmac.helper.plist).
            // Those assets are only staged by `bun run desktop:build[:local]`
            // (externalBin in package.json). Under `tauri dev` the app runs as
            // a bare binary from target/debug with no bundle, so
            // registerAndReturnError: fails with an opaque "Operation not
            // permitted". Detect that up front and surface a clear Pending
            // state instead of propagating the OS error to the UI.
            let bundle_present = crate::system::install_location::check_install_location()
                .bundle_path
                .is_some();

            const APPROVE_INSTRUCTIONS: &str = "Approve nixmac in System Settings → General → Login Items & Extensions if macOS asks for background item approval.";

            let (status, instructions) = if !bundle_present {
                warn!(
                    "privileged helper registration skipped: nixmac is not running from a .app bundle"
                );
                (
                    PermissionStatus::Pending,
                    "Build a signed .app with `bun run desktop:build:local`, drag it into /Applications, and launch it from there to install the unattended sync helper. It cannot be installed from a dev build."
                        .to_string(),
                )
            } else {
                match crate::privileged_helper::service::register() {
                    // Registration alone is not a working helper: wait briefly
                    // for the freshly launched daemon to answer a status
                    // round-trip before reporting Granted.
                    Ok(status) if status.authorized => match await_helper_ready() {
                        Ok(()) => (PermissionStatus::Granted, APPROVE_INSTRUCTIONS.to_string()),
                        Err(error) => (
                            PermissionStatus::Pending,
                            format!(
                                "The helper is registered but did not answer a status probe: {error:#}."
                            ),
                        ),
                    },
                    Ok(_) => {
                        crate::privileged_helper::service::open_login_items_settings();
                        (PermissionStatus::Pending, APPROVE_INSTRUCTIONS.to_string())
                    }
                    Err(error) => {
                        warn!("privileged helper registration failed: {error:#}");
                        crate::privileged_helper::service::open_login_items_settings();
                        (PermissionStatus::Pending, APPROVE_INSTRUCTIONS.to_string())
                    }
                }
            };
            Ok(privileged_helper_permission(status, &instructions))
        }
        _ => Err(anyhow::anyhow!("Unknown permission: {}", permission_id)),
    }
}

/// Wait for a freshly registered helper daemon to come up and answer a
/// status round-trip. launchd starts it asynchronously after approval, so the
/// socket appears a moment after `register()` returns.
fn await_helper_ready() -> Result<()> {
    const ATTEMPTS: u32 = 10;
    const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(300);

    let mut last_error = anyhow::anyhow!("helper socket never appeared");
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(RETRY_DELAY);
        }
        if !crate::privileged_helper::client::socket_available() {
            continue;
        }
        match crate::privileged_helper::client::status() {
            Ok(response) if response.ok => return Ok(()),
            Ok(response) => {
                last_error = anyhow::anyhow!(
                    response
                        .error
                        .unwrap_or_else(|| "helper returned an error".to_string())
                );
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

/// Status of the unattended sync helper, with a detail message when it is
/// not fully working.
///
/// `SMAppService` registration alone is not proof of a working helper: the
/// approval persists in the BackgroundTaskManagement database even after the
/// helper binary is gone or replaced. Granted therefore additionally requires
/// a live status round-trip through the socket, which also exercises both
/// code-signature checks (client validates the daemon, daemon validates this
/// client).
fn check_privileged_helper() -> (PermissionStatus, Option<String>) {
    let status = crate::privileged_helper::service::status();
    if !status.available {
        return (PermissionStatus::Unknown, status.detail);
    }
    if !status.authorized {
        return (PermissionStatus::Pending, None);
    }
    if !status.socket_available {
        return (
            PermissionStatus::Pending,
            Some(
                "The helper is approved in Login Items, but its daemon is not running (no socket). Use Grant to re-register it, or toggle nixmac off and on in System Settings → General → Login Items & Extensions."
                    .to_string(),
            ),
        );
    }
    match crate::privileged_helper::client::status() {
        Ok(response) if response.ok => (PermissionStatus::Granted, None),
        Ok(response) => (
            PermissionStatus::Pending,
            Some(format!(
                "The helper is running but refused this app: {}. Unattended sync will fall back to password prompts until a matching signed build talks to it.",
                response
                    .error
                    .unwrap_or_else(|| "unknown error".to_string())
            )),
        ),
        Err(error) => (
            PermissionStatus::Pending,
            Some(format!(
                "The helper is registered but did not answer a status probe: {error:#}."
            )),
        ),
    }
}

/// Best-effort App Management status.
///
/// macOS provides no public API to read `kTCCServiceSystemPolicyAppBundles`,
/// and the bundled permissions plugin has no command for it. Full Disk Access
/// can authorize the same underlying app-bundle updates, but it is a different
/// TCC service and does not mean App Management itself is granted. Keep this as
/// `Pending` so the UI never displays a false positive.
fn check_app_management() -> PermissionStatus {
    PermissionStatus::Pending
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(debug_assertions)]
    #[test]
    fn e2e_permission_skip_env_is_honored_in_debug_builds() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["NIXMAC_SKIP_PERMISSIONS"]);

        unsafe { std::env::set_var("NIXMAC_SKIP_PERMISSIONS", "true") };

        assert!(e2e_skip_permissions_enabled());
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn e2e_permission_skip_env_is_ignored_in_release_builds() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["NIXMAC_SKIP_PERMISSIONS"]);

        unsafe { std::env::set_var("NIXMAC_SKIP_PERMISSIONS", "true") };

        assert!(!e2e_skip_permissions_enabled());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn vite_permission_skip_env_is_honored_in_debug_builds() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["VITE_NIXMAC_SKIP_PERMISSIONS"]);

        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "true") };

        assert!(vite_skip_permissions_enabled());
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn vite_permission_skip_env_is_ignored_in_release_builds() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["VITE_NIXMAC_SKIP_PERMISSIONS"]);

        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "true") };

        assert!(!vite_skip_permissions_enabled());
    }

    #[test]
    fn app_management_is_present_and_recommended_not_required() {
        let perms = get_default_permissions();
        let app_mgmt = perms
            .iter()
            .find(|p| p.id == "app-management")
            .expect("app-management permission should be registered");

        // Recommended, not required: macOS exposes no reliable probe for App
        // Management, so requiring it would deadlock the onboarding gate
        // (all_required_granted could never become true).
        assert!(!app_mgmt.required);
        assert!(!app_mgmt.can_request_programmatically);

        // It must not count toward the required-permission gate.
        assert!(
            !perms
                .iter()
                .filter(|p| p.required)
                .any(|p| p.id == "app-management")
        );
    }

    #[test]
    fn app_management_is_not_inferred_from_full_disk_access() {
        assert_eq!(check_app_management(), PermissionStatus::Pending);
    }

    #[test]
    fn check_folder_access_returns_granted_for_existing_directory() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().to_path_buf();
        assert_eq!(check_folder_access(&path), PermissionStatus::Granted);
    }

    #[test]
    fn check_folder_access_treats_missing_directory_as_granted() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("does-not-exist");
        assert_eq!(check_folder_access(&path), PermissionStatus::Granted);
    }

    #[test]
    fn vite_permission_skip_requires_truthy_value() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["VITE_NIXMAC_SKIP_PERMISSIONS"]);

        // unset falls back to any value read from a config file, which means this particular
        // assertion is not stable, so commenting it out.
        //unsafe { std::env::remove_var("VITE_NIXMAC_SKIP_PERMISSIONS") };
        //assert!(!vite_skip_permissions_enabled());

        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "0") };
        assert!(!vite_skip_permissions_enabled());

        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "false") };
        assert!(!vite_skip_permissions_enabled());

        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "true") };
        assert_eq!(vite_skip_permissions_enabled(), cfg!(debug_assertions));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn vite_permission_skip_reports_all_permissions_granted() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            "NIXMAC_SKIP_PERMISSIONS",
            "VITE_NIXMAC_SKIP_PERMISSIONS",
        ]);

        unsafe { std::env::remove_var("NIXMAC_SKIP_PERMISSIONS") };
        unsafe { std::env::set_var("VITE_NIXMAC_SKIP_PERMISSIONS", "true") };

        let state = check_all_permissions();

        assert!(state.all_required_granted);
        assert!(
            state
                .permissions
                .iter()
                .all(|permission| permission.status == PermissionStatus::Granted)
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn nixmac_permission_skip_reports_all_permissions_granted() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            "NIXMAC_SKIP_PERMISSIONS",
            "VITE_NIXMAC_SKIP_PERMISSIONS",
        ]);

        unsafe { std::env::set_var("NIXMAC_SKIP_PERMISSIONS", "true") };
        unsafe { std::env::remove_var("VITE_NIXMAC_SKIP_PERMISSIONS") };

        let state = check_all_permissions();

        assert!(state.all_required_granted);
        assert!(
            state
                .permissions
                .iter()
                .all(|permission| permission.status == PermissionStatus::Granted)
        );
    }
}
