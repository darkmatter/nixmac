// Build out-link management for the apply pipeline.
//
// `nix build` needs an out-link so the built system closure stays GC-rooted
// between the build finishing and activation setting the durable system
// profile root (`nix-env -p /nix/var/nix/profiles/system --set`). The link
// lives in the nixmac app-support directory — never in the user's config
// (flake) directory — and is deleted as soon as activation succeeds so it
// never pins an old closure.
//
// Plain `//` comments (not `//!`): this file is also compiled into the
// `nixmac-sync-agent` binary via `include!`, where inner doc comments are
// invalid. For the same reason it must not reference `crate::` paths.

use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};

/// Out-link name for interactive applies from the app.
pub const APPLY_OUT_LINK_NAME: &str = "apply-result";
/// Out-link name for unattended applies from the sync agent. Distinct from the
/// interactive name so the two can't clobber each other's GC pin.
/// Only referenced by the `nixmac-sync-agent` binary, which `include!`s this
/// file rather than linking the crate — hence dead to the app itself.
#[allow(dead_code)]
pub const SYNC_OUT_LINK_NAME: &str = "sync-result";

/// Returns the app-support directory holding build out-links.
///
/// Uses `dirs::data_local_dir()`, which resolves per-platform (macOS:
/// `~/Library/Application Support/`, Linux: `~/.local/share/`).
fn out_link_base_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nixmac")
}

/// Ensures the out-link directory exists and returns the link path for `name`.
pub fn prepare_out_link(name: &str) -> Result<PathBuf> {
    prepare_out_link_in(&out_link_base_dir(), name)
}

fn prepare_out_link_in(base_dir: &Path, name: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(base_dir)
        .with_context(|| format!("failed to create out-link directory {}", base_dir.display()))?;
    Ok(base_dir.join(name))
}

/// Resolves the out-link to the built system's store path.
///
/// Activation uses this resolved path directly (never re-reading the link),
/// so a concurrent apply redirecting the link cannot change what gets
/// activated.
pub fn resolve_out_link(link: &Path) -> Result<PathBuf> {
    let target = std::fs::read_link(link)
        .with_context(|| format!("failed to read build out-link {}", link.display()))?;
    if !target.starts_with("/nix/store") {
        bail!(
            "build out-link {} points outside /nix/store: {}",
            link.display(),
            target.display()
        );
    }
    Ok(target)
}

/// Best-effort removal of the out-link once it's no longer needed as a GC
/// root. Only ever removes a symlink; failure is not worth failing an apply
/// that already activated.
pub fn cleanup_out_link(link: &Path) {
    let is_symlink = link
        .symlink_metadata()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    if is_symlink {
        let _ = std::fs::remove_file(link);
    }
}

/// Removes the `result` symlink that pre-out-link versions of nixmac left in
/// the user's config directory. Only a symlink pointing into /nix/store is
/// touched — a regular file or directory named `result` is the user's.
pub fn remove_legacy_result_link(config_dir: &str) {
    let link = Path::new(config_dir).join("result");
    let Ok(meta) = link.symlink_metadata() else {
        return;
    };
    if !meta.file_type().is_symlink() {
        return;
    }
    let points_into_store = std::fs::read_link(&link)
        .map(|target| target.starts_with("/nix/store"))
        .unwrap_or(false);
    if points_into_store {
        let _ = std::fs::remove_file(&link);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn prepare_out_link_creates_base_dir_and_returns_link_path() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("nested").join("nixmac");
        let link = prepare_out_link_in(&base, APPLY_OUT_LINK_NAME).unwrap();
        assert!(base.is_dir());
        assert_eq!(link, base.join("apply-result"));
    }

    #[test]
    fn resolve_out_link_returns_store_target() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("apply-result");
        symlink("/nix/store/abc123-darwin-system", &link).unwrap();
        assert_eq!(
            resolve_out_link(&link).unwrap(),
            PathBuf::from("/nix/store/abc123-darwin-system")
        );
    }

    #[test]
    fn resolve_out_link_rejects_non_store_target() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("apply-result");
        symlink("/tmp/not-a-store-path", &link).unwrap();
        assert!(resolve_out_link(&link).is_err());
    }

    #[test]
    fn resolve_out_link_errors_when_link_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_out_link(&tmp.path().join("apply-result")).is_err());
    }

    #[test]
    fn cleanup_out_link_removes_dangling_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("apply-result");
        symlink("/nix/store/abc123-darwin-system", &link).unwrap();
        cleanup_out_link(&link);
        assert!(link.symlink_metadata().is_err());
    }

    #[test]
    fn cleanup_out_link_leaves_regular_files_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("apply-result");
        std::fs::write(&path, "not a link").unwrap();
        cleanup_out_link(&path);
        assert!(path.exists());
    }

    #[test]
    fn remove_legacy_result_link_removes_store_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("result");
        symlink("/nix/store/abc123-darwin-system", &link).unwrap();
        remove_legacy_result_link(tmp.path().to_str().unwrap());
        assert!(link.symlink_metadata().is_err());
    }

    #[test]
    fn remove_legacy_result_link_leaves_non_store_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("result");
        symlink("/somewhere/else", &link).unwrap();
        remove_legacy_result_link(tmp.path().to_str().unwrap());
        assert!(link.symlink_metadata().is_ok());
    }

    #[test]
    fn remove_legacy_result_link_leaves_regular_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("result");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("data"), "user file").unwrap();
        remove_legacy_result_link(tmp.path().to_str().unwrap());
        assert!(dir.is_dir());
    }
}
