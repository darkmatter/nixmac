//! Path resolvers for repo-scoped configurable slices.
//!
//! The repo-scoped path lives inside the user's nix config directory at
//! `.nixmac/settings.json`. Because the config directory is itself a git repo
//! tracked by the user, anything written here travels with the repo across
//! machines on the next clone/pull — settings persist across reinstalls and
//! sync across devices without any explicit backup/restore step.
//!
//! The first time the path is requested, the `.nixmac/` directory is created
//! and a short README is written explaining what the file is.

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

/// Absolute path to `<config_dir>/.nixmac/settings.json`. The `.nixmac/`
/// directory and the explanatory `README.md` are created on first call.
pub fn repo_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let config_dir = store::get_config_dir(app)?;
    repo_store_path_for_config_dir(&config_dir)
}

pub(crate) fn repo_store_path_for_config_dir(config_dir: &str) -> Result<String> {
    let dir = Path::new(&config_dir).join(REPO_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    let readme = dir.join(REPO_README_FILE);
    if !readme.exists() {
        // Best-effort — failing to write the README must not block settings
        // reads, since users may have placed the config dir on a read-only
        // mount.
        let _ = std::fs::write(&readme, REPO_README_CONTENT);
    }
    Ok(dir.join(REPO_SETTINGS_FILE).to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_store_path_creates_managed_dir_and_readme() {
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

        let _ = repo_store_path_for_config_dir(temp.path().to_str().expect("utf-8 temp path"))
            .expect("resolve repo-scoped store path");

        assert_eq!(
            std::fs::read_to_string(dir.join(REPO_README_FILE)).expect("read README"),
            "custom note"
        );
    }
}
