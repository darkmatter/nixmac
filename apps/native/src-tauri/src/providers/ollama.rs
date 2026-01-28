use super::ChatCompletionProvider;
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
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: OllamaMessageResponse,
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
        temperature: f32,
    ) -> Result<String> {
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
            },
        };

        debug!("Requesting completion from Ollama {}", self.model);
        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        let response_json: OllamaResponse = response.json().await?;
        Ok(response_json.message.content)
    }
}
