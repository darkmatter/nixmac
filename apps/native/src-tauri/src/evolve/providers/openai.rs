use super::{AiProvider, ProviderResponse, TokenUsage};
use crate::evolve::messages::{Message, Tool as GenericTool, ToolCall};
use anyhow::{anyhow, Result};
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestToolMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionTool, ChatCompletionToolArgs, ChatCompletionToolType,
        CreateChatCompletionRequestArgs, FunctionCall, FunctionObjectArgs,
    },
    Client,
};
use async_trait::async_trait;

pub struct OpenAIProvider {
    client: Client<OpenAIConfig>,
    model: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, api_base: String, model: String) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(api_base);
        let client = Client::with_config(config);
        Self { client, model }
    }
}

#[async_trait]
impl AiProvider for OpenAIProvider {
    fn model_name(&self) -> String {
        self.model.clone()
    }

    async fn completion(
        &self,
        messages: &[Message],
        tools: &[GenericTool],
    ) -> Result<ProviderResponse> {
        let openai_messages = convert_to_openai_messages(messages);
        let openai_tools = convert_to_openai_tools(tools);

        let mut request_builder = CreateChatCompletionRequestArgs::default();
        request_builder
            .model(&self.model)
            .messages(openai_messages)
            .tools(openai_tools)
            .temperature(0.2);

        // Some models support this, others don't. For OpenAI/Claude it is usually supported/required for long checks.
        // But let's check if we can make it optional or robust.
        // For now, hardcode max_tokens as in original mod.rs
        // const MAX_TOKENS: u32 = 65_000;
        request_builder.max_completion_tokens(65000u32);

        let request = request_builder.build()?;

        let response = self.client.chat().create(request).await?;

        let choice = response
            .choices
            .first()
            .ok_or_else(|| anyhow!("No response from OpenAI"))?;

        let message = convert_from_openai_response(choice);

        let usage = response.usage.map(|u| TokenUsage {
            input: u.prompt_tokens,
            output: u.completion_tokens,
            total: u.total_tokens,
        });

        Ok(ProviderResponse { message, usage })
    }
}

fn convert_to_openai_tools(tools: &[GenericTool]) -> Vec<ChatCompletionTool> {
    tools
        .iter()
        .map(|t| {
            ChatCompletionToolArgs::default()
                .r#type(ChatCompletionToolType::Function)
                .function(
                    FunctionObjectArgs::default()
                        .name(&t.name)
                        .description(&t.description)
                        .parameters(t.parameters.clone())
                        .build()
                        .unwrap(),
                )
                .build()
                .unwrap()
        })
        .collect()
}

fn convert_to_openai_messages(messages: &[Message]) -> Vec<ChatCompletionRequestMessage> {
    messages
        .iter()
        .map(|msg| match msg {
            Message::System { content } => ChatCompletionRequestSystemMessageArgs::default()
                .content(content.clone())
                .build()
                .unwrap()
                .into(),
            Message::User { content } => ChatCompletionRequestUserMessageArgs::default()
                .content(content.clone())
                .build()
                .unwrap()
                .into(),
            Message::Assistant {
                content,
                tool_calls,
            } => {
                let mut builder = ChatCompletionRequestAssistantMessageArgs::default();
                if let Some(c) = content {
                    builder.content(c.clone());
                }

                if let Some(calls) = tool_calls {
                    let openai_calls: Vec<ChatCompletionMessageToolCall> = calls
                        .iter()
                        .map(|call| ChatCompletionMessageToolCall {
                            id: call.id.clone(),
                            r#type: ChatCompletionToolType::Function,
                            function: FunctionCall {
                                name: call.name.clone(),
                                arguments: call.arguments.clone(),
                            },
                        })
                        .collect();
                    builder.tool_calls(openai_calls);
                }
                builder.build().unwrap().into()
            }
            Message::Tool {
                tool_call_id,
                content,
            } => ChatCompletionRequestToolMessageArgs::default()
                .tool_call_id(tool_call_id.clone())
                .content(content.clone())
                .build()
                .unwrap()
                .into(),
        })
        .collect()
}

fn convert_from_openai_response(choice: &async_openai::types::ChatChoice) -> Message {
    let content = choice.message.content.clone();
    let tool_calls = choice.message.tool_calls.as_ref().map(|calls| {
        calls
            .iter()
            .map(|call| ToolCall {
                id: call.id.clone(),
                name: call.function.name.clone(),
                arguments: call.function.arguments.clone(),
            })
            .collect()
    });

    Message::Assistant {
        content,
        tool_calls,
    }
}
