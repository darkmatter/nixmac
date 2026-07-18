use super::{
    AiProvider, OnDelta, ProviderError, ProviderResponse, StreamEvent, ThoughtExtractor, TokenUsage,
};
use crate::ai::model_capabilities::capabilities_for_model;
use crate::ai::provider_errors::classify_openai_error;
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use anyhow::anyhow;
use async_openai::{
    Client,
    config::OpenAIConfig,
    error::OpenAIError,
    types::{
        ChatCompletionMessageToolCall, ChatCompletionMessageToolCallChunk,
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestToolMessageArgs,
        ChatCompletionRequestUserMessageArgs, ChatCompletionStreamOptions, ChatCompletionTool,
        ChatCompletionToolArgs, ChatCompletionToolType, CreateChatCompletionRequest,
        CreateChatCompletionRequestArgs, FunctionCall, FunctionObjectArgs,
    },
};
use async_trait::async_trait;
use futures_util::StreamExt;
use log::{info, warn};
use reqwest::StatusCode;

pub struct OpenAIProvider {
    client: Client<OpenAIConfig>,
    model: String,
    chat_completions_url: String,
    max_output_tokens: u32,

    record_chat_logs: bool,
}

impl OpenAIProvider {
    pub fn new(api_key: String, api_base: String, model: String, max_output_tokens: u32) -> Self {
        let chat_completions_url = chat_completions_url(&api_base);
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(api_base);
        let client = Client::with_config(config);
        let record_chat_logs =
            crate::state::completion_log::init_recording("evolve_provider_chat", "evolve provider");
        Self {
            client,
            model,
            chat_completions_url,
            max_output_tokens,
            record_chat_logs,
        }
    }

    fn build_request(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
        stream: bool,
    ) -> std::result::Result<CreateChatCompletionRequest, ProviderError> {
        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&self.model)
            .messages(convert_to_openai_messages(messages))
            .tools(convert_to_openai_tools(tools));

        if stream {
            // Usage arrives only in the stream's final chunk, and only when
            // asked for explicitly.
            request_builder
                .stream(true)
                .stream_options(ChatCompletionStreamOptions {
                    include_usage: true,
                });
        }

        if capabilities_for_model(&self.model).supports_custom_temperature {
            request_builder.temperature(0.2);
        }

        request_builder.max_completion_tokens(self.max_output_tokens);

        request_builder
            .build()
            .map_err(|e| ProviderError::Other(anyhow!(e)))
    }
}

/// A tool call being assembled from stream chunks: the first chunk for an
/// index carries the id and function name, later chunks append argument
/// fragments.
#[derive(Debug, Default, PartialEq)]
struct StreamedToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn merge_tool_call_chunk(
    calls: &mut Vec<StreamedToolCall>,
    chunk: &ChatCompletionMessageToolCallChunk,
) {
    let index = chunk.index as usize;
    if calls.len() <= index {
        calls.resize_with(index + 1, Default::default);
    }
    let call = &mut calls[index];
    if let Some(id) = &chunk.id {
        call.id = id.clone();
    }
    if let Some(function) = &chunk.function {
        if let Some(name) = &function.name {
            call.name.push_str(name);
        }
        if let Some(arguments) = &function.arguments {
            call.arguments.push_str(arguments);
        }
    }
}

fn log_provider_request_start(kind: &str, url: &str, model: &str) -> std::time::Instant {
    info!("→ AI {kind} POST {url} model={model}");
    std::time::Instant::now()
}

fn log_provider_request_ok(kind: &str, url: &str, model: &str, start: std::time::Instant) {
    info!(
        "← AI {kind} POST {url} model={model} ok ({})",
        format_elapsed(start)
    );
}

fn log_provider_request_err(
    kind: &str,
    url: &str,
    model: &str,
    start: std::time::Instant,
    error: &OpenAIError,
) {
    if let Some((status, _)) = classify_openai_error(error) {
        warn!(
            "✗ AI {kind} POST {url} model={model} failed status={status} ({})",
            format_elapsed(start)
        );
    } else {
        warn!(
            "✗ AI {kind} POST {url} model={model} failed: {error} ({})",
            format_elapsed(start)
        );
    }
}

fn chat_completions_url(base_url: &str) -> String {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    remove_credentials(&url)
}

fn remove_credentials(url: &str) -> String {
    let Ok(mut parsed) = reqwest::Url::parse(url) else {
        return url.to_string();
    };
    parsed.set_password(None).ok();
    parsed.set_username("").ok();
    parsed.to_string()
}

fn format_elapsed(start: std::time::Instant) -> String {
    let elapsed = start.elapsed();
    let ms = elapsed.as_millis();
    if ms < 1000 {
        format!("{ms}ms")
    } else {
        format!("{:.2}s", elapsed.as_secs_f64())
    }
}

#[async_trait]
impl AiProvider for OpenAIProvider {
    fn model_name(&self) -> String {
        self.model.clone()
    }

    fn supports_streaming(&self) -> bool {
        true
    }

    async fn completion(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let request = self.build_request(messages, tools, false)?;

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "evolve_provider_chat",
            "openai-compatible",
            "request",
            &request,
        )
        .await;

        let start = log_provider_request_start("chat", &self.chat_completions_url, &self.model);
        let response = match self.client.chat().create(request).await {
            Ok(response) => {
                log_provider_request_ok("chat", &self.chat_completions_url, &self.model, start);
                response
            }
            Err(error) => {
                log_provider_request_err(
                    "chat",
                    &self.chat_completions_url,
                    &self.model,
                    start,
                    &error,
                );
                return Err(normalize_openai_error(error));
            }
        };

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "evolve_provider_chat",
            "openai-compatible",
            "response",
            &response,
        )
        .await;

        let choice = response
            .choices
            .first()
            .ok_or_else(|| ProviderError::Other(anyhow!("No response from OpenAI")))?;

        let message = convert_from_openai_response(choice);

        let usage = response.usage.map(|u| TokenUsage {
            input: u.prompt_tokens,
            output: u.completion_tokens,
            total: u.total_tokens,
        });

        Ok(ProviderResponse { message, usage })
    }

    async fn completion_streaming(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
        on_delta: OnDelta<'_>,
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let request = self.build_request(messages, tools, true)?;

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "evolve_provider_chat",
            "openai-compatible",
            "request",
            &request,
        )
        .await;

        let start =
            log_provider_request_start("chat-stream", &self.chat_completions_url, &self.model);
        let mut stream = match self.client.chat().create_stream(request).await {
            Ok(stream) => stream,
            Err(error) => {
                log_provider_request_err(
                    "chat-stream",
                    &self.chat_completions_url,
                    &self.model,
                    start,
                    &error,
                );
                return Err(normalize_openai_error(error));
            }
        };

        let mut content = String::new();
        let mut tool_calls: Vec<StreamedToolCall> = Vec::new();
        // The model spends most of its tokens on tool-call arguments, not
        // assistant content, so surface those too: the think tool's thought
        // text types out as it generates, other tools announce themselves.
        let mut thought_extractors: std::collections::HashMap<usize, ThoughtExtractor> =
            std::collections::HashMap::new();
        let mut usage: Option<TokenUsage> = None;

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    log_provider_request_err(
                        "chat-stream",
                        &self.chat_completions_url,
                        &self.model,
                        start,
                        &error,
                    );
                    return Err(normalize_openai_error(error));
                }
            };

            // With include_usage the final chunk has empty choices and the
            // whole request's usage.
            if let Some(u) = &chunk.usage {
                usage = Some(TokenUsage {
                    input: u.prompt_tokens,
                    output: u.completion_tokens,
                    total: u.total_tokens,
                });
            }
            let Some(choice) = chunk.choices.first() else {
                continue;
            };
            if let Some(text) = &choice.delta.content {
                if !text.is_empty() {
                    content.push_str(text);
                    on_delta(StreamEvent::Delta(text));
                }
            }
            if let Some(chunks) = &choice.delta.tool_calls {
                for tool_chunk in chunks {
                    let index = tool_chunk.index as usize;
                    merge_tool_call_chunk(&mut tool_calls, tool_chunk);
                    let name = tool_calls[index].name.as_str();
                    // A call's first chunk carries its id and name.
                    if tool_chunk.id.is_some() && !name.is_empty() {
                        if let Some(announcement) = super::tool_call_announcement(name) {
                            on_delta(StreamEvent::Delta(&announcement));
                        }
                    }
                    if name == "think" {
                        if let Some(fragment) = tool_chunk
                            .function
                            .as_ref()
                            .and_then(|f| f.arguments.as_deref())
                        {
                            let text = thought_extractors.entry(index).or_default().push(fragment);
                            if !text.is_empty() {
                                on_delta(StreamEvent::Delta(&text));
                            }
                        }
                    }
                }
            }
        }
        log_provider_request_ok(
            "chat-stream",
            &self.chat_completions_url,
            &self.model,
            start,
        );

        let tool_calls: Vec<ToolCall> = tool_calls
            .into_iter()
            .map(|call| ToolCall {
                id: call.id,
                name: call.name,
                arguments: call.arguments,
            })
            .collect();
        let message = Message::Assistant {
            content: if content.is_empty() {
                None
            } else {
                Some(content)
            },
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
        };

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "evolve_provider_chat",
            "openai-compatible",
            "response",
            &serde_json::json!({
                "streamed": true,
                "message": format!("{:?}", message),
            }),
        )
        .await;

        Ok(ProviderResponse { message, usage })
    }
}

fn convert_to_openai_tools(tools: &[GenericTool]) -> Vec<ChatCompletionTool> {
    tools
        .iter()
        .map(|t| {
            ChatCompletionToolArgs::default()
                .r#type(ChatCompletionToolType::Function)
                .function(
                    FunctionObjectArgs::default()
                        .name(&t.name)
                        .description(&t.description)
                        .parameters(t.parameters.clone())
                        .build()
                        .expect("FunctionObject: all required fields set"),
                )
                .build()
                .expect("ChatCompletionTool: all required fields set")
        })
        .collect()
}

fn convert_to_openai_messages(messages: &[Message]) -> Vec<ChatCompletionRequestMessage> {
    messages
        .iter()
        .map(|msg| match msg {
            Message::System { content } => ChatCompletionRequestSystemMessageArgs::default()
                .content(content.clone())
                .build()
                .expect("SystemMessage: content set")
                .into(),
            Message::User { content } => ChatCompletionRequestUserMessageArgs::default()
                .content(content.clone())
                .build()
                .expect("UserMessage: content set")
                .into(),
            Message::Assistant {
                content,
                tool_calls,
            } => {
                let mut builder = ChatCompletionRequestAssistantMessageArgs::default();
                if let Some(c) = content {
                    builder.content(c.clone());
                }

                if let Some(calls) = tool_calls {
                    let openai_calls: Vec<ChatCompletionMessageToolCall> = calls
                        .iter()
                        .map(|call| ChatCompletionMessageToolCall {
                            id: call.id.clone(),
                            r#type: ChatCompletionToolType::Function,
                            function: FunctionCall {
                                name: call.name.clone(),
                                arguments: call.arguments.clone(),
                            },
                        })
                        .collect();
                    builder.tool_calls(openai_calls);
                }
                builder
                    .build()
                    .expect("AssistantMessage: optional fields only")
                    .into()
            }
            Message::Tool {
                tool_call_id,
                content,
            } => ChatCompletionRequestToolMessageArgs::default()
                .tool_call_id(tool_call_id.clone())
                .content(content.clone())
                .build()
                .expect("ToolMessage: all required fields set")
                .into(),
        })
        .collect()
}

fn convert_from_openai_response(choice: &async_openai::types::ChatChoice) -> Message {
    let content = choice.message.content.clone();
    let tool_calls = choice.message.tool_calls.as_ref().map(|calls| {
        calls
            .iter()
            .map(|call| ToolCall {
                id: call.id.clone(),
                name: call.function.name.clone(),
                arguments: call.function.arguments.clone(),
            })
            .collect()
    });

    Message::Assistant {
        content,
        tool_calls,
    }
}

/// Normalize an async_openai error into a `ProviderError`.
fn normalize_openai_error(e: OpenAIError) -> ProviderError {
    if let Some((status_u16, msg)) = classify_openai_error(&e) {
        let status = StatusCode::from_u16(status_u16).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        ProviderError::Http { status, body: msg }
    } else {
        ProviderError::Other(anyhow!(e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(
        index: u32,
        id: Option<&str>,
        name: Option<&str>,
        arguments: Option<&str>,
    ) -> ChatCompletionMessageToolCallChunk {
        ChatCompletionMessageToolCallChunk {
            index,
            id: id.map(str::to_string),
            r#type: None,
            function: Some(async_openai::types::FunctionCallStream {
                name: name.map(str::to_string),
                arguments: arguments.map(str::to_string),
            }),
        }
    }

    #[test]
    fn assembles_tool_call_arguments_across_chunks() {
        let mut calls = Vec::new();
        merge_tool_call_chunk(
            &mut calls,
            &chunk(0, Some("call_1"), Some("edit_nix_file"), None),
        );
        merge_tool_call_chunk(&mut calls, &chunk(0, None, None, Some("{\"path\":")));
        merge_tool_call_chunk(&mut calls, &chunk(0, None, None, Some("\"flake.nix\"}")));

        assert_eq!(
            calls,
            vec![StreamedToolCall {
                id: "call_1".to_string(),
                name: "edit_nix_file".to_string(),
                arguments: "{\"path\":\"flake.nix\"}".to_string(),
            }]
        );
    }

    #[test]
    fn assembles_parallel_tool_calls_by_index() {
        let mut calls = Vec::new();
        merge_tool_call_chunk(
            &mut calls,
            &chunk(0, Some("call_1"), Some("think"), Some("{}")),
        );
        merge_tool_call_chunk(
            &mut calls,
            &chunk(1, Some("call_2"), Some("read_file"), Some("{")),
        );
        merge_tool_call_chunk(&mut calls, &chunk(1, None, None, Some("}")));

        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "think");
        assert_eq!(calls[1].id, "call_2");
        assert_eq!(calls[1].arguments, "{}");
    }
}
