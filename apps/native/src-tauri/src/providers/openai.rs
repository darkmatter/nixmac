use super::{ChatCompletionProvider, TokenUsage};
use crate::provider_errors::{classify_openai_error, friendly_provider_error};
use anyhow::Result;
use async_openai::{
    config::OpenAIConfig,
    error::OpenAIError,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs, ResponseFormat,
    },
    Client,
};
use async_trait::async_trait;
use log::debug;

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

pub struct OpenAIClient {
    client: Client<OpenAIConfig>,
    model: String,
    record_completions: bool,
}

impl OpenAIClient {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(base_url);
        let client = Client::with_config(config);
        let record_completions = crate::completion_log::init_recording(
            "summary_provider_completions",
            "summary provider",
        );
        Self {
            client,
            model: model.to_string(),
            record_completions,
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
        _num_ctx: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let request = CreateChatCompletionRequestArgs::default()
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
            .temperature(temperature)
            .build()?;

        debug!(
            "Requesting completion from {} [id: {}]",
            self.model, request_id
        );
        let response = self
            .client
            .chat()
            .create(request)
            .await
            .map_err(normalize_completion_error)?;
        crate::completion_log::append_jsonl(
            self.record_completions,
            "summary_provider_completions",
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
        _num_ctx: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        log::info!(
            "json_completion called: model={} response_format=json_object [id: {}]",
            self.model,
            request_id
        );
        let request = CreateChatCompletionRequestArgs::default()
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
            .temperature(temperature)
            .response_format(ResponseFormat::JsonObject)
            .build()?;

        debug!(
            "Requesting JSON completion from {} [id: {}]",
            self.model, request_id
        );
        let response = self
            .client
            .chat()
            .create(request)
            .await
            .map_err(normalize_completion_error)?;
        crate::completion_log::append_jsonl(
            self.record_completions,
            "summary_provider_completions",
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
