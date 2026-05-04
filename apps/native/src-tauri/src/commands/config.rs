use super::helpers::{capture_err, handle_new_config_dir};
use crate::bootstrap::default_config;
use crate::storage::store;
use crate::{shared_types, types, utils};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Returns the current configuration including the flake directory and host attribute.
#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<types::Config, String> {
    let config_dir = store::get_config_dir(&app).map_err(|e| capture_err("config_get", e))?;
    let host_attr = store::get_host_attr(&app)
        .map_err(|e| capture_err("config_get", e))?
        .or_else(store::read_host_attr_from_file);

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
