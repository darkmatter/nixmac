//! Proactive managed-file clobber detection before activation.
//!
//! nix-darwin refuses to overwrite a managed `/etc` file unless it is already a
//! symlink into `/etc/static` or its content hash is in that entry's
//! `knownSha256Hashes`. When neither holds, activation aborts with
//! "Unexpected files in /etc". That check normally runs *as root during
//! activation* — i.e. after we've already prompted for admin rights — so a
//! failure surfaces late and only as log text.
//!
//! Home Manager's managed files use a similar pre-activation collision check,
//! but `backupFileExtension` makes collisions non-blocking by moving existing
//! targets aside before linking the generated files. We surface those paths as
//! warnings so users can review what activation will back up.
//!
//! References (pinned): nix-darwin `modules/system/etc.nix`,
//! `system.activationScripts.checks`; Home Manager dotfiles collision handling.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use crate::shared_types::{
    EtcClobberCheckResult, EtcClobberConflict, EtcClobberConflictKind, ManagedFileRoot,
    ManagedFileWarning,
};
use crate::system::nix::{self, NixEnvironmentEtcEntry, NixHomeManagerXdgConfigFileEntry};

/// Check the current filesystem for managed paths that activation may clobber.
pub fn check_etc_clobber(config_dir: &str, host_attr: &str) -> Result<EtcClobberCheckResult> {
    let etc_entries = nix::get_nix_environment_etc_entries(host_attr, config_dir)?;
    let xdg_config_entries =
        nix::get_nix_home_manager_xdg_config_file_entries(host_attr, config_dir)?;
    Ok(check_entries_for_clobber(
        &etc_entries,
        &xdg_config_entries,
        Path::new("/etc"),
        Path::new("/etc/static"),
    ))
}

fn check_entries_for_clobber(
    etc_entries: &[NixEnvironmentEtcEntry],
    xdg_config_entries: &[NixHomeManagerXdgConfigFileEntry],
    etc_root: &Path,
    static_root: &Path,
) -> EtcClobberCheckResult {
    let conflicts = etc_entries
        .iter()
        .filter_map(|entry| inspect_etc_entry_for_conflict(entry, etc_root, static_root))
        .collect::<Vec<_>>();

    let warnings = xdg_config_entries
        .iter()
        .filter_map(inspect_xdg_config_entry_for_warning)
        .collect::<Vec<_>>();

    EtcClobberCheckResult {
        ok: conflicts.is_empty(),
        checked: etc_entries.len() + xdg_config_entries.len(),
        conflicts,
        warnings,
    }
}

fn inspect_etc_entry_for_conflict(
    entry: &NixEnvironmentEtcEntry,
    etc_root: &Path,
    static_root: &Path,
) -> Option<EtcClobberConflict> {
    let etc_path = join_target(etc_root, &entry.target);
    let expected_static_path = join_target(static_root, &entry.target);

    // `std::fs::metadata` intentionally follows symlinks, matching
    // nix-darwin's `[[ -e $etcFile ]]` and `[[ -f $(readlink -f "$etcFile") ]]`.
    // A broken symlink therefore behaves like nix-darwin's `-e`: it does not
    // count as an existing clobber target.
    let metadata = match std::fs::metadata(&etc_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => {
            return Some(etc_conflict(
                entry,
                &etc_path,
                &expected_static_path,
                EtcClobberConflictKind::Unreadable,
            ));
        }
    };

    // nix-darwin only treats the exact one-hop symlink target as adopted. Do
    // not canonicalize here: a relative symlink or a link to a different store
    // path should be treated the same way nix-darwin's plain `readlink` treats it.
    let current_link_target = std::fs::read_link(&etc_path).ok();
    if current_link_target.as_deref() == Some(expected_static_path.as_path()) {
        return None;
    }

    if metadata.is_file() {
        // Secrets and externally generated files usually have no known hashes.
        // nix-darwin would reject them no matter what their content is, so avoid
        // reading the file at all; this prevents accidentally touching sensitive
        // material such as `/etc/nix/github-token.conf`.
        if entry.known_sha256_hashes.is_empty() {
            return Some(etc_conflict(
                entry,
                &etc_path,
                &expected_static_path,
                EtcClobberConflictKind::UnrecognizedContent,
            ));
        }

        // For hashable paths, match nix-darwin's `shasum -a 256 "$etcFile"`:
        // follow symlinks and compare lowercase hex strings literally.
        match sha256_file(&etc_path) {
            Ok(hash) if entry.known_sha256_hashes.iter().any(|known| known == &hash) => None,
            Ok(_) => Some(etc_conflict(
                entry,
                &etc_path,
                &expected_static_path,
                EtcClobberConflictKind::UnrecognizedContent,
            )),
            Err(_) => Some(etc_conflict(
                entry,
                &etc_path,
                &expected_static_path,
                EtcClobberConflictKind::Unreadable,
            )),
        }
    } else {
        Some(etc_conflict(
            entry,
            &etc_path,
            &expected_static_path,
            EtcClobberConflictKind::NonRegularTarget,
        ))
    }
}

fn inspect_xdg_config_entry_for_warning(
    entry: &NixHomeManagerXdgConfigFileEntry,
) -> Option<ManagedFileWarning> {
    if entry.force || entry.backup_file_extension.is_none() {
        return None;
    }

    let path = join_target(Path::new(&entry.xdg_config_home), &entry.target);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return None,
    };

    if metadata.is_dir() {
        return None;
    }

    let expected_link_target = entry.source.as_deref().map(Path::new);
    let current_link_target = std::fs::read_link(&path).ok();
    if expected_link_target.is_some() && current_link_target.as_deref() == expected_link_target {
        return None;
    }

    Some(ManagedFileWarning {
        path: path.to_string_lossy().into_owned(),
        target: entry.target.clone(),
        managed_root: ManagedFileRoot::XdgConfig,
        user: Some(entry.user.clone()),
        current_link_target: current_link_target.map(|path| path.to_string_lossy().into_owned()),
        expected_link_target: entry.source.clone(),
        backup_extension: entry.backup_file_extension.clone(),
    })
}

fn etc_conflict(
    entry: &NixEnvironmentEtcEntry,
    path: &Path,
    expected_static_path: &Path,
    kind: EtcClobberConflictKind,
) -> EtcClobberConflict {
    EtcClobberConflict {
        path: path.to_string_lossy().into_owned(),
        target: entry.target.clone(),
        expected_static_path: expected_static_path.to_string_lossy().into_owned(),
        current_link_target: std::fs::read_link(path)
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        known_sha256_hashes: entry.known_sha256_hashes.clone(),
        kind,
    }
}

fn join_target(root: &Path, target: &str) -> PathBuf {
    root.join(target.trim_start_matches('/'))
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("Failed to read {} for SHA-256 verification", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn entry(target: &str, known_sha256_hashes: Vec<String>) -> NixEnvironmentEtcEntry {
        NixEnvironmentEtcEntry {
            target: target.to_string(),
            known_sha256_hashes,
        }
    }

    fn xdg_entry(
        target: &str,
        xdg_config_home: &Path,
        source: &Path,
        backup_file_extension: Option<&str>,
    ) -> NixHomeManagerXdgConfigFileEntry {
        NixHomeManagerXdgConfigFileEntry {
            user: "alice".to_string(),
            target: target.to_string(),
            xdg_config_home: xdg_config_home.display().to_string(),
            source: Some(source.display().to_string()),
            force: false,
            backup_file_extension: backup_file_extension.map(str::to_string),
        }
    }

    #[test]
    fn unmanaged_xdg_config_file_with_backup_extension_is_a_warning() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_home = dir.path().join("config");
        let source = dir.path().join("home-files/git/message");
        std::fs::create_dir_all(config_home.join("git")).expect("config dir");
        std::fs::write(config_home.join("git/message"), "local template\n").expect("write config");

        let result = check_entries_for_clobber(
            &[],
            &[xdg_entry(
                "git/message",
                &config_home,
                &source,
                Some("backup"),
            )],
            Path::new("/etc"),
            Path::new("/etc/static"),
        );

        assert!(result.ok);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(
            result.warnings[0].managed_root,
            crate::shared_types::ManagedFileRoot::XdgConfig
        );
        assert_eq!(
            result.warnings[0].backup_extension.as_deref(),
            Some("backup")
        );
    }

    #[test]
    fn adopted_xdg_config_symlink_is_not_a_warning() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_home = dir.path().join("config");
        let source = dir.path().join("home-files/git/message");
        std::fs::create_dir_all(config_home.join("git")).expect("config dir");
        std::fs::create_dir_all(source.parent().expect("source parent")).expect("source dir");
        std::fs::write(&source, "managed template\n").expect("source");
        symlink(&source, config_home.join("git/message")).expect("symlink");

        let result = check_entries_for_clobber(
            &[],
            &[xdg_entry(
                "git/message",
                &config_home,
                &source,
                Some("backup"),
            )],
            Path::new("/etc"),
            Path::new("/etc/static"),
        );

        assert!(result.ok);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn matching_static_symlink_is_not_a_conflict() {
        let dir = tempfile::tempdir().expect("tempdir");
        let etc = dir.path().join("etc");
        let static_root = dir.path().join("static");
        std::fs::create_dir_all(etc.join("nix")).expect("etc nix");
        std::fs::create_dir_all(static_root.join("nix")).expect("static nix");
        symlink(
            static_root.join("nix/github-token.conf"),
            etc.join("nix/github-token.conf"),
        )
        .expect("symlink");

        let result = check_entries_for_clobber(
            &[entry("nix/github-token.conf", Vec::new())],
            &[],
            &etc,
            &static_root,
        );

        assert!(result.ok);
        assert!(result.conflicts.is_empty());
    }

    #[test]
    fn unmanaged_file_without_known_hashes_is_a_conflict_without_reading_static_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let etc = dir.path().join("etc");
        let static_root = dir.path().join("static");
        std::fs::create_dir_all(etc.join("nix")).expect("etc nix");
        std::fs::write(etc.join("nix/github-token.conf"), "token-like contents")
            .expect("write unmanaged file");

        let result = check_entries_for_clobber(
            &[entry("nix/github-token.conf", Vec::new())],
            &[],
            &etc,
            &static_root,
        );

        assert!(!result.ok);
        assert_eq!(
            result.conflicts[0].path,
            etc.join("nix/github-token.conf").display().to_string()
        );
    }

    #[test]
    fn file_with_known_hash_is_not_a_conflict() {
        let dir = tempfile::tempdir().expect("tempdir");
        let etc = dir.path().join("etc");
        let static_root = dir.path().join("static");
        std::fs::create_dir_all(&etc).expect("etc");
        std::fs::write(etc.join("shells"), "/bin/zsh\n").expect("write shells");
        let known = sha256_file(&etc.join("shells")).expect("hash");

        let result =
            check_entries_for_clobber(&[entry("shells", vec![known])], &[], &etc, &static_root);

        assert!(result.ok);
    }

    #[test]
    fn directory_at_managed_path_is_a_conflict() {
        let dir = tempfile::tempdir().expect("tempdir");
        let etc = dir.path().join("etc");
        let static_root = dir.path().join("static");
        std::fs::create_dir_all(etc.join("pam.d/sudo_local")).expect("managed dir");

        let result = check_entries_for_clobber(
            &[entry("pam.d/sudo_local", Vec::new())],
            &[],
            &etc,
            &static_root,
        );

        assert!(!result.ok);
        assert_eq!(
            result.conflicts[0].kind,
            EtcClobberConflictKind::NonRegularTarget
        );
    }
}
