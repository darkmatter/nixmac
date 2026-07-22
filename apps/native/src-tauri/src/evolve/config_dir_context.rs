// Builds a picture of the config_dir for the evolve provider to use as context.
// This is used to DRAMATICALLY cut down on the amount of file system exploration
// that the agent needs to do using the `list_files` tool.
use super::gitignore::{GitignoreChecker, VisibleFiles};
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_RENDERED_ENTRIES: usize = 500;

/// The max depth we travel starting at the nix config directory.
/// You get the number of levels from the repo root "for free".
const MAX_CONFIG_DIR_DEPTH: usize = 6;

const ALLOWED_FILE_NAMES: &[&str] = &[
    "default.nix",
    "flake.lock",
    "flake.nix",
    "home.nix",
    "Makefile",
    "README",
    "README.md",
];

const ALLOWED_EXTENSIONS: &[&str] = &[
    "gif", "jpg", "json", "jsonc", "lock", "md", "nix", "png", "sh", "svg", "toml", "txt", "yaml",
    "yml", "zsh",
];

#[derive(Clone, Debug)]
struct DirEntryView {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

fn calc_max_depth(repo_root: &Path, config_dir: &Path) -> Result<usize> {
    // Max depth should be the default config dir depth + the number of levels (if any)
    // between the repo root and the config dir. For example, if the config dir is at my/repo/nix/os,
    // then the max depth should be 6 (default) + 2 (nix/os) = 8.
    // Expects both paths in the same (canonical) spelling; a config dir that is
    // not inside the repo root is a configuration error, not a depth of 0 —
    // the silent 0 fallback used to hide exactly the symlink mismatch that
    // killed the whole render further down.
    let relative_depth = config_dir
        .strip_prefix(repo_root)
        .map(|relative_path| relative_path.components().count())
        .with_context(|| {
            format!(
                "config_dir '{}' is not inside repo root '{}'",
                config_dir.display(),
                repo_root.display()
            )
        })?;

    Ok(MAX_CONFIG_DIR_DEPTH + relative_depth)
}

// Returns a flattened list of repo-root-relative file paths under config_dir,
// one path per line.
pub fn format_config_dir_context(repo_root: &Path, config_dir: &Path) -> Result<String> {
    if !config_dir.exists() {
        return Err(anyhow::anyhow!(
            "config_dir does not exist: {}",
            config_dir.display()
        ));
    }
    if !config_dir.is_dir() {
        return Err(anyhow::anyhow!(
            "config_dir is not a directory: {}",
            config_dir.display()
        ));
    }

    // Canonicalize both sides once and derive every child path from the
    // canonical root. The repo root usually comes from
    // git2::Repository::discover, which resolves symlinks, while config_dir is
    // caller-supplied; on macOS `/tmp` and `/private/tmp` name the same
    // directory but are not lexically prefix-compatible, so mixed spellings
    // broke every strip_prefix below and lost the entire repo view.
    let repo_root = repo_root
        .canonicalize()
        .with_context(|| format!("failed to canonicalize repo root: {}", repo_root.display()))?;
    let config_dir = config_dir.canonicalize().with_context(|| {
        format!(
            "failed to canonicalize config_dir: {}",
            config_dir.display()
        )
    })?;
    let max_depth = calc_max_depth(&repo_root, &config_dir)?;

    format_config_dir_context_with_max_depth(&repo_root, &config_dir, max_depth)
}

// Inner walk over already-canonicalized paths.
fn format_config_dir_context_with_max_depth(
    repo_root: &Path,
    config_dir: &Path,
    max_depth: usize,
) -> Result<String> {
    // Use the repo root for the ignore base since we may have ignored things at a higher level than the nix config dir.
    let visible = GitignoreChecker::new(repo_root)?
        .map(|checker| checker.visible_files())
        .transpose()?;

    let mut output_paths = Vec::new();
    let mut rendered_entries = 0usize;
    collect_file_paths(
        repo_root,
        config_dir,
        visible.as_ref(),
        0,
        max_depth,
        &mut output_paths,
        &mut rendered_entries,
    )?;

    output_paths.sort();
    Ok(output_paths.join("\n"))
}

#[allow(clippy::too_many_arguments)]
fn collect_file_paths(
    repo_root: &Path,
    dir: &Path,
    visible: Option<&VisibleFiles>,
    depth: usize,
    max_depth: usize,
    output_paths: &mut Vec<String>,
    rendered_entries: &mut usize,
) -> Result<()> {
    let mut entries = collect_filtered_entries(repo_root, dir, visible)?;
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for entry in entries {
        // If a parent or earlier sibling already caused truncation, stop immediately.
        if *rendered_entries >= MAX_RENDERED_ENTRIES {
            return Ok(());
        }

        if entry.is_dir {
            if depth < max_depth {
                collect_file_paths(
                    repo_root,
                    &entry.path,
                    visible,
                    depth + 1,
                    max_depth,
                    output_paths,
                    rendered_entries,
                )?;
                // If the recursive call hit the limit and added the truncation marker,
                // propagate the early return so ancestors don't add duplicates.
                if *rendered_entries >= MAX_RENDERED_ENTRIES {
                    return Ok(());
                }
            }
            continue;
        }

        let relative_for_output = entry.path.strip_prefix(repo_root).with_context(|| {
            format!(
                "failed to strip repo root prefix '{}' from '{}'",
                repo_root.display(),
                entry.path.display()
            )
        })?;
        let rendered_path = relative_for_output
            .to_string_lossy()
            .replace('\\', "/")
            .to_string();
        output_paths.push(rendered_path);
        *rendered_entries += 1;

        // If we've just reached the limit, append a single truncation marker and
        // return so that parent callers don't add duplicates.
        if *rendered_entries >= MAX_RENDERED_ENTRIES {
            output_paths.push("... (truncated)".to_string());
            return Ok(());
        }
    }

    Ok(())
}

fn collect_filtered_entries(
    repo_root: &Path,
    dir: &Path,
    visible: Option<&VisibleFiles>,
) -> Result<Vec<DirEntryView>> {
    let mut out = Vec::new();
    for entry in
        fs::read_dir(dir).with_context(|| format!("failed to read directory: {}", dir.display()))?
    {
        let entry =
            entry.with_context(|| format!("failed to iterate directory: {}", dir.display()))?;
        let file_type = entry
            .file_type()
            .with_context(|| format!("failed to read file type for {}", entry.path().display()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        let relative_for_gitignore = path.strip_prefix(repo_root).with_context(|| {
            format!(
                "failed to strip repo root prefix '{}' from '{}'",
                repo_root.display(),
                path.display()
            )
        })?;

        if should_skip_name(&name) {
            continue;
        }

        if let Some(visible) = visible {
            let is_visible = if file_type.is_dir() {
                visible.contains_dir(relative_for_gitignore)
            } else {
                visible.contains_file(relative_for_gitignore)
            };
            if !is_visible {
                continue;
            }
        }

        if !file_type.is_dir() && !is_allowed_file(&name, &path) {
            continue;
        }

        out.push(DirEntryView {
            name,
            path,
            is_dir: file_type.is_dir(),
        });
    }
    Ok(out)
}

// Skip the results file and any hidden files/folders.
fn should_skip_name(name: &str) -> bool {
    name == "result" || name.starts_with('.')
}

// Allowed filenames are either in the ALLOWED_FILE_NAMES list
// OR have an extension in the ALLOWED_EXTENSIONS list.
fn is_allowed_file(name: &str, path: &Path) -> bool {
    if ALLOWED_FILE_NAMES.contains(&name) {
        return true;
    }

    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext_lower = ext.to_ascii_lowercase();
    ALLOWED_EXTENSIONS.contains(&ext_lower.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn returns_repo_relative_flat_paths_when_config_is_nested() -> Result<()> {
        let tmp = tempdir()?;
        let repo_root = tmp.path().join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(config_dir.join("modules/darwin"))?;
        fs::write(config_dir.join("flake.nix"), "{ }")?;
        fs::write(config_dir.join("modules/darwin/default.nix"), "{ }")?;

        let context = format_config_dir_context(&repo_root, &config_dir)?;

        assert!(context.contains("nix/os/flake.nix"), "context: {context}");
        assert!(
            context.contains("nix/os/modules/darwin/default.nix"),
            "context: {context}"
        );
        Ok(())
    }

    #[test]
    fn returns_root_relative_flat_paths_when_repo_root_and_config_dir_are_same() -> Result<()> {
        let tmp = tempdir()?;
        let repo_root = tmp.path().join("repo");
        fs::create_dir_all(repo_root.join("modules"))?;
        fs::write(repo_root.join("flake.nix"), "{ }")?;
        fs::write(repo_root.join("modules/default.nix"), "{ }")?;

        let context = format_config_dir_context(&repo_root, &repo_root)?;

        assert!(context.contains("flake.nix"), "context: {context}");
        assert!(
            context.contains("modules/default.nix"),
            "context: {context}"
        );
        Ok(())
    }

    #[test]
    fn excludes_files_ignored_by_repo_root_gitignore_with_nested_path_rule() -> Result<()> {
        let tmp = tempdir()?;
        let repo_root = tmp.path().join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(&config_dir)?;
        git2::Repository::init(&repo_root)?;

        fs::write(repo_root.join(".gitignore"), "nix/os/secret.txt\n")?;
        fs::write(config_dir.join("visible.txt"), "hello")?;
        fs::write(config_dir.join("secret.txt"), "hidden")?;

        let context = format_config_dir_context(&repo_root, &config_dir)?;

        assert!(context.contains("nix/os/visible.txt"), "context: {context}");
        assert!(!context.contains("secret.txt"), "context: {context}");
        Ok(())
    }

    #[test]
    fn excludes_files_ignored_by_subdir_gitignore() -> Result<()> {
        let tmp = tempdir()?;
        let repo_root = tmp.path().join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(config_dir.join("nested"))?;
        git2::Repository::init(&repo_root)?;
        fs::write(config_dir.join("nested/.gitignore"), "secret.txt\n")?;
        fs::write(config_dir.join("nested/visible.txt"), "hello")?;
        fs::write(config_dir.join("nested/secret.txt"), "hidden")?;

        let context = format_config_dir_context(&repo_root, &config_dir)?;

        assert!(
            context.contains("nix/os/nested/visible.txt"),
            "context: {context}"
        );
        assert!(!context.contains("secret.txt"), "context: {context}");
        Ok(())
    }

    #[test]
    fn does_not_render_files_outside_config_dir() -> Result<()> {
        let tmp = tempdir()?;
        let repo_root = tmp.path().join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(&config_dir)?;

        fs::write(repo_root.join("outside.md"), "outside")?;
        fs::write(config_dir.join("inside.md"), "inside")?;

        let context = format_config_dir_context(&repo_root, &config_dir)?;

        assert!(context.contains("nix/os/inside.md"), "context: {context}");
        assert!(!context.contains("outside.md"), "context: {context}");
        Ok(())
    }

    #[test]
    fn calc_max_depth_same_dir() -> Result<()> {
        let repo_root = Path::new("/repo");
        let config_dir = Path::new("/repo");
        assert_eq!(calc_max_depth(repo_root, config_dir)?, MAX_CONFIG_DIR_DEPTH);
        Ok(())
    }

    #[test]
    fn calc_max_depth_nested_dir() -> Result<()> {
        let repo_root = Path::new("/repo");
        let config_dir = Path::new("/repo/nix/os");
        assert_eq!(
            calc_max_depth(repo_root, config_dir)?,
            MAX_CONFIG_DIR_DEPTH + 2
        );
        Ok(())
    }

    #[test]
    fn calc_max_depth_errors_when_config_dir_is_outside_repo_root() {
        let err = calc_max_depth(Path::new("/repo"), Path::new("/elsewhere/nix/os"))
            .expect_err("config dir outside the repo root must be an error, not depth 0");
        assert!(
            err.to_string().contains("not inside"),
            "unexpected: {err:#}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn renders_when_repo_root_and_config_dir_use_different_symlink_spellings() -> Result<()> {
        // Mirror the production mismatch behind the 2026-07-20 eval runs'
        // "(Failed to render repo view)": git2 resolves the repo root to its
        // canonical spelling while the caller-supplied config dir keeps the
        // symlinked one — macOS names the same directory /tmp and
        // /private/tmp.
        let tmp = tempdir()?;
        let real_root = tmp.path().join("real");
        let repo_root = real_root.join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(config_dir.join("modules"))?;
        fs::write(config_dir.join("flake.nix"), "{ }")?;
        fs::write(config_dir.join("modules/default.nix"), "{ }")?;
        std::os::unix::fs::symlink(&real_root, tmp.path().join("alias"))?;

        let canonical_repo_root = repo_root.canonicalize()?;
        let aliased_config_dir = tmp.path().join("alias/repo/nix/os");

        let context = format_config_dir_context(&canonical_repo_root, &aliased_config_dir)?;
        assert!(context.contains("nix/os/flake.nix"), "context: {context}");
        assert!(
            context.contains("nix/os/modules/default.nix"),
            "context: {context}"
        );

        // And the reverse spelling mismatch.
        let aliased_repo_root = tmp.path().join("alias/repo");
        let context = format_config_dir_context(&aliased_repo_root, &config_dir.canonicalize()?)?;
        assert!(context.contains("nix/os/flake.nix"), "context: {context}");
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn depth_budget_survives_symlink_spelling_mismatch() -> Result<()> {
        // A partial fix that only canonicalized the render would still walk
        // with MAX_CONFIG_DIR_DEPTH instead of MAX_CONFIG_DIR_DEPTH + 2 for a
        // nested config dir, because calc_max_depth used to swallow the
        // prefix mismatch as depth 0.
        let tmp = tempdir()?;
        let real_root = tmp.path().join("real");
        let repo_root = real_root.join("repo");
        let config_dir = repo_root.join("nix/os");
        fs::create_dir_all(&config_dir)?;
        std::os::unix::fs::symlink(&real_root, tmp.path().join("alias"))?;

        let canonical_repo_root = repo_root.canonicalize()?;
        let aliased_config_dir = tmp.path().join("alias/repo/nix/os");

        assert_eq!(
            calc_max_depth(&canonical_repo_root, &aliased_config_dir.canonicalize()?)?,
            MAX_CONFIG_DIR_DEPTH + 2
        );
        Ok(())
    }
}
