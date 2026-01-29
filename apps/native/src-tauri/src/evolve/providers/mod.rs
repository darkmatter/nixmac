use super::messages::{Message, Tool};
use anyhow::Result;
use async_trait::async_trait;

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
    async fn completion(&self, messages: &[Message], tools: &[Tool]) -> Result<ProviderResponse>;

    fn model_name(&self) -> String;
}
