use super::{AiProvider, ProviderError, ProviderResponse, TokenUsage};
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use anyhow::anyhow;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

const DEFAULT_RETRY_ATTEMPTS: usize = 1;
const RETRY_GUIDANCE: &str = "Retry the previous step. Return either valid structured tool_calls or concise assistant content. Do not emit empty content with no tool_calls. If using tool_calls, keep arguments as strict JSON only.";

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            model,
        }
    }
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OllamaTool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OllamaToolCall {
    function: OllamaFunctionCall,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OllamaFunctionCall {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Clone, Serialize)]
struct OllamaTool {
    r#type: String,
    function: OllamaToolFunction,
}

#[derive(Clone, Serialize)]
struct OllamaToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Deserialize)]
#[allow(dead_code)] // some fields may be unused
struct ChatResponse {
    model: String,
    created_at: String,
    message: OllamaMessage,
    done: bool,
    total_duration: Option<u64>,
    load_duration: Option<u64>,
    prompt_eval_count: Option<u32>,
    prompt_eval_duration: Option<u64>,
    eval_count: Option<u32>,
    eval_duration: Option<u64>,
}

#[async_trait]
impl AiProvider for OllamaProvider {
    fn model_name(&self) -> String {
        self.model.clone()
    }

    async fn completion(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let mut ollama_messages = convert_to_ollama_messages(messages);
        let ollama_tools = convert_to_ollama_tools(tools);
        let url = format!("{}/api/chat", self.base_url);
        let mut retry_attempt = 0usize;

        loop {
            let request = ChatRequest {
                model: self.model.clone(),
                messages: ollama_messages.clone(),
                stream: false,
                tools: ollama_tools.clone(),
            };

            let response = self
                .client
                .post(&url)
                .json(&request)
                .send()
                .await
                .map_err(|e| ProviderError::Other(anyhow!(e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response
                    .text()
                    .await
                    .map_err(|e| ProviderError::Other(anyhow!(e)))?;

                let should_retry = retry_attempt < DEFAULT_RETRY_ATTEMPTS
                    && is_ollama_tool_call_parse_error(status, &error_text);

                if should_retry {
                    retry_attempt += 1;
                    log::warn!(
                        "Ollama parse error response; retrying completion ({}/{})",
                        retry_attempt,
                        DEFAULT_RETRY_ATTEMPTS
                    );
                    append_retry_guidance(&mut ollama_messages);
                    continue;
                }

                return Err(ProviderError::Http {
                    status,
                    body: error_text,
                });
            }

            let chat_response: ChatResponse = response
                .json()
                .await
                .map_err(|e| ProviderError::Other(anyhow!(e)))?;

            // Debug: Log the raw response to understand what we're getting
            log::debug!(
                "Ollama raw response - content: {:?}, tool_calls: {:?}",
                chat_response.message.content,
                chat_response.message.tool_calls
            );

            if retry_attempt < DEFAULT_RETRY_ATTEMPTS
                && is_empty_assistant_response(&chat_response.message)
            {
                retry_attempt += 1;
                log::warn!(
                    "Ollama returned empty assistant message without tool calls; retrying completion ({}/{})",
                    retry_attempt,
                    DEFAULT_RETRY_ATTEMPTS
                );
                append_retry_guidance(&mut ollama_messages);
                continue;
            }

            let message = convert_from_ollama_response(&chat_response);

            let usage = if let Some(eval_count) = chat_response.eval_count {
                Some(TokenUsage {
                    input: chat_response.prompt_eval_count.unwrap_or(0),
                    output: eval_count,
                    total: chat_response.prompt_eval_count.unwrap_or(0) + eval_count,
                })
            } else {
                None
            };

            return Ok(ProviderResponse { message, usage });
        }
    }
}

fn is_ollama_tool_call_parse_error(status: reqwest::StatusCode, body: &str) -> bool {
    status.as_u16() == 500 && body.contains("error parsing tool call")
}

fn is_empty_assistant_response(message: &OllamaMessage) -> bool {
    let no_content = message.content.trim().is_empty();
    let no_tool_calls = message
        .tool_calls
        .as_ref()
        .is_none_or(|tool_calls| tool_calls.is_empty());
    no_content && no_tool_calls
}

fn append_retry_guidance(messages: &mut Vec<OllamaMessage>) {
    messages.push(OllamaMessage {
        role: "user".to_string(),
        content: RETRY_GUIDANCE.to_string(),
        tool_calls: None,
    });
}

fn convert_to_ollama_tools(tools: &[GenericTool]) -> Vec<OllamaTool> {
    tools
        .iter()
        .map(|t| OllamaTool {
            r#type: "function".to_string(),
            function: OllamaToolFunction {
                name: t.name.clone(),
                description: t.description.clone(),
                parameters: t.parameters.clone(),
            },
        })
        .collect()
}

fn convert_to_ollama_messages(messages: &[Message]) -> Vec<OllamaMessage> {
    messages
        .iter()
        .map(|msg| match msg {
            Message::System { content } => OllamaMessage {
                role: "system".to_string(),
                content: content.clone(),
                tool_calls: None,
            },
            Message::User { content } => OllamaMessage {
                role: "user".to_string(),
                content: content.clone(),
                tool_calls: None,
            },
            Message::Assistant {
                content,
                tool_calls,
            } => {
                let calls = tool_calls.as_ref().map(|calls| {
                    calls
                        .iter()
                        .map(|c| OllamaToolCall {
                            function: OllamaFunctionCall {
                                name: c.name.clone(),
                                arguments: serde_json::from_str(&c.arguments)
                                    .unwrap_or(serde_json::json!({})),
                            },
                        })
                        .collect()
                });

                OllamaMessage {
                    role: "assistant".to_string(),
                    content: content.clone().unwrap_or_default(),
                    tool_calls: calls,
                }
            }
            Message::Tool {
                tool_call_id: _,
                content,
            } => {
                // Ollama uses 'tool' role for tool outputs
                OllamaMessage {
                    role: "tool".to_string(),
                    content: content.clone(),
                    tool_calls: None,
                }
            }
        })
        .collect()
}

fn convert_from_ollama_response(response: &ChatResponse) -> Message {
    let content = if response.message.content.is_empty() {
        None
    } else {
        Some(response.message.content.clone())
    };

    let mut tool_calls = if let Some(calls) = &response.message.tool_calls {
        if calls.is_empty() {
            None
        } else {
            Some(
                calls
                    .iter()
                    .map(|c| {
                        let mut args = c.function.arguments.clone();

                        // Some models (e.g., command-r) wrap arguments in a "parameters" field
                        // Extract and unwrap if present
                        if let Some(params) = args.get("parameters") {
                            if params.is_object() {
                                args = params.clone();
                            }
                        }

                        ToolCall {
                            id: "call_ollama".to_string(), // Ollama doesn't return tool call IDs
                            name: c.function.name.clone(),
                            arguments: args.to_string(),
                        }
                    })
                    .collect(),
            )
        }
    } else {
        None
    };

    // Fallback: If no structured tool_calls but content looks like JSON tool invocation, parse it
    if tool_calls.is_none() {
        if let Some(ref text) = content {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
                if let (Some(name), Some(params)) = (
                    json.get("name").and_then(|v| v.as_str()),
                    json.get("parameters"),
                ) {
                    log::warn!(
                        "Model returned text-based tool call ({}), converting to structured format",
                        name
                    );
                    tool_calls = Some(vec![ToolCall {
                        id: "call_ollama".to_string(),
                        name: name.to_string(),
                        arguments: params.to_string(),
                    }]);
                }
            }
        }
    }

    Message::Assistant {
        content,
        tool_calls,
    }
}
