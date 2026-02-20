//! Evolution module for AI-assisted configuration changes.
//!
//! An evolution represents a proposed configuration change (e.g., installing an app,
//! customizing settings). Each evolution is backed by git commits for traceability.
//!
//! Uses OpenAI function calling to generate structured file edits.

use std::path::{Component, Path, PathBuf};

/// Join a relative path into `base`, rejecting absolute paths and any path
/// that would escape `base` using `..` components.
pub(crate) fn join_in_dir(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let rel_path = Path::new(rel);

    if rel_path.is_absolute() {
        return Err(anyhow::anyhow!("Absolute paths are not allowed"));
    }

    // Detect attempts to escape the base via `..`
    let mut depth: isize = 0;
    for comp in rel_path.components() {
        match comp {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir => {
                if depth <= 0 {
                    return Err(anyhow::anyhow!("Path escapes the config directory"));
                }
                depth -= 1;
            }
            other => {
                return Err(anyhow::anyhow!("Unsupported path component: {:?}", other));
            }
        }
    }

    Ok(base.join(rel_path))
}

/// Apply an evolution's edits to the filesystem.
pub fn apply_file_edits(base: &Path, edit: &super::types::FileEdit) -> anyhow::Result<()> {
    let full_path = join_in_dir(base, &edit.path)?;

    if edit.search.is_empty() {
        // New file
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&full_path, &edit.replace)?;
    } else {
        // Edit existing file
        let content = std::fs::read_to_string(&full_path)?;

        // Verify search string exists and is unique
        let count = content.matches(&edit.search).count();
        if count == 0 {
            return Err(anyhow::anyhow!(
                "Search string not found in {}: {:?}",
                edit.path,
                edit.search.chars().take(50).collect::<String>()
            ));
        }
        if count > 1 {
            return Err(anyhow::anyhow!(
                "Search string found {} times in {} (must be unique)",
                count,
                edit.path
            ));
        }

        let new_content = content.replace(&edit.search, &edit.replace);
        std::fs::write(&full_path, new_content)?;
    }

    Ok(())
}
