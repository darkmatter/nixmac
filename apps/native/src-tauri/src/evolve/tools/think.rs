//! `think` tool: structured step-by-step reasoning.

use anyhow::{anyhow, Result};
use log::{debug, info};

use crate::evolve::messages::Tool;

use super::{truncate_for_log, ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "think".to_string(),
        description: "Use this tool to think through problems step by step. You should use this \
                     tool FREQUENTLY - before reading files, before making edits, when analyzing \
                     errors, and when planning your approach. Categories: 'planning' for initial \
                     strategy, 'analysis' for understanding code, 'debugging' for fixing errors, \
                     'verification' for checking your work. Keep thought concise and actionable \
                     (prefer 1-2 sentences, <= 200 characters)."
            .to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["planning", "analysis", "debugging", "verification", "other"],
                    "description": "Category of thinking"
                },
                "thought": {
                    "type": "string",
                    "description": "Brief thought content, ideally 1-2 sentences and <= 200 characters"
                }
            },
            "required": ["category", "thought"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
    let category = args["category"].as_str().unwrap_or("other").to_string();
    let thought = args["thought"]
        .as_str()
        .ok_or_else(|| anyhow!("think: missing thought"))?
        .to_string();

    info!(
        "🧠 THINKING [{}]: {}",
        category,
        truncate_for_log(&thought, 200)
    );
    debug!("Full thought: {}", thought);

    Ok(ToolResult::Think { category, thought })
}
