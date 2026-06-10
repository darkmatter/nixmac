use super::helpers::{capture_err, handle_new_config_dir};
use crate::bootstrap::{default_config, import};
use crate::storage::store;
use crate::{shared_types, types, utils};
use std::fs::DirEntry;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Returns the current configuration including the flake directory and host attribute.
#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_get", e))?;
    let host_attr = store::get_host_attr(&app).map_err(|e| capture_err("config_get", e))?;

    Ok(types::Config {
        config_dir,
        host_attr,
    })
}

/// Sets the nix-darwin host attribute (e.g., "Coopers-MacBook-Pro").
#[tauri::command]
pub async fn config_set_host_attr(
    app: AppHandle,
    host: String,
) -> Result<shared_types::OkResult, String> {
    store::set_host_attr(&app, &host).map_err(|e| capture_err("config_set_host_attr", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Sets the flake configuration directory path.
#[tauri::command]
pub async fn config_set_dir(
    app: AppHandle,
    dir: String,
) -> Result<shared_types::SetDirResult, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("config_set_dir", e))?;

    // Require that the provided path already exists and is a directory.
    // If we don't, then we'll always silently create directories even when
    // the user is making typos trying to set the path, which is particularly
    // annoying when dealing with hidden directories like ~/.darwin-ish things.
    let p = normalized_dir.as_path();
    if !p.exists() || !p.is_dir() {
        return Err(format!(
            "Directory does not exist: {}",
            normalized_dir.display()
        ));
    }

    let prev_dir = store::get_config_dir(&app).ok();
    let new_dir = normalized_dir.to_string_lossy().to_string();
    store::set_config_dir(&app, &new_dir).map_err(|e| capture_err("config_set_dir", e))?;

    let (evolve_state, hosts) = if prev_dir.as_deref() != Some(&new_dir) {
        let (es, hosts) =
            handle_new_config_dir(&app, &new_dir).map_err(|e| capture_err("config_set_dir", e))?;
        (Some(es), hosts)
    } else {
        (None, None)
    };

    Ok(shared_types::SetDirResult {
        dir: new_dir,
        evolve_state,
        hosts,
    })
}

fn is_dir_empty_or_only_git(path: &Path) -> Result<bool, String> {
    let entries: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|entry| entry.file_name().to_str() != Some(".DS_Store"))
        .collect();

    if entries.is_empty() {
        return Ok(true);
    }

    if entries.len() == 1 {
        if let Some(name) = entries[0].file_name().to_str() {
            return Ok(name == ".git");
        }
    }

    Ok(false)
}

fn validate_new_dir_location(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let relative = path.strip_prefix(&home).map_err(|_| {
        "New configuration directories must be created directly in your home directory".to_string()
    })?;

    let mut components = relative.components();
    let Some(Component::Normal(_)) = components.next() else {
        return Err("Use a directory name, not a path".to_string());
    };

    if components.next().is_some() {
        return Err("Use a directory name, not a path".to_string());
    }

    Ok(())
}

/// Creates and selects an empty directory for a new nix-darwin configuration.
#[tauri::command]
pub async fn config_prepare_new_dir(
    app: AppHandle,
    dir: String,
) -> Result<shared_types::SetDirResult, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("config_prepare_new_dir", e))?;
    validate_new_dir_location(&normalized_dir)?;

    let p = normalized_dir.as_path();
    if p.exists() && !p.is_dir() {
        return Err(format!(
            "Path exists but is not a directory: {}",
            normalized_dir.display()
        ));
    }

    if p.exists() && !is_dir_empty_or_only_git(p)? {
        return Err(
            "Directory already exists and is not empty. Choose Existing to use a current configuration."
                .to_string(),
        );
    }

    std::fs::create_dir_all(p).map_err(|e| {
        format!(
            "Failed to create directory {}: {}",
            normalized_dir.display(),
            e
        )
    })?;

    let prev_dir = store::get_config_dir(&app).ok();
    let new_dir = normalized_dir.to_string_lossy().to_string();
    store::set_config_dir(&app, &new_dir).map_err(|e| capture_err("config_prepare_new_dir", e))?;

    let (evolve_state, hosts) = if prev_dir.as_deref() != Some(&new_dir) {
        let (es, hosts) = handle_new_config_dir(&app, &new_dir)
            .map_err(|e| capture_err("config_prepare_new_dir", e))?;
        (Some(es), hosts)
    } else {
        (None, None)
    };

    Ok(shared_types::SetDirResult {
        dir: new_dir,
        evolve_state,
        hosts,
    })
}

/// Opens a native folder picker dialog to select the flake directory.
#[tauri::command]
pub async fn config_pick_dir(app: AppHandle) -> Result<Option<shared_types::SetDirResult>, String> {
    let dialog = app.dialog();
    // Try to open the picker at the currently configured directory
    let prev_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_pick_dir", e))?;
    let result = dialog
        .file()
        .set_title(
            "Select Configuration Directory - TIP: press '⌘'+'⇧'+'.' to show hidden directories",
        )
        .set_directory({
            let p = std::path::PathBuf::from(&prev_dir);
            p.parent().map(std::path::PathBuf::from).unwrap_or(p)
        })
        .blocking_pick_folder();

    if let Some(path) = result {
        let dir = path.to_string();
        store::set_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_pick_dir", e))?;
        let (evolve_state, hosts) = if dir != prev_dir {
            let (es, hosts) =
                handle_new_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
            (Some(es), hosts)
        } else {
            (None, None)
        };
        return Ok(Some(shared_types::SetDirResult {
            dir,
            evolve_state,
            hosts,
        }));
    }

    Ok(None)
}

/// Checks if a flake.nix exists in the config directory
#[tauri::command]
pub async fn flake_exists(app: AppHandle) -> Result<bool, String> {
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("flake_exists", e))?;
    Ok(Path::new(&dir).join("flake.nix").exists())
}

/// Checks if a flake.nix exists at the provided directory path
#[tauri::command]
pub async fn flake_exists_at(_app: AppHandle, dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("flake_exists_at", e))?;
    Ok(normalized_dir.join("flake.nix").exists())
}

/// Checks whether the provided path exists and is a directory.
#[tauri::command]
pub async fn path_exists(_app: AppHandle, dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_dir_input(&dir).map_err(|e| capture_err("path_exists", e))?;
    Ok(normalized_dir.exists() && normalized_dir.is_dir())
}

/// Normalizes a user-provided directory path for validation and persistence.
///
/// Behavior:
/// - trims surrounding whitespace
/// - expands a leading `~` or `~/...` to the user's home directory
/// - resolves relative paths against the current working directory
#[tauri::command]
pub async fn path_normalize(_app: AppHandle, input: String) -> Result<String, String> {
    let normalized =
        utils::normalize_dir_input(&input).map_err(|e| capture_err("path_normalize", e))?;
    Ok(normalized.to_string_lossy().into_owned())
}

/// Creates a new nix-darwin configuration from the bundled template.
#[tauri::command]
pub async fn bootstrap_default_config(app: AppHandle, hostname: String) -> Result<(), String> {
    default_config::bootstrap(&app, &hostname)
}

/// Resolves an optional directory name into an absolute, home-relative target
/// for an imported configuration. Defaults to `~/.darwin`.
fn resolve_import_target(dir_name: Option<String>) -> Result<PathBuf, String> {
    let name = dir_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(".darwin");

    if name.contains('/') || name == "." || name == ".." {
        return Err("Use a directory name, not a path".to_string());
    }

    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(name))
}

fn is_finder_metadata(entry: &DirEntry) -> Result<bool, String> {
    let name = entry.file_name();
    let file_type = entry
        .file_type()
        .map_err(|e| format!("Failed to inspect {}: {}", entry.path().display(), e))?;
    Ok(name.to_str() == Some(".DS_Store") && !file_type.is_dir())
}

fn is_transient_nixmac_dir(path: &Path) -> Result<bool, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?;
    if !metadata.file_type().is_dir() {
        return Ok(false);
    }

    for entry in std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory {}: {}", path.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let name = entry.file_name();
        let name = name.to_str().unwrap_or("");
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {}: {}", entry.path().display(), e))?;

        if !file_type.is_file() || !matches!(name, ".DS_Store" | "README.md" | "settings.json") {
            return Ok(false);
        }
    }

    Ok(true)
}

fn is_import_scaffold(entry: &DirEntry) -> Result<bool, String> {
    let name = entry.file_name();
    if is_finder_metadata(entry)? {
        return Ok(true);
    }
    Ok(name.to_str() == Some(".nixmac") && is_transient_nixmac_dir(&entry.path())?)
}

fn clear_import_scaffold(path: &Path) -> Result<(), String> {
    let ds_store = path.join(".DS_Store");
    if ds_store.exists() {
        std::fs::remove_file(&ds_store)
            .map_err(|e| format!("Failed to clear {}: {}", ds_store.display(), e))?;
    }

    let nixmac = path.join(".nixmac");
    if nixmac.exists() {
        if !is_transient_nixmac_dir(&nixmac)? {
            return Err(format!(
                "Refusing to clear non-transient import scaffold: {}",
                nixmac.display()
            ));
        }
        std::fs::remove_dir_all(&nixmac)
            .map_err(|e| format!("Failed to clear {}: {}", nixmac.display(), e))?;
    }

    Ok(())
}

/// Returns true when `path` is absent or contains only import scaffolding
/// created by macOS/nixmac before the import runs. Import targets must not
/// contain user repo content, since the import writes into this directory.
fn is_importable_target(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    if !path.is_dir() {
        return Err(format!(
            "Path exists but is not a directory: {}",
            path.display()
        ));
    }
    for entry in std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        if !is_import_scaffold(&entry)? {
            return Ok(false);
        }
    }

    Ok(true)
}

/// Validates and prepares an import target directory.
///
/// On success the directory is guaranteed to be absent or *truly* empty:
/// tolerated scaffold entries are removed so libgit2 clone, which rejects a
/// non-empty destination, succeeds.
fn prepare_import_target(dir_name: Option<String>) -> Result<PathBuf, String> {
    let target = resolve_import_target(dir_name)?;
    validate_new_dir_location(&target)?;
    if !is_importable_target(&target)? {
        return Err(
            "Directory already exists and is not empty. Choose Existing to use a current configuration."
                .to_string(),
        );
    }
    if target.exists() {
        clear_import_scaffold(&target)?;
    }
    Ok(target)
}

/// Selects an imported directory as the active config dir and initializes state.
fn finalize_imported_dir(
    app: &AppHandle,
    target: &Path,
) -> Result<shared_types::SetDirResult, String> {
    let new_dir = target.to_string_lossy().to_string();
    store::set_config_dir(app, &new_dir).map_err(|e| capture_err("finalize_imported_dir", e))?;
    let (evolve_state, hosts) = handle_new_config_dir(app, &new_dir)
        .map_err(|e| capture_err("finalize_imported_dir", e))?;
    Ok(shared_types::SetDirResult {
        dir: new_dir,
        evolve_state: Some(evolve_state),
        hosts,
    })
}

/// Opens a native file picker for a `.zip` archive and returns its path.
#[tauri::command]
pub async fn config_pick_zip(app: AppHandle) -> Result<Option<String>, String> {
    let result = app
        .dialog()
        .file()
        .set_title("Select a configuration .zip archive")
        .add_filter("Zip archive", &["zip"])
        .blocking_pick_file();
    Ok(result.map(|path| path.to_string()))
}

/// Clones a GitHub reference (e.g. `owner/repo`) into a fresh config directory.
#[tauri::command]
pub async fn config_import_github(
    app: AppHandle,
    repo_ref: String,
    dir_name: Option<String>,
) -> Result<shared_types::SetDirResult, String> {
    let spec = import::parse_repo_ref(&repo_ref).map_err(|e| e.to_string())?;
    let target = prepare_import_target(dir_name)?;

    // Clone on a blocking thread; libgit2 network I/O is synchronous.
    let target_for_clone = target.clone();
    tauri::async_runtime::spawn_blocking(move || import::clone_repo(&spec, &target_for_clone))
        .await
        .map_err(|e| capture_err("config_import_github", e))?
        .map_err(|e| capture_err("config_import_github", e))?;

    finalize_imported_dir(&app, &target)
}

/// Extracts a local `.zip` archive into a fresh config directory.
#[tauri::command]
pub async fn config_import_zip(
    app: AppHandle,
    zip_path: String,
    dir_name: Option<String>,
) -> Result<shared_types::SetDirResult, String> {
    let zip =
        utils::normalize_dir_input(&zip_path).map_err(|e| capture_err("config_import_zip", e))?;
    if !zip.is_file() {
        return Err(format!("Zip file not found: {}", zip.display()));
    }
    let target = prepare_import_target(dir_name)?;

    let target_for_extract = target.clone();
    tauri::async_runtime::spawn_blocking(move || import::extract_zip(&zip, &target_for_extract))
        .await
        .map_err(|e| capture_err("config_import_zip", e))?
        .map_err(|e| capture_err("config_import_zip", e))?;

    finalize_imported_dir(&app, &target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("nixmac-{name}-{nonce}"))
    }

    #[test]
    fn importable_target_treats_absent_and_finder_only_dirs_as_empty() {
        let absent = temp_dir("import-absent");
        assert!(is_importable_target(&absent).expect("absent path"));

        let ds_only = temp_dir("import-ds-only");
        fs::create_dir_all(&ds_only).expect("create temp dir");
        fs::write(ds_only.join(".DS_Store"), "").expect("create finder metadata");
        assert!(is_importable_target(&ds_only).expect("ds-only path"));

        let with_git = temp_dir("import-with-git");
        fs::create_dir_all(with_git.join(".git")).expect("create git dir");
        // Unlike `is_dir_empty_or_only_git`, a clone target with a `.git` dir is
        // not importable — libgit2 clone requires a truly empty destination.
        assert!(!is_importable_target(&with_git).expect("with-git path"));

        let _ = fs::remove_dir_all(ds_only);
        let _ = fs::remove_dir_all(with_git);
    }

    #[test]
    fn importable_target_treats_transient_nixmac_dir_as_empty() {
        let dir = temp_dir("import-nixmac-only");
        fs::create_dir_all(dir.join(".nixmac")).expect("create transient nixmac dir");
        fs::write(dir.join(".nixmac").join("README.md"), "# .nixmac\n")
            .expect("create generated readme");
        fs::write(dir.join(".nixmac").join("settings.json"), "{}\n")
            .expect("create generated settings");

        assert!(is_importable_target(&dir).expect("nixmac-only path"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn importable_target_rejects_nixmac_repo_content() {
        let dir = temp_dir("import-nixmac-content");
        fs::create_dir_all(dir.join(".nixmac").join("homebrew")).expect("create nixmac module dir");
        fs::write(
            dir.join(".nixmac").join("homebrew").join("default.nix"),
            "{ }",
        )
        .expect("create nixmac module");

        assert!(!is_importable_target(&dir).expect("nixmac repo content path"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prepare_import_target_clears_transient_nixmac_before_import() {
        let name = format!(
            ".darwin-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        );
        let home = dirs::home_dir().expect("home directory");
        let target = home.join(&name);
        fs::create_dir_all(target.join(".nixmac")).expect("create transient nixmac dir");
        fs::write(target.join(".nixmac").join("README.md"), "# .nixmac\n")
            .expect("create generated readme");

        let prepared = prepare_import_target(Some(name)).expect("prepare import target");

        assert_eq!(prepared, target);
        assert!(prepared.exists());
        assert!(!prepared.join(".nixmac").exists());
        assert_eq!(
            fs::read_dir(&prepared)
                .expect("read prepared target")
                .count(),
            0
        );

        let _ = fs::remove_dir_all(prepared);
    }

    #[test]
    fn allows_empty_or_git_only_dirs_ignoring_finder_metadata() {
        let dir = temp_dir("empty-dir-check");
        fs::create_dir_all(dir.join(".git")).expect("create git dir");
        fs::write(dir.join(".DS_Store"), "").expect("create finder metadata");

        assert!(is_dir_empty_or_only_git(&dir).expect("check directory"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_non_empty_dirs_for_new_config() {
        let dir = temp_dir("non-empty-dir-check");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("flake.nix"), "").expect("create flake");

        assert!(!is_dir_empty_or_only_git(&dir).expect("check directory"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn new_config_dir_must_be_a_direct_home_child() {
        let home = dirs::home_dir().expect("home directory");

        assert!(validate_new_dir_location(&home.join(".darwin-test")).is_ok());
        assert!(validate_new_dir_location(&home.join("configs").join("darwin")).is_err());
        assert!(validate_new_dir_location(Path::new("/tmp/darwin")).is_err());
    }
}
