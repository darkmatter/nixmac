//! Summarization model calls.

use anyhow::Result;
use log::{debug, warn};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::ai::providers::{TokenUsage, create_provider};
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
    // The model processes both system and user prompts as input tokens, so
    // include both when sizing the budget — otherwise we underestimate the
    // input and may starve the output budget for reasoning models.
    let combined_prompt = format!("{system_prompt}\n{user_prompt}");
    let allocation = budget_for(&combined_prompt, provider.model());
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

    let cleaned = strip_json_fences(&raw_response);
    match serde_json::from_str::<T>(cleaned) {
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

/// Some models wrap their JSON output in a Markdown code fence
/// (```json ... ``` or ``` ... ```). Strip that wrapper so the payload
/// parses cleanly. Returns the input unchanged if no fence is present.
fn strip_json_fences(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(inner) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    // Drop the opening fence's language tag / rest of that line.
    let inner = match inner.split_once('\n') {
        Some((_lang, rest)) => rest,
        None => inner,
    };
    // Drop the closing fence.
    inner.trim_end().strip_suffix("```").unwrap_or(inner).trim()
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
    tracing::error!(
        source = source,
        provider = provider_model,
        model = provider_model,
        request_id = request_id,
        error_length = err_str.len(),
        error_hash = %hash,
        "{}: provider completion failed",
        context
    );
}

#[cfg(test)]
mod tests {
    use super::strip_json_fences;

    #[test]
    fn strips_json_language_fence() {
        let raw = "```json\n{\"message\":\"hi\"}\n```";
        assert_eq!(strip_json_fences(raw), "{\"message\":\"hi\"}");
    }

    #[test]
    fn strips_bare_fence() {
        let raw = "```\n{\"message\":\"hi\"}\n```";
        assert_eq!(strip_json_fences(raw), "{\"message\":\"hi\"}");
    }

    #[test]
    fn leaves_plain_json_untouched() {
        let raw = "{\"message\":\"hi\"}";
        assert_eq!(strip_json_fences(raw), "{\"message\":\"hi\"}");
    }

    #[test]
    fn handles_surrounding_whitespace() {
        let raw = "  ```json\n{\"message\":\"hi\"}\n```  \n";
        assert_eq!(strip_json_fences(raw), "{\"message\":\"hi\"}");
    }
}
