//! `read_file` tool: read a file's contents (gitignore-aware).

use anyhow::{Result, anyhow};
use log::info;
use std::path::Path;

use crate::evolve::file_ops::resolve_existing_path_in_dir;
use crate::evolve::gitignore::is_path_ignored;
use crate::evolve::messages::Tool;
use crate::evolve::utils::normalize_relative_path;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "read_file".to_string(),
        description: "Read the contents of a file. Always read relevant files before making edits to understand the existing code structure and patterns.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the file"
                }
            },
            "required": ["path"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let path = ctx.args["path"]
        .as_str()
        .ok_or_else(|| anyhow!("read_file: missing path"))?;
    let normalized_rel = normalize_relative_path(Path::new(path))?;
    if is_path_ignored(ctx.gitignore_matcher, &normalized_rel)? {
        return Err(anyhow!(
            "read_file: '{}' is ignored by .gitignore in git repository at '{}'",
            path,
            ctx.repo_root.display()
        ));
    }

    let full_path = resolve_existing_path_in_dir(ctx.repo_root, path)?;
    info!("Reading file: {}", full_path.display());
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| anyhow!("Failed to read {}: {}", path, e))?;
    Ok(ToolResult::Continue(content))
}
