use super::ChatCompletionProvider;
use anyhow::Result;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use async_trait::async_trait;
use log::debug;

pub struct OpenAIClient {
    client: Client<OpenAIConfig>,
    model: String,
}

impl OpenAIClient {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(base_url);
        let client = Client::with_config(config);
        Self {
            client,
            model: model.to_string(),
        }
    }
}

#[async_trait]
impl ChatCompletionProvider for OpenAIClient {
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
        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(vec![
                ChatCompletionRequestSystemMessageArgs::default()
                    .content(system_prompt)
                    .build()?
                    .into(),
                ChatCompletionRequestUserMessageArgs::default()
                    .content(user_prompt)
                    .build()?
                    .into(),
            ])
            .max_completion_tokens(max_tokens)
            .temperature(temperature)
            .build()?;

        debug!("Requesting completion from {}", self.model);
        let response = self.client.chat().create(request).await?;

        Ok(response
            .choices
            .first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default())
    }
}
