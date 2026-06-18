use super::helpers::{capture_err, get_hostname_and_config_dir};
use crate::shared_types;
use crate::storage::store;
use crate::system::scanner;
use tauri::AppHandle;

/// Returns a recommended prompt based on the user's current macOS settings.
#[tauri::command]
pub async fn get_recommended_prompt() -> Result<Option<shared_types::RecommendedPrompt>, String> {
    Ok(scanner::recommend_prompt())
}

/// Scans macOS system defaults and returns settings that differ from factory defaults.
#[tauri::command]
pub async fn scan_system_defaults(
    app: AppHandle,
) -> Result<shared_types::SystemDefaultsScan, String> {
    // Check if system-defaults.nix already exists in the config dir
    if let Ok(dir) = store::get_config_dir(&app) {
        let nix_path = std::path::Path::new(&dir)
            .join("modules")
            .join("darwin")
            .join("system-defaults.nix");
        if nix_path.exists() {
            // Already applied — return empty scan so the CTA stays hidden
            return Ok(shared_types::SystemDefaultsScan {
                defaults: vec![],
                total_scanned: 0,
            });
        }
    }

    let (hostname, config_dir) = get_hostname_and_config_dir(&app, "scan_system_defaults")?;

    let scan = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_system_defaults(&hostname, &config_dir)
    })
    .await
    .map_err(|e| capture_err("scan_system_defaults", e.to_string()))?;

    Ok(scan)
}

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates a git branch, commits, and caches a summary.
#[tauri::command]
pub async fn apply_system_defaults(
    app: AppHandle,
    defaults: Vec<shared_types::SystemDefault>,
) -> Result<shared_types::ConfigEditApplyResult, String> {
    crate::managed_edits::system_defaults::apply_system_defaults(&app, defaults)
        .await
        .map_err(|e| capture_err("apply_system_defaults", e))
}
