// Builds a picture of the config_dir for the evolve provider to use as context.
// This is used to DRAMATICALLY cut down on the amount of file system exploration
// that the agent needs to do using the `list_files` tool.
use anyhow::{Context, Result};
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
struct EntryView {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

pub fn format_config_dir_context(config_dir: &str) -> Result<String> {
    format_config_dir_context_with_max_depth(config_dir, DEFAULT_MAX_DEPTH)
}

// This will generate a directory structure ASCII artwork like
// CONFIG_DIR/
// ├── file1.txt
// ├── file2.txt
// ├── dir1/
// │   ├── file3.txt
// etc.
pub fn format_config_dir_context_with_max_depth(
    config_dir: &str,
    max_depth: usize,
) -> Result<String> {
    let root = Path::new(config_dir);
    if !root.exists() {
        return Err(anyhow::anyhow!("config_dir does not exist: {}", config_dir));
    }
    if !root.is_dir() {
        return Err(anyhow::anyhow!(
            "config_dir is not a directory: {}",
            config_dir
        ));
    }

    let mut output = String::from("CONFIG_DIR/\n");
    let mut rendered_entries = 0usize;
    render_dir(root, "", 0, max_depth, &mut output, &mut rendered_entries)?;
    Ok(output.trim_end().to_string())
}

fn render_dir(
    dir: &Path,
    prefix: &str,
    depth: usize,
    max_depth: usize,
    output: &mut String,
    rendered_entries: &mut usize,
) -> Result<()> {
    let mut entries = collect_filtered_entries(dir)?;

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for (index, entry) in entries.iter().enumerate() {
        if *rendered_entries >= MAX_RENDERED_ENTRIES {
            let connector = if index + 1 == entries.len() {
                "└── "
            } else {
                "├── "
            };
            output.push_str(prefix);
            output.push_str(connector);
            output.push_str("... (truncated)\n");
            break;
        }

        let is_last = index + 1 == entries.len();
        let connector = if is_last { "└── " } else { "├── " };

        output.push_str(prefix);
        output.push_str(connector);
        output.push_str(&entry.name);
        if entry.is_dir {
            output.push('/');
        }
        output.push('\n');

        *rendered_entries += 1;

        if entry.is_dir && depth < max_depth {
            let child_prefix = if is_last {
                format!("{}    ", prefix)
            } else {
                format!("{}│   ", prefix)
            };
            render_dir(
                &entry.path,
                &child_prefix,
                depth + 1,
                max_depth,
                output,
                rendered_entries,
            )?;
        }
    }

    Ok(())
}

fn collect_filtered_entries(dir: &Path) -> Result<Vec<EntryView>> {
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

        if should_skip_name(&name) {
            continue;
        }

        if !file_type.is_dir() && !is_allowed_file(&name, &entry.path()) {
            continue;
        }

        out.push(EntryView {
            name,
            path: entry.path(),
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
