use super::{ChatCompletionProvider, TokenUsage};
use anyhow::Result;
use async_trait::async_trait;
use log::debug;
use serde::{Deserialize, Serialize};

pub struct OllamaClient {
    client: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaClient {
    pub fn new(base_url: &str, model: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.to_string(),
            model: model.to_string(),
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

#[derive(Deserialize)]
struct OllamaResponse {
    message: OllamaMessageResponse,
    eval_count: Option<u32>,
    prompt_eval_count: Option<u32>,
}

#[derive(Deserialize)]
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

        debug!(
            "Requesting completion from {} [id: {}]",
            self.model, request_id
        );
        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        let r: OllamaResponse = response.json().await?;
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

        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        let r: OllamaResponse = response.json().await?;
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
