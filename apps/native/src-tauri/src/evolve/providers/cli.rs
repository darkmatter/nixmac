use super::{AiProvider, ProviderError, ProviderResponse};
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use crate::providers::cli::{run_cli_process, CliTool};
use anyhow::anyhow;
use async_trait::async_trait;
use log::{debug, warn};
use serde_json::Value;

pub struct CliProvider {
    tool: CliTool,
    model: String,
}

impl CliProvider {
    pub fn new(tool: CliTool, model: String) -> Self {
        Self { tool, model }
    }
}

/// Encode tool definitions as structured text for inclusion in the prompt.
fn encode_tools(tools: &[GenericTool]) -> String {
    if tools.is_empty() {
        return String::new();
    }

    let mut out = String::from("\n# Available Tools\n\n");

    for tool in tools {
        out.push_str(&format!("## {}\n", tool.name));
        out.push_str(&format!("{}\n", tool.description));
        out.push_str(&format!(
            "Parameters: {}\n\n",
            serde_json::to_string_pretty(&tool.parameters).unwrap_or_default()
        ));
    }

    out.push_str(
        "# Tool Call Instructions\n\n\
         When you need to use a tool, respond with ONLY a JSON object in this exact format (no other text before or after):\n\
         {\"tool_calls\": [{\"name\": \"tool_name\", \"arguments\": {\"param\": \"value\"}}]}\n\n\
         When you want to respond with text (no tool call), respond normally as plain text.\n\
         NEVER mix tool calls with regular text in the same response.\n",
    );

    out
}

/// Serialize the full message history + tool definitions into a single prompt string.
fn serialize_messages(messages: &[Message], tools: &[GenericTool]) -> String {
    let mut out = String::new();

    for msg in messages {
        match msg {
            Message::System { content } => {
                out.push_str(content);
                out.push_str(&encode_tools(tools));
                out.push('\n');
            }
            Message::User { content } => {
                out.push_str(&format!("[User]\n{}\n\n", content));
            }
            Message::Assistant {
                content,
                tool_calls,
            } => {
                out.push_str("[Assistant]\n");
                if let Some(c) = content {
                    out.push_str(c);
                    out.push('\n');
                }
                if let Some(calls) = tool_calls {
                    let json = serde_json::json!({
                        "tool_calls": calls.iter().map(|c| {
                            serde_json::json!({
                                "name": c.name,
                                "arguments": serde_json::from_str::<Value>(&c.arguments)
                                    .unwrap_or(Value::Object(Default::default()))
                            })
                        }).collect::<Vec<_>>()
                    });
                    out.push_str(&serde_json::to_string(&json).unwrap_or_default());
                    out.push('\n');
                }
                out.push('\n');
            }
            Message::Tool {
                tool_call_id: _,
                content,
            } => {
                out.push_str(&format!("[Tool Result]\n{}\n\n", content));
            }
        }
    }

    out
}

/// Parse the CLI response text into a `Message`, detecting tool calls vs plain text.
///
/// CLI tools (especially Claude with `-p`) may return a multi-line result where
/// each line is a separate `{"tool_calls": [...]}` JSON object. We flatten all
/// tool calls across lines into a single `Message::Assistant` so the evolve loop
/// can execute them sequentially.
fn parse_response(tool: &CliTool, raw: &str) -> Result<Message, ProviderError> {
    let text = match tool {
        CliTool::Claude => {
            let json: Value = serde_json::from_str(raw.trim()).map_err(|e| {
                ProviderError::Other(anyhow!("Failed to parse Claude CLI JSON: {}", e))
            })?;

            if json
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                let err = json
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                return Err(ProviderError::Other(anyhow!("Claude CLI error: {}", err)));
            }

            json.get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        }
        CliTool::Codex | CliTool::OpenCode => raw.trim().to_string(),
    };

    // Single-object parse (handles the common single-line case)
    if let Some(msg) = try_parse_tool_calls(&text) {
        return Ok(msg);
    }

    // Multi-line: try parsing each non-empty line as a tool-call JSON and
    // flatten all discovered tool calls into one message.
    let mut all_calls: Vec<ToolCall> = Vec::new();
    let mut plain_parts: Vec<String> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(Message::Assistant {
            tool_calls: Some(calls),
            ..
        }) = try_parse_tool_calls(trimmed)
        {
            all_calls.extend(calls);
        } else {
            plain_parts.push(trimmed.to_string());
        }
    }

    if !all_calls.is_empty() {
        // Re-number IDs so they're unique across the flattened set
        for (i, call) in all_calls.iter_mut().enumerate() {
            call.id = format!("call_cli_{}", i);
        }
        let content = if plain_parts.is_empty() {
            None
        } else {
            Some(plain_parts.join("\n"))
        };
        debug!(
            "Parsed {} tool call(s) from multi-line CLI response",
            all_calls.len()
        );
        return Ok(Message::Assistant {
            content,
            tool_calls: Some(all_calls),
        });
    }

    // Plain text response
    let content = if text.is_empty() { None } else { Some(text) };
    Ok(Message::Assistant {
        content,
        tool_calls: None,
    })
}

/// Attempt to interpret the text as a structured tool-call response.
///
/// Recognises several formats models commonly produce:
///   - `{"tool_calls": [{"name": "...", "arguments": {...}}]}`
///   - `{"name": "...", "arguments": {...}}`
///   - `{"name": "...", "parameters": {...}}`  (Ollama-style)
fn try_parse_tool_calls(text: &str) -> Option<Message> {
    let json: Value = serde_json::from_str(text.trim()).ok()?;

    // Format: {"tool_calls": [...]}
    if let Some(calls) = json.get("tool_calls").and_then(|v| v.as_array()) {
        let tool_calls: Vec<ToolCall> = calls
            .iter()
            .enumerate()
            .filter_map(|(i, call)| {
                let name = call.get("name")?.as_str()?.to_string();
                let arguments = call
                    .get("arguments")
                    .map(|a| a.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                Some(ToolCall {
                    id: format!("call_cli_{}", i),
                    name,
                    arguments,
                })
            })
            .collect();

        if !tool_calls.is_empty() {
            return Some(Message::Assistant {
                content: None,
                tool_calls: Some(tool_calls),
            });
        }
    }

    // Format: {"name": "...", "arguments": {...}}
    if let (Some(name), Some(args)) = (
        json.get("name").and_then(|v| v.as_str()),
        json.get("arguments"),
    ) {
        warn!(
            "CLI model returned single-object tool call ({}), converting",
            name
        );
        return Some(Message::Assistant {
            content: None,
            tool_calls: Some(vec![ToolCall {
                id: "call_cli_0".to_string(),
                name: name.to_string(),
                arguments: args.to_string(),
            }]),
        });
    }

    // Format: {"name": "...", "parameters": {...}} (Ollama-style)
    if let (Some(name), Some(params)) = (
        json.get("name").and_then(|v| v.as_str()),
        json.get("parameters"),
    ) {
        warn!(
            "CLI model returned parameters-style tool call ({}), converting",
            name
        );
        return Some(Message::Assistant {
            content: None,
            tool_calls: Some(vec![ToolCall {
                id: "call_cli_0".to_string(),
                name: name.to_string(),
                arguments: params.to_string(),
            }]),
        });
    }

    None
}

#[async_trait]
impl AiProvider for CliProvider {
    fn model_name(&self) -> String {
        format!("{}:{}", self.tool.binary_name(), self.model)
    }

    async fn completion(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let prompt = serialize_messages(messages, tools);

        debug!(
            "CLI evolve via {} ({} bytes prompt)",
            self.tool.display_name(),
            prompt.len()
        );

        let mut args: Vec<String> = match &self.tool {
            CliTool::Claude => vec![
                "-p".into(),
                "--output-format".into(),
                "json".into(),
            ],
            CliTool::Codex => vec!["--quiet".into()],
            CliTool::OpenCode => vec!["-p".into()],
        };

        // Append model flag when applicable
        if let Some(flag) = self.tool.model_flag() {
            if !self.model.is_empty() && self.model != self.tool.binary_name() {
                args.push(flag.to_string());
                args.push(self.model.clone());
            }
        }

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let raw =
            run_cli_process(self.tool.binary_name(), &arg_refs, &prompt, 300)
                .await
                .map_err(ProviderError::Other)?;

        let message = parse_response(&self.tool, &raw)?;

        Ok(ProviderResponse {
            message,
            usage: None,
        })
    }
}
