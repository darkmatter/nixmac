//! `search_code` tool: ripgrep over the codebase.

use anyhow::{anyhow, Result};

use crate::evolve::messages::Tool;
use crate::evolve::search_code::execute_search_code;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "search_code".to_string(),
        description: "Search for text patterns in the codebase using ripgrep. \
                     This helps locate where functions or variables are defined or used. \
                     Output format: one match per line as file:line:text, where \
                     text is the matching line content.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "Optional glob pattern for files to search in"
                }
            },
            "required": ["pattern"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let pattern = ctx.args["pattern"]
        .as_str()
        .ok_or_else(|| anyhow!("search_code: missing pattern"))?;
    let file_pattern = ctx.args["file_pattern"].as_str();
    let output = execute_search_code(ctx.repo_root, pattern, file_pattern, ctx.gitignore_matcher)?;
    Ok(ToolResult::Continue(output))
}
