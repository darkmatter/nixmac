mod ollama;
mod openai;

use anyhow::Result;
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;
use tauri::{AppHandle, Runtime};

use async_trait::async_trait;

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
    let provider = std::env::var("SUMMARY_AI_PROVIDER").unwrap_or_else(|_| "openai".to_string());

    match provider.as_str() {
        "ollama" => {
            let model = std::env::var("SUMMARY_MODEL").unwrap_or_else(|_| "llama3.1".to_string());
            let base_url = std::env::var("OLLAMA_API_BASE")
                .unwrap_or_else(|_| "http://localhost:11434".to_string());
            Ok(Box::new(OllamaClient::new(&base_url, &model)))
        }
        _ => {
            const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
            const SUMMARY_MODEL: &str = "openai/gpt-4o-mini";

            // Try to get key from store first, then env var
            let store_key = app_handle
                .and_then(|app| crate::store::get_openai_api_key(app).ok())
                .flatten();

            let key = store_key
                .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                .ok_or_else(|| anyhow::anyhow!("No API key configured"))?;

            Ok(Box::new(OpenAIClient::new(
                &key,
                OPENROUTER_BASE_URL,
                SUMMARY_MODEL,
            )))
        }
    }
}
