use super::helpers::capture_err;
use crate::bootstrap::default_config;
use crate::storage::store;
use crate::system::nix;
use crate::{rebuild, shared_types};
use std::process::Command;
use tauri::AppHandle;

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

fn e2e_mock_host_attr() -> String {
    crate::e2e_runtime::value("NIXMAC_E2E_HOST_ATTR").unwrap_or_else(|| "e2e-host".to_string())
}

/// Starts a streaming darwin-rebuild switch operation.
/// Progress is emitted via `darwin:apply:data` events, completion via `darwin:apply:end`.
#[tauri::command]
pub async fn darwin_apply_stream_start(
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

/// Used by rollback to restore a previous nix store without a full rebuild.
#[tauri::command]
pub async fn darwin_activate_store_path(
    app: AppHandle,
    store_path: String,
) -> Result<shared_types::OkResult, String> {
    rebuild::activate_store_path_stream(&app, store_path)
        .map(|_| shared_types::OkResult::yes())
        .map_err(|e| capture_err("darwin_activate_store_path", e))
}

/// Cancels an in-progress apply by stashing changes on a new branch and returning to the previous branch.
/// Does not kill the running darwin-rebuild process; process cancellation is not yet implemented.
#[tauri::command]
pub async fn darwin_apply_stream_cancel(app: AppHandle) -> Result<shared_types::OkResult, String> {
    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;

    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to add files to git: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let date = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let output = Command::new("git")
        .args(["checkout", "-b", &format!("canceled-{}", date)])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout canceled commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let output = Command::new("git")
        .args(["commit", "-m", &format!("Canceled commit: {}", commit_hash)])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to commit canceled commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // check out prev branch
    let output = Command::new("git")
        .args(["checkout", "-"])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .map_err(|e| capture_err("darwin_apply_stream_cancel", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to checkout previous branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // TODO: Implement actual cancellation by tracking the child process
    Ok(shared_types::OkResult::yes())
}

/// Records build state and changeset after a successful darwin-rebuild switch.
#[tauri::command]
pub async fn finalize_apply(app: AppHandle) -> Result<shared_types::FinalizeApplyResult, String> {
    crate::rebuild::finalize_apply(&app)
        .await
        .map_err(|e| capture_err("finalize_apply", e))
}

/// Finalize a rollback store-path activation — restores the pre-evolution build record.
#[tauri::command]
pub async fn finalize_rollback(
    app: AppHandle,
    store_path: Option<String>,
    changeset_id: Option<i64>,
) -> Result<shared_types::FinalizeApplyResult, String> {
    crate::rebuild::finalize_rollback(&app, store_path, changeset_id)
        .await
        .map_err(|e| capture_err("finalize_rollback", e))
}

#[tauri::command]
pub async fn flake_installed_apps(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    if e2e_mock_system_enabled() {
        log::info!(
            "[apply] NIXMAC_E2E_MOCK_SYSTEM enabled; returning empty installed apps fixture"
        );
        // No current Product Proof surface depends on installed-app shape; avoid real Nix here.
        return Ok(Vec::new());
    }

    let dir = store::ensure_config_dir_exists(&app)
        .map_err(|e| capture_err("flake_installed_apps", e))?;

    let host = nix::determine_host_attr(&app)
        .or_else(|| {
            let hosts = nix::list_darwin_hosts(&dir).ok()?;
            if hosts.len() == 1 {
                Some(hosts[0].clone())
            } else {
                None
            }
        })
        .ok_or_else(|| "Host attribute not found".to_string())?;

    let apps = nix::evaluate_installed_apps(&dir, &host)
        .map_err(|e| capture_err("flake_installed_apps", e))?;
    Ok(apps)
}

fn nix_check_result() -> shared_types::NixCheckResult {
    if e2e_mock_system_enabled() {
        log::info!(
            "[apply] NIXMAC_E2E_MOCK_SYSTEM enabled; reporting mocked Nix/darwin-rebuild availability"
        );
        return shared_types::NixCheckResult {
            installed: true,
            version: Some("NIXMAC_E2E_MOCK_SYSTEM mocked nix".to_string()),
            darwin_rebuild_available: true,
        };
    }

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
    shared_types::NixCheckResult {
        installed,
        version,
        darwin_rebuild_available,
    }
}

#[tauri::command]
pub async fn nix_check() -> Result<shared_types::NixCheckResult, String> {
    Ok(nix_check_result())
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
pub async fn finalize_flake_lock(app: AppHandle) -> Result<shared_types::OkResult, String> {
    default_config::finalize_flake_lock(&app)?;
    Ok(shared_types::OkResult::yes())
}

/// Lists all darwinConfigurations defined in the flake.
#[tauri::command]
pub async fn flake_list_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    if e2e_mock_system_enabled() {
        let host = e2e_mock_host_attr();
        log::info!(
            "[apply] NIXMAC_E2E_MOCK_SYSTEM enabled; returning mocked flake host {}",
            host
        );
        return Ok(vec![host]);
    }

    let dir =
        store::ensure_config_dir_exists(&app).map_err(|e| capture_err("flake_list_hosts", e))?;
    let hosts = nix::list_darwin_hosts(&dir).map_err(|e| capture_err("flake_list_hosts", e))?;
    Ok(hosts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(debug_assertions)]
    #[test]
    fn e2e_mock_nix_check_reports_available_system() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&["NIXMAC_E2E_MOCK_SYSTEM"]);

        std::env::set_var("NIXMAC_E2E_MOCK_SYSTEM", "1");
        let result = nix_check_result();

        assert!(result.installed);
        assert!(result.darwin_rebuild_available);
        assert_eq!(
            result.version.as_deref(),
            Some("NIXMAC_E2E_MOCK_SYSTEM mocked nix")
        );
    }

    #[test]
    fn e2e_mock_host_attr_uses_runtime_value_or_default() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore =
            crate::test_support::EnvVarRestore::capture(&["HOME", "NIXMAC_E2E_HOST_ATTR"]);
        let temp_home = tempfile::tempdir().unwrap();

        std::env::set_var("HOME", temp_home.path());
        std::env::remove_var("NIXMAC_E2E_HOST_ATTR");
        assert_eq!(e2e_mock_host_attr(), "e2e-host");

        std::env::set_var("NIXMAC_E2E_HOST_ATTR", "ci-host");
        assert_eq!(e2e_mock_host_attr(), "ci-host");
    }
}
