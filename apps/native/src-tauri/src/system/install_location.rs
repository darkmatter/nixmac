//! Detect whether nixmac is running from a `.app` bundle in `/Applications`.
//!
//! macOS TCC services (notably Full Disk Access) key off the bundle's identity
//! and location. An app launched from the mounted DMG (`/Volumes/nixmac/nixmac.app`)
//! or from a random download folder will not match the TCC entry created for the
//! `/Applications` copy, so grants silently fail to take effect. The FDA
//! permission row already tells users to "make sure nixmac is in your
//! Applications folder"; this module lets the UI detect that condition
//! proactively instead of relying on the user reading the instructions.
//!
//! On non-macOS targets every call reports `NotRunningFromBundle`.

#[cfg(target_os = "macos")]
use std::path::PathBuf;

use crate::shared_types::InstallLocationState;

/// Walk up from the current executable to the enclosing `.app` bundle, if any.
#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(std::path::Path::to_path_buf)
}

/// Canonicalize both sides so symlinks (e.g. `/Applications` itself, or a
/// trailing `/` in a copied path) don't cause a false mismatch.
#[cfg(target_os = "macos")]
fn same_path(a: &std::path::Path, b: &std::path::Path) -> bool {
    let canon = |p: &std::path::Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

/// Inspect the running app's install location.
pub fn check_install_location() -> InstallLocationState {
    #[cfg(target_os = "macos")]
    {
        let Some(bundle) = current_app_bundle() else {
            return InstallLocationState {
                in_applications_dir: false,
                bundle_path: None,
            };
        };

        let in_applications_dir = bundle
            .parent()
            .is_some_and(|parent| same_path(parent, std::path::Path::new("/Applications")));

        InstallLocationState {
            in_applications_dir,
            bundle_path: Some(bundle.to_string_lossy().into_owned()),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        InstallLocationState {
            in_applications_dir: false,
            bundle_path: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_install_location_returns_a_state() {
        // We can't assert a specific value here — it depends on where the test
        // binary is running from — but the call must not panic and must return
        // a consistent bundle_path/in_applications_dir pairing: when there is
        // no bundle, bundle_path is None.
        let state = check_install_location();
        if state.bundle_path.is_none() {
            assert!(!state.in_applications_dir);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn same_path_handles_missing_canonicalization() {
        // `/Applications` exists on macOS CI runners; canonicalize both sides
        // and confirm the helper agrees. If /Applications is absent (very
        // unlikely), this still exercises the fallback branch.
        let a = std::path::Path::new("/Applications");
        assert!(same_path(a, a));
    }
}
