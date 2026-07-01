use super::{ChatCompletionProvider, TokenUsage};
use anyhow::Result;
use async_trait::async_trait;
use log::debug;
use serde::{Deserialize, Serialize};

pub struct OllamaClient {
    client: reqwest_middleware::ClientWithMiddleware,
    base_url: String,
    model: String,
    record_chat_logs: bool,
}

impl OllamaClient {
    pub fn new(base_url: &str, model: &str) -> Self {
        let record_chat_logs = crate::state::completion_log::init_recording(
            "summary_provider_chat",
            "summary provider",
        );
        Self {
            client: crate::http_client::logged(),
            base_url: base_url.to_string(),
            model: model.to_string(),
            record_chat_logs,
        }
    }
}

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaMessage<'a>>,
    stream: bool,
    options: OllamaOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'a str>,
}

#[derive(Serialize)]
struct OllamaMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct OllamaResponse {
    message: OllamaMessageResponse,
    eval_count: Option<u32>,
    prompt_eval_count: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct OllamaMessageResponse {
    content: String,
}

#[async_trait]
impl ChatCompletionProvider for OllamaClient {
    fn model(&self) -> &str {
        &self.model
    }

    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let url = format!("{}/api/chat", self.base_url);

        let request = OllamaRequest {
            model: &self.model,
            messages: vec![
                OllamaMessage {
                    role: "system",
                    content: system_prompt,
                },
                OllamaMessage {
                    role: "user",
                    content: user_prompt,
                },
            ],
            stream: false,
            options: OllamaOptions {
                temperature,
                num_predict: max_tokens,
                num_ctx: context_window_tokens,
            },
            format: None,
        };

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "ollama",
            "request",
            &request,
        )
        .await;

        debug!(
            "Requesting completion from {} [id: {}]",
            self.model, request_id
        );
        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await?;
            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "summary_provider_chat",
                "ollama",
                "response_error",
                &serde_json::json!({
                    "status": status.as_u16(),
                    "body": error_text.clone(),
                }),
            )
            .await;
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        let r: OllamaResponse = response.json().await?;
        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "ollama",
            "response",
            &r,
        )
        .await;
        Ok((
            r.message.content,
            TokenUsage {
                input: r.prompt_eval_count,
                output: r.eval_count,
            },
        ))
    }

    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let url = format!("{}/api/chat", self.base_url);

        log::info!(
            "json_completion called: model={} format=json max_tokens={} context_window_tokens={:?} [id: {}]",
            self.model,
            max_tokens,
            context_window_tokens,
            request_id
        );

        let request = OllamaRequest {
            model: &self.model,
            messages: vec![
                OllamaMessage {
                    role: "system",
                    content: system_prompt,
                },
                OllamaMessage {
                    role: "user",
                    content: user_prompt,
                },
            ],
            stream: false,
            options: OllamaOptions {
                temperature,
                num_predict: max_tokens,
                num_ctx: context_window_tokens,
            },
            format: Some("json"),
        };

        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "ollama",
            "request",
            &request,
        )
        .await;

        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await?;
            crate::state::completion_log::append_event_jsonl(
                self.record_chat_logs,
                "summary_provider_chat",
                "ollama",
                "response_error",
                &serde_json::json!({
                    "status": status.as_u16(),
                    "body": error_text.clone(),
                }),
            )
            .await;
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        let r: OllamaResponse = response.json().await?;
        crate::state::completion_log::append_event_jsonl(
            self.record_chat_logs,
            "summary_provider_chat",
            "ollama",
            "response",
            &r,
        )
        .await;
        log::info!(
            "json_completion done: in={:?} out={:?} [id: {}]",
            r.prompt_eval_count,
            r.eval_count,
            request_id
        );
        Ok((
            r.message.content,
            TokenUsage {
                input: r.prompt_eval_count,
                output: r.eval_count,
            },
        ))
    }
}
