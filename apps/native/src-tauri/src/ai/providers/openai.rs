use super::{ChatCompletionProvider, TokenUsage};
use crate::ai::model_capabilities::capabilities_for_model;
use crate::ai::provider_errors::{classify_openai_error, friendly_provider_error};
use anyhow::Result;
use async_openai::{
    Client,
    config::OpenAIConfig,
    error::OpenAIError,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs, ResponseFormat,
    },
};
use async_trait::async_trait;
use log::{debug, info, warn};

/// Normalize an async_openai error into a user-friendly anyhow error.
///
/// Classified API errors get a friendly message for the user while preserving
/// the original error in the chain via `context`. Unclassified errors pass
/// through directly so callers can inspect the full source.
fn normalize_completion_error(e: OpenAIError) -> anyhow::Error {
    if let Some((status, _)) = classify_openai_error(&e) {
        anyhow::Error::from(e).context(friendly_provider_error(status))
    } else {
        anyhow::Error::from(e)
    }
}

fn log_provider_request_start(
    kind: &str,
    url: &str,
    model: &str,
    request_id: &str,
) -> std::time::Instant {
    info!("→ AI {kind} POST {url} model={model} id={request_id}");
    std::time::Instant::now()
}

fn log_provider_request_ok(
    kind: &str,
    url: &str,
    model: &str,
    request_id: &str,
    start: std::time::Instant,
) {
    info!(
        "← AI {kind} POST {url} model={model} id={request_id} ok ({})",
        format_elapsed(start)
    );
}

fn log_provider_request_err(
    kind: &str,
    url: &str,
    model: &str,
    request_id: &str,
    start: std::time::Instant,
    error: &OpenAIError,
) {
    if let Some((status, _)) = classify_openai_error(error) {
        warn!(
            "✗ AI {kind} POST {url} model={model} id={request_id} failed status={status} ({})",
            format_elapsed(start)
        );
    } else {
        warn!(
            "✗ AI {kind} POST {url} model={model} id={request_id} failed: {error} ({})",
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

pub struct OpenAIClient {
    client: Client<OpenAIConfig>,
    model: String,
    chat_completions_url: String,
    record_chat_logs: bool,
}

impl OpenAIClient {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(base_url);
        let client = Client::with_config(config);
        let record_chat_logs = crate::state::completion_log::init_recording(
            "summary_provider_chat",
            "summary provider",
        );
        Self {
            client,
            model: model.to_string(),
            chat_completions_url: chat_completions_url(base_url),
            record_chat_logs,
        }
    }
}

#[async_trait]
impl ChatCompletionProvider for OpenAIClient {
    fn model(&self) -> &str {
        &self.model
    }

    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        _context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&self.model)
            .messages(vec![
                ChatCompletionRequestSystemMessageArgs::default()
                    .content(system_prompt)
                    .build()?
                    .into(),
                ChatCompletionRequestUserMessageArgs::default()
                    .content(user_prompt)
                    .build()?
                    .into(),
            ])
            .max_completion_tokens(max_tokens);

        if capabilities_for_model(&self.model).supports_custom_temperature {
            request_builder.temperature(temperature);
        }

        let request = request_builder.build()?;

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "openai-compatible",
            "request",
            &request,
        )
        .await;

        debug!(
            "Requesting completion from {} [id: {}]",
            self.model, request_id
        );
        let start =
            log_provider_request_start("chat", &self.chat_completions_url, &self.model, request_id);
        let response = match self.client.chat().create(request).await {
            Ok(response) => {
                log_provider_request_ok(
                    "chat",
                    &self.chat_completions_url,
                    &self.model,
                    request_id,
                    start,
                );
                response
            }
            Err(error) => {
                log_provider_request_err(
                    "chat",
                    &self.chat_completions_url,
                    &self.model,
                    request_id,
                    start,
                    &error,
                );
                return Err(normalize_completion_error(error));
            }
        };
        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "openai-compatible",
            "response",
            &response,
        )
        .await;
        let usage = TokenUsage {
            input: response.usage.as_ref().map(|u| u.prompt_tokens),
            output: response.usage.as_ref().map(|u| u.completion_tokens),
        };
        Ok((
            response
                .choices
                .first()
                .and_then(|c| c.message.content.clone())
                .unwrap_or_default(),
            usage,
        ))
    }

    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        _context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        log::info!(
            "json_completion called: model={} response_format=json_object [id: {}]",
            self.model,
            request_id
        );
        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&self.model)
            .messages(vec![
                ChatCompletionRequestSystemMessageArgs::default()
                    .content(system_prompt)
                    .build()?
                    .into(),
                ChatCompletionRequestUserMessageArgs::default()
                    .content(user_prompt)
                    .build()?
                    .into(),
            ])
            .max_completion_tokens(max_tokens)
            .response_format(ResponseFormat::JsonObject);

        if capabilities_for_model(&self.model).supports_custom_temperature {
            request_builder.temperature(temperature);
        }

        let request = request_builder.build()?;

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "openai-compatible",
            "request",
            &request,
        )
        .await;

        debug!(
            "Requesting JSON completion from {} [id: {}]",
            self.model, request_id
        );
        let start = log_provider_request_start(
            "json_chat",
            &self.chat_completions_url,
            &self.model,
            request_id,
        );
        let response = match self.client.chat().create(request).await {
            Ok(response) => {
                log_provider_request_ok(
                    "json_chat",
                    &self.chat_completions_url,
                    &self.model,
                    request_id,
                    start,
                );
                response
            }
            Err(error) => {
                log_provider_request_err(
                    "json_chat",
                    &self.chat_completions_url,
                    &self.model,
                    request_id,
                    start,
                    &error,
                );
                return Err(normalize_completion_error(error));
            }
        };
        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "openai-compatible",
            "response",
            &response,
        )
        .await;
        let usage = TokenUsage {
            input: response.usage.as_ref().map(|u| u.prompt_tokens),
            output: response.usage.as_ref().map(|u| u.completion_tokens),
        };

        Ok((
            response
                .choices
                .first()
                .and_then(|c| c.message.content.clone())
                .unwrap_or_default(),
            usage,
        ))
    }
}
