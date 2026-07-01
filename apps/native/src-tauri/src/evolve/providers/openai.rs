use super::{AiProvider, ProviderError, ProviderResponse, TokenUsage};
use crate::ai::model_capabilities::capabilities_for_model;
use crate::ai::provider_errors::classify_openai_error;
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use anyhow::anyhow;
use async_openai::{
    Client,
    config::OpenAIConfig,
    error::OpenAIError,
    types::{
        ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestToolMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionTool, ChatCompletionToolArgs, ChatCompletionToolType,
        CreateChatCompletionRequestArgs, FunctionCall, FunctionObjectArgs,
    },
};
use async_trait::async_trait;
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

    async fn completion(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        let openai_messages = convert_to_openai_messages(messages);
        let openai_tools = convert_to_openai_tools(tools);

        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&self.model)
            .messages(openai_messages)
            .tools(openai_tools);

        if capabilities_for_model(&self.model).supports_custom_temperature {
            request_builder.temperature(0.2);
        }

        request_builder.max_completion_tokens(self.max_output_tokens);

        let request = request_builder
            .build()
            .map_err(|e| ProviderError::Other(anyhow!(e)))?;

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
