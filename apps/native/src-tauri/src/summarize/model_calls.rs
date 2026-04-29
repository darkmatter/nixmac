//! Hunk-based summarization model calls.

use anyhow::Result;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::providers::{create_provider, TokenUsage};
use crate::summarize::model_output_types::{
    EvolvedGroupSummary, HunkSummary, RawHunkPlacement, RawNewMapEntry,
};
use crate::summarize::token_budgets::{
    commit_message_budget, group_budget, map_relations_budget, map_relations_to_existing_budget,
    single_budget,
};

const TEMPERATURE: f32 = 0.3;

async fn request_json<R: Runtime, T: serde::de::DeserializeOwned>(
    system_prompt: &str,
    user_prompt: &str,
    completion_tokens: u32,
    input_tokens_budget: Option<u32>,
    temperature: f32,
    fn_name: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(T, TokenUsage)> {
    let provider = create_provider(app_handle)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    debug!(
        "[{}] requesting from {} [id: {}]",
        fn_name,
        provider.model(),
        request_id
    );

    let (raw_response, tokens_used) = match provider
        .json_completion(
            system_prompt,
            user_prompt,
            completion_tokens,
            input_tokens_budget,
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
            "[{}] model returned empty response [id: {}] for user prompt: {} and system prompt: {}",
            fn_name, request_id, user_prompt, system_prompt
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

// ── Commit message ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CommitMessageJson {
    message: String,
}

pub async fn generate_commit_message<R: Runtime>(
    prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(String, TokenUsage)> {
    let budget = commit_message_budget(prompt);
    let (parsed, usage) = request_json::<_, CommitMessageJson>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
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

// ── map_relations — group incoming hunks into semantic groups ─────────────────

#[derive(Deserialize)]
struct RawNewMapResponse {
    changes: Vec<RawNewMapEntry>,
}

/// Groups all hunks from a new changeset into semantic groups.
/// Caller builds the prompt via `prompts::build_new_map`.
pub async fn map_relations<R: Runtime>(
    prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(Vec<RawNewMapEntry>, TokenUsage)> {
    let budget = map_relations_budget(prompt);
    let (raw, usage) = request_json::<_, RawNewMapResponse>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
        TEMPERATURE,
        "map_relations",
        app_handle,
    )
    .await?;
    Ok((raw.changes, usage))
}

// ── map_relations_to_existing — place missed hunks onto an existing map ───────

#[derive(Deserialize)]
struct RawPlacementResponse {
    placements: Vec<RawHunkPlacement>,
}

/// Places missed hunks onto an existing semantic map.
pub async fn map_relations_to_existing<R: Runtime>(
    prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(Vec<RawHunkPlacement>, TokenUsage)> {
    let budget = map_relations_to_existing_budget(prompt);
    let (raw, usage) = request_json::<_, RawPlacementResponse>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
        TEMPERATURE,
        "map_relations_to_existing",
        app_handle,
    )
    .await?;
    Ok((raw.placements, usage))
}

// ── Iterative summarization — for use by task runner ─────────────────────────

#[derive(Deserialize, Serialize)]
struct OwnSummaryEntry {
    hash: String,
    title: String,
    description: String,
}

#[derive(Deserialize)]
struct EvolvedGroupRaw {
    group: HunkSummary,
    changes: Vec<OwnSummaryEntry>,
}

pub async fn summarize_evolved_group<R: Runtime>(
    prompt: &str,
    former_group_id: i64,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(EvolvedGroupSummary, TokenUsage)> {
    let budget = group_budget(prompt);
    let fn_name = format!("summarize_evolved_group[{}]", former_group_id);
    let (raw, usage) = request_json::<_, EvolvedGroupRaw>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
        TEMPERATURE,
        &fn_name,
        app_handle,
    )
    .await?;
    let own_summaries = raw
        .changes
        .into_iter()
        .map(|e| {
            (
                e.hash,
                HunkSummary {
                    title: e.title,
                    description: e.description,
                },
            )
        })
        .collect();
    Ok((
        EvolvedGroupSummary {
            former_group_id,
            group: raw.group,
            own_summaries,
        },
        usage,
    ))
}

pub async fn summarize_new_group<R: Runtime>(
    prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(EvolvedGroupSummary, TokenUsage)> {
    let budget = group_budget(prompt);
    let (raw, usage) = request_json::<_, EvolvedGroupRaw>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
        TEMPERATURE,
        "summarize_new_group",
        app_handle,
    )
    .await?;
    let own_summaries = raw
        .changes
        .into_iter()
        .map(|e| {
            (
                e.hash,
                HunkSummary {
                    title: e.title,
                    description: e.description,
                },
            )
        })
        .collect();
    Ok((
        EvolvedGroupSummary {
            former_group_id: 0,
            group: raw.group,
            own_summaries,
        },
        usage,
    ))
}

pub async fn summarize_new_single<R: Runtime>(
    prompt: &str,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(HunkSummary, TokenUsage)> {
    let budget = single_budget(prompt);
    debug!(
        "summarize_new_single: completion_tokens {}, required_context_tokens {}",
        budget.output_tokens, budget.required_context_tokens
    );
    request_json::<_, HunkSummary>(
        "",
        prompt,
        budget.output_tokens,
        Some(budget.required_context_tokens),
        TEMPERATURE,
        "summarize_new_single",
        app_handle,
    )
    .await
}

// ── Private helpers ───────────────────────────────────────────────────────────

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
