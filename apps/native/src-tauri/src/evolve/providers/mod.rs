use super::messages::{Message, Tool};
use crate::provider_errors::friendly_provider_error;
use anyhow::Error as AnyhowError;
use async_trait::async_trait;
use reqwest::StatusCode;
use thiserror::Error;

pub mod cli;
pub mod ollama;
pub mod openai;

pub use cli::CliProvider;
pub use ollama::OllamaProvider;
pub use openai::OpenAIProvider;

#[derive(Debug, Clone)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub total: u32,
}

#[derive(Debug)]
pub struct ProviderResponse {
    pub message: Message,
    pub usage: Option<TokenUsage>,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn completion(
        &self,
        messages: &[Message],
        tools: &[Tool],
    ) -> std::result::Result<ProviderResponse, ProviderError>;

    fn model_name(&self) -> String;
}

/// Errors returned by AI providers in the evolve subsystem.
///
/// Purpose:
/// - Represent provider-level failures while preserving useful debug data for
///   local diagnostics and UI display (HTTP status and provider response body).
///
/// Security & privacy rules:
/// - `Http { status, body }` intentionally keeps the full response `body` for
///   *local* debugging and UI only. Depending on the AI provider,
///   the body may contain sensitive data (prompts, completions, or user content)
///   and MUST NOT be sent to remote diagnostics (Sentry, analytics) in raw form.
/// - Before sending anything to remote telemetry, use a redaction/summary helper
///   to send only non-sensitive metadata such as status code, error type, length,
///   and a correlation hash. Never send `body` itself.
///
/// API guidance for callers:
/// - Prefer matching on `ProviderError` directly when you need `status` or the
///   full `body` for local handling:
///     - `ProviderError::Http { status, body }` — safe to inspect for local logs/UI.
///     - `ProviderError::Other(e)` — wrapper for non-HTTP errors (keeps original error).
/// - If a public API returns `anyhow::Error` (error erasure), callers that need
///   `ProviderError` can downcast the `anyhow::Error` with `err.downcast_ref::<ProviderError>()`
///   or `err.downcast::<ProviderError>()` to recover the concrete error and inspect `status`.
/// - Avoid `format!("{}", e)` or `e.to_string()` for remote reporting because
///   `Display` includes the raw body for `Http` variants.
///
/// See `report_provider_error` in `evolve/mod.rs` for an example of safe telemetry
/// reporting and `extract_error_metadata` for extracting non-sensitive fields.
#[derive(Debug, Error)]
pub enum ProviderError {
    /// HTTP-style error with status code and body
    #[error("http error {status}: {body}")]
    Http { status: StatusCode, body: String },
    /// Other error (wrapped anyhow::Error)
    #[error(transparent)]
    Other(AnyhowError),
}

impl ProviderError {
    /// Return a user-friendly error message suitable for display in the UI.
    ///
    /// Translates raw provider errors into actionable guidance without
    /// exposing technical details like JSON payloads or deserialization failures.
    /// The concrete `OpenAIError` matching in `openai.rs` ensures that both
    /// standard API errors and deserialization failures are already mapped to
    /// `Http { status, body }` before reaching this method.
    pub fn user_message(&self) -> String {
        match self {
            ProviderError::Http { status, .. } => friendly_provider_error(status.as_u16()),
            ProviderError::Other(e) => {
                let msg = format!("{:#}", e);
                // Preserve controlled messages that are already user-friendly.
                // These are our own anyhow errors from setup validation, not
                // raw provider/network errors:
                //   - "No API key found. Please add your API key in Settings..."
                //   - "No host attribute configured. Please set a host first."
                if msg.contains("API key") || msg.contains("No host") {
                    msg
                } else {
                    // Transport errors, DNS failures, connection refused, etc.
                    // should not leak raw technical text to the user.
                    "Something went wrong connecting to the AI provider. Please check your connection and try again.".to_string()
                }
            }
        }
    }
}
