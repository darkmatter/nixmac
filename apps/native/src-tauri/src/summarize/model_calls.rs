//! Summarization model calls.

use anyhow::Result;
use log::{debug, warn};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::ai::providers::{TokenUsage, create_provider};
use crate::summarize::token_budgets::changeset_summaries_budget;

/// One item in the model's multi-summary response: a conventional commit
/// message plus the file paths it covers.
#[derive(Debug, Clone, Deserialize)]
pub struct ChangesetSummaryItem {
    pub summary: String,
    pub files: Vec<String>,
}

/// The prompt asks for an array, but providers request
/// `response_format: json_object`, which steers models toward a top-level
/// object — especially when there is only one group. Accept both shapes.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ChangesetSummariesResponse {
    Many(Vec<ChangesetSummaryItem>),
    One(ChangesetSummaryItem),
}

impl From<ChangesetSummariesResponse> for Vec<ChangesetSummaryItem> {
    fn from(response: ChangesetSummariesResponse) -> Self {
        match response {
            ChangesetSummariesResponse::Many(items) => items,
            ChangesetSummariesResponse::One(item) => vec![item],
        }
    }
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

    let cleaned = extract_json_object(&raw_response);
    match serde_json::from_str::<T>(cleaned) {
        Ok(parsed) => Ok((parsed, tokens_used)),
        Err(first_err) => {
            // Models occasionally wrap JSON in markdown fences or prepend
            // prose even when a JSON response format is requested. The first
            // parse already applied `extract_json_object` to tolerate that, so
            // a remaining failure is most likely a non-deterministic malformed
            // completion. Retry once with the same inputs before giving up.
            warn!(
                "[{}] JSON parse failed, retrying [id: {}]: {}. Raw: {}",
                fn_name, request_id, first_err, raw_response
            );

            let retry_id = uuid::Uuid::new_v4().to_string();
            let (retry_raw, retry_tokens) = match provider
                .json_completion(
                    system_prompt,
                    user_prompt,
                    allocation.output_tokens,
                    Some(allocation.required_context_tokens),
                    temperature,
                    &retry_id,
                )
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    let err_str = format!("{:#}", e);
                    warn!(
                        "[{}] retry provider completion failed: {}",
                        fn_name, err_str
                    );
                    report_provider_error(fn_name, provider.model(), &retry_id, &err_str, fn_name);
                    return Err(e);
                }
            };

            if retry_raw.trim().is_empty() {
                warn!(
                    "[{}] retry returned empty response [id: {}]",
                    fn_name, retry_id
                );
                return Err(anyhow::anyhow!(
                    "{}: failed to parse JSON and retry returned empty response",
                    fn_name
                ));
            }

            let retry_cleaned = extract_json_object(&retry_raw);
            match serde_json::from_str::<T>(retry_cleaned) {
                Ok(parsed) => Ok((parsed, retry_tokens)),
                Err(e) => {
                    warn!(
                        "[{}] retry also failed to parse JSON [id: {}]: {}. Raw: {}",
                        fn_name, retry_id, e, retry_raw
                    );
                    Err(anyhow::anyhow!(
                        "{}: failed to parse JSON after retry: {}",
                        fn_name,
                        e
                    ))
                }
            }
        }
    }
}

/// Extract the first JSON object or array from a model response.
///
/// Providers ask for `response_format: json_object` (or the local equivalent),
/// but CLI-backed providers and some reasoning-style models still occasionally
/// wrap output in markdown fences (```` ```json … ``` ````) or emit leading
/// prose. This narrows the response to the first balanced `{ … }` or
/// `[ … ]` span so the downstream `serde_json::from_str` is robust against
/// that wrapping.
fn extract_json_object(raw: &str) -> &str {
    let trimmed = raw.trim();

    // Strip a single surrounding ```json … ``` or ``` … ``` fence.
    let after_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(str::trim_start)
        .unwrap_or(trimmed);
    let body = after_fence
        .strip_suffix("```")
        .map(str::trim_end)
        .unwrap_or(after_fence);

    // Narrow to the first balanced {...} or [...] span, tolerating
    // leading/trailing prose. Arrays are produced when the model returns
    // multiple summary items.
    let obj_span = match (body.find('{'), body.rfind('}')) {
        (Some(start), Some(end)) if end > start => Some(start..=end),
        _ => None,
    };
    let arr_span = match (body.find('['), body.rfind(']')) {
        (Some(start), Some(end)) if end > start => Some(start..=end),
        _ => None,
    };
    match (obj_span, arr_span) {
        (Some(obj), Some(arr)) => {
            // Pick whichever starts first; if both start at the same position
            // (impossible for { vs [), prefer the object.
            if *obj.start() <= *arr.start() {
                &body[obj]
            } else {
                &body[arr]
            }
        }
        (Some(span), None) => &body[span],
        (None, Some(span)) => &body[span],
        (None, None) => body,
    }
}

/// Calls the model and parses a `[{ summary, files }]` array response.
///
/// Returns one or more summary items. The caller is responsible for matching
/// `files` back to change rows; any change the model did not assign to a group
/// is left for the caller to handle (e.g. as singles).
pub async fn generate_changeset_summaries<R: Runtime>(
    system_prompt: &str,
    user_prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(Vec<ChangesetSummaryItem>, TokenUsage)> {
    let (response, usage) = request_json::<_, ChangesetSummariesResponse>(
        system_prompt,
        user_prompt,
        changeset_summaries_budget,
        0.2,
        "generate_changeset_summaries",
        app_handle,
    )
    .await?;

    let cleaned: Vec<ChangesetSummaryItem> = Vec::from(response)
        .into_iter()
        .map(|mut item| {
            item.summary = item.summary.trim().to_string();
            item
        })
        .filter(|item| !item.summary.is_empty())
        .collect();

    if cleaned.is_empty() {
        return Err(anyhow::anyhow!(
            "generate_changeset_summaries: parsed empty result list"
        ));
    }

    Ok((cleaned, usage))
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
    use super::*;

    #[test]
    fn extract_plain_json() {
        assert_eq!(
            extract_json_object(r#"{"message":"hi"}"#),
            r#"{"message":"hi"}"#
        );
    }

    #[test]
    fn extract_plain_array() {
        assert_eq!(
            extract_json_object(r#"[{"summary":"a","files":["f.nix"]}]"#),
            r#"[{"summary":"a","files":["f.nix"]}]"#
        );
    }

    #[test]
    fn extract_strips_json_fence() {
        let raw = "```json\n{\"message\":\"hi\"}\n```";
        assert_eq!(extract_json_object(raw), r#"{"message":"hi"}"#);
    }

    #[test]
    fn extract_strips_array_fence() {
        let raw = "```json\n[{\"summary\":\"a\",\"files\":[]}]\n```";
        assert_eq!(extract_json_object(raw), r#"[{"summary":"a","files":[]}]"#);
    }

    #[test]
    fn extract_strips_bare_fence() {
        let raw = "```\n{\"message\":\"hi\"}\n```";
        assert_eq!(extract_json_object(raw), r#"{"message":"hi"}"#);
    }

    #[test]
    fn extract_narrows_to_balanced_object() {
        let raw = "Sure, here you go:\n{\"message\":\"hi\"}\nLet me know.";
        assert_eq!(extract_json_object(raw), r#"{"message":"hi"}"#);
    }

    #[test]
    fn extract_narrows_to_balanced_array() {
        let raw = "Sure, here you go:\n[{\"summary\":\"a\",\"files\":[]}]\nLet me know.";
        assert_eq!(extract_json_object(raw), r#"[{"summary":"a","files":[]}]"#);
    }

    #[test]
    fn extract_prefers_first_span_when_object_and_array_both_present() {
        // An object embedded in prose, followed by an array — the object
        // starts first, so it should win.
        let raw = "ok: {\"a\":1} then [\"x\"]";
        assert_eq!(extract_json_object(raw), r#"{"a":1}"#);
    }

    #[test]
    fn summaries_response_parses_array() {
        let parsed: ChangesetSummariesResponse =
            serde_json::from_str(r#"[{"summary":"a","files":["f.nix"]}]"#).unwrap();
        let items = Vec::from(parsed);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].summary, "a");
    }

    #[test]
    fn summaries_response_parses_single_object() {
        let parsed: ChangesetSummariesResponse = serde_json::from_str(
            r#"{"summary":"chore(home): rename pi4 host","files":["alex-laptop/home.nix"]}"#,
        )
        .unwrap();
        let items = Vec::from(parsed);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].files, vec!["alex-laptop/home.nix"]);
    }

    #[test]
    fn extract_returns_body_when_no_braces() {
        // No braces — return as-is so the caller's serde error stays informative.
        assert_eq!(extract_json_object("not json"), "not json");
    }
}
