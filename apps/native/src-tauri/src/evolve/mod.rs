//! Evolution module for AI-assisted configuration changes.

mod config_dir_context;
mod edit_nix_file;
mod file_ops;
pub mod messages;
pub mod providers;
mod search_code;
mod search_packages;
mod tools;
mod types;
mod utils;

/// Directories ignored by file listing and search helpers.
pub(crate) const IGNORED_DIRS: [&str; 2] = [".git", "result"];

// Re-export public API
use anyhow::{anyhow, Result};
use chrono::Utc;
use log::{debug, error, info, warn};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;
use tools::{create_tools, execute_tool, ToolResult};
pub use types::{Evolution, EvolutionState};

use crate::{
    commands, nix, statistics, store,
    types::{emit_evolve_event, EvolveEvent},
    utils as global_utils,
};
use config_dir_context::format_config_dir_context;
use messages::Message;
use providers::{AiProvider, OllamaProvider, OpenAIProvider, ProviderError};

use self::types::FileEdit;

/// Return short hex prefix for correlation of error messages without risking sensitive content exposure.
fn short_hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())[..8].to_string()
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
        Regex::new(r"(?i)\bstatus(?:Code|_code|:)?\s*[:=]?\s*(\d{3})\b").unwrap()
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

/// Report a ProviderError to Sentry using structured fields (no raw bodies).
/// This is because ProviderError::Http contains the raw response body which may have sensitive info,
/// (in the case of Ollama it definitely includes the prompt and response related to it)
/// so we extract only metadata for Sentry.
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
            sentry::with_scope(
                |scope| {
                    scope.set_tag("provider", provider);
                    scope.set_tag("model", model);
                    scope.set_tag("iteration", iteration.to_string());
                    scope.set_tag("messages_count", messages.len().to_string());
                    scope.set_extra("response_status", (status.as_u16() as u64).into());
                    scope.set_extra("error_length", (body.len() as u64).into());
                    scope.set_extra("error_hash", body_hash.into());
                    sentry::capture_message("AI API HTTP error (redacted)", sentry::Level::Error);
                },
                || {},
            );
        }
        ProviderError::Other(e) => {
            let err_str = format!("{:#}", e);
            // fallback: use parsing extractor to try to pull metadata
            let (status, code, typ, len) = extract_error_metadata(&err_str);
            let hash = short_hash(&err_str);
            sentry::with_scope(
                |scope| {
                    scope.set_tag("provider", provider);
                    scope.set_tag("model", model);
                    scope.set_tag("iteration", iteration.to_string());
                    scope.set_tag("messages_count", messages.len().to_string());
                    if let Some(s) = status {
                        scope.set_extra("response_status", (s as u64).into());
                    }
                    if let Some(c) = code {
                        scope.set_extra("error_code", c.into());
                    }
                    if let Some(t) = typ {
                        scope.set_extra("error_type", t.into());
                    }
                    scope.set_extra("error_length", (len as u64).into());
                    scope.set_extra("error_hash", hash.into());
                    sentry::capture_message("AI API error (redacted)", sentry::Level::Error);
                },
                || {},
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
const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4";
const DEFAULT_OLLAMA_API_BASE: &str = "http://localhost:11434";
const DEFAULT_MAX_BUILD_ATTEMPTS: usize = 5;

// Percentage of max_iterations after which we require at least one edit/build_check.
// Example: with max_iterations=50 and this set to 60, threshold is 30 iterations.
const MAX_ITERATIONS_BEFORE_EDIT_PERCENT: usize = 60;

// Applied separately to stdout and stderr. So when thinking about tokens,
// the effective output limit could be up to double this if both are long.
const BUILD_OUTPUT_MAX_CHARS: usize = 6_000;
const BUILD_OUTPUT_TAIL_LINES: usize = 80;

const SYSTEM_PROMPT: &str = include_str!("../../prompts/system.md");

/// Partial evolution telemetry captured on failed runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionProgress {
    pub state: EvolutionState,
    pub iterations: usize,
    pub build_attempts: usize,
    pub total_tokens: u32,
    pub edits_count: usize,
    pub thinking_count: usize,
    pub tool_calls_count: usize,
}

/// Error for failed evolution generation that still carries partial progress.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct EvolutionRunError {
    pub message: String,
    pub progress: EvolutionProgress,
}

impl EvolutionRunError {
    fn from_state(
        message: impl Into<String>,
        evolution: &Evolution,
        iterations: usize,
        build_attempts: usize,
        total_tokens: u32,
    ) -> Self {
        Self {
            message: message.into(),
            progress: EvolutionProgress {
                state: EvolutionState::Failed,
                iterations,
                build_attempts,
                total_tokens,
                edits_count: evolution.edits.len(),
                thinking_count: evolution.thinking.len(),
                tool_calls_count: evolution.tool_calls.len(),
            },
        }
    }
}

/// Build a short single-line preview from the conversation messages to help with
/// troubleshooting.
fn build_preview(messages: &[Message]) -> String {
    let preview_raw: String = messages
        .iter()
        .rev()
        .filter_map(|m| match m {
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

fn escape_user_query(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Generate an evolution from a user prompt using OpenAI function calling.
///
/// This runs an agentic loop where the model can read files, make edits,
/// and signal completion. When the agent signals "done", we verify the
/// changes by running a nix build check, and send errors back if it fails.
pub async fn generate_evolution(
    app: &AppHandle,
    config_dir: &str,
    prompt: &str,
) -> Result<Evolution> {
    let start_time = chrono::Utc::now().timestamp();

    // Determine provider
    let store_provider = store::get_evolve_provider(app).ok().flatten();
    let provider_type = store_provider
        .or_else(|| std::env::var("EVOLVE_PROVIDER").ok())
        .unwrap_or_else(|| "openai".to_string());

    info!("");
    info!("════════════════════════════════════════════════════════════════");
    info!("EVOLUTION STARTING");
    info!("════════════════════════════════════════════════════════════════");
    info!("Provider: {}", provider_type);
    info!("Config dir: {}", config_dir);
    info!("📝 Prompt: {}", prompt);

    let store_model = store::get_evolve_model(app).ok().flatten();

    // Select provider implementation
    let provider: Arc<dyn AiProvider> = if provider_type == "ollama" {
        let model = store_model
            .or_else(|| std::env::var("EVOLVE_MODEL").ok())
            .unwrap_or_else(|| "qwen3-coder:30b".to_string());
        let base_url = store::get_ollama_api_base_url(app)
            .ok()
            .flatten()
            .or_else(|| std::env::var("OLLAMA_API_BASE").ok())
            .unwrap_or_else(|| DEFAULT_OLLAMA_API_BASE.to_string());
        info!(
            "Using Ollama provider | Model: {} | URL: {}",
            model, base_url
        );
        Arc::new(OllamaProvider::new(base_url, model))
    } else {
        // Init OpenAI / OpenRouter - try OpenRouter key first, then OpenAI key
        let api_key = store::get_openrouter_api_key(app)
            .ok()
            .flatten()
            .or_else(|| {
                info!("OpenRouter key not found, trying OpenAI key from store");
                store::get_openai_api_key(app).ok().flatten()
            })
            .or_else(|| {
                info!("Falling back to OPENROUTER_API_KEY environment variable");
                std::env::var("OPENROUTER_API_KEY").ok()
            })
            .or_else(|| {
                info!("Falling back to OPENAI_API_KEY environment variable");
                std::env::var("OPENAI_API_KEY").ok()
            })
            .ok_or_else(|| {
                anyhow!("No API key found. Please add your API key in Settings to get started.")
            })?;

        let model = store_model
            .or_else(|| std::env::var("EVOLVE_MODEL").ok())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());
        info!("Using OpenRouter provider | Model: {}", model);
        Arc::new(OpenAIProvider::new(
            api_key,
            OPENROUTER_BASE_URL.to_string(),
            model,
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

    // Read configurable limits from store
    let max_iterations = store::get_max_iterations(app).unwrap_or(store::DEFAULT_MAX_ITERATIONS);
    let max_iterations_before_edit = std::cmp::max(
        1,
        (max_iterations * MAX_ITERATIONS_BEFORE_EDIT_PERCENT) / 100,
    );
    let max_build_attempts =
        store::get_max_build_attempts(app).unwrap_or(DEFAULT_MAX_BUILD_ATTEMPTS);
    info!(
        "Limits: max_iterations={}, max_iterations_before_edit={} ({}%), max_build_attempts={}",
        max_iterations,
        max_iterations_before_edit,
        MAX_ITERATIONS_BEFORE_EDIT_PERCENT,
        max_build_attempts
    );

    let tools = create_tools();
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

    info!("Evolution ID: {}", evolution.id);
    info!("════════════════════════════════════════════════════════════════");

    // Initialize conversation with system prompt (inject config values) and user message
    let system_prompt = SYSTEM_PROMPT
        .replace("{{CONFIG_DIR}}", config_dir)
        .replace("{{HOST_ATTR}}", &host_attr);
    let config_dir_context = match format_config_dir_context(config_dir) {
        Ok(tree) => tree,
        Err(e) => {
            warn!(
                "Failed to build config_dir context for prompt ({}): {}",
                config_dir, e
            );
            "(Failed to render config directory tree)".to_string()
        }
    };

    let mut messages: Vec<Message> = vec![
        Message::System {
            content: system_prompt.clone(),
        },
        Message::User {
            content: format!(
                "<user_query>{}</user_query>\n\n<config_dir>\n{}\n</config_dir>\n\nStart by using the 'think' tool to plan your approach.",
                escape_user_query(prompt),
                config_dir_context
            ),
        },
    ];

    // Track whether we've made any actual edits or build checks
    let mut made_edit_or_build_check = false;

    // Agentic loop - let the model use tools until done AND build passes
    loop {
        // Check for cancellation at the start of each iteration
        if commands::is_evolve_cancelled() {
            warn!("⚠️ Evolution cancelled by user");
            evolution.state = EvolutionState::Failed;
            emit_evolve_event(
                app,
                EvolveEvent::error(start_time, Some(iteration), "Evolution cancelled by user", "Evolution cancelled by user"),
            );
            // Track failure
            if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                warn!("Failed to record evolution failure stats: {}", e);
            }
            return Err(EvolutionRunError::from_state(
                "Evolution cancelled by user",
                &evolution,
                iteration,
                build_attempts,
                total_tokens,
            )
            .into());
        }

        iteration += 1;
        info!("────────────────────────────────────────────────────────────────");
        info!(
            "ITERATION {} | messages={} | build_attempts={}/{}",
            iteration,
            messages.len(),
            build_attempts,
            max_build_attempts
        );
        info!("────────────────────────────────────────────────────────────────");

        // Emit iteration event
        emit_evolve_event(
            app,
            EvolveEvent::iteration(start_time, iteration, messages.len()),
        );

        // Capture the messages that most directly drive the agent's next action
        let preview = build_preview(&messages);

        debug!("Sending request to AI provider, preview: {}", preview);
        emit_evolve_event(app, EvolveEvent::api_request(start_time, iteration));

        // Run provider completion inside a short-lived block and select!
        // on it plus a cancellation signal. This lets the future borrow
        // `messages` only for the call so we can mutate `messages` after
        // the block without deep-cloning the conversation.
        let response_result = {
            let fut = provider.completion(&messages, &tools);
            tokio::pin!(fut);

            tokio::select! {
                res = &mut fut => res,
                _ = async {
                    loop {
                        if commands::is_evolve_cancelled() {
                            break;
                        }
                        // consider switching the cancellation mechanism to a tokio::sync::Notify or watch channel and select! directly on that signal instead of polling with sleep
                        sleep(Duration::from_millis(100)).await;
                    }
                } => {
                    warn!("⚠️ Evolution cancelled by user during provider call");
                    evolution.state = EvolutionState::Failed;
                    emit_evolve_event(
                        app,
                        EvolveEvent::error(start_time, Some(iteration), "Evolution cancelled by user", "Evolution cancelled by user"),
                    );
                    // Track failure
                    if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                        warn!("Failed to record evolution failure stats: {}", e);
                    }
                    return Err(EvolutionRunError::from_state(
                        "Evolution cancelled by user",
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
                    &messages,
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
                EvolveEvent::api_response(start_time, iteration, usage.total),
            );
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

        // Add assistant message to history
        messages.push(assistant_msg.clone());

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
                    let args: serde_json::Value =
                        serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));

                    let args_summary = summarize_args(&args);
                    info!("  → {} | args: {}", tool_name, args_summary);

                    // Emit tool call event
                    emit_evolve_event(
                        app,
                        EvolveEvent::tool_call(start_time, iteration, tool_name, &args_summary),
                    );

                    let result = execute_tool(config_dir, host_attr.as_str(), tool_name, &args);

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
                            if tool_name == "edit_file" || tool_name == "build_check" {
                                made_edit_or_build_check = true;
                            }

                            // Emit specific events based on tool result type
                            match res {
                                ToolResult::Think { category, thought } => {
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
                                ToolResult::Continue(_content) => {
                                    if tool_name == "read_file" {
                                        if let Some(path) =
                                            args.get("path").and_then(|v| v.as_str())
                                        {
                                            emit_evolve_event(
                                                app,
                                                EvolveEvent::reading(start_time, iteration, path),
                                            );
                                        }
                                    }
                                }
                                ToolResult::Done(summary_text) => {
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::complete(start_time, iteration, summary_text),
                                    );
                                }
                            }

                            let (msg, break_signal) = match process_tool_result(
                                &tool_call.id,
                                res,
                                &mut evolution,
                                &mut build_verified,
                                &mut build_attempts,
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
                            messages.push(msg);

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
                                EvolveEvent::error(start_time, Some(iteration), &format!("Tool {} failed", tool_name), &e.to_string()),
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

                            messages.push(Message::Tool {
                                tool_call_id: tool_call.id.clone(),
                                content: recovery_message,
                            });
                        }
                    }
                }

                if should_break {
                    break;
                }
            } else {
                info!("Model returned empty tool list");
                // This shouldn't happen if tool_calls is Some, but good to handle
            }
        } else {
            // Model returned content with no tool calls.
            if let Message::Assistant {
                content: Some(content),
                ..
            } = assistant_msg
            {
                if evolution.edits.is_empty() {
                    // No files were changed — this is a conversational reply (e.g. "hi").
                    // Emit the content as the completion event so the UI shows it,
                    // and mark the state so the caller can skip the review workflow.
                    info!("Conversational response (no edits made)");
                    emit_evolve_event(app, EvolveEvent::complete(start_time, iteration, &content));
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

        // Safety limits
        if iteration == max_iterations_before_edit && !made_edit_or_build_check {
            warn!(
                "⚠️ No edit or build_check by iteration {} - agent not making progress",
                max_iterations_before_edit
            );
            evolution.state = EvolutionState::Failed;
            let message = format!(
                "I've analyzed your configuration for {} iterations but haven't started making concrete changes yet. \
This suggests I'm having difficulty understanding what modifications you'd like. \
Could you provide more specific guidance on what aspects of your configuration need adjustment?",
                max_iterations_before_edit
            );
            emit_evolve_event(
                app,
                EvolveEvent::error(start_time, Some(iteration), &message),
            );
            // Track failure
            if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                warn!("Failed to record evolution failure stats: {}", e);
            }
            return Err(EvolutionRunError::from_state(
                message,
                &evolution,
                iteration,
                build_attempts,
                total_tokens,
            )
            .into());
        }

        // Safety limits
        if iteration >= max_iterations {
            warn!(
                "⚠️ Evolution exceeded maximum iterations ({}) - aborting",
                max_iterations
            );
            evolution.state = EvolutionState::Failed;
            emit_evolve_event(
                app,
                EvolveEvent::error(
                    start_time,
                    Some(iteration),
                    &format!("Maximum iterations exceeded ({})", max_iterations),
                    &format!("Maximum iterations exceeded ({})", max_iterations),
                ),
            );
            // Track failure
            if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                warn!("Failed to record evolution failure stats: {}", e);
            }
            return Err(EvolutionRunError::from_state(
                format!("Evolution exceeded maximum iterations ({})", max_iterations),
                &evolution,
                iteration,
                build_attempts,
                total_tokens,
            )
            .into());
        }

        if build_attempts >= max_build_attempts {
            warn!(
                "⚠️ Evolution exceeded maximum build attempts ({}) - aborting",
                max_build_attempts
            );
            evolution.state = EvolutionState::Failed;
            emit_evolve_event(
                app,
                EvolveEvent::error(
                    start_time,
                    Some(iteration),
                    &format!("Failed after {} build attempts", max_build_attempts),
                    &format!("Failed after {} build attempts", max_build_attempts),
                ),
            );
            // Track failure
            if let Err(e) = statistics::record_evolution_failure(app, iteration) {
                warn!("Failed to record evolution failure stats: {}", e);
            }
            return Err(EvolutionRunError::from_state(
                format!(
                    "Failed to produce a valid configuration after {} build attempts",
                    max_build_attempts
                ),
                &evolution,
                iteration,
                build_attempts,
                total_tokens,
            )
            .into());
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

    info!("════════════════════════════════════════════════════════════════");
    info!("EVOLUTION COMPLETE");
    info!("════════════════════════════════════════════════════════════════");
    info!("ID: {}", evolution.id);
    info!("State: {:?}", evolution.state);
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
        ToolResult::Continue(s) => (format!("{} chars", s.len()), true),
        ToolResult::Edit(e) => (format!("edited {}", e.path), true),
        ToolResult::EditSemantic(e) => (format!("semantic edit {} ({:?})", e.path, e.action), true),
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

        ToolResult::Edit(edit) => {
            info!(
                "📝 Edit | path={} | -{} chars, +{} chars",
                edit.path,
                edit.search.len(),
                edit.replace.len()
            );
            evolution.edits.push(edit.clone());
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

            let msg = Message::Tool {
                tool_call_id: tool_call_id.to_string(),
                content:
                    "Semantic edit applied successfully. Remember to run build_check before calling done."
                        .to_string(),
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
                warn!(
                    "❌ BUILD CHECK FAILED (attempt {}/{})",
                    build_attempts, DEFAULT_MAX_BUILD_ATTEMPTS
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
    };

    Ok((message, should_break))
}
