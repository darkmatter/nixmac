//! Path resolvers for repo-scoped configurable slices.
//!
//! The repo-scoped path lives inside the user's nix config directory at
//! `.nixmac/settings.json`. Because the config directory is itself a git repo
//! tracked by the user, anything written here travels with the repo across
//! machines on the next clone/pull — settings persist across reinstalls and
//! sync across devices without any explicit backup/restore step.
//!
//! Callers that intend to write repo-scoped settings should ensure the
//! `.nixmac/` directory first by using `ensure_repo_store_dir_for_path`;
//! read-only startup paths can resolve the settings location without mutating
//! a not-yet-confirmed config directory.

use crate::storage::store;
use anyhow::Result;
use std::path::Path;
use tauri::{AppHandle, Runtime};

const REPO_DIR_NAME: &str = ".nixmac";
const REPO_SETTINGS_FILE: &str = "settings.json";
const REPO_README_FILE: &str = "README.md";

const REPO_README_CONTENT: &str = "\
# .nixmac

This directory is managed by [nixmac](https://github.com/darkmatter/nixmac).

`settings.json` holds user preferences that should follow you across machines
— things like the default model and confirmation
behavior. The file is plain JSON; nixmac reads it on the next agent run.

Per-device settings (developer mode, pinned version, update channel, model
cache) intentionally live elsewhere in your OS app data directory and are
**not** synced here.

If you'd rather not commit these settings, add `.nixmac/` to your
`.gitignore`. Removing the file is harmless — nixmac will recreate it with
defaults on next launch.
";

/// Absolute path to `<config_dir>/.nixmac/settings.json`.
///
/// This resolver is read-only: **IT DOES NOT AUTOMAGICALLY CREATE `.nixmac/`**. Use
/// `ensure_repo_store_dir_for_path` before writes that should materialize the
/// managed settings directory.
pub fn repo_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let config_dir = store::get_config_dir(app)?;
    repo_store_path_for_config_dir(&config_dir)
}

pub(crate) fn repo_store_path_for_config_dir(config_dir: &str) -> Result<String> {
    let dir = Path::new(&config_dir).join(REPO_DIR_NAME);
    Ok(dir.join(REPO_SETTINGS_FILE).to_string_lossy().to_string())
}

/// Ensure the parent `.nixmac/` directory exists for a repo-scoped settings
/// file and create the explanatory README when missing.
pub(crate) fn ensure_repo_store_dir_for_path(path: impl AsRef<Path>) -> Result<()> {
    let Some(dir) = path.as_ref().parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(&dir)?;
    let readme = dir.join(REPO_README_FILE);
    if !readme.exists() {
        // Best-effort — failing to write the README must not block settings
        // reads, since users may have placed the config dir on a read-only
        // mount.
        let _ = std::fs::write(&readme, REPO_README_CONTENT);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn repo_store_path_does_not_create_managed_dir() {
        let temp = tempfile::tempdir().expect("create tempdir");

        let path = repo_store_path_for_config_dir(temp.path().to_str().expect("utf-8 temp path"))
            .expect("resolve repo-scoped store path");

        let expected_dir = temp.path().join(REPO_DIR_NAME);
        assert_eq!(
            path,
            expected_dir
                .join(REPO_SETTINGS_FILE)
                .to_string_lossy()
                .to_string()
        );
        assert!(!expected_dir.exists());
    }

    #[test]
    fn ensure_repo_store_dir_creates_managed_dir_and_readme() {
        let temp = tempfile::tempdir().expect("create tempdir");

        let path = PathBuf::from(
            repo_store_path_for_config_dir(temp.path().to_str().expect("utf-8 temp path"))
                .expect("resolve repo-scoped store path"),
        );
        ensure_repo_store_dir_for_path(&path).expect("ensure repo store dir");

        let expected_dir = temp.path().join(REPO_DIR_NAME);
        assert_eq!(
            path,
            expected_dir
                .join(REPO_SETTINGS_FILE)
                .to_string_lossy()
                .to_string()
        );
        assert!(expected_dir.is_dir());
        assert_eq!(
            std::fs::read_to_string(expected_dir.join(REPO_README_FILE))
                .expect("read generated README"),
            REPO_README_CONTENT
        );
    }

    #[test]
    fn repo_store_path_preserves_existing_readme() {
        let temp = tempfile::tempdir().expect("create tempdir");
        let dir = temp.path().join(REPO_DIR_NAME);
        std::fs::create_dir_all(&dir).expect("create managed dir");
        std::fs::write(dir.join(REPO_README_FILE), "custom note").expect("write custom README");

        let path = PathBuf::from(
            repo_store_path_for_config_dir(temp.path().to_str().expect("utf-8 temp path"))
                .expect("resolve repo-scoped store path"),
        );
        ensure_repo_store_dir_for_path(&path).expect("ensure repo store dir");

        assert_eq!(
            std::fs::read_to_string(dir.join(REPO_README_FILE)).expect("read README"),
            "custom note"
        );
    }

    #[test]
    fn ensure_repo_store_dir_accepts_file_path() {
        let temp = tempfile::tempdir().expect("create tempdir");
        let path: PathBuf = temp.path().join(REPO_DIR_NAME).join(REPO_SETTINGS_FILE);

        ensure_repo_store_dir_for_path(&path).expect("ensure repo store dir");

        assert!(temp.path().join(REPO_DIR_NAME).is_dir());
        assert!(
            temp.path()
                .join(REPO_DIR_NAME)
                .join(REPO_README_FILE)
                .is_file()
        );
    }
}
