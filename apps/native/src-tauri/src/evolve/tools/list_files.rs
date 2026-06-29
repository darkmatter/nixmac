//! `list_files` tool: glob the config directory (gitignore-aware).

use anyhow::{Result, anyhow};
use log::{debug, info};
use std::path::Component;

use crate::evolve::IGNORED_DIRS;
use crate::evolve::file_ops::{ensure_path_under_base, join_in_dir};
use crate::evolve::gitignore::is_ignored_by_matcher;
use crate::evolve::messages::Tool;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "list_files".to_string(),
        description:
            "List files in the config directory. Use glob patterns to find specific file types."
                .to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern (default: **/*)"
                }
            }
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let repo_root = ctx.repo_root;
    let pattern = ctx.args["pattern"].as_str().unwrap_or("**/*");
    // Validate and normalize the provided glob pattern so it cannot
    // escape `base` (reject absolute/prefix components) and so any
    // `..`/`.` components are resolved before we run the glob.
    let full_pattern = join_in_dir(repo_root, pattern)?;
    info!("Listing files matching: {}", full_pattern.display());

    let ignored_dirs = IGNORED_DIRS;
    let matched_files = glob::glob(full_pattern.to_str().unwrap())
        .map_err(|e| anyhow!("Invalid glob pattern: {}", e))?
        .filter_map(|p| p.ok())
        .filter(|p| p.is_file())
        .collect::<Vec<_>>();

    let mut files: Vec<String> = Vec::new();
    let mut escaped_matches: Vec<String> = Vec::new();

    for p in matched_files {
        if ensure_path_under_base(repo_root, &p).is_err() {
            escaped_matches.push(p.display().to_string());
            continue;
        }

        // Strip the normalized `base` so results are returned
        // relative to the same directory we validated above.
        let Some(rel) = p.strip_prefix(repo_root).ok() else {
            continue;
        };

        if let Some(Component::Normal(name)) = rel.components().next() {
            if ignored_dirs.contains(&name.to_string_lossy().as_ref()) {
                continue;
            }
        }

        if is_ignored_by_matcher(ctx.gitignore_matcher, rel, false) {
            continue;
        }

        files.push(rel.to_string_lossy().to_string());
    }

    if !escaped_matches.is_empty() {
        let _sample = escaped_matches
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");

        // Don't return the sample as part of the error return since it contains local paths outside git repository.
        return Err(anyhow!(
            "list_files matched one or more files outside git repository after symlink resolution. pattern='{}' git repository='{}'. Fix: narrow the pattern to files under git repository and avoid symlink targets outside git repository.",
            pattern,
            repo_root.display(),
        ));
    }

    debug!("Found {} files", files.len());
    Ok(ToolResult::Continue(files.join("\n")))
}
