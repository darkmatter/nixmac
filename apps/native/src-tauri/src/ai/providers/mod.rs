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

pub(crate) fn resolve_legacy_openai_provider(
    provider: String,
    has_openai_credential: bool,
    has_openrouter_credential: bool,
) -> String {
    if provider == "openai" && !has_openai_credential && has_openrouter_credential {
        "openrouter".to_string()
    } else {
        provider
    }
}

pub(crate) fn openrouter_model_slug_or_default(
    model: Option<String>,
    default_model: &str,
) -> String {
    model
        .filter(|value| value.trim().contains('/'))
        .unwrap_or_else(|| default_model.to_string())
}

fn has_openai_provider_credential<R: Runtime>(app_handle: Option<&AppHandle<R>>) -> Result<bool> {
    if let Some(app) = app_handle {
        return Ok(crate::storage::store::get_effective_openai_provider_credential(app)?.is_some());
    }

    Ok(crate::storage::store::get_env_openai_provider_credential().is_some())
}

fn has_openrouter_provider_credential<R: Runtime>(
    app_handle: Option<&AppHandle<R>>,
) -> Result<bool> {
    if let Some(app) = app_handle {
        return Ok(
            crate::storage::store::get_effective_openrouter_provider_credential(app)?.is_some(),
        );
    }

    Ok(crate::storage::store::get_env_openrouter_provider_credential().is_some())
}

fn resolve_summary_provider<R: Runtime>(
    app_handle: Option<&AppHandle<R>>,
    provider: String,
) -> Result<(String, bool)> {
    if provider != "openai" {
        return Ok((provider, false));
    }

    let resolved = resolve_legacy_openai_provider(
        provider,
        has_openai_provider_credential(app_handle)?,
        has_openrouter_provider_credential(app_handle)?,
    );

    if resolved == "openrouter" {
        log::info!("Using OpenRouter for legacy OpenAI summary provider because no direct OpenAI key is configured");
    }
    let used_legacy_openai_fallback = resolved == "openrouter";

    Ok((resolved, used_legacy_openai_fallback))
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
    let (provider, used_legacy_openai_fallback) = resolve_summary_provider(app_handle, provider)?;

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
            let configured_model = configured_model(store_model, "SUMMARY_MODEL");
            let model = if used_legacy_openai_fallback {
                openrouter_model_slug_or_default(configured_model, DEFAULT_SUMMARY_MODEL)
            } else {
                configured_model.unwrap_or_else(|| DEFAULT_SUMMARY_MODEL.to_string())
            };

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

#[cfg(test)]
mod tests {
    use super::{openrouter_model_slug_or_default, resolve_legacy_openai_provider};

    #[test]
    fn legacy_openai_provider_falls_back_to_openrouter_when_only_openrouter_key_exists() {
        let provider = resolve_legacy_openai_provider("openai".to_string(), false, true);

        assert_eq!(provider, "openrouter");
    }

    #[test]
    fn direct_openai_provider_stays_openai_when_openai_key_exists() {
        let provider = resolve_legacy_openai_provider("openai".to_string(), true, true);

        assert_eq!(provider, "openai");
    }

    #[test]
    fn non_openai_provider_is_unchanged() {
        let provider = resolve_legacy_openai_provider("ollama".to_string(), false, true);

        assert_eq!(provider, "ollama");
    }

    #[test]
    fn openrouter_model_slug_is_preserved() {
        let model = openrouter_model_slug_or_default(
            Some("google/gemini-2.5-pro".to_string()),
            "anthropic/claude-sonnet-4",
        );

        assert_eq!(model, "google/gemini-2.5-pro");
    }

    #[test]
    fn bare_openai_model_uses_openrouter_default() {
        let model = openrouter_model_slug_or_default(
            Some("gpt-4o".to_string()),
            "anthropic/claude-sonnet-4",
        );

        assert_eq!(model, "anthropic/claude-sonnet-4");
    }
}
