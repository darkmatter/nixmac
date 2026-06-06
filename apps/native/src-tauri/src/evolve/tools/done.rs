//! `done` tool: signal that all changes are complete.

use anyhow::Result;
use log::info;

use crate::evolve::messages::Tool;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "done".to_string(),
        description: "Signal that all changes are complete. IMPORTANT: Only call this AFTER \
                     you have verified your changes with build_check and are confident they work.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Description of changes made"
                }
            },
            "required": ["summary"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let summary = ctx.args["summary"]
        .as_str()
        .unwrap_or("Changes complete")
        .to_string();
    info!("Agent signaled done: {}", summary);
    Ok(ToolResult::Done(summary))
}
