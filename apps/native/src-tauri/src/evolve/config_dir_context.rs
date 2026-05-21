// Builds a picture of the config_dir for the evolve provider to use as context.
// This is used to DRAMATICALLY cut down on the amount of file system exploration
// that the agent needs to do using the `list_files` tool.
use super::gitignore::{is_ignored_by_matcher, load_gitignore_matcher};
use anyhow::{Context, Result};
use ignore::gitignore::Gitignore;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_RENDERED_ENTRIES: usize = 500;
const DEFAULT_MAX_DEPTH: usize = 6;

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

pub fn format_config_dir_context(repo_root: &Path, config_dir: &str) -> Result<String> {
    format_config_dir_context_with_max_depth(repo_root, config_dir, DEFAULT_MAX_DEPTH)
}

// Returns a flattened list of repo-root-relative file paths under config_dir,
// one path per line and always prefixed with '/'.
pub fn format_config_dir_context_with_max_depth(
    repo_root: &Path,
    config_dir: &str,
    max_depth: usize,
) -> Result<String> {
    let config_dir_path = Path::new(config_dir);
    if !config_dir_path.exists() {
        return Err(anyhow::anyhow!("config_dir does not exist: {}", config_dir));
    }
    if !config_dir_path.is_dir() {
        return Err(anyhow::anyhow!(
            "config_dir is not a directory: {}",
            config_dir
        ));
    }

    // Use the repo root for the ignore base since we may have ignored things at a higher level than the nix config dir.
    let gitignore = load_gitignore_matcher(repo_root)?;

    let mut output_paths = Vec::new();
    let mut rendered_entries = 0usize;
    collect_file_paths(
        repo_root,
        config_dir_path,
        gitignore.as_ref(),
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
    gitignore: Option<&Gitignore>,
    depth: usize,
    max_depth: usize,
    output_paths: &mut Vec<String>,
    rendered_entries: &mut usize,
) -> Result<()> {
    let mut entries = collect_filtered_entries(repo_root, dir, gitignore)?;
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for entry in entries {
        if *rendered_entries >= MAX_RENDERED_ENTRIES {
            output_paths.push("... (truncated)".to_string());
            break;
        }

        if entry.is_dir {
            if depth < max_depth {
                collect_file_paths(
                    repo_root,
                    &entry.path,
                    gitignore,
                    depth + 1,
                    max_depth,
                    output_paths,
                    rendered_entries,
                )?;
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
        let rendered_path = format!(
            "{}",
            relative_for_output.to_string_lossy().replace('\\', "/")
        );
        output_paths.push(rendered_path);
        *rendered_entries += 1;
    }

    Ok(())
}

fn collect_filtered_entries(
    repo_root: &Path,
    dir: &Path,
    gitignore: Option<&Gitignore>,
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

        if is_ignored_by_matcher(gitignore, relative_for_gitignore, file_type.is_dir()) {
            continue;
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

        let context = format_config_dir_context(
            &repo_root,
            config_dir.to_str().context("utf-8 config path")?,
        )?;

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

        let context = format_config_dir_context(
            &repo_root,
            repo_root.to_str().context("utf-8 config path")?,
        )?;

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

        fs::write(repo_root.join(".gitignore"), "nix/os/secret.txt\n")?;
        fs::write(config_dir.join("visible.txt"), "hello")?;
        fs::write(config_dir.join("secret.txt"), "hidden")?;

        let context =
            format_config_dir_context(&repo_root, config_dir.to_str().context("utf-8 path")?)?;

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
        fs::write(config_dir.join("nested/.gitignore"), "secret.txt\n")?;
        fs::write(config_dir.join("nested/visible.txt"), "hello")?;
        fs::write(config_dir.join("nested/secret.txt"), "hidden")?;

        let context =
            format_config_dir_context(&repo_root, config_dir.to_str().context("utf-8 path")?)?;

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

        let context =
            format_config_dir_context(&repo_root, config_dir.to_str().context("utf-8 path")?)?;

        assert!(context.contains("nix/os/inside.md"), "context: {context}");
        assert!(!context.contains("outside.md"), "context: {context}");
        Ok(())
    }
}
