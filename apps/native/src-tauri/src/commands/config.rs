use super::helpers::{
    capture_err, clear_config_dir_provisional, handle_new_config_dir, mark_config_dir_provisional,
};
use crate::bootstrap::{default_config, discover, import};
use crate::storage::{canonical_config, store};
use crate::system::nix;
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
    cascade_config_dir_replacement(&app, normalized_dir.as_path());
    store::set_config_dir(&app, &new_dir).map_err(|e| capture_err("config_set_dir", e))?;
    // The user chose a pre-existing directory: it is theirs, not onboarding's.
    clear_config_dir_provisional(&app);
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

/// Validates the location for a new or imported configuration directory: the
/// canonical /etc/nix-darwin location, or any directory inside the user's
/// home — nested paths like `~/tmp/nix-darwin` are fine, missing parents are
/// created by the callers. Paths are compared lexically (normalization does
/// not resolve `..`), so parent-dir segments are rejected outright.
fn validate_new_dir_location(path: &Path) -> Result<(), String> {
    if canonical_config::is_canonical_config_path(path) {
        return Ok(());
    }

    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let relative = path.strip_prefix(&home).map_err(|_| {
        "New configuration directories must live inside your home directory (or at /etc/nix-darwin)"
            .to_string()
    })?;

    let mut components = relative.components().peekable();
    if components.peek().is_none() {
        return Err(
            "Choose a directory inside your home directory, not the home directory itself"
                .to_string(),
        );
    }
    if !components.all(|c| matches!(c, Component::Normal(_))) {
        return Err("Directory paths must not contain '.' or '..' segments".to_string());
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

    release_provisional_target(&app, p);
    if p.exists() && !is_dir_empty_or_only_git(p)? {
        return Err(format!(
            "Directory {} already exists and is not empty. Choose Existing to use a current configuration.",
            normalized_dir.display()
        ));
    }

    let prev_dir = store::get_config_dir(&app).ok();
    let new_dir = normalized_dir.to_string_lossy().to_string();
    cascade_config_dir_replacement(&app, normalized_dir.as_path());
    store::set_config_dir(&app, &new_dir).map_err(|e| capture_err("config_prepare_new_dir", e))?;
    store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_prepare_new_dir", e))?;
    // Scaffolded by us, so owned by onboarding until the first successful apply.
    mark_config_dir_provisional(&app, normalized_dir.as_path());

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
        cascade_config_dir_replacement(&app, Path::new(&dir));
        store::set_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
        // The user chose a pre-existing directory: it is theirs, not onboarding's.
        clear_config_dir_provisional(&app);
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("config_pick_dir", e))?;
        let changed = dir != prev_dir;
        if changed {
            handle_new_config_dir(&app, &dir).map_err(|e| capture_err("config_pick_dir", e))?;
        }
        return Ok(Some(shared_types::SetDirResult { dir, changed }));
    }

    Ok(None)
}

/// Opens a native folder picker and returns the chosen path, WITHOUT
/// selecting it as the config directory (unlike `config_pick_dir`) — callers
/// validate the folder first and decide what to select.
pub async fn config_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let prev_dir = store::get_config_dir(&app).unwrap_or_default();
    let result = app
        .dialog()
        .file()
        .set_title(
            "Select Configuration Directory - TIP: press '⌘'+'⇧'+'.' to show hidden directories",
        )
        .set_directory({
            let p = std::path::PathBuf::from(&prev_dir);
            p.parent().map(std::path::PathBuf::from).unwrap_or(p)
        })
        .blocking_pick_folder();
    Ok(result.map(|path| path.to_string()))
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

/// Resolves the template root inside a checked-out template repository: the
/// clone itself, or the `?dir=` subdirectory. The root must contain a
/// `flake.nix`; the error lists the flake locations found elsewhere in the
/// repository so the user can fix the reference's `?dir=`.
fn resolve_template_root(clone_dir: &Path, subdir: Option<&str>) -> Result<PathBuf, String> {
    let root = match subdir {
        Some(subdir) => {
            let dir = clone_dir.join(subdir);
            if !dir.is_dir() {
                return Err(format!(
                    "Subdirectory '{}' does not exist in the template repository",
                    subdir
                ));
            }
            dir
        }
        None => clone_dir.to_path_buf(),
    };
    if root.join("flake.nix").is_file() {
        return Ok(root);
    }

    let location = match subdir {
        Some(subdir) => format!("subdirectory '{}' of the template repository", subdir),
        None => "the template repository".to_string(),
    };
    let candidates: Vec<String> =
        discover::find_flake_dirs(clone_dir, discover::FLAKE_SEARCH_DEPTH)
            .into_iter()
            .map(|dir| {
                if dir.is_empty() {
                    "<repository root>".to_string()
                } else {
                    dir
                }
            })
            .collect();
    if candidates.is_empty() {
        Err(format!("No flake.nix found in {}.", location))
    } else {
        Err(format!(
            "No flake.nix found in {}. Found flakes at: {}. Set ?dir=<subdirectory> accordingly (omit ?dir= for the repository root).",
            location,
            candidates.join(", ")
        ))
    }
}

/// Scaffolds a fresh configuration into `target` from a template checked out
/// at `clone_dir`: placeholder rendering, fresh git history. Split from the
/// async command so the clone-independent part is unit-testable.
fn scaffold_template_from_clone(
    clone_dir: &Path,
    subdir: Option<&str>,
    hostname: &str,
    target: &Path,
) -> Result<default_config::ScaffoldOutcome, String> {
    let template_root = resolve_template_root(clone_dir, subdir)?;
    default_config::scaffold_template(
        &template_root,
        &target.to_string_lossy(),
        hostname,
        default_config::detect_darwin_platform(),
        &default_config::detect_username(),
    )
}

/// Creates a new configuration from a remote template repository (e.g.
/// `github:owner/repo?dir=templates/mac`). The repo is cloned into a
/// temporary directory and the referenced template directory is scaffolded
/// into a fresh config dir — unlike imports, the template's git history is
/// deliberately NOT inherited. The config dir is only selected on success,
/// so a failed clone or validation never advances onboarding.
pub async fn config_create_from_template(
    app: AppHandle,
    template_ref: String,
    hostname: String,
    dir_name: Option<String>,
) -> Result<shared_types::SetDirResult, String> {
    // Cheap validations before any network or filesystem work.
    default_config::validate_template_hostname(&hostname)?;
    let spec = import::parse_repo_ref(&template_ref).map_err(|e| e.to_string())?;
    let subdir = spec.subdir.clone();

    let target = prepare_import_target(dir_name)?;

    // Clone the whole template repo into a tempdir on a blocking thread;
    // libgit2 network I/O is synchronous. The tempdir cleans itself up.
    let scaffolded = async {
        let temp = tempfile::tempdir()
            .map_err(|e| format!("Failed to create temporary directory: {}", e))?;
        let clone_dir = temp.path().join("repo");

        let app_for_clone = app.clone();
        let clone_dir_for_clone = clone_dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            import::materialize_repo(Some(app_for_clone), &spec, &clone_dir_for_clone)
        })
        .await
        .map_err(|e| capture_err("config_create_from_template", e))?
        .map_err(|e| capture_err("config_create_from_template", e))?;

        scaffold_template_from_clone(&clone_dir, subdir.as_deref(), &hostname, &target.path)
    }
    .await;

    let outcome = match scaffolded {
        Ok(outcome) => outcome,
        Err(e) => {
            cleanup_import_target(&target);
            return Err(e);
        }
    };

    let result = finalize_imported_dir(&app, &target.path)?;

    // The config dir changed, so any previous host attribute is stale. When
    // the template consumed the hostname placeholder it is host-parameterized
    // per the template conventions — adopt the chosen name directly, exactly
    // like a bundled template. Otherwise leave it empty so the Choose Machine
    // step resolves the template's actual hosts.
    let host_attr = if outcome.hostname_used {
        hostname.as_str()
    } else {
        ""
    };
    store::set_host_attr(&app, host_attr)
        .map_err(|e| capture_err("config_create_from_template", e))?;

    // Mirror the bundled bootstrap: generate and commit flake.lock once the
    // config dir is selected. Non-fatal — a template may ship its own lock.
    if nix::is_nix_installed() {
        if let Err(e) = default_config::finalize_flake_lock(&app) {
            log::info!("Could not finalize flake.lock for the template: {}", e);
        }
    }

    Ok(result)
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

/// Bookkeeping for replacing the config dir while onboarding is still in
/// progress (no successful apply yet). Call BEFORE `store::set_config_dir`:
/// it reads the outgoing selection from preferences.
///
/// Two facts go stale when the dir changes mid-onboarding: the "scan this
/// Mac" pass was applied to the old repo, so its stamp is cleared and the
/// step machine re-surfaces the customizations step; and an old provisional
/// materialization is now orphaned, so it is deleted — unless the new dir
/// lives inside it. After the first successful apply this is a no-op:
/// post-onboarding dir changes must not rewind onboarding or delete anything.
fn cascade_config_dir_replacement(app: &AppHandle, new_dir: &Path) {
    let Some(prefs) = crate::state::preferences::try_read(app) else {
        return;
    };
    if prefs.onboarding_last_build_at.is_some() {
        return;
    }
    let Some(old_dir) = prefs.config_dir.as_deref() else {
        return;
    };
    let new_canonical = super::onboarding::canonicalized(new_dir);
    if new_canonical == super::onboarding::canonicalized(Path::new(old_dir)) {
        return;
    }

    if let Some(root) = super::onboarding::provisional_root_to_wipe(
        prefs.onboarding_provisional_config_dir.as_deref(),
        Some(old_dir),
        prefs.onboarding_last_build_at,
    ) {
        // Never delete the tree the new selection lives in.
        if !new_canonical.starts_with(super::onboarding::canonicalized(&root)) {
            cleanup_import_target(&ImportTarget {
                created: !canonical_config::is_canonical_config_path(&root),
                path: root,
            });
        }
    }

    if prefs.onboarding_mac_scanned_at.is_some()
        || prefs.onboarding_provisional_config_dir.is_some()
    {
        if let Err(e) = crate::state::preferences::write(app, |prefs| {
            prefs.onboarding_mac_scanned_at = None;
            prefs.onboarding_provisional_config_dir = None;
        }) {
            log::warn!("Failed to cascade onboarding facts on config dir change: {e:#}");
        }
    }
}

/// Frees `target` for reuse when it is onboarding's own provisional
/// materialization. Import and scaffold targets must be empty, which would
/// make retrying an import (or re-running it after "Change source") fail on
/// its own leftovers; since onboarding still owns the tree — marker matches,
/// active config dir inside it, no successful apply yet — deleting it is safe.
fn release_provisional_target(app: &AppHandle, target: &Path) {
    let Some(prefs) = crate::state::preferences::try_read(app) else {
        return;
    };
    let Some(root) = super::onboarding::provisional_root_to_wipe(
        prefs.onboarding_provisional_config_dir.as_deref(),
        prefs.config_dir.as_deref(),
        prefs.onboarding_last_build_at,
    ) else {
        return;
    };
    if super::onboarding::canonicalized(&root) == super::onboarding::canonicalized(target) {
        cleanup_import_target(&ImportTarget {
            created: !canonical_config::is_canonical_config_path(&root),
            path: root,
        });
    }
}

/// Records the parked tree of a `NeedsFlakeDirChoice` import. The clone is
/// real on-disk state with no other owner; the record is what lets the next
/// import or an onboarding reset discard it if the user abandons the choice.
fn record_pending_import(app: &AppHandle, dir: &Path) {
    let dir = dir.to_string_lossy().to_string();
    if let Err(e) = crate::state::preferences::write(app, move |prefs| {
        prefs.pending_import_dir = Some(dir);
    }) {
        log::warn!("Failed to record pending import: {e:#}");
    }
}

fn clear_pending_import(app: &AppHandle) {
    if let Err(e) = crate::state::preferences::write(app, |prefs| {
        prefs.pending_import_dir = None;
    }) {
        log::warn!("Failed to clear pending import record: {e:#}");
    }
}

/// Discards the parked tree of an abandoned `NeedsFlakeDirChoice` import, if
/// one is recorded. Safety mirrors `config_discard_import`: only locations an
/// import could have created, and never a tree the active config dir lives in.
pub(super) fn discard_pending_import(app: &AppHandle) {
    let Some(prefs) = crate::state::preferences::try_read(app) else {
        return;
    };
    let Some(pending) = prefs.pending_import_dir else {
        return;
    };
    let dir = PathBuf::from(&pending);
    if pending_import_wipe_allowed(&dir, prefs.config_dir.as_deref()) && dir.is_dir() {
        cleanup_import_target(&ImportTarget {
            created: !canonical_config::is_canonical_config_path(&dir),
            path: dir,
        });
    }
    clear_pending_import(app);
}

fn pending_import_wipe_allowed(dir: &Path, active_config: Option<&str>) -> bool {
    if validate_new_dir_location(dir).is_err() {
        return false;
    }
    let Some(active) = active_config else {
        return true;
    };
    !super::onboarding::canonicalized(Path::new(active))
        .starts_with(super::onboarding::canonicalized(dir))
}

/// A validated, empty directory an import can clone/extract into. Records
/// whether the import created it, so cleanup after a failed import knows if
/// removing the directory itself is safe.
pub(super) struct ImportTarget {
    pub(super) path: PathBuf,
    pub(super) created: bool,
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
pub(super) fn cleanup_import_target(target: &ImportTarget) {
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
    cascade_config_dir_replacement(app, target);
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
            // Record the materialization ROOT, not the (possibly nested)
            // config dir: releasing ownership must remove the whole clone.
            mark_config_dir_provisional(app, &target.path);
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
            record_pending_import(app, &target.path);
            Ok(shared_types::ImportConfigResult::NeedsFlakeDirChoice {
                clone_dir: target.path.to_string_lossy().to_string(),
                flake_dirs: dirs,
            })
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
    discard_pending_import(&app);
    release_provisional_target(&app, &resolve_import_target(dir_name.clone())?);
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
            // Record the clone ROOT: releasing ownership must remove the
            // whole clone, not just the `?dir=` subdirectory.
            mark_config_dir_provisional(&app, &target.path);
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
    discard_pending_import(&app);
    release_provisional_target(&app, &resolve_import_target(dir_name.clone())?);
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

/// Finalizes a pending import (`NeedsFlakeDirChoice`) by selecting one of the
/// discovered flake directories inside the imported tree. `flake_dir` is
/// relative to `clone_dir`; empty selects the root. Always reinitializes
/// state for the new directory, unlike `config_set_dir`, which skips that
/// when the path string is unchanged.
pub async fn config_finalize_import(
    app: AppHandle,
    clone_dir: String,
    flake_dir: String,
) -> Result<shared_types::ImportConfigResult, String> {
    let clone_dir = utils::normalize_path_input(&clone_dir)
        .map_err(|e| capture_err("config_finalize_import", e))?;
    if !clone_dir.is_dir() {
        return Err(format!(
            "Imported directory does not exist: {}",
            clone_dir.display()
        ));
    }

    let config_dir = if flake_dir.is_empty() {
        if !clone_dir.join("flake.nix").is_file() {
            return Err(format!("No flake.nix found in {}", clone_dir.display()));
        }
        clone_dir.clone()
    } else {
        import::validate_subdir(&flake_dir).map_err(|e| e.to_string())?;
        resolve_subdir_config_dir(&clone_dir, &flake_dir)?
    };

    let result = finalize_imported_dir(&app, &config_dir)?;
    // Record the clone ROOT: releasing ownership must remove the whole clone,
    // not just the selected flake subdirectory.
    mark_config_dir_provisional(&app, &clone_dir);
    // The parked tree became the active config; it is no longer discardable.
    clear_pending_import(&app);
    Ok(shared_types::ImportConfigResult::Imported {
        dir: result.dir,
        changed: result.changed,
        flake_dir: (!flake_dir.is_empty()).then_some(flake_dir),
    })
}

/// Discards a pending import (`NeedsFlakeDirChoice` the user cancelled),
/// emptying the imported tree so the target can be reused. Refuses to touch
/// the active config directory or anything containing it.
pub async fn config_discard_import(
    app: AppHandle,
    dir: String,
) -> Result<shared_types::OkResult, String> {
    let dir =
        utils::normalize_path_input(&dir).map_err(|e| capture_err("config_discard_import", e))?;
    // Same location rules as import targets: a home child or the canonical
    // config dir. Anything else was never created by an import.
    validate_new_dir_location(&dir)?;

    if let Ok(active) = store::get_config_dir(&app) {
        let active = PathBuf::from(active);
        if active.starts_with(&dir) {
            return Err(format!(
                "Refusing to discard {}: it contains the active config directory",
                dir.display()
            ));
        }
    }

    if dir.is_dir() {
        // The canonical /etc/nix-darwin must stay in place (privileged
        // creation); anything else an import created can go entirely.
        cleanup_import_target(&ImportTarget {
            path: dir.clone(),
            created: !canonical_config::is_canonical_config_path(&dir),
        });
    }

    let pending_matches = crate::state::preferences::try_read(&app)
        .and_then(|prefs| prefs.pending_import_dir)
        .is_some_and(|p| {
            super::onboarding::canonicalized(Path::new(&p))
                == super::onboarding::canonicalized(&dir)
        });
    if pending_matches {
        clear_pending_import(&app);
    }
    Ok(shared_types::OkResult::yes())
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
    fn pending_import_wipe_respects_location_and_active_config() {
        let home = dirs::home_dir().expect("home dir");
        let pending = home.join("nixmac-test-pending-import");

        // Import-creatable location, no active config: safe.
        assert!(pending_import_wipe_allowed(&pending, None));
        // Active config elsewhere: still safe.
        assert!(pending_import_wipe_allowed(
            &pending,
            Some(&home.join("other-config").to_string_lossy())
        ));
        // Active config inside the pending tree: never delete under it.
        assert!(!pending_import_wipe_allowed(
            &pending,
            Some(&pending.join("flakes/darwin").to_string_lossy())
        ));
        // A path an import could not have created (not a direct home child).
        assert!(!pending_import_wipe_allowed(
            &home.join("nested/deeper-dir"),
            None
        ));
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
    fn new_config_dir_must_live_under_home() {
        let home = dirs::home_dir().expect("home directory");

        assert!(validate_new_dir_location(&home.join(".darwin-test")).is_ok());
        // Nested destinations are fine; missing parents get created.
        assert!(validate_new_dir_location(&home.join("configs").join("darwin")).is_ok());
        assert!(validate_new_dir_location(&home.join("tmp/deeply/nested")).is_ok());

        assert!(validate_new_dir_location(&home).is_err());
        assert!(validate_new_dir_location(Path::new("/tmp/darwin")).is_err());
        // Lexical comparison: `..` segments could escape home. (Lone `.`
        // segments are normalized away by Path::components and stay allowed.)
        assert!(validate_new_dir_location(&home.join("a/../../etc")).is_err());
        assert!(validate_new_dir_location(&home.join("a/./b")).is_ok());
    }

    #[test]
    fn prepare_import_target_creates_missing_parents() {
        let home = dirs::home_dir().expect("home directory");
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let parent = home.join(format!(".nixmac-test-nested-{nonce}"));
        let dir = parent.join("inner/nix-darwin");

        let target = prepare_import_target(Some(dir.to_string_lossy().to_string()))
            .expect("prepare nested import target");
        assert_eq!(target.path, dir);
        assert!(target.created);
        assert!(target.path.is_dir());

        let _ = fs::remove_dir_all(parent);
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

    /// Lays out a fake checked-out template repository: `.git` metadata at
    /// the root plus a nested template using placeholders.
    fn fake_template_clone(root: &Path) {
        fs::create_dir_all(root.join(".git/objects")).expect("create git dir");
        fs::write(root.join(".git/HEAD"), "ref").expect("create git file");
        fs::write(root.join("README.md"), "about these templates").expect("create readme");
        fs::create_dir_all(root.join("templates/mac")).expect("create template dir");
        fs::write(
            root.join("templates/mac/flake.nix"),
            "darwinConfigurations.HOSTNAME_PLACEHOLDER = { };",
        )
        .expect("create flake");
    }

    #[test]
    fn resolve_template_root_requires_flake_and_lists_candidates() {
        let clone = temp_dir("template-root");
        fake_template_clone(&clone);

        assert_eq!(
            resolve_template_root(&clone, Some("templates/mac")).expect("resolve subdir"),
            clone.join("templates/mac")
        );

        let err = resolve_template_root(&clone, None).expect_err("root has no flake");
        assert!(err.contains("templates/mac"), "unhelpful error: {err}");

        let err = resolve_template_root(&clone, Some("templates")).expect_err("no flake in subdir");
        assert!(err.contains("templates/mac"), "unhelpful error: {err}");

        assert!(
            resolve_template_root(&clone, Some("missing"))
                .expect_err("missing subdir")
                .contains("does not exist")
        );

        let _ = fs::remove_dir_all(clone);
    }

    #[test]
    fn scaffold_template_from_clone_renders_fresh_history_without_repo_git() {
        let clone = temp_dir("template-scaffold-clone");
        fake_template_clone(&clone);
        let target = temp_dir("template-scaffold-target");
        fs::create_dir_all(&target).expect("create target");

        let outcome =
            scaffold_template_from_clone(&clone, Some("templates/mac"), "my-mac", &target)
                .expect("scaffold");
        // The fixture uses HOSTNAME_PLACEHOLDER, so the hostname is adoptable.
        assert!(outcome.hostname_used);

        let flake = fs::read_to_string(target.join("flake.nix")).expect("read flake");
        assert!(flake.contains("darwinConfigurations.my-mac"));
        // Only the template subdir's contents land in the target.
        assert!(!target.join("README.md").exists());
        assert!(!target.join("templates").exists());

        // Fresh history: a single parentless commit, no remotes.
        let repo = git2::Repository::open(&target).expect("open repo");
        let head = repo.head().expect("head").peel_to_commit().expect("commit");
        assert_eq!(head.parent_count(), 0);
        assert!(repo.remotes().expect("remotes").is_empty());

        let _ = fs::remove_dir_all(clone);
        let _ = fs::remove_dir_all(target);
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
