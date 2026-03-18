//! Hunk-based summarization pipeline (Stage 1 + Stage 2).
//!
//! Stage 1 (`analyze_hunks`): holistic semantic map — groups diff hunks into
//! semantic changes via a sonnet-tier model.
//!
//! Stage 2 (`summarize_semantic_change`): concurrent per-group summarization —
//! produces a group description and per-hunk own summaries.

use anyhow::Result;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::providers::{create_provider, TokenUsage};
use sha2::{Digest, Sha256};

/// Report a provider error to Sentry in a safe, redacted way (no message bodies).
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

const TEMPERATURE: f32 = 0.3;

// ── Stage 1 types ─────────────────────────────────────────────────────────────

/// Hunk with reasoning for classification as main or sub to a semantic change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkAssignment {
    pub hash: String,
    pub reasoning: String,
}
/// Grouping of hunks as associated with a single semantic change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticChange {
    pub title: String,
    pub main_summary_hunks: Vec<HunkAssignment>,
    pub sub_summary_hunks: Vec<HunkAssignment>,
}

/// Full output of Stage 1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticMap {
    pub semantic_changes: Vec<SemanticChange>,
}

/// Stage 1 — returns a structured semantic map
///
/// Sees all hunks together and and guesses user intent / change themes
pub async fn analyze_hunks<R: Runtime>(
    changes: &[crate::sqlite_types::Change],
    commit_message: &str,
    max_tokens: u32,
    num_ctx: Option<u32>,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(SemanticMap, TokenUsage)> {
    if changes.is_empty() {
        return Ok((
            SemanticMap {
                semantic_changes: vec![],
            },
            TokenUsage::default(),
        ));
    }

    let provider = create_provider(app_handle)?;

    // Build the hunk list with hashes so the model can reference them by hash.
    let mut hunk_list = String::new();
    for change in changes {
        hunk_list.push_str(&format!(
            "hash: {}\nfile: {}\nlines: {}\ndiff:\n{}\n\n",
            change.hash, change.filename, change.line_count, change.diff
        ));
    }

    let system_prompt = r#"You analyze nix-darwin configuration diffs and produce a structured semantic map.

Your job is NOT to summarize — it is to group hunks into semantic changes.

Before writing any JSON: read every hunk in full, then identify the semantic themes present in the commit. Ask yourself: "What is the user actually trying to accomplish?" A single intent (e.g. adding a linter) will often touch many files — the linter config, the editor settings, multiple package lists, shell aliases — that is ONE semantic change, not many. Only after you have identified all themes and their cross-file footprint should you construct the JSON.

Before producing the JSON, verify that every hash from the input is present in at least one semantic change — try to categorize artifacts and auto-generated changes as sub_summary_hunks for the semantic changes that they are related to. Use file path as a strong clue and add this to the reasoning. If a hunk has no clear relationship to any existing group, create a new semantic change for it rather than forcing it into an unrelated one.

Respond with valid JSON matching this exact structure:
{
  "semantic_changes": [
    {
      "title": "Short Noun Title",
      "main_summary_hunks": [
        { "hash": "<hash>", "reasoning": "<one sentence why this is a main change>" }
      ],
      "sub_summary_hunks": [
        { "hash": "<hash>", "reasoning": "<one sentence why this is a side-effect or artifact>" }
      ]
    }
  ]
}

Rules:
- Intent over location: group by what the user is trying to accomplish, not by which file was edited. Changes in VSCode settings, neovim config, and package lists that all relate to adding the same tool belong in one semantic change. File-name similarity is a weak signal; shared intent is the strong signal.
- title: 1–3 words max, noun phrase naming the specific subject — no verbs ("Update", "Add", "Remove"), no generic adjectives such as "additional, another, new", no generic category words ("Package Updates", "Config Changes", "Settings"). Name the exact thing being changed: "Git Config", "Oxlint", "SSH Keys", "Editor Theme"
- Cause-and-effect takes precedence over file-name grouping: if a change in one file is a downstream consequence of another change in the same commit (e.g. editor config enabling a tool that was just installed, a shell alias for a newly added package), classify it as a sub_summary_hunk of the causing semantic change rather than its own main change.
- Do not group unrelated hunks: two hunks belong in the same semantic change only if they share a file path prefix, reference the same tool or package in their diff content, or have a direct cause-and-effect relationship. When no clear link exists, create a separate semantic change rather than forcing a grouping.
- Artifacts and auto-generated files (paths containing segments like `automatic_backups`, `backup`, `.lock`, `generated`, or similar) are always sub_summary_hunks, never main — the group title must come from the intentional user change that caused the artifact, not from the artifact itself.
- reasoning: one short sentence per hunk explaining why it was classified as main or sub
- Use exact hash strings from the input — never count positions
- One hunk may appear in multiple semantic changes if it is genuinely shared
- Respond with ONLY valid JSON, no markdown code blocks or extra text"#;

    let user_prompt = format!(
        "Commit message: {}\n\nChanges:\n{}",
        commit_message, hunk_list
    );

    let request_id = uuid::Uuid::new_v4().to_string();
    debug!(
        "Requesting semantic map from {} [id: {}]",
        provider.model(),
        request_id
    );

    let (raw_response, tokens_used) = match provider
        .json_completion(
            system_prompt,
            &user_prompt,
            max_tokens,
            num_ctx,
            TEMPERATURE,
            &request_id,
        )
        .await
    {
        Ok(t) => t,
        Err(e) => {
            let err_str = format!("{:#}", e);
            warn!("[analyze_hunks] provider completion failed: {}", err_str);
            report_provider_error(
                "semantic_map",
                provider.model(),
                &request_id,
                &err_str,
                "analyze_hunks",
            );
            return Err(e);
        }
    };

    if raw_response.trim().is_empty() {
        warn!(
            "[analyze_hunks] model returned empty response [id: {}]",
            request_id
        );
        return Err(anyhow::anyhow!(
            "analyze_hunks: model returned empty response"
        ));
    }

    match serde_json::from_str::<SemanticMap>(&raw_response) {
        Ok(map) => Ok((map, tokens_used)),
        Err(e) => {
            warn!(
                "Failed to parse semantic map JSON [id: {}]: {}. Raw: {}",
                request_id, e, raw_response
            );
            Err(anyhow::anyhow!("Failed to parse semantic map: {}", e))
        }
    }
}

// ── Stage 2 types ─────────────────────────────────────────────────────────────

/// Per-semantic-change summary produced by Stage 2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkSummary {
    pub title: String,
    pub description: String,
}

/// Per-hunk own summary entry in the Stage 2 JSON response.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OwnSummaryEntry {
    hash: String,
    title: String,
    description: String,
}

/// Raw Stage 2 JSON response — group summary + per-hunk own summaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SemanticChangeSummaryRaw {
    title: String,
    description: String,
    hunk_summaries: Vec<OwnSummaryEntry>,
}

/// Stage 2 result: group summary for the semantic change + one own summary per hunk.
#[derive(Debug, Clone)]
pub struct SemanticChangeSummary {
    pub group: HunkSummary,
    /// hash → own summary (title + description) for each main and sub hunk
    pub own_summaries: std::collections::HashMap<String, HunkSummary>,
}

/// Stage 2 — group + per-hunk summarization for one semantic change.
/// Designed to be fanned out concurrently across all semantic changes from Stage 1.
pub async fn summarize_semantic_change<R: Runtime>(
    main_changes: Vec<(crate::sqlite_types::Change, String)>,
    sub_changes: Vec<(crate::sqlite_types::Change, String)>,
    context_title: String,
    max_tokens: u32,
    num_ctx: Option<u32>,
    app_handle: Option<AppHandle<R>>,
) -> Result<(SemanticChangeSummary, TokenUsage)> {
    let provider = create_provider(app_handle.as_ref())?;

    let n_main = main_changes.len();
    let n_sub = sub_changes.len();
    let sub_line = if n_sub > 0 {
        format!(
            " and {} sub-effect change{}",
            n_sub,
            if n_sub == 1 { "" } else { "s" }
        )
    } else {
        String::new()
    };

    let mut body = format!(
        "Semantic change: {}\n{} main change{}{}.\n\nMain changes:\n\n",
        context_title,
        n_main,
        if n_main == 1 { "" } else { "s" },
        sub_line,
    );

    for (i, (change, reasoning)) in main_changes.iter().enumerate() {
        body.push_str(&format!(
            "{}. hash={}\n   Main because: {}\n   File: {}\n```diff\n{}\n```\n\n",
            i + 1,
            change.hash,
            reasoning,
            change.filename,
            change.diff,
        ));
    }

    if !sub_changes.is_empty() {
        body.push_str("Sub-effect changes:\n\n");
        for (i, (change, reasoning)) in sub_changes.iter().enumerate() {
            body.push_str(&format!(
                "{}. hash={}\n   Sub-effect because: {}\n   File: {}\n```diff\n{}\n```\n\n",
                i + 1,
                change.hash,
                reasoning,
                change.filename,
                change.diff,
            ));
        }
    }

    let all_hashes: Vec<String> = main_changes
        .iter()
        .chain(sub_changes.iter())
        .map(|(c, _)| c.hash.clone())
        .collect();

    body.push_str(&format!(
        "Generate hunk_summaries for these hashes: {}\n",
        all_hashes.join(", ")
    ));

    let system_prompt = r#"You summarize one nix-darwin semantic change: one group summary and one own summary per hunk.

Respond with valid JSON:
{
  "title": "...",
  "description": "...",
  "hunk_summaries": [
    { "hash": "<hash>", "title": "...", "description": "..." }
  ]
}

Rules:
- title (group): use the provided context title exactly as given
- description (group): one short line for the semantic change as a whole. Focus on main changes. Include actual values (config keys, package names, model names). Use → for before/after pairs. Verbs are fine; long comma-joined sentences are not.
  Good: "theme: dracula → catppuccin in terminal and editor"
  Good: "Added rectangle to Homebrew casks and home-manager packages"
  Good: "git alias lg added for pretty one-line log"
  Bad: "Updated the configuration to change several settings and values"
- hunk_summaries: exactly one entry per requested hash, in any order
    - title: 1–3 words max, noun phrase only — no verbs, no action words like "Update/Switch/Setup/Add/Remove", or adjectives like "additional, another, new". Name the subject, not the action. Examples: "Git Config", "Python Packages", "SSH Keys", "Editor Theme", "Brew Taps"
    - description: one short line
    - main hunk: describe what this specific file's change contributes; include actual values from the diff
    - sub hunk: describe the sub-effect nature using the provided reasoning, not the raw diff content
      Good: "Auto-generated lock file"
      Good: "Downstream: PATH updated to include newly added tool"
- Respond with ONLY valid JSON, no markdown code blocks or extra text"#;

    let user_prompt = format!("Context title: {}\n\n{}", context_title, body);

    let request_id = uuid::Uuid::new_v4().to_string();
    debug!(
        "Requesting stage 2 summary for '{}' from {} [id: {}]",
        context_title,
        provider.model(),
        request_id
    );

    let (raw_response, tokens_used) = match provider
        .json_completion(
            system_prompt,
            &user_prompt,
            max_tokens,
            num_ctx,
            TEMPERATURE,
            &request_id,
        )
        .await
    {
        Ok(t) => t,
        Err(e) => {
            let err_str = format!("{:#}", e);
            warn!(
                "[summarize_semantic_change] provider completion failed for '{}': {}",
                context_title, err_str
            );
            report_provider_error(
                "stage2_summary",
                provider.model(),
                &request_id,
                &err_str,
                "summarize_semantic_change",
            );
            return Err(e);
        }
    };

    match serde_json::from_str::<SemanticChangeSummaryRaw>(&raw_response) {
        Ok(raw) => {
            let own_summaries = raw
                .hunk_summaries
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
                SemanticChangeSummary {
                    group: HunkSummary {
                        title: raw.title,
                        description: raw.description,
                    },
                    own_summaries,
                },
                tokens_used,
            ))
        }
        Err(e) => {
            warn!(
                "Failed to parse stage 2 JSON for '{}' [id: {}]: {}. Raw: {}",
                context_title, request_id, e, raw_response
            );
            Err(anyhow::anyhow!("Failed to parse stage 2 summary: {}", e))
        }
    }
}

/// Runs concurrently with Stage 2 when no commit message was provided up-front.
pub async fn generate_commit_message_from_map<R: Runtime>(
    titles: Vec<String>,
    max_tokens: u32,
    app_handle: Option<&AppHandle<R>>,
) -> Result<(String, TokenUsage)> {
    if titles.is_empty() {
        return Err(anyhow::anyhow!(
            "generate_commit_message_from_map: no semantic change titles to work from"
        ));
    }

    let provider = create_provider(app_handle)?;

    let title_list = titles
        .iter()
        .enumerate()
        .map(|(i, t)| format!("{}. {}", i + 1, t))
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = "You write git commit messages in conventional commit format.\n\
        Format: <type>(<scope>): <description>\n\
        Types: feat, fix, chore, refactor, docs, style, test, perf\n\
        Scope: optional, the affected area\n\
        The description must cover all major changes — use a comma-separated list if needed. \
        Lead with the most significant change. Only omit truly minor or mechanical details.\n\
        Respond with JSON: {\"message\": \"<commit message>\"}";

    let user_prompt = format!("Write a commit message for these changes:\n{}", title_list);

    let request_id = uuid::Uuid::new_v4().to_string();
    let (raw, tokens_used) = match provider
        .json_completion(
            system_prompt,
            &user_prompt,
            max_tokens,
            None,
            0.2,
            &request_id,
        )
        .await
    {
        Ok(t) => t,
        Err(e) => {
            let err_str = format!("{:#}", e);
            warn!(
                "[generate_commit_message_from_map] provider completion failed: {}",
                err_str
            );
            report_provider_error(
                "commit_message_from_map",
                provider.model(),
                &request_id,
                &err_str,
                "generate_commit_message_from_map",
            );
            return Err(e);
        }
    };

    if raw.trim().is_empty() {
        warn!(
            "[generate_commit_message_from_map] model returned empty response [id: {}]",
            request_id
        );
        return Err(anyhow::anyhow!(
            "generate_commit_message_from_map: model returned empty response"
        ));
    }

    #[derive(Deserialize)]
    struct CommitMessageJson {
        message: String,
    }

    match serde_json::from_str::<CommitMessageJson>(&raw) {
        Ok(parsed) if !parsed.message.trim().is_empty() => {
            Ok((parsed.message.trim().to_string(), tokens_used))
        }
        Ok(_) => Err(anyhow::anyhow!(
            "generate_commit_message_from_map: parsed empty message [id: {}]",
            request_id
        )),
        Err(e) => {
            warn!(
                "[generate_commit_message_from_map] failed to parse JSON [id: {}]: {}. Raw: {}",
                request_id, e, raw
            );
            Err(anyhow::anyhow!(
                "generate_commit_message_from_map: failed to parse JSON: {}",
                e
            ))
        }
    }
}
