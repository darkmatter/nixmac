//! Path resolvers that the `Configurable` derive can target via
//! `#[config(store_path_fn = ...)]`.
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
— things like agent iteration limits, default model, and confirmation
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
