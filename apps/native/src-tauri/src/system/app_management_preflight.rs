//! Proactive App Management detection before activation.
//!
//! Home Manager's `targets.darwin.copyApps` activation checks whether existing
//! managed `.app` bundles can be updated by touching `.DS_Store` inside each
//! bundle. macOS gates that operation behind App Management
//! (`SystemPolicyAppBundles`). Running the same harmless probe before the admin
//! activation step lets nixmac stop with structured guidance before prompting
//! for elevated privileges.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use crate::shared_types::{
    AppManagementCheckResult, AppManagementPermissionTarget, AppManagementProbeFailure,
};
use crate::system::nix::{self, NixHomeManagerCopyAppsEntry};

/// Check whether Home Manager copyApps activation can update existing app
/// bundles without hitting macOS App Management denial.
pub fn check_app_management(config_dir: &str, host_attr: &str) -> Result<AppManagementCheckResult> {
    let entries = nix::get_nix_home_manager_copy_apps_entries(host_attr, config_dir)?;
    Ok(check_copy_apps_entries(&entries))
}

pub fn check_copy_apps_entries(
    entries: &[NixHomeManagerCopyAppsEntry],
) -> AppManagementCheckResult {
    let mut targets = Vec::new();
    let mut failures = Vec::new();
    let mut checked = 0usize;

    for entry in entries {
        let target_dir = copy_apps_target_dir(entry);
        let app_bundles = app_bundles_in_target_dir(&target_dir);
        checked += app_bundles.len();

        if !app_bundles.is_empty() {
            targets.push(AppManagementPermissionTarget {
                user: entry.user.clone(),
                directory: target_dir.to_string_lossy().into_owned(),
                app_bundles: app_bundles
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            });
        }

        for app_bundle in app_bundles {
            if let Err(error) = probe_app_bundle(&app_bundle) {
                failures.push(AppManagementProbeFailure {
                    user: entry.user.clone(),
                    app_bundle: app_bundle.to_string_lossy().into_owned(),
                    error: error.to_string(),
                });
            }
        }
    }

    AppManagementCheckResult {
        ok: failures.is_empty(),
        checked,
        targets,
        failures,
    }
}

fn copy_apps_target_dir(entry: &NixHomeManagerCopyAppsEntry) -> PathBuf {
    let directory = Path::new(&entry.directory);
    if directory.is_absolute() {
        directory.to_path_buf()
    } else {
        Path::new(&entry.home_directory).join(directory)
    }
}

fn app_bundles_in_target_dir(target_dir: &Path) -> Vec<PathBuf> {
    // Home Manager intentionally skips the App Management probe while migrating
    // from linkApps when the target directory itself is a symlink.
    if fs::symlink_metadata(target_dir)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Vec::new();
    }

    let Ok(entries) = fs::read_dir(target_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("app")
                && fs::metadata(path)
                    .map(|metadata| metadata.is_dir())
                    .unwrap_or(false)
        })
        .collect()
}

fn probe_app_bundle(app_bundle: &Path) -> Result<()> {
    let probe_path = app_bundle.join(".DS_Store");
    let output = Command::new("/usr/bin/touch")
        .arg(&probe_path)
        .output()
        .with_context(|| format!("failed to run /usr/bin/touch for {}", probe_path.display()))?;
    if !output.status.success() {
        bail!(
            "/usr/bin/touch failed for {}: {}",
            probe_path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(home_directory: &Path, directory: &str) -> NixHomeManagerCopyAppsEntry {
        NixHomeManagerCopyAppsEntry {
            user: "alice".to_string(),
            home_directory: home_directory.display().to_string(),
            directory: directory.to_string(),
        }
    }

    #[test]
    fn clear_when_copy_apps_target_has_no_existing_apps() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result =
            check_copy_apps_entries(&[entry(dir.path(), "Applications/Home Manager Apps")]);

        assert!(result.ok);
        assert_eq!(result.checked, 0);
        assert!(result.targets.is_empty());
        assert!(result.failures.is_empty());
    }

    #[test]
    fn probes_existing_app_bundles_under_target_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_dir = dir
            .path()
            .join("Applications/Home Manager Apps/Example.app");
        fs::create_dir_all(&app_dir).expect("app dir");

        let result =
            check_copy_apps_entries(&[entry(dir.path(), "Applications/Home Manager Apps")]);

        assert!(result.ok);
        assert_eq!(result.checked, 1);
        assert_eq!(result.targets.len(), 1);
        assert_eq!(result.targets[0].app_bundles.len(), 1);
        assert!(app_dir.join(".DS_Store").exists());
    }

    #[cfg(unix)]
    #[test]
    fn reports_unwritable_existing_app_bundle_as_failure() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let app_dir = dir
            .path()
            .join("Applications/Home Manager Apps/Example.app");
        fs::create_dir_all(&app_dir).expect("app dir");
        let mut permissions = fs::metadata(&app_dir).expect("metadata").permissions();
        permissions.set_mode(0o555);
        fs::set_permissions(&app_dir, permissions).expect("make app dir read-only");

        let result =
            check_copy_apps_entries(&[entry(dir.path(), "Applications/Home Manager Apps")]);

        let mut permissions = fs::metadata(&app_dir).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&app_dir, permissions).expect("restore permissions");

        assert!(!result.ok);
        assert_eq!(result.checked, 1);
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].app_bundle.ends_with("Example.app"));
    }
}
