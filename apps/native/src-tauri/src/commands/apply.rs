use super::helpers::capture_err;
use crate::storage::store;
use crate::system::nix;
use crate::{rebuild, shared_types};
use tauri::AppHandle;

pub async fn start_apply_stream(
    app: AppHandle,
    host_override: Option<String>,
) -> Result<shared_types::OkResult, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_apply_stream_start", e))?;

    let stored_attr = nix::determine_host_attr(&app);
    let discovered_hosts = nix::list_darwin_hosts(&dir).ok();

    log::info!(
        "[apply] config_dir={}, host_override={:?}, stored={:?}, discovered={:?}",
        dir,
        host_override,
        stored_attr,
        discovered_hosts
    );

    let host = host_override
        .or(stored_attr)
        .or_else(|| {
            let hosts = discovered_hosts.as_ref()?;
            (hosts.len() == 1).then(|| hosts[0].clone())
        })
        .ok_or_else(|| {
            "Host attribute not found. Set a host in Settings or ensure your flake defines exactly one darwinConfiguration.".to_string()
        })?;

    rebuild::apply_stream(&app, &dir, &host)
        .map_err(|e| capture_err("darwin_apply_stream_start", e))?;
    Ok(shared_types::OkResult::yes())
}

pub async fn activate_store_path(
    app: AppHandle,
    store_path: String,
) -> Result<shared_types::OkResult, String> {
    rebuild::activate_store_path_stream(&app, store_path)
        .map(|_| shared_types::OkResult::yes())
        .map_err(|e| capture_err("darwin_activate_store_path", e))
}

pub async fn run_finalize_apply(app: AppHandle) -> Result<(), String> {
    crate::rebuild::finalize_apply(&app)
        .await
        .map_err(|e| capture_err("finalize_apply", e))
}

pub async fn run_finalize_rollback(
    app: AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<(), String> {
    crate::rebuild::finalize_rollback(&app, store_path, changeset_id)
        .await
        .map_err(|e| capture_err("finalize_rollback", e))
}

pub async fn fetch_rebuild_status(app: AppHandle) -> Result<shared_types::RebuildStatus, String> {
    Ok(crate::state::rebuild_status::get(&app))
}

#[tauri::command]
pub async fn darwin_apply_stream_start(
    app: AppHandle,
    host_override: Option<String>,
) -> Result<shared_types::OkResult, String> {
    start_apply_stream(app, host_override).await
}

#[tauri::command]
pub async fn darwin_activate_store_path(
    app: AppHandle,
    store_path: String,
) -> Result<shared_types::OkResult, String> {
    activate_store_path(app, store_path).await
}

#[tauri::command]
pub async fn finalize_apply(app: AppHandle) -> Result<(), String> {
    run_finalize_apply(app).await
}

#[tauri::command]
pub async fn finalize_rollback(
    app: AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<(), String> {
    run_finalize_rollback(app, store_path, changeset_id).await
}

#[tauri::command]
pub async fn get_rebuild_status(app: AppHandle) -> Result<shared_types::RebuildStatus, String> {
    fetch_rebuild_status(app).await
}

#[tauri::command]
pub async fn get_nix_install_state(
    app: AppHandle,
) -> Result<shared_types::NixInstallState, String> {
    Ok(crate::state::nix_install_state::get(&app))
}

#[tauri::command]
pub async fn nix_check(app: AppHandle) -> Result<shared_types::NixCheckResult, String> {
    let installed = nix::is_nix_installed();
    let version = if installed {
        nix::get_nix_version()
    } else {
        None
    };
    let darwin_rebuild_available = if installed {
        nix::is_darwin_rebuild_available()
    } else {
        false
    };
    crate::state::nix_install_state::update(&app, |state| {
        state.installed = Some(installed);
        state.darwin_rebuild_available = Some(darwin_rebuild_available);
    });
    Ok(shared_types::NixCheckResult {
        installed,
        version,
        darwin_rebuild_available,
    })
}

#[tauri::command]
pub async fn darwin_rebuild_prefetch(app: AppHandle) -> Result<shared_types::OkResult, String> {
    nix::prefetch_darwin_rebuild_stream(&app)
        .map_err(|e| capture_err("darwin_rebuild_prefetch", e))?;
    Ok(shared_types::OkResult::yes())
}

#[tauri::command]
pub async fn nix_install_start(app: AppHandle) -> Result<shared_types::OkResult, String> {
    nix::install_nix_stream(&app).map_err(|e| capture_err("nix_install_start", e))?;
    Ok(shared_types::OkResult::yes())
}

#[tauri::command]
pub async fn flake_list_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("flake_list_hosts", e))?;
    let hosts = nix::list_darwin_hosts(&dir).map_err(|e| capture_err("flake_list_hosts", e))?;
    Ok(hosts)
}
