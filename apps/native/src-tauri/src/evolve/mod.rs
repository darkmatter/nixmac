//! Evolution module for AI-assisted configuration changes.

mod age;
mod chat_memory;
pub(crate) mod config;
mod config_dir_context;
mod ensure_secret;
pub(crate) mod file_ops;
mod gitignore;
pub mod messages;
pub(crate) mod nix_file_editor;
pub mod providers;
mod search_code;
pub mod search_docs;
mod search_packages;
pub mod session_control;
mod sops;
mod tools;
pub(crate) mod types;
mod utils;

pub mod lifecycle;

/// Directories ignored by file listing and search helpers.
pub(crate) const IGNORED_DIRS: [&str; 2] = [".git", "result"];

use crate::evolve::utils::{escape_user_query, format_duration_secs};
use crate::git::query::repo_root;
// Re-export public API
use crate::shared_types::{Evolution, EvolutionState, FileEdit};
use crate::system::nix;
use anyhow::{Result, anyhow};
use chrono::Utc;
use log::{debug, error, info, warn};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::sleep;
use tools::{ToolResult, create_tools, execute_tool, is_editing_tool};
pub use types::{EvolutionProgress, EvolutionRunError};

use crate::{
    ai::model_capabilities::capabilities_for_model,
    statistics, store,
    types::{EvolveEvent, emit_evolve_event},
    utils as global_utils,
    utils::short_hash,
};
use chat_memory::{ChatMessage, Role as ChatMemoryRole, to_provider_context_messages};

pub(crate) use chat_memory::session_chat_memory_store;
use config_dir_context::format_config_dir_context;
use messages::Message;
use providers::{AiProvider, CliProvider, OllamaProvider, OpenAIProvider, ProviderError};

/// Strategy for retaining evolution messages in the conversation history for provider context.
/// This is used to balance keeping important context visible to the model with limiting token usage
/// and latency by discarding less relevant messages.
enum MemoryStrategy {
    None,      // no filtering (pass everything through)
    Retention, // use TTL-based filtering
}

impl MemoryStrategy {
    fn from_env() -> Self {
        match crate::env::settings(None)
            .evolution_memory_strategy
            .as_str()
        {
            "" | "none" => MemoryStrategy::None,
            "retention" => MemoryStrategy::Retention,
            _ => MemoryStrategy::None,
        }
    }
}

/// Retention policy for evolution-time messages, used to determine which messages to keep in the
/// conversation history for context and which to discard to save tokens and latency.
#[derive(Debug, Clone, Serialize, Deserialize)]
enum Retention {
    Permanent,
    Recent { keep_iterations: usize },
}

/// An evolution-time message with associated metadata for retention and iteration tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct EvolutionMessage {
    message: Message,
    retention: Retention,
    created_iteration: usize,
    key: Option<String>, // optional key for deduplication or reference (e.g. file path for read_file results)
}

fn normalize_max_output_tokens(value: usize) -> u32 {
    value.max(1).min(u32::MAX as usize) as u32
}

fn normalize_openai_max_output_tokens(model: &str, value: usize) -> u32 {
    let normalized = normalize_max_output_tokens(value);
    // Called only in the direct OpenAI branch. OpenRouter-compatible requests
    // keep their provider-level behavior even when the slug contains gpt-4o.
    capabilities_for_model(model).clamp_max_completion_tokens(normalized)
}

impl EvolutionMessage {
    fn permanent(message: Message, iteration: usize, key: Option<String>) -> Self {
        Self {
            message,
            retention: Retention::Permanent,
            created_iteration: iteration,
            key,
        }
    }

    fn recent(message: Message, iteration: usize, keep: usize, key: Option<String>) -> Self {
        Self {
            message,
            retention: Retention::Recent {
                keep_iterations: keep,
            },
            created_iteration: iteration,
            key,
        }
    }
}

/// Extract structured metadata from an error string without returning any user/chat text.
/// This is a best-effort attempt to get useful info like status codes or error types for
/// monitoring and alerting, while avoiding any risk of including sensitive content in
/// Sentry events.
fn extract_error_metadata(error: &str) -> (Option<u16>, Option<String>, Option<String>, usize) {
    // Try parse JSON to extract common fields like status, code, type without taking message text.
    if let Ok(json) = serde_json::from_str::<Value>(error) {
        let status = json
            .get("status")
            .and_then(|v| v.as_u64())
            .map(|v| v as u16);
        let code = json
            .get("code")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let typ = json
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        return (status, code, typ, error.len());
    }

    // Fallback: regex for "status: 400" or "statusCode=400"
    static STATUS_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
        Regex::new(r"(?i)\bstatus(?:Code|_code|:)?\s*[:=]?\s*(\d{3})\b")
            .expect("Failed to compile status regex")
    });
    if let Some(cap) = STATUS_RE.captures(error) {
        if let Some(m) = cap.get(1) {
            if let Ok(s) = m.as_str().parse::<u16>() {
                return (Some(s), None, None, error.len());
            }
        }
    }

    (None, None, None, error.len())
}

/// Report a ProviderError via tracing using structured fields (no raw bodies).
/// This is because ProviderError::Http contains the raw response body which may have sensitive info,
/// (in the case of Ollama it definitely includes the prompt and response related to it)
/// so we extract only metadata for logging.
fn report_provider_error(
    err: &ProviderError,
    provider: &str,
    model: &str,
    messages: &[Message],
    iteration: usize,
) {
    match err {
        ProviderError::Http { status, body } => {
            // compute short hash of body for correlation but never send body
            let body_hash = short_hash(body);
            tracing::error!(
                provider = provider,
                model = model,
                iteration = iteration,
                messages_count = messages.len(),
                response_status = status.as_u16(),
                error_length = body.len(),
                error_hash = %body_hash,
                "AI API HTTP error (redacted)"
            );
        }
        ProviderError::Other(e) => {
            let err_str = format!("{:#}", e);
            // fallback: use parsing extractor to try to pull metadata
            let (status, code, typ, len) = extract_error_metadata(&err_str);
            let hash = short_hash(&err_str);
            tracing::error!(
                provider = provider,
                model = model,
                iteration = iteration,
                messages_count = messages.len(),
                response_status = status.map(|s| s as u64),
                error_code = code.as_deref(),
                error_type = typ.as_deref(),
                error_length = len,
                error_hash = %hash,
                "AI API error (redacted)"
            );
        }
    }
}

/// Log API errors to a file for debugging content policy rejections
fn log_api_error(
    err: &ProviderError,
    messages: &[Message],
    prompt: &str,
    iteration: usize,
    provider: &str,
    model: &str,
) {
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("nixmac")
        .join("logs");

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        error!("Failed to create log directory: {}", e);
        return;
    }

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let log_file = log_dir.join(format!("api_error_{}.log", timestamp));

    let mut file = match OpenOptions::new().create(true).append(true).open(&log_file) {
        Ok(f) => f,
        Err(e) => {
            error!("Failed to open error log file: {}", e);
            return;
        }
    };

    // Fire-and-forget writeln pattern: we don't care if this fails,
    // the file is already open and we just want to ensure the log
    // starts with a separator line.
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );
    let _ = writeln!(file, "API ERROR LOG - {}", Utc::now().to_rfc3339());
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );
    match err {
        ProviderError::Http { status, body } => {
            let _ = writeln!(
                file,
                "HTTP Error: status={} len={}",
                status.as_u16(),
                body.len()
            );
            let _ = writeln!(file);
            let _ = writeln!(file, "Response body:");
            let _ = writeln!(file, "{}", body);
        }
        ProviderError::Other(e) => {
            let err_str = format!("{:#}", e);
            let _ = writeln!(file, "Error: {}", err_str);
        }
    }
    let _ = writeln!(file, "Iteration: {}", iteration);
    let _ = writeln!(file, "Original Prompt: {}", prompt);
    let _ = writeln!(file);
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );
    let _ = writeln!(file, "MESSAGES ({} total):", messages.len());
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );

    for (i, msg) in messages.iter().enumerate() {
        let _ = writeln!(file);
        let _ = writeln!(file, "--- Message {} ---", i + 1);
        match serde_json::to_string_pretty(msg) {
            Ok(json) => {
                let _ = writeln!(file, "{}", json);
            }
            Err(_) => {
                let _ = writeln!(file, "{:?}", msg);
            }
        }
    }

    let _ = writeln!(file);
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );
    let _ = writeln!(file, "END OF ERROR LOG");
    let _ = writeln!(
        file,
        "═══════════════════════════════════════════════════════════════"
    );

    info!("API error logged to: {}", log_file.display());

    // Report structured summary to Sentry using ProviderError-aware helper.
    report_provider_error(err, provider, model, messages, iteration);
}

// Use OpenRouter with Claude for evolution - better reasoning without strict content policies
const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4";
const DEFAULT_OPENAI_MODEL: &str = "gpt-4o";
const DEFAULT_OLLAMA_API_BASE: &str = "http://localhost:11434";

// Percentage of max_iterations after which we require at least one edit/build_check.
// Example: with max_iterations=50 and this set to 75, threshold is 37 iterations.
const MAX_ITERATIONS_BEFORE_EDIT_PERCENT: usize = 75;

// Applied separately to stdout and stderr. So when thinking about tokens,
// the effective output limit could be up to double this if both are long.
const BUILD_OUTPUT_MAX_CHARS: usize = 6_000;
const BUILD_OUTPUT_TAIL_LINES: usize = 80;

const SYSTEM_PROMPT: &str = include_str!("../../prompts/system.md");

fn configured_model(
    store_model: Option<String>,
    env_model: impl Fn() -> Option<String>,
) -> Option<String> {
    store_model
        .and_then(global_utils::non_empty_trimmed_string)
        .or_else(env_model)
}

fn require_local_model(
    provider_name: &str,
    store_model: Option<String>,
    env_var: &str,
) -> Result<String> {
    configured_model(store_model, crate::env::default_evolve_model).ok_or_else(|| {
        anyhow!("No {provider_name} model configured. Please select a model in Settings or set {env_var}.")
    })
}

/// Build a short single-line preview from the conversation messages to help with
/// troubleshooting.
fn build_preview(messages: &[EvolutionMessage]) -> String {
    let preview_raw: String = messages
        .iter()
        .rev()
        .filter_map(|m| match &m.message {
            // user messages and system prompts are always relevant
            Message::User { content } | Message::System { content } => {
                let c = content.trim();
                if c.is_empty() {
                    None
                } else {
                    Some(c.to_string())
                }
            }
            // tool outputs can be included if non-empty
            Message::Tool { content, .. } => {
                let c = content.trim();
                if c.is_empty() {
                    None
                } else {
                    Some(c.to_string())
                }
            }
            // skip assistant messages
            Message::Assistant { .. } => None,
        })
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" \n\n ");

    // replace newlines with spaces and truncate
    let mut preview = preview_raw.replace(['\n', '\r'], " ");
    if preview.len() > 100 {
        global_utils::truncate_utf8(&mut preview, 100);
        preview.push_str("...");
    }
    preview
}

/// Filter evolution messages based on their retention policy and key to determine which should be
/// sent to the provider for context in the next iteration.
fn filter_evolution_messages(
    messages: &[EvolutionMessage],
    iteration: usize,
    made_build_check: bool,
) -> Vec<EvolutionMessage> {
    let strategy = MemoryStrategy::from_env();

    if matches!(strategy, MemoryStrategy::None) {
        return messages.to_vec();
    }

    // 1. Filter by retention policy.
    let filtered_msgs: Vec<(usize, &EvolutionMessage)> = match strategy {
        MemoryStrategy::Retention => messages
            .iter()
            .enumerate()
            .filter(|m| match m.1.retention {
                Retention::Permanent => true,
                Retention::Recent { keep_iterations } => {
                    iteration.saturating_sub(m.1.created_iteration) <= keep_iterations
                }
            })
            .collect(),
        MemoryStrategy::None => unreachable!("handled by early return above"),
    };

    // 2. Filter thinks prior to build check.
    //  If we made a build check, discard the "think" tool results that came BEFORE
    //  the first build check (which has a key prefixed with "build_check_") since they likely
    //  contain outdated plans or reasoning that led to the now-failed build.
    //  The "think" tool calls have a key with a prefix of "think_".
    // CONSIDER: There are probably other tools (the "search_*" tools come to mind)
    // that are probably also not very useful after an edit and/or build check.
    let first_build_check_idx = if made_build_check {
        messages.iter().position(|m| {
            m.key
                .as_deref()
                .is_some_and(|key| key.starts_with("build_check_"))
        })
    } else {
        None
    };

    let filtered_msgs: Vec<(usize, &EvolutionMessage)> = match first_build_check_idx {
        Some(build_check_idx) => filtered_msgs
            .into_iter()
            .filter(|(original_idx, m)| {
                if *original_idx < build_check_idx {
                    if let Some(key) = m.key.as_deref() {
                        !key.starts_with("think_")
                    } else {
                        true
                    }
                } else {
                    true
                }
            })
            .collect(),
        None => filtered_msgs,
    };

    // 3. Filter out-of-date duplicates.
    //  If key is set, only keep the LAST message with that key to ensure only the most recent info is used.
    //  To do this, iterate in reverse, track seen keys, and collect messages, then reverse to restore order.
    let mut seen_keys = std::collections::HashSet::new();
    let mut filtered = Vec::with_capacity(filtered_msgs.len());
    for (_, m) in filtered_msgs.iter().rev() {
        if let Some(key) = m.key.as_ref() {
            if seen_keys.contains(key) {
                continue;
            } else {
                seen_keys.insert(key.clone());
            }
        }
        filtered.push((*m).clone());
    }
    filtered.reverse();
    filtered
}

/// Map a tool name to its retention window in provider-loop iterations.
///
/// `keep_iterations` is compared against the loop's `iteration` counter, not the
/// number of `Message` values in history. Because one loop iteration can append
/// several messages, the windows below are chosen to mean:
/// - `1`: keep the tool result visible to the next provider call only
/// - `2`: keep the tool result visible through the next two provider calls
/// - `Permanent`: keep it for the whole evolution session
fn retention_for_tool(tool_name: &str) -> Retention {
    match tool_name {
        // The model needs the build result on the very next provider call so it can
        // decide whether to call `done` or continue fixing issues.
        "build_check" => Retention::Recent { keep_iterations: 1 },

        // Multiple edits across iterations may be important but only temporarily.
        "edit_file" | "edit_nix_file" => Retention::Recent { keep_iterations: 3 },

        // Everything else is informational or durable enough to keep for the whole run.
        // In particular:
        // 1. "search_packages", "search_docs", and "search_code" need to be durable so that the agent can
        //      plan to add a bunch of requested packages in one shot toward the end.
        // 2. "read_file" can be very large; however, the agent likes to read a
        //      file up front, and then refer back to it at the end after it plans the edit.
        // 3. "list_files" needs to persist because the agent tries to re-read things later,
        //      and it's bad if it tries to read files that don't exist that are hallucinated
        //      from training data.
        // 4. "think" may contain the original plan up to the point where we start doing build checks.
        _ => Retention::Permanent,
    }
}

/// Set a evolution-message deduplication key for a "read_file" tool action.
/// Currently this only applies to full-file reads, hence the checks on the
/// line start and line end args.
fn read_file_dedup_key(path: &str, args: &serde_json::Value) -> Option<String> {
    let has_line_start = args.get("line_start").is_some();
    let has_line_end = args.get("line_end").is_some();

    if has_line_start || has_line_end {
        None
    } else {
        Some(path.to_string())
    }
}

/// Determine how to store a tool result based on the tool type. For tools that produce important context,
/// keep them forever. For everything else, just keep it around for as long as seems useful empirically/heuristically.
fn store_tool_result(
    msg: Message,
    tool_name: &str,
    iteration: usize,
    key: Option<String>,
) -> EvolutionMessage {
    match retention_for_tool(tool_name) {
        Retention::Permanent => EvolutionMessage::permanent(msg, iteration, key),
        Retention::Recent { keep_iterations } => {
            EvolutionMessage::recent(msg, iteration, keep_iterations, key)
        }
    }
}

/// When starting an evolution, we want to restore any relevant context from the current session's
/// chat memory so the model can continue referencing it. These would typically be
/// conversational responses from earlier on in the session.
fn restore_historical_evolution_messages() -> Vec<EvolutionMessage> {
    let chat_memory_store = session_chat_memory_store();
    let historical_ev_msgs: Vec<EvolutionMessage> =
        to_provider_context_messages(chat_memory_store.as_ref())
            .into_iter()
            .map(|m| EvolutionMessage::permanent(m, 0, None))
            .collect();
    debug!(
        "[evolve] restored session chat context messages={}",
        historical_ev_msgs.len()
    );
    historical_ev_msgs
}

const LIMIT_DECISION_CONTINUE: &str = "Yes, keep going";
const LIMIT_DECISION_STOP: &str = "Stop";

#[derive(Debug, Clone, Copy)]
enum EvolutionLimitKind {
    NoProgress,
    MaxIterations,
    BuildAttempts,
    TokenBudget,
}

fn format_token_count(tokens: usize) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}K", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LimitDecision {
    Continue,
    Stop,
    Cancelled,
}

impl EvolutionLimitKind {
    fn attempts_label(self, attempts: usize) -> String {
        match self {
            Self::BuildAttempts => format!("{} build attempts", attempts),
            Self::NoProgress | Self::MaxIterations => format!("{} attempts", attempts),
            Self::TokenBudget => format!("{} tokens", format_token_count(attempts)),
        }
    }

    fn prompt(self, attempts: usize) -> String {
        match self {
            Self::TokenBudget => format!(
                "The AI has used {}. Keep going?",
                self.attempts_label(attempts)
            ),
            _ => format!(
                "The AI has made {}. Keep going?",
                self.attempts_label(attempts)
            ),
        }
    }

    fn stop_summary(self, attempts: usize) -> String {
        match self {
            Self::NoProgress => format!(
                "Evolution stopped after {} because the AI had not started making concrete changes.",
                self.attempts_label(attempts)
            ),
            Self::MaxIterations => format!(
                "Evolution stopped after reaching {}. The current conversation context was preserved.",
                self.attempts_label(attempts)
            ),
            Self::BuildAttempts => format!(
                "Evolution stopped after reaching {}. You can review the current changes or continue with a follow-up prompt.",
                self.attempts_label(attempts)
            ),
            Self::TokenBudget => format!(
                "Evolution stopped after consuming {}. You can review the current changes or continue with a follow-up prompt.",
                self.attempts_label(attempts)
            ),
        }
    }
}

fn should_continue_after_limit(answer: &str) -> bool {
    let normalized = answer.trim().to_ascii_lowercase();
    normalized == "yes"
        || normalized == "y"
        || normalized == "continue"
        || normalized == "keep going"
        || normalized == LIMIT_DECISION_CONTINUE.to_ascii_lowercase()
}

async fn ask_to_continue_after_limit<R: Runtime>(
    app: &AppHandle<R>,
    start_time: i64,
    iteration: usize,
    limit_kind: EvolutionLimitKind,
    attempts: usize,
    interactive: bool,
) -> LimitDecision {
    let prompt = limit_kind.prompt(attempts);

    if !interactive {
        info!(
            "{} Limit reached in a non-interactive context; stopping evolution.",
            prompt
        );
        emit_evolve_event(
            app,
            EvolveEvent::info(
                start_time,
                Some(iteration),
                &format!(
                    "{} Defaulting to stop because this run cannot accept interactive input.",
                    prompt
                ),
            ),
        );
        return LimitDecision::Stop;
    }

    emit_evolve_event(
        app,
        EvolveEvent::question(
            start_time,
            iteration,
            &prompt,
            &Some(vec![
                LIMIT_DECISION_CONTINUE.to_string(),
                LIMIT_DECISION_STOP.to_string(),
            ]),
        ),
    );

    info!("Limit reached; waiting for user decision: {}", prompt);
    let answer = tokio::select! {
        answer = session_control::wait_for_question_response() => answer,
        _ = async {
            loop {
                if session_control::is_evolve_cancelled() {
                    break;
                }
                sleep(Duration::from_millis(100)).await;
            }
        } => {
            warn!("Evolution cancelled while waiting for limit decision");
            return LimitDecision::Cancelled;
        }
    };

    match answer {
        Some(answer) if should_continue_after_limit(&answer) => {
            info!("User chose to continue after reaching an evolution limit");
            emit_evolve_event(
                app,
                EvolveEvent::info(start_time, Some(iteration), "Continuing evolution..."),
            );
            LimitDecision::Continue
        }
        Some(answer) => {
            info!(
                "User chose to stop after reaching an evolution limit: {}",
                answer
            );
            LimitDecision::Stop
        }
        None => {
            warn!("Limit decision channel closed; stopping evolution");
            LimitDecision::Stop
        }
    }
}

fn finish_after_limit_stop<R: Runtime>(
    app: &AppHandle<R>,
    evolution: &mut Evolution,
    start_time: i64,
    iteration: usize,
    limit_kind: EvolutionLimitKind,
    attempts: usize,
) {
    let summary = limit_kind.stop_summary(attempts);
    info!("{}", summary);
    // The terminal `Complete` event is emitted by the lifecycle after all
    // state cells are updated; only the informational stop notice goes out here.
    emit_evolve_event(
        app,
        EvolveEvent::info(start_time, Some(iteration), &summary),
    );

    evolution.summary = Some(summary);
    evolution.state = EvolutionState::LimitReached;
}

/// Generate an evolution from a user prompt using OpenAI function calling.
///
/// This runs an agentic loop where the model can read files, make edits,
/// and signal completion. When the agent signals "done", we verify the
/// changes by running a nix build check, and send errors back if it fails.
pub async fn generate_evolution<R: Runtime>(
    app: &AppHandle<R>,
    config_dir: &str,
    prompt: &str,
    banned_tools: &[&str],
) -> Result<Evolution> {
    let start_time = chrono::Utc::now().timestamp();
    let repo_root = repo_root(config_dir);

    // Determine provider
    let env_settings = crate::env::settings_from_app(Some(app));
    let store_provider = store::get_evolve_provider(app).ok().flatten();
    let requested_provider_type = store_provider
        .or_else(|| crate::env::optional(env_settings.default_evolve_provider.clone()));
    let store_model = store::get_evolve_model(app).ok().flatten();
    let configured_evolve_model = configured_model(store_model.clone(), || {
        crate::env::optional(env_settings.default_evolve_model.clone())
    });
    let (provider_type, used_legacy_openai_fallback) = if let Some(provider) =
        requested_provider_type
    {
        if provider != "openai" {
            (provider, false)
        } else {
            let has_openai_provider_credential =
                store::get_effective_openai_provider_credential(app)?.is_some();
            let has_openrouter_provider_credential =
                store::get_effective_openrouter_provider_credential(app)?.is_some();

            let resolved_provider = crate::ai::providers::resolve_legacy_openai_provider(
                provider,
                configured_evolve_model.as_deref(),
                has_openai_provider_credential,
                has_openrouter_provider_credential,
            );
            if resolved_provider == "openrouter" {
                info!("Using OpenRouter for legacy OpenAI evolve provider compatibility");
            }
            let used_legacy_openai_fallback = resolved_provider == "openrouter";

            (resolved_provider, used_legacy_openai_fallback)
        }
    } else {
        let has_openai_provider_credential =
            store::get_effective_openai_provider_credential(app)?.is_some();
        let has_openrouter_provider_credential =
            store::get_effective_openrouter_provider_credential(app)?.is_some();
        let resolved_provider =
            crate::ai::providers::resolve_unconfigured_openai_compatible_provider(
                None,
                has_openai_provider_credential,
                has_openrouter_provider_credential,
            );
        if resolved_provider == "openai" {
            info!("Using OpenAI evolve provider because only an OpenAI credential is configured");
        }

        (resolved_provider, false)
    };

    info!("");
    info!("════════════════════════════════════════════════════════════════");
    info!("EVOLUTION STARTING");
    info!("════════════════════════════════════════════════════════════════");
    info!("Provider: {}", provider_type);
    info!("Config dir: {}", config_dir);
    info!("Repo root: {}", repo_root.display());
    info!("📝 Prompt: {}", prompt);

    let max_output_tokens =
        store::get_max_output_tokens(app).unwrap_or(store::DEFAULT_MAX_OUTPUT_TOKENS);
    let max_output_tokens_for_request = normalize_max_output_tokens(max_output_tokens);

    // Select provider implementation
    let provider: Arc<dyn AiProvider> = if provider_type == "ollama" {
        let model = require_local_model("Ollama", store_model, crate::env::keys::EVOLVE_MODEL)?;
        let base_url = store::get_ollama_api_base_url(app)
            .ok()
            .flatten()
            .or_else(|| crate::env::optional(env_settings.ollama_api_base.clone()))
            .unwrap_or_else(|| DEFAULT_OLLAMA_API_BASE.to_string());
        info!(
            "Using Ollama provider | Model: {} | URL: {} | Max output tokens: {}",
            model, base_url, max_output_tokens_for_request
        );
        Arc::new(OllamaProvider::new(
            base_url,
            model,
            max_output_tokens_for_request,
        ))
    } else if matches!(provider_type.as_str(), "claude" | "codex" | "opencode") {
        let tool = match provider_type.as_str() {
            "claude" => crate::ai::providers::cli::CliTool::Claude,
            "codex" => crate::ai::providers::cli::CliTool::Codex,
            _ => crate::ai::providers::cli::CliTool::OpenCode,
        };
        let model = configured_evolve_model.unwrap_or_else(|| provider_type.clone());
        info!("Using CLI provider: {} | Model: {}", provider_type, model);
        Arc::new(CliProvider::new(tool, model))
    } else if provider_type == "vllm" {
        let model = require_local_model("vLLM", store_model, crate::env::keys::EVOLVE_MODEL)?;
        let base_url = store::get_vllm_api_base_url(app)
            .ok()
            .flatten()
            .or_else(|| crate::env::optional(env_settings.vllm_api_base.clone()))
            .ok_or_else(|| anyhow!("No vLLM base URL configured. Please set it in Settings."))?;
        let api_key = store::get_effective_vllm_api_key(app)?.unwrap_or_else(|| "none".to_string());
        info!(
            "Using vLLM provider | Model: {} | URL: {} | Max output tokens: {}",
            model, base_url, max_output_tokens_for_request
        );
        Arc::new(OpenAIProvider::new(
            api_key,
            base_url,
            model,
            max_output_tokens_for_request,
        ))
    } else if provider_type == crate::ai::providers::NIXMAC_PROVIDER {
        let api_key = store::get_device_api_key(app)?
            .ok_or_else(|| anyhow!("Sign in to nixmac hosted inference first."))?;
        let base_url = crate::ai::providers::nixmac_llm_api_base(&store::get_web_server_url()?);
        let model = configured_evolve_model
            .unwrap_or_else(|| crate::ai::providers::DEFAULT_NIXMAC_MODEL.to_string());
        info!(
            "Using nixmac hosted provider | Model: {} | Max output tokens: {}",
            model, max_output_tokens_for_request
        );
        Arc::new(OpenAIProvider::new(
            api_key,
            base_url,
            model,
            max_output_tokens_for_request,
        ))
    } else if provider_type == "openai" {
        let (api_key, base_url) = store::get_effective_openai_provider_credential(app)?
            .ok_or_else(|| {
                anyhow!(
                    "No OpenAI API key found. Please add your API key in Settings to get started."
                )
            })?;

        let model = configured_evolve_model.unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string());
        let model = model.strip_prefix("openai/").unwrap_or(&model).to_string();
        let openai_max_output_tokens_for_request =
            normalize_openai_max_output_tokens(&model, max_output_tokens);
        info!(
            "Using OpenAI provider | Model: {} | Max output tokens: {}",
            model, openai_max_output_tokens_for_request
        );
        Arc::new(OpenAIProvider::new(
            api_key,
            base_url.to_string(),
            model,
            openai_max_output_tokens_for_request,
        ))
    } else {
        let (api_key, base_url) = store::get_effective_openrouter_provider_credential(app)?
            .ok_or_else(|| {
                anyhow!("No OpenRouter API key found. Please add your API key in Settings to get started.")
            })?;

        let model = if used_legacy_openai_fallback {
            crate::ai::providers::openrouter_model_slug_or_default(
                configured_evolve_model,
                DEFAULT_MODEL,
            )
        } else {
            configured_evolve_model.unwrap_or_else(|| DEFAULT_MODEL.to_string())
        };
        info!(
            "Using OpenRouter provider | Model: {} | Max output tokens: {}",
            model, max_output_tokens_for_request
        );
        Arc::new(OpenAIProvider::new(
            api_key,
            base_url.to_string(),
            model,
            max_output_tokens_for_request,
        ))
    };

    // Emit start event
    emit_evolve_event(
        app,
        EvolveEvent::start(start_time, &provider.model_name(), prompt),
    );

    // Determine the host for build checking
    let host_attr = nix::determine_host_attr(app)
        .ok_or_else(|| anyhow!("No host attribute configured. Please set a host first."))?;
    info!("Target host: {}", host_attr);

    emit_evolve_event(
        app,
        EvolveEvent::info(start_time, None, &format!("Target host: {}", host_attr)),
    );

    // Read configurable limits from the managed observable (hot-reloaded on
    // every run). `app.state` panics if the observable isn't managed; that is
    // intentional — it surfaces a startup misconfiguration immediately
    // instead of silently swapping in field defaults.
    let config::EvolutionLimits {
        mut max_build_attempts,
        mut max_token_budget,
        mut max_iterations,
        ..
    } = app
        .state::<crate::observable::Observable<config::EvolutionLimits>>()
        .read_sync()
        .clone();

    let mut max_iterations_before_edit = std::cmp::max(
        1,
        (max_iterations * MAX_ITERATIONS_BEFORE_EDIT_PERCENT) / 100,
    );
    let max_iterations_before_edit_increment = max_iterations_before_edit.max(1);
    let max_iterations_increment = max_iterations.max(1);
    let max_build_attempts_increment = max_build_attempts.max(1);
    let max_token_budget_increment = max_token_budget.max(1);
    let interactive_limit_prompt = !banned_tools.contains(&"ask_user");
    info!(
        "Limits: max_token_budget={}, max_iterations_before_edit={} ({}%), max_build_attempts={}, max_iterations={}",
        max_token_budget,
        max_iterations_before_edit,
        MAX_ITERATIONS_BEFORE_EDIT_PERCENT,
        max_build_attempts,
        max_iterations,
    );

    let tools = create_tools(banned_tools);
    let allowed_tool_names = tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();
    let allowed_tool_names_display = allowed_tool_names.join(", ");
    let mut evolution = Evolution::new(prompt);
    let mut iteration: usize = 0;
    let mut build_attempts: usize = 0;
    let mut build_verified = false;
    let mut total_tokens: u32 = 0;
    let chat_memory_store = session_chat_memory_store();

    // Restore only persisted conversational history (user/assistant, NOT tool)
    let historical_context = restore_historical_evolution_messages();

    // Persist the raw user request at session scope before model execution so the
    // next evolve run can continue from this thread.
    // CONSIDER: Don't store the prompt until the turn finishes (not cancelled or errored).
    chat_memory_store.append(ChatMessage {
        role: ChatMemoryRole::User,
        content: prompt.to_string(),
        timestamp: Utc::now(),
    });
    debug!("[evolve] saved user message to session chat memory");

    info!("Evolution ID: {}", evolution.id);
    info!("════════════════════════════════════════════════════════════════");

    // Initialize conversation with system prompt
    let repo_view_context = match format_config_dir_context(repo_root.as_path(), config_dir) {
        Ok(tree) => tree,
        Err(e) => {
            warn!(
                "Failed to build repo view context for prompt ({}): {}",
                config_dir, e
            );
            "(Failed to render repo view)".to_string()
        }
    };

    let mut messages: Vec<EvolutionMessage> = vec![EvolutionMessage::permanent(
        Message::System {
            content: SYSTEM_PROMPT.to_string(),
        },
        0,
        None,
    )];

    // Restore historical context after system prompt but before the new user message,
    // so it's included in the token count and visible to the model in the correct order.
    messages.extend(historical_context);

    messages.push(EvolutionMessage::permanent(
        Message::User {
            content: format!(
            "<user_query>{}</user_query>\n\n<repo_view>\n{}\n</repo_view>\nStart by using the 'think' tool to plan your approach.",
                escape_user_query(prompt),
                repo_view_context
            ),
        },
        0,
        None,
    ));

    let gitignore_matcher = gitignore::load_gitignore_matcher(repo_root.as_path())?;

    // Track whether we've made any actual edits and/or build checks
    let mut made_edit = false;
    let mut made_build_check = false;

    // Agentic loop - let the model use tools until done AND build passes
    loop {
        // Check for cancellation at the start of each iteration
        if session_control::is_evolve_cancelled() {
            warn!("⚠️ {}", session_control::EVOLUTION_CANCELLED_MSG);
            evolution.state = EvolutionState::Failed;
            emit_evolve_event(
                app,
                EvolveEvent::error(
                    start_time,
                    Some(iteration),
                    session_control::EVOLUTION_CANCELLED_MSG,
                    session_control::EVOLUTION_CANCELLED_MSG,
                ),
            );
            // Track failure
            if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                warn!("Failed to record evolution failure stats: {}", e);
            }
            return Err(EvolutionRunError::from_state(
                session_control::EVOLUTION_CANCELLED_MSG,
                &evolution,
                iteration,
                build_attempts,
                total_tokens,
            )
            .into());
        }

        iteration += 1;

        // Run provider completion inside a short-lived block and select!
        // on it plus a cancellation signal. This lets the future borrow
        // `messages` only for the call so we can mutate `messages` after
        // the block without deep-cloning the conversation.
        let active_messages = filter_evolution_messages(&messages, iteration, made_build_check);
        let active_provider_messages: Vec<Message> =
            active_messages.iter().map(|m| m.message.clone()).collect();

        info!("────────────────────────────────────────────────────────────────");
        info!(
            "ITERATION {} | active messages={} | build_attempts={}/{}",
            iteration,
            active_messages.len(),
            build_attempts,
            max_build_attempts
        );
        info!("────────────────────────────────────────────────────────────────");

        // Emit iteration event
        emit_evolve_event(
            app,
            EvolveEvent::iteration(start_time, iteration, active_messages.len()),
        );

        // Capture the messages that most directly drive the agent's next action
        let preview = build_preview(&active_messages);

        debug!("Sending request to AI provider, preview: {}", preview);
        emit_evolve_event(app, EvolveEvent::api_request(start_time, iteration));

        let response_result = {
            let fut = provider.completion(&active_provider_messages, &tools);
            tokio::pin!(fut);

            tokio::select! {
                res = &mut fut => res,
                _ = async {
                    loop {
                        if session_control::is_evolve_cancelled() {
                            break;
                        }
                        // TODO: Replace polling with tokio::sync::Notify or watch channel to avoid sleep.
                        sleep(Duration::from_millis(100)).await;
                    }
                } => {
                    warn!("⚠️ {} during provider call", session_control::EVOLUTION_CANCELLED_MSG);
                    evolution.state = EvolutionState::Failed;
                    emit_evolve_event(
                        app,
                        EvolveEvent::error(start_time, Some(iteration), session_control::EVOLUTION_CANCELLED_MSG, session_control::EVOLUTION_CANCELLED_MSG),
                    );
                    // Track failure
                    if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                        warn!("Failed to record evolution failure stats: {}", e);
                    }
                    return Err(EvolutionRunError::from_state(
                        session_control::EVOLUTION_CANCELLED_MSG,
                        &evolution,
                        iteration,
                        build_attempts,
                        total_tokens,
                    )
                    .into());
                }
            }
        };

        // Handle API failures
        let response = match response_result {
            Ok(res) => res,
            Err(e) => {
                // Raw error for logging and diagnostics
                let error_str = format!("{:#}", e);
                error!("AI API error:\n{}", error_str);

                // Log full details locally and report redacted summary to Sentry
                log_api_error(
                    &e,
                    &active_provider_messages,
                    prompt,
                    iteration,
                    &provider_type,
                    &provider.model_name(),
                );

                emit_evolve_event(
                    app,
                    EvolveEvent::error(start_time, Some(iteration), &e.user_message(), &error_str),
                );

                // Track failure
                if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                    warn!("Failed to record evolution failure stats: {}", e);
                }

                // User-friendly message for the UI — translates raw provider
                // errors into actionable guidance without technical details.
                let user_msg = e.user_message();

                evolution.state = EvolutionState::Failed;
                return Err(EvolutionRunError::from_state(
                    user_msg,
                    &evolution,
                    iteration,
                    build_attempts,
                    total_tokens,
                )
                .into());
            }
        };

        // Track token usage
        if let Some(usage) = &response.usage {
            total_tokens += usage.total;
            info!(
                "📊 Tokens | this_call: {} (in={}, out={}) | total_session: {}",
                usage.total, usage.input, usage.output, total_tokens
            );
            emit_evolve_event(
                app,
                EvolveEvent::api_response(
                    start_time,
                    iteration,
                    usage.total,
                    total_tokens,
                    max_token_budget,
                ),
            );
        }

        // Safety limits -- Token budget. Caps cumulative session tokens
        // (in addition to the per-call max_output_tokens). Skipped if
        // the provider didn't report usage; the iteration guard below
        // is the fallback for those providers.
        if total_tokens >= max_token_budget {
            warn!(
                "⚠️ Evolution reached token budget ({}/{}) - asking whether to continue",
                total_tokens, max_token_budget,
            );
            match ask_to_continue_after_limit(
                app,
                start_time,
                iteration,
                EvolutionLimitKind::TokenBudget,
                total_tokens as usize,
                interactive_limit_prompt,
            )
            .await
            {
                LimitDecision::Continue => {
                    max_token_budget = max_token_budget.saturating_add(max_token_budget_increment);
                    info!("Extending token budget to {}", max_token_budget);
                }
                LimitDecision::Stop => {
                    finish_after_limit_stop(
                        app,
                        &mut evolution,
                        start_time,
                        iteration,
                        EvolutionLimitKind::TokenBudget,
                        total_tokens as usize,
                    );
                    break;
                }
                LimitDecision::Cancelled => {
                    evolution.state = EvolutionState::Failed;
                    return Err(EvolutionRunError::from_state(
                        session_control::EVOLUTION_CANCELLED_MSG,
                        &evolution,
                        iteration,
                        build_attempts,
                        total_tokens,
                    )
                    .into());
                }
            }
        }

        let assistant_msg = response.message;

        // Log assistant text response if any. If tool calls are present, treat tool_calls as
        // the sole executable source and only log content as an optional side note.
        if let Message::Assistant {
            content: Some(ref text),
            ref tool_calls,
        } = assistant_msg
        {
            let has_tool_calls = tool_calls.as_ref().is_some_and(|calls| !calls.is_empty());
            if has_tool_calls {
                debug!(
                    "Assistant returned content alongside tool_calls; content treated as non-executable text | content_preview={}",
                    global_utils::truncate_with_ellipsis(text, 300)
                );
            }
            info!(
                "💬 Assistant: {}",
                global_utils::truncate_with_ellipsis(text, 500)
            );
        }
        let assistant_ev_msg: EvolutionMessage = EvolutionMessage {
            message: assistant_msg.clone(),
            retention: Retention::Permanent,
            created_iteration: iteration,
            key: None,
        };
        // Add assistant message to history
        messages.push(assistant_ev_msg);

        // Check if model wants to use tools
        if let Message::Assistant {
            tool_calls: Some(ref tool_calls),
            ..
        } = assistant_msg
        {
            if !tool_calls.is_empty() {
                info!("🔧 Model requested {} tool call(s)", tool_calls.len());
                let mut should_break = false;

                for tool_call in tool_calls {
                    let tool_name = &tool_call.name;
                    let args_str = &tool_call.arguments;
                    let args_raw: serde_json::Value =
                        serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));
                    let args = sanitize_tool_args(tool_name, &args_raw);

                    let args_summary = summarize_args(&args);
                    info!("  → {} | args: {}", tool_name, args_summary);

                    // Emit tool call event
                    emit_evolve_event(
                        app,
                        EvolveEvent::tool_call(start_time, iteration, tool_name, &args_summary),
                    );

                    let result = execute_tool(
                        repo_root.as_path(),
                        config_dir,
                        host_attr.as_str(),
                        tool_name,
                        &args,
                        gitignore_matcher.as_ref(),
                    );

                    let mut tool_key: Option<String> = None;
                    match result {
                        Ok(ref res) => {
                            let (result_summary, success) = summarize_result(res);
                            evolution.add_tool_call(
                                start_time,
                                iteration,
                                tool_name,
                                &args_summary,
                                &result_summary,
                                success,
                            );

                            // Track if we've made an edit or build check
                            if is_editing_tool(tool_name) {
                                made_edit = true;
                            }
                            if tool_name == "build_check" {
                                made_build_check = true;
                                tool_key = Some(format!("build_check_{}", iteration));
                            }

                            // Emit specific events based on tool result type
                            match res {
                                ToolResult::Think { category, thought } => {
                                    tool_key = Some("think_".to_string() + &iteration.to_string());
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::thinking(
                                            start_time, iteration, category, thought,
                                        ),
                                    );
                                }
                                ToolResult::Edit(edit) => {
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::editing(start_time, iteration, &edit.path),
                                    );
                                }
                                ToolResult::EditSemantic(edit) => {
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::editing(start_time, iteration, &edit.path),
                                    );
                                }
                                ToolResult::EnsureSecret(result) => {
                                    let path = format!("secrets/{}.yaml", result.name);
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::editing(start_time, iteration, &path),
                                    );
                                }
                                ToolResult::BuildResult {
                                    success,
                                    output,
                                    stderr,
                                    stdout,
                                } => {
                                    if *success {
                                        emit_evolve_event(
                                            app,
                                            EvolveEvent::build_pass(start_time, iteration),
                                        );
                                    } else {
                                        let error_source = if !stderr.is_empty() {
                                            stderr
                                        } else if !stdout.is_empty() {
                                            stdout
                                        } else {
                                            output
                                        };
                                        let error_preview = error_source
                                            .lines()
                                            .take(3)
                                            .collect::<Vec<_>>()
                                            .join("\n");
                                        emit_evolve_event(
                                            app,
                                            EvolveEvent::build_fail(
                                                start_time,
                                                iteration,
                                                &error_preview,
                                            ),
                                        );
                                    }
                                }
                                ToolResult::SearchPackages(results) => {
                                    let packages = results
                                        .iter()
                                        .map(|r| r.name.as_str())
                                        .collect::<Vec<_>>()
                                        .join(", ");
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::search_packages(
                                            start_time, iteration, &packages,
                                        ),
                                    );
                                }
                                ToolResult::Continue(_content) => {
                                    if tool_name == "read_file" {
                                        if let Some(path) =
                                            args.get("path").and_then(|v| v.as_str())
                                        {
                                            tool_key = read_file_dedup_key(path, &args);
                                            emit_evolve_event(
                                                app,
                                                EvolveEvent::reading(start_time, iteration, path),
                                            );
                                        }
                                    }
                                }
                                ToolResult::Done(summary_text) => {
                                    // The terminal `Complete` event is emitted by the
                                    // lifecycle once all state cells are updated; the
                                    // agent summary travels with it via `evolution.summary`.
                                    info!("Agent signalled done: {}", summary_text);
                                }
                                ToolResult::Question { question, choices } => {
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::question(
                                            start_time, iteration, question, choices,
                                        ),
                                    );
                                }
                            }

                            // Handle question tool specially: wait for user response
                            if let ToolResult::Question {
                                question,
                                choices: _,
                            } = res
                            {
                                info!("⏳ Waiting for user response to: {}", question);
                                let user_answer = tokio::select! {
                                    answer = session_control::wait_for_question_response() => {
                                        match answer {
                                            Some(a) => a,
                                            None => {
                                                warn!("Question response channel closed");
                                                "No response provided.".to_string()
                                            }
                                        }
                                    }
                                    _ = async {
                                        loop {
                                            if session_control::is_evolve_cancelled() {
                                                break;
                                            }
                                            sleep(Duration::from_millis(100)).await;
                                        }
                                    } => {
                                        warn!("Evolution cancelled while waiting for question response");
                                        evolution.state = EvolutionState::Failed;
                                        return Err(EvolutionRunError::from_state(
                                            session_control::EVOLUTION_CANCELLED_MSG,
                                            &evolution,
                                            iteration,
                                            build_attempts,
                                            total_tokens,
                                        ).into());
                                    }
                                };
                                info!("📨 User answered: {}", user_answer);
                                messages.push(store_tool_result(
                                    Message::Tool {
                                        tool_call_id: tool_call.id.clone(),
                                        content: format!("User response: {}", user_answer),
                                    },
                                    tool_name,
                                    iteration,
                                    None,
                                ));
                                continue;
                            }

                            let (msg, break_signal) = match process_tool_result(
                                &tool_call.id,
                                res,
                                &mut evolution,
                                &mut build_verified,
                                &mut build_attempts,
                                max_build_attempts,
                                &host_attr,
                                start_time,
                                iteration,
                            ) {
                                Ok(v) => v,
                                Err(e) => {
                                    evolution.state = EvolutionState::Failed;
                                    return Err(EvolutionRunError::from_state(
                                        e.to_string(),
                                        &evolution,
                                        iteration,
                                        build_attempts,
                                        total_tokens,
                                    )
                                    .into());
                                }
                            };
                            messages.push(store_tool_result(msg, tool_name, iteration, tool_key));

                            match break_signal {
                                Some(true) => {
                                    should_break = true;
                                    break;
                                }
                                Some(false) => {}
                                None => break, // Break inner loop only
                            }
                        }
                        Err(e) => {
                            error!("❌ Tool {} failed: {}", tool_name, e);
                            emit_evolve_event(
                                app,
                                EvolveEvent::error(
                                    start_time,
                                    Some(iteration),
                                    &format!("Tool {} failed", tool_name),
                                    &e.to_string(),
                                ),
                            );
                            evolution.add_tool_call(
                                start_time,
                                iteration,
                                tool_name,
                                &args_summary,
                                &format!("ERROR: {}", e),
                                false,
                            );

                            let tool_error = e.to_string();
                            let recovery_message = if tool_error.starts_with("Unknown tool:") {
                                format!(
                                    "Unknown tool '{}'. Retry with one of the allowed tools only: {}. \
Do not invent tool names and do not place tool invocations in assistant content.",
                                    tool_name, allowed_tool_names_display
                                )
                            } else {
                                format!("Error: {}. Please try a different approach.", tool_error)
                            };

                            messages.push(store_tool_result(
                                Message::Tool {
                                    tool_call_id: tool_call.id.clone(),
                                    content: recovery_message,
                                },
                                tool_name,
                                iteration,
                                tool_key,
                            ));
                        }
                    }
                }

                if should_break {
                    break;
                }
            } else {
                // tool_calls: Some([]) — empty list, treat same as no tool calls.
                info!("Model returned empty tool list — treating as no tool calls");
            }
        }

        // If no tool calls were made (None or empty list), handle as terminal response.
        let no_tool_calls = match &assistant_msg {
            Message::Assistant { tool_calls, .. } => {
                tool_calls.as_ref().is_none_or(|calls| calls.is_empty())
            }
            _ => false,
        };

        if no_tool_calls {
            if let Message::Assistant {
                content: Some(content),
                ..
            } = assistant_msg
            {
                if evolution.edits.is_empty() {
                    // No files were changed — this is a conversational reply (e.g. "hi").
                    // The lifecycle emits the terminal `Complete` event carrying the
                    // content as `conversational_response`; mark the state so the
                    // caller can skip the review workflow.
                    info!("Conversational response (no edits made)");
                    evolution.summary = Some(content);
                    evolution.state = EvolutionState::Conversational;
                } else {
                    info!("Model finished without tool calls (edits already made)");
                    evolution.summary = Some(content);
                    evolution.state = EvolutionState::Generated;
                }
            } else {
                info!("Model finished without tool calls");
                evolution.state = EvolutionState::Generated;
            }
            break;
        }

        // Safety limits -- Max Iterations Before Edit Check
        if iteration >= max_iterations_before_edit && !(made_edit || made_build_check) {
            warn!(
                "⚠️ No edit or build_check by iteration {} - asking whether to continue",
                max_iterations_before_edit
            );
            match ask_to_continue_after_limit(
                app,
                start_time,
                iteration,
                EvolutionLimitKind::NoProgress,
                iteration,
                interactive_limit_prompt,
            )
            .await
            {
                LimitDecision::Continue => {
                    max_iterations_before_edit += max_iterations_before_edit_increment;
                    max_iterations = max_iterations.max(max_iterations_before_edit);
                    info!(
                        "Extending no-progress limit to iteration {} and max iterations to {}",
                        max_iterations_before_edit, max_iterations
                    );
                }
                LimitDecision::Stop => {
                    finish_after_limit_stop(
                        app,
                        &mut evolution,
                        start_time,
                        iteration,
                        EvolutionLimitKind::NoProgress,
                        iteration,
                    );
                    break;
                }
                LimitDecision::Cancelled => {
                    evolution.state = EvolutionState::Failed;
                    return Err(EvolutionRunError::from_state(
                        session_control::EVOLUTION_CANCELLED_MSG,
                        &evolution,
                        iteration,
                        build_attempts,
                        total_tokens,
                    )
                    .into());
                }
            }
        }

        // Safety limits -- Max Iterations
        if iteration >= max_iterations {
            warn!(
                "⚠️ Evolution reached maximum iterations ({}) - asking whether to continue",
                max_iterations
            );
            match ask_to_continue_after_limit(
                app,
                start_time,
                iteration,
                EvolutionLimitKind::MaxIterations,
                iteration,
                interactive_limit_prompt,
            )
            .await
            {
                LimitDecision::Continue => {
                    max_iterations += max_iterations_increment;
                    info!("Extending max iterations to {}", max_iterations);

                    // Avoid immediately prompting again this same iteration if build attempts
                    // are already at/over the current ceiling.
                    if build_attempts >= max_build_attempts {
                        max_build_attempts += max_build_attempts_increment;
                        info!(
                            "Also extending max build attempts to {}",
                            max_build_attempts
                        );
                    }
                }
                LimitDecision::Stop => {
                    finish_after_limit_stop(
                        app,
                        &mut evolution,
                        start_time,
                        iteration,
                        EvolutionLimitKind::MaxIterations,
                        iteration,
                    );
                    break;
                }
                LimitDecision::Cancelled => {
                    evolution.state = EvolutionState::Failed;
                    return Err(EvolutionRunError::from_state(
                        session_control::EVOLUTION_CANCELLED_MSG,
                        &evolution,
                        iteration,
                        build_attempts,
                        total_tokens,
                    )
                    .into());
                }
            }
        }

        // Safety limits -- Max Build Attempts
        if build_attempts >= max_build_attempts {
            warn!(
                "⚠️ Evolution reached maximum build attempts ({}) - asking whether to continue",
                max_build_attempts
            );
            match ask_to_continue_after_limit(
                app,
                start_time,
                iteration,
                EvolutionLimitKind::BuildAttempts,
                build_attempts,
                interactive_limit_prompt,
            )
            .await
            {
                LimitDecision::Continue => {
                    max_build_attempts += max_build_attempts_increment;
                    info!("Extending max build attempts to {}", max_build_attempts);
                }
                LimitDecision::Stop => {
                    finish_after_limit_stop(
                        app,
                        &mut evolution,
                        start_time,
                        iteration,
                        EvolutionLimitKind::BuildAttempts,
                        build_attempts,
                    );
                    break;
                }
                LimitDecision::Cancelled => {
                    evolution.state = EvolutionState::Failed;
                    return Err(EvolutionRunError::from_state(
                        session_control::EVOLUTION_CANCELLED_MSG,
                        &evolution,
                        iteration,
                        build_attempts,
                        total_tokens,
                    )
                    .into());
                }
            }
        }
    }

    // Update evolution stats
    evolution.iterations = iteration;
    evolution.build_attempts = build_attempts;
    evolution.total_tokens = total_tokens;

    // Store conversation for potential refinement
    evolution.messages = messages
        .iter()
        .filter_map(|m| serde_json::to_value(m).ok())
        .collect();

    // Prefer persisting the summary the user actually saw (set by ToolResult::Done
    // or the terminal assistant response). This avoids capturing intermediate
    // assistant messages that the agent emitted while performing tool calls.
    if let Some(summary) = &evolution.summary {
        if !summary.trim().is_empty() {
            chat_memory_store.append(ChatMessage {
                role: ChatMemoryRole::Assistant,
                content: summary.clone(),
                timestamp: Utc::now(),
            });
            debug!("[evolve] saved evolution.summary to session chat memory");
        }
    } else if let Some(content) = messages
        .iter()
        .rev()
        .find_map(|ev_msg| match &ev_msg.message {
            Message::Assistant {
                content: Some(content),
                ..
            } if !content.trim().is_empty() => Some(content.clone()),
            _ => None,
        })
    {
        // Fallback: persist the last assistant message if no summary was produced.
        chat_memory_store.append(ChatMessage {
            role: ChatMemoryRole::Assistant,
            content,
            timestamp: Utc::now(),
        });
        debug!("[evolve] saved assistant message to session chat memory");
    }

    let elapsed_secs = chrono::Utc::now()
        .timestamp()
        .saturating_sub(start_time)
        .max(0);
    info!("════════════════════════════════════════════════════════════════");
    info!("EVOLUTION COMPLETE");
    info!("════════════════════════════════════════════════════════════════");
    info!("ID: {}", evolution.id);
    info!("State: {:?}", evolution.state);
    info!("Duration: {}", format_duration_secs(elapsed_secs));
    info!("Iterations: {}", evolution.iterations);
    info!("Build attempts: {}", evolution.build_attempts);
    info!("Total tokens: {}", evolution.total_tokens);
    info!("Edits: {}", evolution.edits.len());
    info!("Thinking entries: {}", evolution.thinking.len());
    info!("Tool calls: {}", evolution.tool_calls.len());
    info!("════════════════════════════════════════════════════════════════");

    let evolution_json = serde_json::to_string(&evolution).unwrap_or_default();
    store::set_evolve_metadata(app, &evolution_json)?;

    // Track successful evolution
    if let Err(e) = statistics::record_evolution_success(app, evolution.iterations) {
        warn!("Failed to record evolution success stats: {}", e);
    }

    Ok(evolution)
}

// Truncate build output to save against model token limits while preserving the tail where error details usually are
fn truncate_build_output_for_model(output: &str) -> String {
    // Short-circuit if output is already within limits
    let output = output.trim();
    if output.len() <= BUILD_OUTPUT_MAX_CHARS {
        return output.to_string();
    }

    let lines: Vec<&str> = output.lines().collect();
    let total_lines = lines.len();

    // Try to find last "error:" line, otherwise just take tail
    let start_idx = lines
        .iter()
        .rposition(|line| line.to_ascii_lowercase().contains("error:"))
        .unwrap_or_else(|| total_lines.saturating_sub(BUILD_OUTPUT_TAIL_LINES));

    let tail_lines = &lines[start_idx..];
    let mut truncated = tail_lines.join("\n");

    if truncated.len() > BUILD_OUTPUT_MAX_CHARS {
        global_utils::truncate_utf8(&mut truncated, BUILD_OUTPUT_MAX_CHARS);
        truncated.push_str("\n\n... [truncated] ...");
    } else if start_idx > 0 {
        truncated = format!(
            "... [omitted {} lines; original size={} chars] ...\n\n{}",
            start_idx,
            output.len(),
            truncated
        );
    }

    truncated
}

/// Sanitize sensitive tool arguments before logging, telemetry emission, and execution.
fn sanitize_tool_args(tool_name: &str, args: &serde_json::Value) -> serde_json::Value {
    let mut sanitized = args.clone();

    if tool_name == "ensure_secret" {
        if let Some(args_obj) = sanitized.as_object_mut() {
            if let Some(scaffold_obj) = args_obj
                .get_mut("scaffold")
                .and_then(serde_json::Value::as_object_mut)
            {
                if scaffold_obj.contains_key("content") {
                    scaffold_obj.insert(
                        "content".to_string(),
                        serde_json::Value::String("[REDACTED]".to_string()),
                    );
                }
            }
        }
    }

    sanitized
}

/// Summarize tool arguments for logging
fn summarize_args(args: &serde_json::Value) -> String {
    match args {
        serde_json::Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| {
                    let v_str = match v {
                        serde_json::Value::String(s) => {
                            format!("\"{}\"", global_utils::truncate_with_ellipsis(s, 50))
                        }
                        _ => v.to_string(),
                    };
                    format!("{}={}", k, v_str)
                })
                .collect();
            parts.join(", ")
        }
        _ => args.to_string(),
    }
}

/// Summarize tool result for logging
fn summarize_result(result: &ToolResult) -> (String, bool) {
    match result {
        ToolResult::Think { category, thought } => {
            (format!("[{}] {} chars", category, thought.len()), true)
        }
        ToolResult::SearchPackages(results) => (format!("found {} packages", results.len()), true),
        ToolResult::Continue(s) => (format!("{} chars", s.len()), true),
        ToolResult::Edit(e) => (format!("edited {}", e.path), true),
        ToolResult::EditSemantic(e) => (format!("semantic edit {} ({:?})", e.path, e.action), true),
        ToolResult::EnsureSecret(r) => (format!("ensure_secret {}", r.name), true),
        ToolResult::BuildResult { success, .. } => {
            if *success {
                ("PASSED".to_string(), true)
            } else {
                ("FAILED".to_string(), false)
            }
        }
        ToolResult::Done(s) => (
            format!("done: {}", global_utils::truncate_with_ellipsis(s, 50)),
            true,
        ),
        ToolResult::Question { question, .. } => (
            format!(
                "asked: {}",
                global_utils::truncate_with_ellipsis(question, 50)
            ),
            true,
        ),
    }
}

/// Process a successful tool result and return the appropriate response message.
/// Returns `Ok(Some(true))` if the loop should break, `Ok(Some(false))` to continue,
/// or `Ok(None)` to break the inner tool loop but continue the outer loop.
#[allow(clippy::too_many_arguments)]
fn process_tool_result(
    tool_call_id: &str,
    result: &ToolResult,
    evolution: &mut Evolution,
    build_verified: &mut bool,
    build_attempts: &mut usize,
    max_build_attempts: usize,
    host_attr: &str,
    start_time: i64,
    iteration: usize,
) -> Result<(Message, Option<bool>)> {
    let (message, should_break) = match result {
        ToolResult::Think { category, thought } => {
            info!("🧠 THINK [{}]:", category);
            for line in thought.lines() {
                info!("   │ {}", line);
            }
            info!("   └─────────────────────────────────────────");

            evolution.add_thought(start_time, iteration, category, thought);

            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content: "Thought recorded. Continue with your plan.".to_string(),
            };
            (msg, Some(false))
        }

        ToolResult::Continue(content) => {
            debug!("Tool returned {} bytes", content.len());
            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content: content.clone(),
            };
            (msg, Some(false))
        }

        ToolResult::SearchPackages(search_packages) => {
            info!(
                "🔍 Search Packages | found {} packages",
                search_packages.len()
            );
            for pkg in search_packages.iter().take(5) {
                info!("   │ {}: {:?}", pkg.name, pkg.install_via);
            }
            if search_packages.len() > 5 {
                info!("   │ ... and {} more", search_packages.len() - 5);
            }

            // Return the packages as JSON
            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content: serde_json::to_string(search_packages)
                    .unwrap_or_else(|_| "[]".to_string()),
            };
            (msg, Some(false))
        }

        ToolResult::Edit(edit) => {
            info!(
                "📝 Edit | path={} | -{} chars, +{} chars",
                edit.path,
                edit.search.len(),
                edit.replace.len()
            );
            evolution.edits.push(edit.clone());
            // A new edit invalidates any prior successful build: the verified
            // state no longer matches the files, so `done` must require a fresh
            // build_check.
            *build_verified = false;
            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content:
                    "Edit applied successfully. Remember to run build_check before calling done."
                        .to_string(),
            };
            (msg, Some(false))
        }

        ToolResult::EditSemantic(edit) => {
            info!(
                "📝 Semantic Edit | path={} | description={}",
                edit.path,
                format_args!("{:?}", edit.action)
            );
            evolution.edits.push(FileEdit {
                path: edit.path.clone(),
                // Preserve semantic edit events in the legacy edits list.
                search: String::new(),
                replace: format!("semantic:{:?}", edit.action),
            });
            // A new edit invalidates any prior successful build verification.
            *build_verified = false;

            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content:
                    "Semantic edit applied successfully. Remember to run build_check before calling done."
                        .to_string(),
            };
            (msg, Some(false))
        }

        ToolResult::EnsureSecret(result) => {
            info!("🔐 Secret | name={} | path={}", result.name, result.path);
            evolution.edits.push(FileEdit {
                path: result.path.clone(),
                search: String::new(),
                replace: format!("ensure_secret:{}", result.name),
            });
            // A new edit invalidates any prior successful build verification.
            *build_verified = false;
            let content = serde_json::to_string(result)
                .unwrap_or_else(|_| format!("{{\"name\":\"{}\"}}", result.name));
            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content: format!(
                    "{content}\n\nSecret created/updated successfully. Remember to run build_check before calling done."
                ),
            };
            (msg, Some(false))
        }

        ToolResult::BuildResult {
            success,
            output: _,
            stdout,
            stderr,
        } => {
            *build_attempts += 1;

            let trimmed_stdout = stdout.trim();
            let trimmed_stderr = stderr.trim();

            let stderr_for_model = if trimmed_stderr.is_empty() {
                None
            } else {
                Some(truncate_build_output_for_model(trimmed_stderr))
            };

            let stdout_for_model = if trimmed_stdout.is_empty() {
                None
            } else {
                Some(truncate_build_output_for_model(trimmed_stdout))
            };

            let model_output = match (&stderr_for_model, &stdout_for_model) {
                (Some(stderr), Some(stdout)) => {
                    format!("stderr:\n{stderr}\n\nstdout:\n{stdout}")
                }
                (Some(stderr), None) => format!("stderr:\n{stderr}"),
                (None, Some(stdout)) => format!("stdout:\n{stdout}"),
                (None, None) => "(no build output captured)".to_string(),
            };

            if *success {
                info!("✅ BUILD CHECK PASSED");
                *build_verified = true;

                let msg = Message::Tool {
                    tool_call_id: tool_call_id.to_string(),
                    content: format!(
                        "{}\n\nBuild verified! You may now call 'done' with your summary.",
                        model_output
                    ),
                };
                (msg, Some(false))
            } else {
                // A failing build invalidates any earlier successful verification,
                // otherwise `done` could still accept the (now broken) config.
                *build_verified = false;
                warn!(
                    "❌ BUILD CHECK FAILED (attempt {}/{})",
                    build_attempts, max_build_attempts
                );

                // Prefer logging stderr first since that's usually where Nix errors live.
                let log_preview = if !trimmed_stderr.is_empty() {
                    trimmed_stderr
                } else if !trimmed_stdout.is_empty() {
                    trimmed_stdout
                } else {
                    ""
                };

                for line in log_preview.lines().take(20) {
                    warn!("   │ {}", line);
                }

                let msg = Message::Tool {
                    tool_call_id: tool_call_id.to_string(),
                    content: format!(
                        "{}\n\nUse the 'think' tool to analyze the error, then fix the issue and run build_check again.",
                        model_output
                    ),
                };
                (msg, Some(false))
            }
        }

        ToolResult::Done(summary) => {
            if *build_verified {
                info!("✅ EVOLUTION COMPLETE (build verified)");
                info!("Summary: {}", summary);
                evolution.summary = Some(summary.clone());
                evolution.state = EvolutionState::Generated;
                let msg = Message::Tool {
                    tool_call_id: tool_call_id.to_string(),
                    content: "Evolution complete.".to_string(),
                };
                (msg, Some(true))
            } else if evolution.has_edits() {
                info!("⚠️ Agent called done without build verification");
                let msg = Message::Tool {
                    tool_call_id: tool_call_id.to_string(),
                    content: format!(
                        "Before completing, you must verify your changes compile. \
                         Run build_check with host='{}' to validate, then call done again.",
                        host_attr
                    ),
                };
                (msg, None) // Break inner loop, continue outer
            } else {
                info!("✅ EVOLUTION COMPLETE (no edits)");
                info!("Summary: {}", summary);
                evolution.summary = Some(summary.clone());
                evolution.state = EvolutionState::Generated;
                let msg = Message::Tool {
                    tool_call_id: tool_call_id.to_string(),
                    content: "Evolution complete.".to_string(),
                };
                (msg, Some(true))
            }
        }

        // Questions are handled before process_tool_result is called,
        // so this arm should never be reached.
        ToolResult::Question { .. } => {
            unreachable!("Question results are handled in the main loop before process_tool_result")
        }
    };

    Ok((message, should_break))
}

#[cfg(test)]
mod tests {
    use super::{
        Evolution, EvolutionMessage, EvolutionState, FileEdit, Message, Retention, ToolResult,
        filter_evolution_messages, normalize_openai_max_output_tokens, process_tool_result,
        read_file_dedup_key, store_tool_result,
    };

    fn build_result(success: bool) -> ToolResult {
        ToolResult::BuildResult {
            success,
            output: String::new(),
            stdout: String::new(),
            stderr: if success {
                String::new()
            } else {
                "boom".to_string()
            },
        }
    }

    fn run_tool_result(result: &ToolResult, evolution: &mut Evolution, build_verified: &mut bool) {
        let mut build_attempts = 0usize;
        process_tool_result(
            "tool-call-id",
            result,
            evolution,
            build_verified,
            &mut build_attempts,
            5,
            "host",
            0,
            0,
        )
        .expect("process_tool_result should not error in these cases");
    }

    #[test]
    fn direct_openai_gpt_4o_output_tokens_are_capped_to_api_limit() {
        assert_eq!(normalize_openai_max_output_tokens("gpt-4o", 32_768), 16_384);
        assert_eq!(
            normalize_openai_max_output_tokens("openai/gpt-4o-mini", 32_768),
            16_384
        );
        assert_eq!(
            normalize_openai_max_output_tokens("gpt-4o-2024-08-06", 32_768),
            16_384
        );
    }

    #[test]
    fn direct_openai_output_token_cap_preserves_lower_user_limit() {
        assert_eq!(normalize_openai_max_output_tokens("gpt-4o", 4_096), 4_096);
    }

    #[test]
    fn direct_openai_output_token_cap_leaves_unknown_models_unchanged() {
        assert_eq!(
            normalize_openai_max_output_tokens("custom-openai-model", 32_768),
            32_768
        );
    }

    // Bug 1: build_verified latched true on the first passing build and was never
    // cleared, so a later failing build_check (or an edit) still let `done`
    // complete an unbuildable config. A failing build must clear verification.
    #[test]
    fn failing_build_check_clears_prior_verification() {
        let mut evolution = Evolution::new("prompt");
        let mut build_verified = false;

        run_tool_result(&build_result(true), &mut evolution, &mut build_verified);
        assert!(
            build_verified,
            "a passing build_check should set build_verified"
        );

        run_tool_result(&build_result(false), &mut evolution, &mut build_verified);
        assert!(
            !build_verified,
            "a failing build_check must clear the prior verification"
        );
    }

    // End-to-end consequence: with edits present, calling done after a build that
    // failed (following an earlier pass) must NOT mark the evolution Generated.
    #[test]
    fn done_is_rejected_after_a_failing_build() {
        let mut evolution = Evolution::new("prompt");
        evolution.edits.push(FileEdit {
            path: "configuration.nix".to_string(),
            search: "a".to_string(),
            replace: "b".to_string(),
        });
        let mut build_verified = false;

        run_tool_result(&build_result(true), &mut evolution, &mut build_verified);
        run_tool_result(&build_result(false), &mut evolution, &mut build_verified);
        run_tool_result(
            &ToolResult::Done("done".to_string()),
            &mut evolution,
            &mut build_verified,
        );

        assert!(
            !matches!(evolution.state, EvolutionState::Generated),
            "done must not complete an evolution whose last build_check failed"
        );
    }

    // A new edit after a passing build_check must clear verification, so the
    // agent cannot call done on files that were changed since the last build.
    #[test]
    fn edit_after_passing_build_clears_verification() {
        let mut evolution = Evolution::new("prompt");
        let mut build_verified = false;

        run_tool_result(&build_result(true), &mut evolution, &mut build_verified);
        assert!(
            build_verified,
            "a passing build_check should set build_verified"
        );

        run_tool_result(
            &ToolResult::Edit(FileEdit {
                path: "configuration.nix".to_string(),
                search: "a".to_string(),
                replace: "b".to_string(),
            }),
            &mut evolution,
            &mut build_verified,
        );
        assert!(
            !build_verified,
            "an edit after a passing build must clear the prior verification"
        );
    }

    fn set_memory_strategy_for_test(
        value: &str,
    ) -> (
        std::sync::MutexGuard<'static, ()>,
        crate::test_support::EnvVarRestore,
    ) {
        let lock = crate::test_support::e2e_env_lock();
        let restore =
            crate::test_support::EnvVarRestore::capture(&["NIXMAC_EVOLUTION_MEMORY_STRATEGY"]);
        unsafe { std::env::set_var("NIXMAC_EVOLUTION_MEMORY_STRATEGY", value) };
        (lock, restore)
    }

    fn sample_messages() -> Vec<EvolutionMessage> {
        vec![
            EvolutionMessage::permanent(
                Message::System {
                    content: "System prompt".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::permanent(
                Message::User {
                    content: "Initial user prompt".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::recent(
                Message::User {
                    content: "Short-lived message".to_string(),
                },
                1,
                1,
                None,
            ),
        ]
    }

    #[test]
    fn test_filter_evolution_messages_none_strategy_keeps_recent_messages() {
        let (_lock, _restore) = set_memory_strategy_for_test("none");
        let messages = sample_messages();

        let out = filter_evolution_messages(&messages, 1000, false);

        // With strategy=none, no filtering is applied at all.
        assert_eq!(out.len(), messages.len());
        assert!(out.iter().any(
            |m| matches!(&m.message, Message::User { content } if content == "Short-lived message")
        ));
    }

    #[test]
    fn test_filter_evolution_messages_none_strategy_bypasses_all_other_filters() {
        let (_lock, _restore) = set_memory_strategy_for_test("none");
        let messages = vec![
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "think-1".to_string(),
                    content: "Thought before build".to_string(),
                },
                1,
                1,
                Some("think_1".to_string()),
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "build-check-1".to_string(),
                    content: "Build failed".to_string(),
                },
                2,
                1,
                Some("build_check_1".to_string()),
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "think-2".to_string(),
                    content: "Thought after build".to_string(),
                },
                3,
                1,
                Some("think_2".to_string()),
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "read-file-1".to_string(),
                    content: "first read".to_string(),
                },
                4,
                1,
                Some("module.nix".to_string()),
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "read-file-2".to_string(),
                    content: "second read".to_string(),
                },
                5,
                1,
                Some("module.nix".to_string()),
            ),
        ];

        let out = filter_evolution_messages(&messages, 99, true);

        assert_eq!(out.len(), messages.len());
        assert!(out
            .iter()
            .any(|m| matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "think-1")));
        assert!(out.iter().any(
            |m| matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "build-check-1")
        ));
        assert!(out
            .iter()
            .any(|m| matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "think-2")));
        assert!(out.iter().filter(|m| matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "read-file-1" || tool_call_id == "read-file-2")).count() == 2);
    }

    #[test]
    fn test_filter_evolution_messages_retention_strategy_expires_recent_messages() {
        let (_lock, _restore) = set_memory_strategy_for_test("retention");
        let messages = sample_messages();

        let out = filter_evolution_messages(&messages, 1000, false);

        // With strategy=retention, recent messages eventually expire.
        assert!(out.iter().all(
            |m| !matches!(&m.message, Message::User { content } if content == "Short-lived message")
        ));
        assert!(out.iter().any(
            |m| matches!(&m.message, Message::System { content } if content == "System prompt")
        ));
        assert!(out.iter().any(
            |m| matches!(&m.message, Message::User { content } if content == "Initial user prompt")
        ));
    }

    #[test]
    fn test_filter_evolution_messages_unknown_strategy_defaults_to_none() {
        let (_lock, _restore) = set_memory_strategy_for_test("bogus-value");
        let messages = sample_messages();

        let out = filter_evolution_messages(&messages, 1000, false);

        // Unknown values should safely default to none behavior.
        assert!(out.len() == messages.len());
    }

    #[test]
    fn test_filter_evolution_messages_retention_timeline() {
        let (_lock, _restore) = set_memory_strategy_for_test("retention");
        let messages = vec![
            EvolutionMessage::permanent(
                Message::System {
                    content: "System prompt".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::permanent(
                Message::User {
                    content: "Initial user prompt".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::recent(
                Message::User {
                    content: "One-iteration message".to_string(),
                },
                1,
                1,
                None,
            ),
            EvolutionMessage::recent(
                Message::User {
                    content: "Two-iteration message".to_string(),
                },
                1,
                2,
                None,
            ),
        ];

        let iteration_1_messages = filter_evolution_messages(&messages, 1, false);
        assert_eq!(iteration_1_messages.len(), 4);

        let iteration_2_messages = filter_evolution_messages(&messages, 2, false);
        assert_eq!(iteration_2_messages.len(), 4);

        let iteration_3_messages = filter_evolution_messages(&messages, 3, false);
        assert_eq!(iteration_3_messages.len(), 3);
        assert!(iteration_3_messages.iter().all(
            |m| !matches!(&m.message, Message::User { content } if content == "One-iteration message")
        ));
        assert!(iteration_3_messages
            .iter()
            .any(|m| matches!(&m.message, Message::User { content } if content == "Two-iteration message")));

        let iteration_4_messages = filter_evolution_messages(&messages, 4, false);
        assert_eq!(iteration_4_messages.len(), 2);
        assert!(iteration_4_messages.iter().all(
            |m| !matches!(&m.message, Message::User { content } if content == "One-iteration message")
        ));
        assert!(iteration_4_messages.iter().all(
            |m| !matches!(&m.message, Message::User { content } if content == "Two-iteration message")
        ));
    }

    #[test]
    fn test_store_tool_result() {
        let iteration = 7;

        let search_docs_message = Message::Tool {
            tool_call_id: "search-docs-1".to_string(),
            content: "[]".to_string(),
        };
        let build_check_message = Message::Tool {
            tool_call_id: "build-check-1".to_string(),
            content: "Build failed".to_string(),
        };

        // The retention windows are measured in loop iterations, not message count.

        // We only assert that tool results are recorded with a recent retention
        // window (not permanent), that the creation iteration is preserved, and
        // that the tool_call_id survives. This avoids tying tests to numeric
        // retention tuning.
        let edit_file_stored = store_tool_result(search_docs_message, "edit_file", iteration, None);
        assert!(matches!(
            edit_file_stored.retention,
            Retention::Recent { .. }
        ));
        assert_eq!(edit_file_stored.created_iteration, iteration);
        assert!(
            matches!(edit_file_stored.message, Message::Tool { ref tool_call_id, .. } if tool_call_id == "search-docs-1")
        );

        let build_check_stored =
            store_tool_result(build_check_message, "build_check", iteration, None);
        assert!(matches!(
            build_check_stored.retention,
            Retention::Recent { .. }
        ));
        assert_eq!(build_check_stored.created_iteration, iteration);
        assert!(
            matches!(build_check_stored.message, Message::Tool { ref tool_call_id, .. } if tool_call_id == "build-check-1")
        );
    }

    #[test]
    fn test_filter_out_thinks_after_build_check() {
        let m1 = EvolutionMessage::permanent(
            Message::User {
                content: "User message".to_string(),
            },
            0,
            None,
        );
        let m2 = EvolutionMessage::recent(
            Message::Tool {
                tool_call_id: "think-1".to_string(),
                content: "Thought content".to_string(),
            },
            1,
            1,
            Some("think_1".to_string()),
        );
        let m3 = EvolutionMessage::recent(
            Message::Tool {
                tool_call_id: "build-check-1".to_string(),
                content: "Build failed".to_string(),
            },
            1,
            2,
            Some("build_check_1".to_string()),
        );
        let m4 = EvolutionMessage::recent(
            Message::Tool {
                tool_call_id: "think-2".to_string(),
                content: "Another thought".to_string(),
            },
            1,
            3,
            Some("think_2".to_string()),
        );
        let messages = vec![m1, m2, m3, m4];
        // Use retention so we exercise the build-check pruning branch.
        let (_lock, _restore) = set_memory_strategy_for_test("retention");
        let filtered = filter_evolution_messages(&messages, 3, true);
        // The think before the build check should be filtered out, but the one after should be kept.
        assert!(filtered.iter().any(
            |m| matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "think-2")
        ));
        assert!(filtered.iter().all(
            |m| !matches!(&m.message, Message::Tool { tool_call_id, .. } if tool_call_id == "think-1")
        ));
    }

    #[test]
    fn test_pre_build_thinks_stay_pruned_after_build_check_message_expires() {
        let (_lock, _restore) = set_memory_strategy_for_test("retention");

        let messages = vec![
            EvolutionMessage::permanent(
                Message::User {
                    content: "User message".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::permanent(
                Message::Tool {
                    tool_call_id: "think-before-build".to_string(),
                    content: "Outdated pre-build reasoning".to_string(),
                },
                1,
                Some("think_1".to_string()),
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "build-check-1".to_string(),
                    content: "Build failed".to_string(),
                },
                2,
                1,
                Some("build_check_2".to_string()),
            ),
            EvolutionMessage::permanent(
                Message::Tool {
                    tool_call_id: "think-after-build".to_string(),
                    content: "Post-build reasoning".to_string(),
                },
                3,
                Some("think_3".to_string()),
            ),
        ];

        // At iteration 10, the build_check message is expired by retention,
        // but made_build_check is still true and pre-build thinks should remain pruned.
        let filtered = filter_evolution_messages(&messages, 10, true);

        assert!(filtered.iter().all(|m| !matches!(
            &m.message,
            Message::Tool { tool_call_id, .. } if tool_call_id == "think-before-build"
        )));
        assert!(filtered.iter().any(|m| matches!(
            &m.message,
            Message::Tool { tool_call_id, .. } if tool_call_id == "think-after-build"
        )));
    }

    #[test]
    fn test_filter_evolution_messages_last_key_wins() {
        let m1 = EvolutionMessage::permanent(
            Message::User {
                content: "A".to_string(),
            },
            0,
            Some("key1".to_string()),
        );
        let m2 = EvolutionMessage::permanent(
            Message::User {
                content: "B".to_string(),
            },
            1,
            Some("key2".to_string()),
        );
        let m3 = EvolutionMessage::permanent(
            Message::User {
                content: "C".to_string(),
            },
            2,
            Some("key1".to_string()),
        );
        let m4 = EvolutionMessage::permanent(
            Message::User {
                content: "D".to_string(),
            },
            3,
            None,
        );
        let m5 = EvolutionMessage::permanent(
            Message::User {
                content: "E".to_string(),
            },
            4,
            Some("key2".to_string()),
        );
        let m6 = EvolutionMessage::permanent(
            Message::User {
                content: "F".to_string(),
            },
            5,
            None,
        );
        let messages = vec![m1, m2, m3, m4, m5, m6];
        // Use retention so dedupe logic is exercised (none now early-exits).
        let (_lock, _restore) = set_memory_strategy_for_test("retention");
        let filtered = filter_evolution_messages(&messages, 10, false);
        // Only the last message for key1 and key2 should be kept, plus all messages with no key
        let contents: Vec<_> = filtered
            .iter()
            .map(|m| match &m.message {
                Message::User { content } => content.as_str(),
                _ => "",
            })
            .collect();
        assert_eq!(contents, vec!["C", "D", "E", "F"]);
    }

    #[test]
    fn test_read_file_dedup_key_only_for_full_file_reads() {
        let full_file_args = serde_json::json!({
            "path": "modules/darwin/defaults.nix",
        });
        let partial_args = serde_json::json!({
            "path": "modules/darwin/defaults.nix",
            "line_start": 1,
            "line_end": 200,
        });

        assert_eq!(
            read_file_dedup_key("modules/darwin/defaults.nix", &full_file_args),
            Some("modules/darwin/defaults.nix".to_string())
        );
        assert_eq!(
            read_file_dedup_key("modules/darwin/defaults.nix", &partial_args),
            None
        );
    }
}
