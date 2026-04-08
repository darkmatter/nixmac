mod ollama;
mod openai;

use anyhow::Result;
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;
use tauri::{AppHandle, Runtime};

use async_trait::async_trait;

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_SUMMARY_MODEL: &str = "openai/gpt-4o-mini";
const DEFAULT_OLLAMA_API_BASE: &str = "http://localhost:11434";

/// Token consumption reported by a provider for a single completion call.
#[derive(Debug, Default, Clone)]
#[allow(dead_code)]
pub struct TokenUsage {
    pub input: Option<u32>,
    pub output: Option<u32>,
}

/// Returns `(content, usage)` — fields inside `TokenUsage` or `None` when unsupported
#[async_trait]
pub trait ChatCompletionProvider: Send + Sync {
    /// Get the model name/identifier
    fn model(&self) -> &str;

    /// Request a chat completion.
    /// `num_ctx` — overrides Ollama default context-window size
    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        num_ctx: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)>;

    /// Request a completion with JSON output enforced (response_format: json_object).
    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        num_ctx: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        self.completion(
            system_prompt,
            user_prompt,
            max_tokens,
            num_ctx,
            temperature,
            request_id,
        )
        .await
    }
}

/// Create a provider based on environment configuration
pub fn create_provider<R: Runtime>(
    app_handle: Option<&AppHandle<R>>,
) -> Result<Box<dyn ChatCompletionProvider>> {
    let store_provider = app_handle
        .and_then(|app| crate::store::get_summary_provider(app).ok())
        .flatten();

    let provider = store_provider
        .or_else(|| std::env::var("SUMMARY_AI_PROVIDER").ok())
        .unwrap_or_else(|| "openai".to_string());

    let store_model = app_handle
        .and_then(|app| crate::store::get_summary_model(app).ok())
        .flatten();

    match provider.as_str() {
        "ollama" => {
            let model = store_model
                .or_else(|| std::env::var("SUMMARY_MODEL").ok())
                .unwrap_or_else(|| "llama3.1".to_string());

            let base_url = app_handle
                .and_then(|app| crate::store::get_ollama_api_base_url(app).ok())
                .flatten()
                .or_else(|| std::env::var("OLLAMA_API_BASE").ok())
                .unwrap_or_else(|| DEFAULT_OLLAMA_API_BASE.to_string());
            Ok(Box::new(OllamaClient::new(&base_url, &model)))
        }
        "vllm" => {
            let model = store_model
                .or_else(|| std::env::var("SUMMARY_MODEL").ok())
                .unwrap_or_else(|| "gpt-oss-120b".to_string());

            let base_url = app_handle
                .and_then(|app| crate::store::get_vllm_api_base_url(app).ok())
                .flatten()
                .or_else(|| std::env::var("VLLM_API_BASE").ok())
                .ok_or_else(|| anyhow::anyhow!("No vLLM base URL configured. Please set it in Settings."))?;

            let api_key = app_handle
                .and_then(|app| crate::store::get_vllm_api_key(app).ok())
                .flatten()
                .unwrap_or_else(|| "none".to_string());

            Ok(Box::new(OpenAIClient::new(&api_key, &base_url, &model)))
        }
        _ => {
            let model = store_model
                .or_else(|| std::env::var("SUMMARY_MODEL").ok())
                .unwrap_or_else(|| DEFAULT_SUMMARY_MODEL.to_string());

            // Resolve API key and matching base URL together.
            // Prefer OpenRouter; fall back to direct OpenAI.
            let (key, base_url) = app_handle
                .and_then(|app| {
                    crate::store::get_openrouter_api_key(app)
                        .ok()
                        .flatten()
                        .map(|k| (k, OPENROUTER_BASE_URL))
                })
                .or_else(|| {
                    app_handle.and_then(|app| {
                        crate::store::get_openai_api_key(app)
                            .ok()
                            .flatten()
                            .map(|k| (k, OPENAI_BASE_URL))
                    })
                })
                .or_else(|| {
                    std::env::var("OPENROUTER_API_KEY")
                        .ok()
                        .map(|k| (k, OPENROUTER_BASE_URL))
                })
                .or_else(|| {
                    std::env::var("OPENAI_API_KEY")
                        .ok()
                        .map(|k| (k, OPENAI_BASE_URL))
                })
                .ok_or_else(|| anyhow::anyhow!("No API key found. Please add your API key in Settings to get started."))?;

            // Strip OpenRouter-style "openai/" prefix for direct OpenAI usage
            let model = if base_url == OPENAI_BASE_URL {
                model.strip_prefix("openai/").unwrap_or(&model).to_string()
            } else {
                model
            };

            Ok(Box::new(OpenAIClient::new(&key, base_url, &model)))
        }
    }
}
