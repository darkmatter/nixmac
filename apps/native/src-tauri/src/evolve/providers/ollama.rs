use super::{AiProvider, OnDelta, ProviderError, ProviderResponse, TokenUsage};
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use anyhow::anyhow;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

const DEFAULT_RETRY_ATTEMPTS: usize = 1;
const RETRY_GUIDANCE: &str = "Retry the previous step. Return either valid structured tool_calls or concise assistant content. Do not emit empty content with no tool_calls. If using tool_calls, keep arguments as strict JSON only.";

pub struct OllamaProvider {
    client: reqwest_middleware::ClientWithMiddleware,
    base_url: String,
    model: String,
    max_output_tokens: u32,
    record_chat_logs: bool,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String, max_output_tokens: u32) -> Self {
        let record_chat_logs =
            crate::state::completion_log::init_recording("evolve_provider_chat", "evolve provider");
        Self {
            client: crate::http_client::logged(),
            base_url: base_url.trim_end_matches('/').to_string(),
            model,
            max_output_tokens,
            record_chat_logs,
        }
    }
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    options: OllamaOptions,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OllamaTool>,
}

#[derive(Clone, Serialize)]
struct OllamaOptions {
    num_predict: u32,
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

/// Buffers raw HTTP body bytes and yields complete newline-terminated NDJSON
/// records. Transport chunk boundaries are arbitrary — they can split a
/// multibyte UTF-8 character or a JSON record — so bytes stay buffered until
/// a full record has arrived and can be decoded as a whole. Decoding each
/// chunk independently would turn a character split across packets into
/// replacement characters, corrupting streamed prose and tool arguments.
#[derive(Default)]
struct NdjsonBuffer {
    buffer: Vec<u8>,
}

impl NdjsonBuffer {
    /// Append a transport chunk and drain the complete records it finishes.
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut records = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let record: Vec<u8> = self.buffer.drain(..=pos).collect();
            let record = String::from_utf8_lossy(&record);
            let record = record.trim();
            if !record.is_empty() {
                records.push(record.to_string());
            }
        }
        records
    }

    /// The trailing record the stream ended without newline-terminating.
    fn finish(self) -> Option<String> {
        let record = String::from_utf8_lossy(&self.buffer);
        let record = record.trim();
        if record.is_empty() {
            None
        } else {
            Some(record.to_string())
        }
    }
}

#[derive(Serialize, Deserialize)]
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
                options: OllamaOptions {
                    num_predict: self.max_output_tokens,
                },
                tools: ollama_tools.clone(),
            };

            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "evolve_provider_chat",
                "ollama",
                "request",
                &request,
            )
            .await;

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

                crate::state::completion_log::append_event_jsonl(
                    self.record_chat_logs,
                    "evolve_provider_chat",
                    "ollama",
                    "response_error",
                    &serde_json::json!({
                        "status": status.as_u16(),
                        "body": error_text.clone(),
                    }),
                )
                .await;

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

            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "evolve_provider_chat",
                "ollama",
                "response",
                &chat_response,
            )
            .await;

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

    async fn completion_streaming(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
        on_delta: OnDelta<'_>,
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let mut ollama_messages = convert_to_ollama_messages(messages);
        let ollama_tools = convert_to_ollama_tools(tools);
        let url = format!("{}/api/chat", self.base_url);
        let mut retry_attempt = 0usize;

        loop {
            let request = ChatRequest {
                model: self.model.clone(),
                messages: ollama_messages.clone(),
                stream: true,
                options: OllamaOptions {
                    num_predict: self.max_output_tokens,
                },
                tools: ollama_tools.clone(),
            };

            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "evolve_provider_chat",
                "ollama",
                "request",
                &request,
            )
            .await;

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

                crate::state::completion_log::append_event_jsonl(
                    self.record_chat_logs,
                    "evolve_provider_chat",
                    "ollama",
                    "response_error",
                    &serde_json::json!({
                        "status": status.as_u16(),
                        "body": error_text.clone(),
                    }),
                )
                .await;

                if should_retry {
                    retry_attempt += 1;
                    log::warn!(
                        "Ollama parse error response; retrying streamed completion ({}/{})",
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

            // NDJSON: one ChatResponse object per line, the last with
            // done:true carrying the eval counters.
            let mut byte_stream = response.bytes_stream();
            let mut ndjson = NdjsonBuffer::default();
            let mut assembled = OllamaMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_calls: None,
            };
            let mut done_chunk: Option<ChatResponse> = None;

            let handle_line = |line: &str,
                               assembled: &mut OllamaMessage,
                               done_chunk: &mut Option<ChatResponse>|
             -> std::result::Result<(), ProviderError> {
                if line.is_empty() {
                    return Ok(());
                }
                let chunk: ChatResponse = serde_json::from_str(line).map_err(|e| {
                    // Mid-stream failures arrive as an {"error": "..."} line.
                    if let Ok(err) = serde_json::from_str::<OllamaStreamError>(line) {
                        ProviderError::Other(anyhow!("Ollama stream error: {}", err.error))
                    } else {
                        ProviderError::Other(anyhow!("Unparseable Ollama stream line: {e}"))
                    }
                })?;
                if !chunk.message.content.is_empty() {
                    assembled.content.push_str(&chunk.message.content);
                    on_delta(&chunk.message.content);
                }
                if let Some(calls) = &chunk.message.tool_calls {
                    // Ollama sends tool calls whole; surface them so the
                    // stream shows more than the (often empty) content: the
                    // think tool's thought text, and announcements for the
                    // rest.
                    for call in calls {
                        if call.function.name == "think" {
                            if let Some(thought) = call
                                .function
                                .arguments
                                .get("thought")
                                .and_then(|v| v.as_str())
                            {
                                on_delta(thought);
                            }
                        } else if let Some(announcement) =
                            super::tool_call_announcement(&call.function.name)
                        {
                            on_delta(&announcement);
                        }
                    }
                    assembled
                        .tool_calls
                        .get_or_insert_with(Vec::new)
                        .extend(calls.iter().cloned());
                }
                if chunk.done {
                    *done_chunk = Some(chunk);
                }
                Ok(())
            };

            let mut stream_result: std::result::Result<(), ProviderError> = Ok(());
            'read: while let Some(bytes) = byte_stream.next().await {
                let bytes = match bytes {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        stream_result = Err(ProviderError::Other(anyhow!(e)));
                        break 'read;
                    }
                };
                for record in ndjson.push(&bytes) {
                    if let Err(e) = handle_line(&record, &mut assembled, &mut done_chunk) {
                        stream_result = Err(e);
                        break 'read;
                    }
                }
            }
            if stream_result.is_ok() {
                if let Some(record) = ndjson.finish() {
                    stream_result = handle_line(&record, &mut assembled, &mut done_chunk);
                }
            }

            if let Err(e) = stream_result {
                // Tool-call parse failures can surface mid-stream instead of
                // as an HTTP 500; keep the blocking path's retry semantics.
                let text = format!("{e:#}");
                if retry_attempt < DEFAULT_RETRY_ATTEMPTS
                    && text.contains("error parsing tool call")
                {
                    retry_attempt += 1;
                    log::warn!(
                        "Ollama mid-stream parse error; retrying streamed completion ({}/{})",
                        retry_attempt,
                        DEFAULT_RETRY_ATTEMPTS
                    );
                    append_retry_guidance(&mut ollama_messages);
                    continue;
                }
                return Err(e);
            }

            let Some(done) = done_chunk else {
                return Err(ProviderError::Other(anyhow!(
                    "Ollama stream ended without a done chunk"
                )));
            };

            let full_response = ChatResponse {
                model: done.model,
                created_at: done.created_at,
                message: assembled,
                done: true,
                total_duration: done.total_duration,
                load_duration: done.load_duration,
                prompt_eval_count: done.prompt_eval_count,
                prompt_eval_duration: done.prompt_eval_duration,
                eval_count: done.eval_count,
                eval_duration: done.eval_duration,
            };

            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "evolve_provider_chat",
                "ollama",
                "response",
                &full_response,
            )
            .await;

            if retry_attempt < DEFAULT_RETRY_ATTEMPTS
                && is_empty_assistant_response(&full_response.message)
            {
                retry_attempt += 1;
                log::warn!(
                    "Ollama returned empty streamed assistant message without tool calls; retrying completion ({}/{})",
                    retry_attempt,
                    DEFAULT_RETRY_ATTEMPTS
                );
                append_retry_guidance(&mut ollama_messages);
                continue;
            }

            let message = convert_from_ollama_response(&full_response);

            let usage = full_response.eval_count.map(|eval_count| TokenUsage {
                input: full_response.prompt_eval_count.unwrap_or(0),
                output: eval_count,
                total: full_response.prompt_eval_count.unwrap_or(0) + eval_count,
            });

            return Ok(ProviderResponse { message, usage });
        }
    }
}

#[derive(Deserialize)]
struct OllamaStreamError {
    error: String,
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
                        if let Some(params) = args.get("parameters")
                            && params.is_object()
                        {
                            args = params.clone();
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
    if tool_calls.is_none()
        && let Some(ref text) = content
        && let Ok(json) = serde_json::from_str::<serde_json::Value>(text)
    {
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
        } else if let (Some(category), Some(thought)) = (
            json.get("category").and_then(|v| v.as_str()),
            json.get("thought").and_then(|v| v.as_str()),
        ) {
            // Some Ollama models seem to occasionally emit think payloads as plain assistant JSON content.
            // Coerce these into structured tool calls so the loop continues instead of
            // being treated as a conversational completion.
            log::warn!(
                "Model returned text-based think payload, converting to structured tool call"
            );
            let args = serde_json::json!({
                "category": category,
                "thought": thought,
            });
            tool_calls = Some(vec![ToolCall {
                id: "call_ollama".to_string(),
                name: "think".to_string(),
                arguments: args.to_string(),
            }]);
        }
    }

    Message::Assistant {
        content,
        tool_calls,
    }
}

#[cfg(test)]
mod tests {
    use super::NdjsonBuffer;

    fn collect_split(input: &[u8], at: usize) -> Vec<String> {
        let mut buffer = NdjsonBuffer::default();
        let mut records = buffer.push(&input[..at]);
        records.extend(buffer.push(&input[at..]));
        records.extend(buffer.finish());
        records
    }

    #[test]
    fn ndjson_survives_any_chunk_boundary() {
        // Multibyte content (é is 2 bytes, → is 3): any split point must
        // yield the same records, never replacement characters.
        let input = "{\"path\":\"café.nix\"}\n{\"note\":\"a → b\"}\n".as_bytes();
        let expected = vec![
            "{\"path\":\"café.nix\"}".to_string(),
            "{\"note\":\"a → b\"}".to_string(),
        ];
        for at in 0..=input.len() {
            assert_eq!(collect_split(input, at), expected, "split at byte {at}");
        }
    }

    #[test]
    fn ndjson_yields_multiple_records_from_one_chunk() {
        let mut buffer = NdjsonBuffer::default();
        assert_eq!(
            buffer.push(b"{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n"),
            vec!["{\"a\":1}", "{\"b\":2}", "{\"c\":3}"]
        );
    }

    #[test]
    fn ndjson_assembles_a_record_from_many_chunks() {
        let mut buffer = NdjsonBuffer::default();
        assert!(buffer.push(b"{\"mess").is_empty());
        assert!(buffer.push(b"age\":\"hi").is_empty());
        assert_eq!(buffer.push(b"\"}\n"), vec!["{\"message\":\"hi\"}"]);
    }

    #[test]
    fn ndjson_finish_returns_the_unterminated_tail() {
        let mut buffer = NdjsonBuffer::default();
        assert_eq!(buffer.push(b"{\"a\":1}\n{\"tail\""), vec!["{\"a\":1}"]);
        assert_eq!(buffer.finish().as_deref(), Some("{\"tail\""));
    }

    #[test]
    fn ndjson_skips_blank_lines() {
        let mut buffer = NdjsonBuffer::default();
        assert_eq!(buffer.push(b"\n\r\n{\"a\":1}\n\n"), vec!["{\"a\":1}"]);
        assert_eq!(buffer.finish(), None);
    }
}
