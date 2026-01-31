mod ollama;
mod openai;

use anyhow::Result;
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;
use tauri::{AppHandle, Runtime};

use async_trait::async_trait;

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_SUMMARY_MODEL: &str = "openai/gpt-4o-mini";

/// Trait for pluggable chat completion providers
#[async_trait]
pub trait ChatCompletionProvider: Send + Sync {
    /// Get the model name/identifier
    fn model(&self) -> &str;

    /// Request a chat completion
    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<String>;
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

            let base_url = std::env::var("OLLAMA_API_BASE")
                .unwrap_or_else(|_| "http://localhost:11434".to_string());
            Ok(Box::new(OllamaClient::new(&base_url, &model)))
        }
        _ => {
            let model = store_model
                .or_else(|| std::env::var("SUMMARY_MODEL").ok())
                .unwrap_or_else(|| DEFAULT_SUMMARY_MODEL.to_string());

            // Try to get key from store first (OpenRouter preferred), then env var
            let store_key = app_handle.and_then(|app| {
                // Try OpenRouter key first, then OpenAI key
                crate::store::get_openrouter_api_key(app)
                    .ok()
                    .flatten()
                    .or_else(|| crate::store::get_openai_api_key(app).ok().flatten())
            });

            let key = store_key
                .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                .ok_or_else(|| anyhow::anyhow!("No API key configured. Please set your OpenRouter or OpenAI API key in Settings."))?;

            Ok(Box::new(OpenAIClient::new(
                &key,
                OPENROUTER_BASE_URL,
                &model,
            )))
        }
    }
}
