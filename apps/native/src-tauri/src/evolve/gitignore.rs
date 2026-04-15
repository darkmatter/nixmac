use anyhow::{anyhow, Result};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::fs;
use std::path::{Path, PathBuf};

/// Load all `.gitignore` files under the base config directory.
pub(crate) fn load_gitignore_matcher(base: &Path) -> Result<Option<Gitignore>> {
    let mut gitignore_paths = Vec::new();
    collect_gitignore_files(base, &mut gitignore_paths)?;

    if gitignore_paths.is_empty() {
        return Ok(None);
    }

    gitignore_paths.sort();

    let mut builder = GitignoreBuilder::new(base);
    for gitignore_path in gitignore_paths {
        builder.add(gitignore_path);
    }

    let matcher = builder.build().map_err(|e| {
        anyhow!(
            "Failed to parse one or more .gitignore files in {}: {}",
            base.display(),
            e
        )
    })?;

    Ok(Some(matcher))
}

/// Returns true when `relative_path` is ignored by the provided gitignore matcher.
pub(crate) fn is_ignored_by_matcher(
    matcher: Option<&Gitignore>,
    relative_path: &Path,
    is_dir: bool,
) -> bool {
    matcher
        .map(|m| m.matched_path_or_any_parents(relative_path, is_dir).is_ignore())
        .unwrap_or(false)
}

fn collect_gitignore_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir)
        .map_err(|e| anyhow!("Failed to read directory {}: {}", dir.display(), e))?
    {
        let entry = entry
            .map_err(|e| anyhow!("Failed to read directory entry in {}: {}", dir.display(), e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| anyhow!("Failed to get file type for {}: {}", entry.path().display(), e))?;
        let path = entry.path();
        let name = entry.file_name();

        if file_type.is_file() && name == ".gitignore" {
            out.push(path);
            continue;
        }

        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        if super::IGNORED_DIRS.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }

        collect_gitignore_files(&path, out)?;
    }

    Ok(())
}
