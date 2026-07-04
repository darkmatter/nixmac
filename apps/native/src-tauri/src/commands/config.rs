use super::helpers::{capture_err, handle_new_config_dir};
use crate::bootstrap::{default_config, discover, import};
use crate::storage::{canonical_config, store};
use crate::{shared_types, types, utils};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Returns the current configuration including the flake directory and host attribute.
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_get", e))?;
    let host_attr = store::get_host_attr(&app).map_err(|e| capture_err("config_get", e))?;

    Ok(types::Config {
        config_dir,
        host_attr,
    })
}

/// Gets the hostname that we're running on, does not touch config but is used
/// for UI convenience and onboarding defaults.
/// The name of this function is specifically chosen to NOT get confused
/// with an actual config read.
pub async fn get_this_hostname() -> Result<String, String> {
    let hostname =
        default_config::detect_hostname().map_err(|e| capture_err("get_this_hostname", e))?;
    Ok(hostname)
}

/// Sets the nix-darwin host attribute (e.g., "Coopers-MacBook-Pro").
pub async fn config_set_host_attr(
    app: AppHandle,
    host: String,
) -> Result<shared_types::OkResult, String> {
    store::set_host_attr(&app, &host).map_err(|e| capture_err("config_set_host_attr", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Sets the flake configuration directory path.
pub async fn config_set_dir(
    app: AppHandle,
    dir: String,
) -> Result<shared_types::SetDirResult, String> {
    let normalized_dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("config_set_dir", e))?;

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
    store::sync_canonical_config_link(&new_dir).map_err(|e| capture_err("config_set_dir", e))?;

    let changed = prev_dir.as_deref() != Some(&new_dir);
    if changed {
        handle_new_config_dir(&app, &new_dir).map_err(|e| capture_err("config_set_dir", e))?;
    }

    Ok(shared_types::SetDirResult {
        dir: new_dir,
        changed,
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
    if canonical_config::is_canonical_config_path(path) {
        return Ok(());
    }

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
pub async fn config_prepare_new_dir(
    app: AppHandle,
    dir: String,
) -> Result<shared_types::SetDirResult, String> {
    let normalized_dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("config_prepare_new_dir", e))?;
    validate_new_dir_location(&normalized_dir)?;

    let p = normalized_dir.as_path();
    if p.exists() && !p.is_dir() {
        return Err(format!(
            "Path exists but is not a directory: {}",
            normalized_dir.display()
        ));
    }

    if p.exists() && !is_dir_empty_or_only_git(p)? {
        return Err(format!(
            "Directory {} already exists and is not empty. Choose Existing to use a current configuration.",
            normalized_dir.display()
        ));
    }

    let prev_dir = store::get_config_dir(&app).ok();
    let new_dir = normalized_dir.to_string_lossy().to_string();
    store::set_config_dir(&app, &new_dir).map_err(|e| capture_err("config_prepare_new_dir", e))?;
    store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_prepare_new_dir", e))?;

    let changed = prev_dir.as_deref() != Some(&new_dir);
    if changed {
        handle_new_config_dir(&app, &new_dir)
            .map_err(|e| capture_err("config_prepare_new_dir", e))?;
    }

    Ok(shared_types::SetDirResult {
        dir: new_dir,
        changed,
    })
}

/// Opens a native folder picker dialog to select the flake directory.
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
        let changed = dir != prev_dir;
        if changed {
            handle_new_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
        }
        return Ok(Some(shared_types::SetDirResult { dir, changed }));
    }

    Ok(None)
}

/// Checks if a flake.nix exists in the config directory
pub async fn flake_exists(app: AppHandle) -> Result<bool, String> {
    let dir = store::get_config_dir(&app).map_err(|e| capture_err("flake_exists", e))?;
    Ok(Path::new(&dir).join("flake.nix").exists())
}

/// Checks if a flake.nix exists at the provided directory path
pub async fn flake_exists_at(_app: AppHandle, dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("flake_exists_at", e))?;
    Ok(normalized_dir.join("flake.nix").exists())
}

/// Lists the directories under `dir` that contain a `flake.nix`, as paths
/// relative to `dir` (`""` for `dir` itself), shallowest first.
pub async fn flake_locate_at(_app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    let normalized_dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("flake_locate_at", e))?;
    Ok(discover::find_flake_dirs(
        &normalized_dir,
        discover::FLAKE_SEARCH_DEPTH,
    ))
}

/// Checks whether the provided path exists and is a directory.
pub async fn path_exists(dir: String) -> Result<bool, String> {
    let normalized_dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("path_exists", e))?;
    Ok(normalized_dir.exists() && normalized_dir.is_dir())
}

/// Normalizes a user-provided directory path for validation and persistence.
///
/// Behavior:
/// - trims surrounding whitespace
/// - expands a leading `~` or `~/...` to the user's home directory
/// - resolves relative paths against the current working directory
pub async fn path_normalize(input: String) -> Result<String, String> {
    let normalized =
        utils::normalize_path_input(&input).map_err(|e| capture_err("path_normalize", e))?;
    Ok(normalized.to_string_lossy().into_owned())
}

/// Creates a new nix-darwin configuration from the bundled template.
pub async fn bootstrap_default_config(
    app: AppHandle,
    hostname: String,
    template_id: Option<String>,
) -> Result<(), String> {
    default_config::bootstrap_with_template(&app, &hostname, template_id.as_deref())
}

/// Resolves an optional destination into an absolute target for an imported
/// configuration. Defaults to `/etc/nix-darwin`.
///
/// Accepted forms:
/// - a plain directory name (resolved as `~/name`), or
/// - a path-like input (e.g. `~/.darwin` or `/Users/alice/.darwin`).
fn resolve_import_target(dir_name: Option<String>) -> Result<PathBuf, String> {
    let name = dir_name.as_deref().map(str::trim).filter(|n| !n.is_empty());

    if let Some(name) = name {
        let looks_like_path = name.contains('/') || name.starts_with('~');
        if looks_like_path {
            return utils::normalize_path_input(name)
                .map_err(|e| capture_err("resolve_import_target", e));
        }

        let home =
            dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
        return Ok(home.join(name));
    }

    Ok(PathBuf::from(canonical_config::CANONICAL_CONFIG_DIR))
}

/// Returns true when `path` is absent or an empty directory (ignoring Finder
/// metadata). Import targets must be empty so we never clobber existing files.
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
    let has_entries = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .any(|entry| entry.file_name().to_str() != Some(".DS_Store"));
    Ok(!has_entries)
}

/// A validated, empty directory an import can clone/extract into. Records
/// whether the import created it, so cleanup after a failed import knows if
/// removing the directory itself is safe.
struct ImportTarget {
    path: PathBuf,
    created: bool,
}

/// Validates and prepares an import target directory.
///
/// On success the directory is guaranteed to be absent or *truly* empty: a
/// lone `.DS_Store` (which `is_importable_target` tolerates, since the folder
/// looks empty in Finder) is removed so libgit2 clone, which rejects a
/// non-empty destination, succeeds.
fn prepare_import_target(dir_name: Option<String>) -> Result<ImportTarget, String> {
    let target = resolve_import_target(dir_name)?;
    validate_new_dir_location(&target)?;
    if !is_importable_target(&target)? {
        return Err(format!(
            "Directory {} already exists and is not empty. Choose Existing to use a current configuration.",
            target.display()
        ));
    }
    let created = !target.exists();
    if created {
        std::fs::create_dir_all(&target)
            .map_err(|e| format!("Failed to create directory {}: {}", target.display(), e))?;
    } else {
        let ds_store = target.join(".DS_Store");
        if ds_store.exists() {
            std::fs::remove_file(&ds_store)
                .map_err(|e| format!("Failed to clear {}: {}", ds_store.display(), e))?;
        }
    }
    Ok(ImportTarget {
        path: target,
        created,
    })
}

/// Best-effort removal of a failed import's contents so the target can be
/// reused on retry. The directory itself is only removed when this import
/// created it: a pre-existing directory (notably the canonical
/// /etc/nix-darwin, whose creation needs the privileged flow) is left in
/// place, emptied.
fn cleanup_import_target(target: &ImportTarget) {
    if let Ok(entries) = std::fs::read_dir(&target.path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let result = if path.is_dir() && !path.is_symlink() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            if let Err(e) = result {
                log::warn!("Failed to clean up {}: {}", path.display(), e);
            }
        }
    }
    if target.created {
        if let Err(e) = std::fs::remove_dir(&target.path) {
            log::warn!(
                "Failed to remove import target {}: {}",
                target.path.display(),
                e
            );
        }
    }
}

/// Selects an imported directory as the active config dir and initializes state.
fn finalize_imported_dir(
    app: &AppHandle,
    target: &Path,
) -> Result<shared_types::SetDirResult, String> {
    let new_dir = target.to_string_lossy().to_string();
    store::set_config_dir(app, &new_dir).map_err(|e| capture_err("finalize_imported_dir", e))?;
    store::sync_canonical_config_link(&new_dir)
        .map_err(|e| capture_err("finalize_imported_dir", e))?;
    handle_new_config_dir(app, &new_dir).map_err(|e| capture_err("finalize_imported_dir", e))?;
    Ok(shared_types::SetDirResult {
        dir: new_dir,
        changed: true,
    })
}

/// Opens a native file picker for a `.zip` archive and returns its path.
pub async fn config_pick_zip(app: AppHandle) -> Result<Option<String>, String> {
    let result = app
        .dialog()
        .file()
        .set_title("Select a configuration .zip archive")
        .add_filter("Zip archive", &["zip"])
        .blocking_pick_file();
    Ok(result.map(|path| path.to_string()))
}

/// Resolves the config directory inside a fresh clone: `target` itself, or a
/// requested subdirectory, which must exist and contain a `flake.nix`.
fn resolve_subdir_config_dir(target: &Path, subdir: &str) -> Result<PathBuf, String> {
    let dir = target.join(subdir);
    if !dir.is_dir() {
        return Err(format!(
            "Subdirectory '{}' does not exist in the imported repository",
            subdir
        ));
    }
    if !dir.join("flake.nix").is_file() {
        return Err(format!(
            "No flake.nix found in subdirectory '{}' of the imported repository",
            subdir
        ));
    }
    Ok(dir)
}

/// Where an imported tree's config directory should point, decided from the
/// flake locations discovered inside it (relative paths, shallowest first).
#[derive(Debug, PartialEq, Eq)]
enum FlakeChoice {
    /// Exactly one sensible choice: the relative dir (`""` for the root).
    Chosen(String),
    /// Several nested candidates and no root flake to break the tie.
    Ambiguous(Vec<String>),
    /// No flake.nix anywhere within the search depth.
    NoneFound,
}

fn choose_flake_dir(dirs: Vec<String>) -> FlakeChoice {
    match dirs.as_slice() {
        [] => FlakeChoice::NoneFound,
        // A root flake wins outright — that is what importing the repo means,
        // regardless of any nested flakes (vendored examples, templates, ...).
        [first, ..] if first.is_empty() => FlakeChoice::Chosen(String::new()),
        [single] => FlakeChoice::Chosen(single.clone()),
        _ => FlakeChoice::Ambiguous(dirs),
    }
}

/// Validates a fresh import and selects its config directory: the root when
/// it has a flake, the single nested flake dir otherwise. Zero or ambiguous
/// candidates fail the import (cleaning the target up for retry) so a
/// flake-less directory can never become the active configuration.
fn finalize_discovered_import(
    app: &AppHandle,
    target: &ImportTarget,
) -> Result<shared_types::ImportConfigResult, String> {
    let flake_dirs = discover::find_flake_dirs(&target.path, discover::FLAKE_SEARCH_DEPTH);
    match choose_flake_dir(flake_dirs) {
        FlakeChoice::Chosen(rel) => {
            let config_dir = if rel.is_empty() {
                target.path.clone()
            } else {
                target.path.join(&rel)
            };
            let result = finalize_imported_dir(app, &config_dir)?;
            Ok(shared_types::ImportConfigResult::Imported {
                dir: result.dir,
                changed: result.changed,
                flake_dir: (!rel.is_empty()).then_some(rel),
            })
        }
        FlakeChoice::NoneFound => {
            cleanup_import_target(target);
            Err(format!(
                "No flake.nix found in the imported configuration (searched {} levels deep).",
                discover::FLAKE_SEARCH_DEPTH
            ))
        }
        FlakeChoice::Ambiguous(dirs) => {
            // TODO: keep the clone and let the UI offer a chooser instead of
            // asking the user to re-import with ?dir=.
            cleanup_import_target(target);
            Err(format!(
                "Multiple flake.nix candidates found: {}. Re-import with ?dir=<subdirectory> to pick one.",
                dirs.join(", ")
            ))
        }
    }
}

/// Clones a GitHub reference (e.g. `owner/repo`) into a fresh config
/// directory. The full repository is always cloned; the config directory
/// points at the requested `?dir=` subdirectory, or at the discovered flake
/// location, so the import keeps its git history and origin.
pub async fn config_import_github(
    app: AppHandle,
    repo_ref: String,
    dir_name: Option<String>,
) -> Result<shared_types::ImportConfigResult, String> {
    let spec = import::parse_repo_ref(&repo_ref).map_err(|e| e.to_string())?;
    let target = prepare_import_target(dir_name)?;
    let subdir = spec.subdir.clone();

    // Clone on a blocking thread; libgit2 network I/O is synchronous.
    let target_for_clone = target.path.clone();
    let app_for_clone = app.clone();
    let cloned = tauri::async_runtime::spawn_blocking(move || {
        import::materialize_repo(Some(app_for_clone), &spec, &target_for_clone)
    })
    .await
    .map_err(|e| capture_err("config_import_github", e))?;
    if let Err(e) = cloned {
        cleanup_import_target(&target);
        return Err(capture_err("config_import_github", e));
    }

    match subdir.as_deref() {
        Some(subdir) => {
            let config_dir = match resolve_subdir_config_dir(&target.path, subdir) {
                Ok(dir) => dir,
                Err(e) => {
                    cleanup_import_target(&target);
                    return Err(e);
                }
            };
            let result = finalize_imported_dir(&app, &config_dir)?;
            Ok(shared_types::ImportConfigResult::Imported {
                dir: result.dir,
                changed: result.changed,
                flake_dir: Some(subdir.to_string()),
            })
        }
        None => finalize_discovered_import(&app, &target),
    }
}

/// Extracts a local `.zip` archive into a fresh config directory. The config
/// directory points at the discovered flake location inside the extraction.
pub async fn config_import_zip(
    app: AppHandle,
    zip_path: String,
    dir_name: Option<String>,
) -> Result<shared_types::ImportConfigResult, String> {
    let zip =
        utils::normalize_path_input(&zip_path).map_err(|e| capture_err("config_import_zip", e))?;
    if !zip.is_file() {
        return Err(format!("Zip file not found: {}", zip.display()));
    }
    let target = prepare_import_target(dir_name)?;

    let target_for_extract = target.path.clone();
    let extracted = tauri::async_runtime::spawn_blocking(move || {
        import::extract_zip(&zip, &target_for_extract)
    })
    .await
    .map_err(|e| capture_err("config_import_zip", e))?;
    if let Err(e) = extracted {
        cleanup_import_target(&target);
        return Err(capture_err("config_import_zip", e));
    }

    finalize_discovered_import(&app, &target)
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

    #[test]
    fn test_prepare_import_target_creates_empty_dir_under_home() {
        let home = dirs::home_dir().expect("home directory");
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let dir = home.join(format!(".nixmac-test-prepare-import-{nonce}"));
        let target = prepare_import_target(Some(dir.to_string_lossy().to_string()))
            .expect("prepare import target");
        assert_eq!(target.path, dir);
        assert!(target.created);
        assert!(target.path.is_dir());

        let _ = fs::remove_dir_all(target.path);
    }

    #[test]
    fn choose_flake_dir_prefers_root_then_single_nested() {
        let dirs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        assert_eq!(choose_flake_dir(dirs(&[])), FlakeChoice::NoneFound);
        assert_eq!(
            choose_flake_dir(dirs(&[""])),
            FlakeChoice::Chosen(String::new())
        );
        // A root flake wins even when nested candidates exist.
        assert_eq!(
            choose_flake_dir(dirs(&["", "nix/os"])),
            FlakeChoice::Chosen(String::new())
        );
        assert_eq!(
            choose_flake_dir(dirs(&["nix/os"])),
            FlakeChoice::Chosen("nix/os".to_string())
        );
        assert_eq!(
            choose_flake_dir(dirs(&["a", "b"])),
            FlakeChoice::Ambiguous(dirs(&["a", "b"]))
        );
    }

    #[test]
    fn cleanup_import_target_empties_and_removes_only_created_dirs() {
        let created = temp_dir("cleanup-created");
        fs::create_dir_all(created.join("repo/nested")).expect("create contents");
        fs::write(created.join("repo/file"), "x").expect("create file");
        cleanup_import_target(&ImportTarget {
            path: created.clone(),
            created: true,
        });
        assert!(!created.exists());

        // A pre-existing directory is emptied but kept in place.
        let preexisting = temp_dir("cleanup-preexisting");
        fs::create_dir_all(preexisting.join("repo")).expect("create contents");
        cleanup_import_target(&ImportTarget {
            path: preexisting.clone(),
            created: false,
        });
        assert!(preexisting.exists());
        assert!(
            fs::read_dir(&preexisting)
                .expect("read dir")
                .next()
                .is_none()
        );

        let _ = fs::remove_dir_all(preexisting);
    }

    #[test]
    fn test_prepare_import_target_rejects_dir_not_under_home() {
        let dir = PathBuf::from("/tmp/nixmac-test");
        let result = prepare_import_target(Some(dir.to_string_lossy().to_string()));
        assert!(result.is_err());
    }

    #[test]
    fn resolve_subdir_config_dir_requires_existing_dir_with_flake() {
        let dir = temp_dir("resolve-subdir");
        fs::create_dir_all(dir.join("nix/os")).expect("create subdir");
        fs::write(dir.join("nix/os/flake.nix"), "{ }").expect("create flake");
        fs::create_dir_all(dir.join("empty")).expect("create empty subdir");

        assert_eq!(
            resolve_subdir_config_dir(&dir, "nix/os").expect("resolve"),
            dir.join("nix/os")
        );
        assert!(
            resolve_subdir_config_dir(&dir, "empty")
                .unwrap_err()
                .contains("No flake.nix")
        );
        assert!(
            resolve_subdir_config_dir(&dir, "missing")
                .unwrap_err()
                .contains("does not exist")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prepare_import_target_rejects_non_empty_dir() {
        let dir = temp_dir("prepare-import-target-non-empty");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("flake.nix"), "").expect("create flake");

        let result = prepare_import_target(Some(dir.to_string_lossy().to_string()));
        assert!(result.is_err());

        let _ = fs::remove_dir_all(dir);
    }
}
