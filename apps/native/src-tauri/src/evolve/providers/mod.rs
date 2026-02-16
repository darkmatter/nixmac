use super::messages::{Message, Tool};
use anyhow::Error as AnyhowError;
use async_trait::async_trait;
use reqwest::StatusCode;
use std::error::Error as StdError;
use std::fmt;

pub mod ollama;
pub mod openai;

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
#[derive(Debug)]
pub enum ProviderError {
    /// HTTP-style error with status code and body
    Http { status: StatusCode, body: String },
    /// Other error (wrapped anyhow::Error)
    Other(AnyhowError),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderError::Http { status, body } => write!(f, "http error {}: {}", status, body),
            ProviderError::Other(e) => write!(f, "{}", e),
        }
    }
}

impl StdError for ProviderError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            ProviderError::Other(e) => e.source(),
            _ => None,
        }
    }
}
