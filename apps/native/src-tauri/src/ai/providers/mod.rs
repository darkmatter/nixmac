pub mod cli;
mod ollama;
mod openai;

use anyhow::Result;
pub use cli::{CliCompletionClient, CliTool};
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;
use tauri::{AppHandle, Runtime};

use async_trait::async_trait;

const DEFAULT_SUMMARY_MODEL: &str = "openai/gpt-oss-120b";
const DEFAULT_OPENAI_SUMMARY_MODEL: &str = "gpt-5-mini";
const DEFAULT_OLLAMA_API_BASE: &str = "http://localhost:11434";
pub(crate) const NIXMAC_PROVIDER: &str = "nixmac";
pub(crate) const DEFAULT_NIXMAC_MODEL: &str = "auto";

pub(crate) fn nixmac_llm_api_base(web_server_url: &str) -> String {
    format!("{}/api/llm/v1", web_server_url.trim_end_matches('/'))
}

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

fn configured_model(
    store_model: Option<String>,
    env_model: impl Fn() -> Option<String>,
) -> Option<String> {
    store_model
        .and_then(crate::utils::non_empty_trimmed_string)
        .or_else(env_model)
}

fn require_local_model(
    provider_name: &str,
    store_model: Option<String>,
    env_var: &str,
) -> Result<String> {
    configured_model(store_model, crate::env::default_summary_model).ok_or_else(|| {
        anyhow::anyhow!(
            "No {provider_name} model configured. Please select a model in Settings or set {env_var}."
        )
    })
}

pub(crate) fn resolve_legacy_openai_provider(
    provider: String,
    model: Option<&str>,
    has_openai_credential: bool,
    has_openrouter_credential: bool,
) -> String {
    let uses_openrouter_model = model
        .and_then(crate::utils::non_empty_trimmed_string)
        .is_some_and(|value| value.contains('/'));
    if provider == "openai"
        && has_openrouter_credential
        && (!has_openai_credential || uses_openrouter_model)
    {
        "openrouter".to_string()
    } else {
        provider
    }
}

pub(crate) fn resolve_unconfigured_openai_compatible_provider(
    provider: Option<String>,
    has_openai_credential: bool,
    has_openrouter_credential: bool,
) -> String {
    provider.unwrap_or_else(|| {
        if has_openai_credential && !has_openrouter_credential {
            "openai".to_string()
        } else {
            "openrouter".to_string()
        }
    })
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
    provider: Option<String>,
    model: Option<&str>,
) -> Result<(String, bool)> {
    let provider = if let Some(provider) = provider {
        provider
    } else {
        resolve_unconfigured_openai_compatible_provider(
            None,
            has_openai_provider_credential(app_handle)?,
            has_openrouter_provider_credential(app_handle)?,
        )
    };

    if provider != "openai" {
        return Ok((provider, false));
    }

    let resolved = resolve_legacy_openai_provider(
        provider,
        model,
        has_openai_provider_credential(app_handle)?,
        has_openrouter_provider_credential(app_handle)?,
    );

    if resolved == "openrouter" {
        log::info!("Using OpenRouter for legacy OpenAI summary provider compatibility");
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

    let env_settings = crate::env::settings_from_app(app_handle);
    let configured_provider = store_provider
        .or_else(|| crate::env::optional(env_settings.default_summary_provider.clone()));
    let store_model = app_handle
        .and_then(|app| crate::storage::store::get_summary_model(app).ok())
        .flatten();
    let configured_summary_model = configured_model(store_model.clone(), || {
        crate::env::optional(env_settings.default_summary_model.clone())
    });
    let (provider, used_legacy_openai_fallback) = resolve_summary_provider(
        app_handle,
        configured_provider,
        configured_summary_model.as_deref(),
    )?;

    match provider.as_str() {
        "claude" | "codex" | "opencode" => {
            let tool = match provider.as_str() {
                "claude" => CliTool::Claude,
                "codex" => CliTool::Codex,
                _ => CliTool::OpenCode,
            };
            let model = configured_summary_model.unwrap_or_else(|| provider.clone());
            Ok(Box::new(CliCompletionClient::new(tool, model)))
        }
        "ollama" => {
            let model =
                require_local_model("Ollama", store_model, crate::env::keys::SUMMARY_MODEL)?;

            let base_url = app_handle
                .and_then(|app| crate::storage::store::get_ollama_api_base_url(app).ok())
                .flatten()
                .or_else(|| crate::env::optional(env_settings.ollama_api_base.clone()))
                .unwrap_or_else(|| DEFAULT_OLLAMA_API_BASE.to_string());
            Ok(Box::new(OllamaClient::new(&base_url, &model)))
        }
        "openai_compatible" => {
            let model = require_local_model(
                "OpenAI-compatible",
                store_model,
                crate::env::keys::SUMMARY_MODEL,
            )?;

            let base_url = app_handle
                .and_then(|app| crate::storage::store::get_openai_compatible_api_base_url(app).ok())
                .flatten()
                .or_else(|| crate::env::optional(env_settings.openai_compatible_api_base.clone()))
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "No OpenAI-compatible base URL configured. Please set it in Settings."
                    )
                })?;

            let api_key = app_handle
                .map(crate::storage::store::get_effective_openai_compatible_api_key)
                .transpose()?
                .flatten()
                .unwrap_or_else(|| "none".to_string());

            Ok(Box::new(OpenAIClient::new(&api_key, &base_url, &model)))
        }
        NIXMAC_PROVIDER => {
            let app = app_handle.ok_or_else(|| {
                anyhow::anyhow!("The nixmac hosted provider requires the desktop app context.")
            })?;
            let api_key = crate::storage::store::get_device_api_key(app)?
                .ok_or_else(|| anyhow::anyhow!("Sign in to nixmac hosted inference first."))?;
            let base_url = nixmac_llm_api_base(&crate::storage::store::get_web_server_url()?);
            let model =
                configured_summary_model.unwrap_or_else(|| DEFAULT_NIXMAC_MODEL.to_string());

            Ok(Box::new(OpenAIClient::new(&api_key, &base_url, &model)))
        }
        "openai" => {
            let model = configured_summary_model
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
            let model = if used_legacy_openai_fallback {
                openrouter_model_slug_or_default(configured_summary_model, DEFAULT_SUMMARY_MODEL)
            } else {
                configured_summary_model.unwrap_or_else(|| DEFAULT_SUMMARY_MODEL.to_string())
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
    use super::{
        openrouter_model_slug_or_default, resolve_legacy_openai_provider,
        resolve_unconfigured_openai_compatible_provider,
    };

    #[test]
    fn legacy_openai_provider_falls_back_to_openrouter_when_only_openrouter_key_exists() {
        let provider =
            resolve_legacy_openai_provider("openai".to_string(), Some("gpt-4o"), false, true);

        assert_eq!(provider, "openrouter");
    }

    #[test]
    fn legacy_openai_provider_falls_back_to_openrouter_for_openrouter_model_slug() {
        let provider = resolve_legacy_openai_provider(
            "openai".to_string(),
            Some("~anthropic/claude-sonnet-latest"),
            true,
            true,
        );

        assert_eq!(provider, "openrouter");
    }

    #[test]
    fn legacy_openai_provider_falls_back_to_openrouter_for_missing_model() {
        let provider = resolve_legacy_openai_provider("openai".to_string(), None, false, true);

        assert_eq!(provider, "openrouter");
    }

    #[test]
    fn direct_openai_provider_stays_openai_when_openai_key_exists_without_model() {
        let provider = resolve_legacy_openai_provider("openai".to_string(), None, true, true);

        assert_eq!(provider, "openai");
    }

    #[test]
    fn direct_openai_provider_stays_openai_when_openai_key_exists_with_bare_model() {
        let provider =
            resolve_legacy_openai_provider("openai".to_string(), Some("gpt-4o"), true, true);

        assert_eq!(provider, "openai");
    }

    #[test]
    fn non_openai_provider_is_unchanged() {
        let provider =
            resolve_legacy_openai_provider("ollama".to_string(), Some("gpt-4o"), false, true);

        assert_eq!(provider, "ollama");
    }

    #[test]
    fn unconfigured_provider_uses_openai_when_only_openai_key_exists() {
        let provider = resolve_unconfigured_openai_compatible_provider(None, true, false);

        assert_eq!(provider, "openai");
    }

    #[test]
    fn unconfigured_provider_preserves_openrouter_default_when_both_keys_exist() {
        let provider = resolve_unconfigured_openai_compatible_provider(None, true, true);

        assert_eq!(provider, "openrouter");
    }

    #[test]
    fn configured_provider_overrides_available_credentials() {
        let provider = resolve_unconfigured_openai_compatible_provider(
            Some("ollama".to_string()),
            true,
            false,
        );

        assert_eq!(provider, "ollama");
    }

    #[test]
    fn openrouter_model_slug_is_preserved() {
        let model = openrouter_model_slug_or_default(
            Some("google/gemini-2.5-pro".to_string()),
            "~anthropic/claude-sonnet-latest",
        );

        assert_eq!(model, "google/gemini-2.5-pro");
    }

    #[test]
    fn bare_openai_model_uses_openrouter_default() {
        let model = openrouter_model_slug_or_default(
            Some("gpt-4o".to_string()),
            "~anthropic/claude-sonnet-latest",
        );

        assert_eq!(model, "~anthropic/claude-sonnet-latest");
    }
}
