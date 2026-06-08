//! Summarization model calls.

use anyhow::Result;
use log::{debug, warn};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::ai::providers::{create_provider, TokenUsage};
use crate::summarize::token_budgets::commit_message_budget;

#[derive(Deserialize)]
struct CommitMessageJson {
    message: String,
}

async fn request_json<R: Runtime, T: serde::de::DeserializeOwned>(
    system_prompt: &str,
    user_prompt: &str,
    budget_for: fn(&str, &str) -> crate::summarize::token_budgets::TokenAllocation,
    temperature: f32,
    fn_name: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(T, TokenUsage)> {
    let provider = create_provider(app_handle)?;
    let allocation = budget_for(user_prompt, provider.model());
    let request_id = uuid::Uuid::new_v4().to_string();
    debug!(
        "[{}] requesting from {} [id: {}] output_tokens={} context_window_tokens={}",
        fn_name,
        provider.model(),
        request_id,
        allocation.output_tokens,
        allocation.required_context_tokens
    );

    let (raw_response, tokens_used) = match provider
        .json_completion(
            system_prompt,
            user_prompt,
            allocation.output_tokens,
            Some(allocation.required_context_tokens),
            temperature,
            &request_id,
        )
        .await
    {
        Ok(t) => t,
        Err(e) => {
            let err_str = format!("{:#}", e);
            warn!("[{}] provider completion failed: {}", fn_name, err_str);
            report_provider_error(fn_name, provider.model(), &request_id, &err_str, fn_name);
            return Err(e);
        }
    };

    if raw_response.trim().is_empty() {
        warn!(
            "[{}] model returned empty response [id: {}]",
            fn_name, request_id,
        );
        debug!(
            "[{}] user prompt: {}\nsystem prompt: {}\ntoken budget: {}",
            fn_name, user_prompt, system_prompt, allocation.output_tokens
        );
        return Err(anyhow::anyhow!(
            "{}: model returned empty response",
            fn_name
        ));
    }

    match serde_json::from_str::<T>(&raw_response) {
        Ok(parsed) => Ok((parsed, tokens_used)),
        Err(e) => {
            warn!(
                "[{}] failed to parse JSON [id: {}]: {}. Raw: {}",
                fn_name, request_id, e, raw_response
            );
            Err(anyhow::anyhow!("{}: failed to parse JSON: {}", fn_name, e))
        }
    }
}

pub async fn generate_commit_message<R: Runtime>(
    system_prompt: &str,
    user_prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(String, TokenUsage)> {
    let (parsed, usage) = request_json::<_, CommitMessageJson>(
        system_prompt,
        user_prompt,
        commit_message_budget,
        0.2,
        "generate_commit_message",
        app_handle,
    )
    .await?;
    if parsed.message.trim().is_empty() {
        return Err(anyhow::anyhow!(
            "generate_commit_message: parsed empty message"
        ));
    }
    Ok((parsed.message.trim().to_string(), usage))
}

fn report_provider_error(
    source: &str,
    provider_model: &str,
    request_id: &str,
    err_str: &str,
    context: &str,
) {
    let mut h = Sha256::new();
    h.update(err_str.as_bytes());
    let hash = hex::encode(h.finalize())[..8].to_string();
    sentry::with_scope(
        |scope| {
            scope.set_tag("source", source);
            scope.set_tag("provider", provider_model);
            scope.set_tag("model", provider_model);
            scope.set_extra("request_id", request_id.into());
            scope.set_extra("error_length", (err_str.len() as u64).into());
            scope.set_extra("error_hash", hash.into());
            sentry::capture_message(
                &format!("{}: provider completion failed", context),
                sentry::Level::Error,
            );
        },
        || {},
    );
}
