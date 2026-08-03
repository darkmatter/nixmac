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
//! The privileged helper's reconciliation reads the same judgment for a
//! stricter purpose: a copy running from anywhere else mutates no helper at
//! all. That is why the bundle path is resolved before it is compared, rather
//! than compared as observed.
//!
//! On non-macOS targets every call reports `NotRunningFromBundle`.

use std::path::{Path, PathBuf};

use crate::shared_types::InstallLocationState;

/// Where `/Applications` is, and nowhere else it may be.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const APPLICATIONS_DIR: &str = "/Applications";

/// Where this app runs from, judged against the one location that counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallLocation {
    /// A `.app` bundle whose real, symlink-resolved path sits directly in
    /// `/Applications`. The path is the resolved one.
    Canonical(PathBuf),
    /// Anywhere else, including not running from a bundle at all: a disk image,
    /// a download folder, a nested directory, a symlink into `/Applications`
    /// pointing elsewhere, or a translocated copy (macOS runs quarantined apps
    /// from a random read-only mount, whose path is never under
    /// `/Applications`). The path is what was observed, when there was one.
    Elsewhere(Option<PathBuf>),
}

/// Walk up from the current executable to the enclosing `.app` bundle, if any.
#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(std::path::Path::to_path_buf)
}

/// Where the running app is installed.
pub fn locate_app_bundle() -> InstallLocation {
    #[cfg(target_os = "macos")]
    {
        match current_app_bundle() {
            Some(bundle) => classify_bundle(&bundle, Path::new(APPLICATIONS_DIR)),
            None => InstallLocation::Elsewhere(None),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        InstallLocation::Elsewhere(None)
    }
}

/// Judges one bundle path against one applications directory.
///
/// The **bundle itself** is resolved first, not just its parent: a symlink at
/// `/Applications/nixmac.app` pointing into a home directory has `/Applications`
/// for a parent while the code that actually runs lives somewhere else
/// entirely, and the location this answers about is where the code is. Both
/// sides are resolved so the comparison survives `/Applications` itself being a
/// symlink and a trailing slash on either path.
///
/// A path that cannot be resolved is not canonical: this is the gate in front of
/// every helper mutation, so an unanswerable question is answered no.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn classify_bundle(bundle: &Path, applications: &Path) -> InstallLocation {
    let observed = || InstallLocation::Elsewhere(Some(bundle.to_path_buf()));
    let (Ok(resolved), Ok(applications)) = (
        std::fs::canonicalize(bundle),
        std::fs::canonicalize(applications),
    ) else {
        return observed();
    };
    if resolved.parent() == Some(applications.as_path()) {
        InstallLocation::Canonical(resolved)
    } else {
        observed()
    }
}

/// Inspect the running app's install location.
pub fn check_install_location() -> InstallLocationState {
    match locate_app_bundle() {
        InstallLocation::Canonical(bundle) => InstallLocationState {
            in_applications_dir: true,
            bundle_path: Some(bundle.to_string_lossy().into_owned()),
        },
        InstallLocation::Elsewhere(bundle) => InstallLocationState {
            in_applications_dir: false,
            bundle_path: bundle.map(|bundle| bundle.to_string_lossy().into_owned()),
        },
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

    /// A real directory named like a bundle, since the judgment resolves paths
    /// and a fake one would not resolve.
    fn bundle_in(parent: &Path) -> PathBuf {
        let bundle = parent.join("nixmac.app");
        std::fs::create_dir_all(&bundle).expect("bundle");
        bundle
    }

    #[test]
    fn a_bundle_directly_in_the_applications_directory_is_canonical() {
        let directory = tempfile::tempdir().expect("temp dir");
        let applications = directory.path().join("Applications");
        let bundle = bundle_in(&applications);

        assert_eq!(
            classify_bundle(&bundle, &applications),
            InstallLocation::Canonical(
                std::fs::canonicalize(&bundle).expect("the bundle resolves")
            )
        );
    }

    #[test]
    fn a_symlink_in_the_applications_directory_is_not_canonical() {
        // The case a parent-only comparison passes: `/Applications/nixmac.app`
        // is the parent's child, but the code behind it runs from elsewhere, so
        // it is not installed in `/Applications` — and under the helper's
        // reconciliation it may mutate nothing.
        let directory = tempfile::tempdir().expect("temp dir");
        let applications = directory.path().join("Applications");
        std::fs::create_dir_all(&applications).expect("applications");
        let elsewhere = bundle_in(&directory.path().join("Downloads"));
        let link = applications.join("nixmac.app");
        std::os::unix::fs::symlink(&elsewhere, &link).expect("symlink");

        assert_eq!(
            classify_bundle(&link, &applications),
            InstallLocation::Elsewhere(Some(link))
        );
    }

    #[test]
    fn a_bundle_anywhere_else_is_not_canonical() {
        // A disk image, a download folder, a nested copy, a translocated
        // read-only mount: all of them differ from the applications directory
        // in exactly this way, and the report carries the path the user can be
        // told about.
        let directory = tempfile::tempdir().expect("temp dir");
        let applications = directory.path().join("Applications");
        std::fs::create_dir_all(&applications).expect("applications");

        for parent in [
            directory.path().join("Volumes").join("nixmac"),
            directory.path().join("Downloads"),
            applications.join("Utilities"),
        ] {
            let bundle = bundle_in(&parent);

            assert_eq!(
                classify_bundle(&bundle, &applications),
                InstallLocation::Elsewhere(Some(bundle))
            );
        }
    }

    #[test]
    fn a_path_that_cannot_be_resolved_is_not_canonical() {
        // The gate in front of every helper mutation: a question that cannot be
        // answered is answered no.
        let directory = tempfile::tempdir().expect("temp dir");
        let applications = directory.path().join("Applications");
        let absent = applications.join("nixmac.app");

        assert_eq!(
            classify_bundle(&absent, &applications),
            InstallLocation::Elsewhere(Some(absent))
        );
    }
}
