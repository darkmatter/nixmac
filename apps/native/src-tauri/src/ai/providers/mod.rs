pub mod cli;
mod ollama;
mod openai;

use anyhow::Result;
pub use cli::{CliCompletionClient, CliTool};
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;
use tauri::{AppHandle, Runtime};

use async_trait::async_trait;

const DEFAULT_SUMMARY_MODEL: &str = "openai/gpt-4o-mini";
const DEFAULT_OPENAI_SUMMARY_MODEL: &str = "gpt-4o-mini";
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
    /// `context_window_tokens` sets a provider context-window target.
    /// For Ollama this maps to `num_ctx`; OpenAI-compatible providers ignore it.
    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)>;

    /// Request a completion with JSON output enforced (response_format: json_object).
    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        self.completion(
            system_prompt,
            user_prompt,
            max_tokens,
            context_window_tokens,
            temperature,
            request_id,
        )
        .await
    }
}

fn configured_model(store_model: Option<String>, env_var: &str) -> Option<String> {
    store_model
        .and_then(crate::utils::non_empty_trimmed_string)
        .or_else(|| {
            std::env::var(env_var)
                .ok()
                .and_then(crate::utils::non_empty_trimmed_string)
        })
}

fn require_local_model(
    provider_name: &str,
    store_model: Option<String>,
    env_var: &str,
) -> Result<String> {
    configured_model(store_model, env_var).ok_or_else(|| {
        anyhow::anyhow!(
            "No {provider_name} model configured. Please select a model in Settings or set {env_var}."
        )
    })
}

/// Create a provider based on environment configuration
pub fn create_provider<R: Runtime>(
    app_handle: Option<&AppHandle<R>>,
) -> Result<Box<dyn ChatCompletionProvider>> {
    let store_provider = app_handle
        .and_then(|app| crate::storage::store::get_summary_provider(app).ok())
        .flatten();

    let provider = store_provider
        .or_else(|| std::env::var("SUMMARY_AI_PROVIDER").ok())
        .unwrap_or_else(|| "openrouter".to_string());

    let store_model = app_handle
        .and_then(|app| crate::storage::store::get_summary_model(app).ok())
        .flatten();

    match provider.as_str() {
        "claude" | "codex" | "opencode" => {
            let tool = match provider.as_str() {
                "claude" => CliTool::Claude,
                "codex" => CliTool::Codex,
                _ => CliTool::OpenCode,
            };
            let model =
                configured_model(store_model, "SUMMARY_MODEL").unwrap_or_else(|| provider.clone());
            Ok(Box::new(CliCompletionClient::new(tool, model)))
        }
        "ollama" => {
            let model = require_local_model("Ollama", store_model, "SUMMARY_MODEL")?;

            let base_url = app_handle
                .and_then(|app| crate::storage::store::get_ollama_api_base_url(app).ok())
                .flatten()
                .or_else(|| std::env::var("OLLAMA_API_BASE").ok())
                .unwrap_or_else(|| DEFAULT_OLLAMA_API_BASE.to_string());
            Ok(Box::new(OllamaClient::new(&base_url, &model)))
        }
        "vllm" => {
            let model = require_local_model("vLLM", store_model, "SUMMARY_MODEL")?;

            let base_url = app_handle
                .and_then(|app| crate::storage::store::get_vllm_api_base_url(app).ok())
                .flatten()
                .or_else(|| std::env::var("VLLM_API_BASE").ok())
                .ok_or_else(|| {
                    anyhow::anyhow!("No vLLM base URL configured. Please set it in Settings.")
                })?;

            let api_key = app_handle
                .map(crate::storage::store::get_effective_vllm_api_key)
                .transpose()?
                .flatten()
                .unwrap_or_else(|| "none".to_string());

            Ok(Box::new(OpenAIClient::new(&api_key, &base_url, &model)))
        }
        "openai" => {
            let model = configured_model(store_model, "SUMMARY_MODEL")
                .unwrap_or_else(|| DEFAULT_OPENAI_SUMMARY_MODEL.to_string());

            let (key, base_url) = if let Some(app) = app_handle {
                crate::storage::store::get_effective_openai_provider_credential(app)?
            } else {
                crate::storage::store::get_env_openai_provider_credential()
            }
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "No OpenAI API key found. Please add your API key in Settings to get started."
                )
            })?;

            let model = model.strip_prefix("openai/").unwrap_or(&model).to_string();

            Ok(Box::new(OpenAIClient::new(&key, base_url, &model)))
        }
        _ => {
            let model = configured_model(store_model, "SUMMARY_MODEL")
                .unwrap_or_else(|| DEFAULT_SUMMARY_MODEL.to_string());

            let (key, base_url) = if let Some(app) = app_handle {
                crate::storage::store::get_effective_openrouter_provider_credential(app)?
            } else {
                crate::storage::store::get_env_openrouter_provider_credential()
            }
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "No OpenRouter API key found. Please add your API key in Settings to get started."
                )
            })?;

            Ok(Box::new(OpenAIClient::new(&key, base_url, &model)))
        }
    }
}
