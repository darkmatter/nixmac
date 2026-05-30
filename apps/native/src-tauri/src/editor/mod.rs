//! Editor file I/O commands for the Monaco editor integration.
//!
//! Provides safe read/write/list operations scoped to the user's config directory,
//! reusing the path validation from `evolve::file_ops`.

pub mod lsp;

use std::path::Path;

use tauri::AppHandle;

use crate::evolve::file_ops;
use crate::storage::store;

/// Read a file relative to the git repository.
pub async fn read_file(app: &AppHandle, rel_path: &str) -> Result<String, String> {
    let repo_root = store::get_repo_root(app).map_err(|e| e.to_string())?;
    read_file_from_repo_root(Path::new(&repo_root), rel_path)
}

/// Write a file relative to the git repository.
/// Validates .nix and .yaml syntax before writing.
pub async fn write_file(app: &AppHandle, rel_path: &str, content: &str) -> Result<(), String> {
    let repo_root = store::get_repo_root(app).map_err(|e| e.to_string())?;
    write_file_in_repo_root(Path::new(&repo_root), rel_path, content)
}

fn read_file_from_repo_root(base: &Path, rel_path: &str) -> Result<String, String> {
    let full_path =
        file_ops::resolve_existing_path_in_dir(base, rel_path).map_err(|e| e.to_string())?;

    std::fs::read_to_string(&full_path).map_err(|e| format!("Failed to read {}: {}", rel_path, e))
}

fn write_file_in_repo_root(base: &Path, rel_path: &str, content: &str) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::{read_file_from_repo_root, write_file_in_repo_root};
    use tempfile::tempdir;

    #[test]
    fn read_file_from_repo_root_reads_existing_file() {
        let tmp = tempdir().expect("create temp dir");
        let repo_root = tmp.path().join("repo");
        std::fs::create_dir_all(repo_root.join("nested")).expect("create repo tree");
        std::fs::write(repo_root.join("nested/config.txt"), "hello").expect("write fixture");

        let content = read_file_from_repo_root(&repo_root, "nested/config.txt").expect("read file");

        assert_eq!(content, "hello");
    }

    #[test]
    fn write_file_in_repo_root_creates_parent_dirs_and_writes_content() {
        let tmp = tempdir().expect("create temp dir");
        let repo_root = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_root).expect("create repo root");

        write_file_in_repo_root(&repo_root, "nested/deeper/config.txt", "hello world")
            .expect("write file");

        let written =
            std::fs::read_to_string(repo_root.join("nested/deeper/config.txt")).expect("read");
        assert_eq!(written, "hello world");
    }

    #[test]
    fn write_file_in_repo_root_rejects_invalid_yaml() {
        let tmp = tempdir().expect("create temp dir");
        let repo_root = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_root).expect("create repo root");

        let err = write_file_in_repo_root(&repo_root, "config/settings.yaml", "foo: [bar")
            .expect_err("invalid yaml should fail");

        assert!(
            err.contains("Syntax error in config/settings.yaml"),
            "{err}"
        );
        assert!(!repo_root.join("config/settings.yaml").exists());
    }

    #[test]
    fn write_file_in_repo_root_rejects_paths_outside_repo_root() {
        let tmp = tempdir().expect("create temp dir");
        let repo_root = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_root).expect("create repo root");

        let err = write_file_in_repo_root(&repo_root, "../escape.txt", "nope")
            .expect_err("path escape should fail");

        assert!(err.contains("Path escapes the config directory"), "{err}");
        assert!(!tmp.path().join("escape.txt").exists());
    }
}
