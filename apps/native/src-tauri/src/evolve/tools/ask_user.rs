//! `ask_user` tool: ask the user a question and wait for a response.

use anyhow::{anyhow, Result};
use log::info;

use crate::evolve::messages::Tool;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "ask_user".to_string(),
        description: "Ask the user a question and wait for their response. Use this when you \
                     need clarification, want to confirm a destructive action, or need the user \
                     to choose between options. The question should be clear and specific. \
                     Optionally provide a list of choices for the user to pick from.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to ask the user"
                },
                "choices": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional list of choices for the user to pick from"
                }
            },
            "required": ["question"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
    let question = args["question"]
        .as_str()
        .ok_or_else(|| anyhow!("ask_user: missing question"))?
        .to_string();
    let choices = args["choices"].as_array().map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect::<Vec<_>>()
    });

    info!("❓ Agent asking user: {}", question);
    Ok(ToolResult::Question { question, choices })
}
