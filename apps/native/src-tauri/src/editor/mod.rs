//! Editor file I/O commands for the Monaco editor integration.
//!
//! Provides safe read/write/list operations scoped to the user's config directory,
//! reusing the path validation from `evolve::file_ops`.

pub mod lsp;

use std::path::Path;

use tauri::AppHandle;

use crate::evolve::file_ops;
use crate::storage::store;

/// Read a file relative to the config directory.
pub async fn read_file(app: &AppHandle, rel_path: &str) -> Result<String, String> {
    let config_dir = store::get_config_dir(app).map_err(|e| e.to_string())?;
    let base = Path::new(&config_dir);

    let full_path =
        file_ops::resolve_existing_path_in_dir(base, rel_path).map_err(|e| e.to_string())?;

    std::fs::read_to_string(&full_path).map_err(|e| format!("Failed to read {}: {}", rel_path, e))
}

/// Write a file relative to the config directory.
/// Validates .nix and .yaml syntax before writing.
pub async fn write_file(app: &AppHandle, rel_path: &str, content: &str) -> Result<(), String> {
    let config_dir = store::get_config_dir(app).map_err(|e| e.to_string())?;
    let base = Path::new(&config_dir);

    let full_path =
        file_ops::resolve_path_in_dir_allow_create(base, rel_path).map_err(|e| e.to_string())?;

    // Validate syntax for known file types before writing
    file_ops::validate_file_content(rel_path, content).map_err(|e| e.to_string())?;

    if let Some(parent) = full_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories for {}: {}", rel_path, e))?;
        }
    }

    std::fs::write(&full_path, content).map_err(|e| format!("Failed to write {}: {}", rel_path, e))
}

