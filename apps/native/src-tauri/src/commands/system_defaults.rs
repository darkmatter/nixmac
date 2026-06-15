use super::helpers::capture_err;
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
    let scan = scanner::scan_system_defaults();

    // Filter out defaults already tracked in the generated module while keeping
    // the remaining machine drift visible for per-item tracking.
    if let Ok(dir) = store::get_config_dir(&app) {
        let nix_path = std::path::Path::new(&dir)
            .join("modules")
            .join("darwin")
            .join("system-defaults.nix");
        if nix_path.exists() {
            let content = std::fs::read_to_string(&nix_path)
                .map_err(|e| format!("Failed to read system-defaults.nix: {e}"))?;
            return Ok(scanner::filter_tracked_system_defaults(scan, &content));
        }
    }
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
