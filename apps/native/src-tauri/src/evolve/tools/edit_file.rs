//! `edit_file` tool: find-and-replace edits to a file.

use anyhow::{anyhow, Context, Result};
use log::info;

use crate::evolve::file_ops::apply_file_edits;
use crate::evolve::messages::Tool;
use crate::shared_types::FileEdit;

use super::{ensure_nixmac_edit_allowed, ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "edit_file".to_string(),
        description: "Edit a file by finding and replacing text. The search string must be \
                     unique in the file. For creating a new file or replacing an entire file, \
                     use empty search string. \
                     IMPORTANT: Always provide complete, production-ready code - never use \
                      placeholders, TODOs, or abbreviated implementations. \
                      NOTE: For .nix, .yaml, and .yml files, the edit will be rejected if syntax is invalid \
                      (e.g., unmatched braces/brackets, unclosed strings). Ensure edits maintain valid syntax. \
                      IMPORTANT: Under .nixmac, only exact .nixmac/<module>/data.json files may be edited; all other files are reserved.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the file"
                },
                "search": {
                    "type": "string",
                    "description": "Exact text to find (empty for new file)"
                },
                "replace": {
                    "type": "string",
                    "description": "Text to replace with"
                }
            },
            "required": ["path", "search", "replace"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
    let path = args["path"]
        .as_str()
        .ok_or_else(|| anyhow!("edit_file: missing path"))?;
    ensure_nixmac_edit_allowed("edit_file", path)?;
    let search = args["search"]
        .as_str()
        .ok_or_else(|| anyhow!("edit_file: missing search"))?;
    let replace = args["replace"]
        .as_str()
        .ok_or_else(|| anyhow!("edit_file: missing replace"))?;

    info!("Editing file: {}", path);
    apply_file_edits(
        ctx.repo_root,
        &FileEdit {
            path: path.to_string(),
            search: search.to_string(),
            replace: replace.to_string(),
        },
        ctx.gitignore_matcher,
    )
    .with_context(|| {
        format!(
            "edit_file failed for path='{}' (search_len={}, replace_len={})",
            path,
            search.len(),
            replace.len(),
        )
    })?;

    Ok(ToolResult::Edit(FileEdit {
        path: path.to_string(),
        search: search.to_string(),
        replace: replace.to_string(),
    }))
}
