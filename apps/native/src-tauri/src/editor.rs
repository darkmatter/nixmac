//! Editor file I/O commands for the Monaco editor integration.
//!
//! Provides safe read/write/list operations scoped to the user's config directory,
//! reusing the path validation from `evolve::file_ops`.

use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;

use crate::evolve::file_ops;
use crate::store;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

/// Read a file relative to the config directory.
pub async fn read_file(app: &AppHandle, rel_path: &str) -> Result<String, String> {
    let config_dir = store::get_config_dir(app).map_err(|e| e.to_string())?;
    let base = Path::new(&config_dir);

    let full_path =
        file_ops::resolve_existing_path_in_dir(base, rel_path).map_err(|e| e.to_string())?;

    std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read {}: {}", rel_path, e))
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

    std::fs::write(&full_path, content)
        .map_err(|e| format!("Failed to write {}: {}", rel_path, e))
}

/// List files in the config directory recursively.
pub async fn list_files(app: &AppHandle) -> Result<Vec<FileEntry>, String> {
    let config_dir = store::get_config_dir(app).map_err(|e| e.to_string())?;
    let base = Path::new(&config_dir);

    let mut entries = Vec::new();
    collect_entries(base, base, &mut entries).map_err(|e| e.to_string())?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn collect_entries(
    base: &Path,
    dir: &Path,
    entries: &mut Vec<FileEntry>,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs and common noise
        if name.starts_with('.') || name == "node_modules" || name == "result" {
            continue;
        }

        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        let is_dir = path.is_dir();
        entries.push(FileEntry {
            path: rel,
            name,
            is_dir,
        });

        if is_dir {
            collect_entries(base, &path, entries)?;
        }
    }
    Ok(())
}
