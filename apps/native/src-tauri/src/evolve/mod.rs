//! Evolution module for AI-assisted configuration changes.

mod file_ops;
mod tools;
mod types;

// Re-export public API
pub use types::{Evolution, EvolutionState};

use anyhow::{anyhow, Result};
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use chrono::Utc;
use log::{debug, error, info, warn};
use std::fs::OpenOptions;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager};
use tools::{create_tools, execute_tool, ToolResult};

use crate::{nix, store, types::EvolveEvent};

/// Log API errors to a file for debugging content policy rejections
fn log_api_error(
    error: &str,
    messages: &[ChatCompletionRequestMessage],
    prompt: &str,
    iteration: usize,
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
    let _ = writeln!(file, "Error: {}", error);
    let _ = writeln!(file, "Iteration: {}", iteration);
    let _ = writeln!(file, "Original Prompt: {}", prompt);
    let _ = writeln!(file, "");
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
        let _ = writeln!(file, "");
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

    let _ = writeln!(file, "");
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
}

const DEFAULT_MODEL: &str = "gpt-5.2";
const MAX_TOKENS: u32 = 65_000;
const TEMPERATURE: f32 = 0.2;
const MAX_ITERATIONS: usize = 50;
const MAX_BUILD_ATTEMPTS: usize = 5;
const SYSTEM_PROMPT: &str = include_str!("../../prompts/system.md");
const EVOLVE_EVENT_CHANNEL: &str = "darwin:evolve:event";

/// Additional instructions to encourage thinking
const THINKING_INSTRUCTIONS: &str = r#"

IMPORTANT: You have a 'think' tool available. Use it FREQUENTLY to reason through problems:
1. BEFORE reading files - think about what you need to understand
2. AFTER reading files - analyze what you learned
3. BEFORE making edits - plan your changes carefully
4. WHEN debugging - analyze errors step by step
5. BEFORE calling done - verify your work is complete

Thorough thinking leads to better, more complete implementations. Don't rush."#;

/// Helper to emit evolve events to the frontend
fn emit_evolve_event(app: &AppHandle, event: EvolveEvent) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.emit(EVOLVE_EVENT_CHANNEL, &event) {
            warn!("Failed to emit evolve event: {}", e);
        }
    }
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

    info!("════════════════════════════════════════════════════════════════");
    info!("EVOLUTION STARTING");
    info!("════════════════════════════════════════════════════════════════");
    info!("Model: {}", DEFAULT_MODEL);
    info!("Config dir: {}", config_dir);
    info!("Prompt: {}", prompt);

    // Emit start event
    emit_evolve_event(app, EvolveEvent::start(start_time, DEFAULT_MODEL, prompt));

    // Determine the host for build checking
    let host_attr = nix::determine_host_attr(app)
        .ok_or_else(|| anyhow!("No host attribute configured. Please set a host first."))?;
    info!("Target host: {}", host_attr);

    emit_evolve_event(
        app,
        EvolveEvent::info(start_time, None, &format!("Target host: {}", host_attr)),
    );

    let client = Client::with_config(OpenAIConfig::default());
    let tools = create_tools();
    let mut evolution = Evolution::new(prompt);
    let mut iteration: usize = 0;
    let mut build_attempts: usize = 0;
    let mut build_verified = false;
    let mut total_tokens: u32 = 0;

    info!("Evolution ID: {}", evolution.id);
    info!("════════════════════════════════════════════════════════════════");

    // Initialize conversation with system prompt and user message
    let mut messages: Vec<ChatCompletionRequestMessage> = vec![
        ChatCompletionRequestSystemMessageArgs::default()
            .content(format!("{}{}", SYSTEM_PROMPT, THINKING_INSTRUCTIONS))
            .build()?
            .into(),
        ChatCompletionRequestUserMessageArgs::default()
            .content(format!(
                "{}\n\nNote: The target host configuration is '{}'. Use this for build_check.\n\n\
                 Start by using the 'think' tool to plan your approach.",
                prompt, host_attr
            ))
            .build()?
            .into(),
    ];

    // Agentic loop - let the model use tools until done AND build passes
    loop {
        iteration += 1;
        info!("────────────────────────────────────────────────────────────────");
        info!(
            "ITERATION {} | messages={} | build_attempts={}/{}",
            iteration,
            messages.len(),
            build_attempts,
            MAX_BUILD_ATTEMPTS
        );
        info!("────────────────────────────────────────────────────────────────");

        // Emit iteration event
        emit_evolve_event(
            app,
            EvolveEvent::iteration(start_time, iteration, messages.len()),
        );

        let request = CreateChatCompletionRequestArgs::default()
            .model(DEFAULT_MODEL)
            .messages(messages.clone())
            .tools(tools.clone())
            .max_completion_tokens(MAX_TOKENS)
            .temperature(TEMPERATURE)
            .build()?;

        debug!("Sending request to OpenAI API...");
        emit_evolve_event(app, EvolveEvent::api_request(start_time, iteration));

        let response = client.chat().create(request).await.map_err(|e| {
            let error_str = e.to_string();
            error!("OpenAI API error: {}", error_str);

            // Log full request details to file for debugging content policy issues
            log_api_error(&error_str, &messages, prompt, iteration);

            emit_evolve_event(
                app,
                EvolveEvent::error(start_time, Some(iteration), &error_str),
            );
            e
        })?;

        let choice = response
            .choices
            .first()
            .ok_or_else(|| anyhow!("No response from OpenAI"))?;

        // Track token usage
        if let Some(usage) = &response.usage {
            total_tokens += usage.total_tokens;
            info!(
                "📊 Tokens | this_call: {} (prompt={}, completion={}) | total_session: {}",
                usage.total_tokens, usage.prompt_tokens, usage.completion_tokens, total_tokens
            );
            emit_evolve_event(
                app,
                EvolveEvent::api_response(start_time, iteration, usage.total_tokens),
            );
        }

        // Log assistant text response if any
        if let Some(content) = &choice.message.content {
            info!("💬 Assistant: {}", truncate_for_log(content, 500));
        }

        // Build assistant message based on response content
        let assistant_msg = build_assistant_message(
            choice.message.content.as_deref(),
            choice.message.tool_calls.as_ref(),
        )?;
        messages.push(assistant_msg);

        // Check if model wants to use tools
        if let Some(tool_calls) = &choice.message.tool_calls {
            info!("🔧 Model requested {} tool call(s)", tool_calls.len());
            let mut should_break = false;

            for tool_call in tool_calls {
                let tool_name = &tool_call.function.name;
                let args: serde_json::Value = serde_json::from_str(&tool_call.function.arguments)
                    .unwrap_or(serde_json::json!({}));

                let args_summary = summarize_args(&args);
                info!("  → {} | args: {}", tool_name, args_summary);

                // Emit tool call event
                emit_evolve_event(
                    app,
                    EvolveEvent::tool_call(start_time, iteration, tool_name, &args_summary),
                );

                let result = execute_tool(config_dir, tool_name, &args);

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

                        // Emit specific events based on tool result type
                        match res {
                            ToolResult::Think { category, thought } => {
                                emit_evolve_event(
                                    app,
                                    EvolveEvent::thinking(start_time, iteration, category, thought),
                                );
                            }
                            ToolResult::Edit(edit) => {
                                emit_evolve_event(
                                    app,
                                    EvolveEvent::editing(start_time, iteration, &edit.path),
                                );
                            }
                            ToolResult::BuildResult { success, output } => {
                                if *success {
                                    emit_evolve_event(
                                        app,
                                        EvolveEvent::build_pass(start_time, iteration),
                                    );
                                } else {
                                    let error_preview =
                                        output.lines().take(3).collect::<Vec<_>>().join("\n");
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
                            ToolResult::Continue(content) => {
                                // Check if this was a read_file operation
                                if tool_name == "read_file" {
                                    if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
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

                        let (msg, break_signal) = process_tool_result(
                            &tool_call.id,
                            res,
                            &mut evolution,
                            &mut build_verified,
                            &mut build_attempts,
                            &host_attr,
                            start_time,
                            iteration,
                        )?;
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
                            EvolveEvent::error(start_time, Some(iteration), &e.to_string()),
                        );
                        evolution.add_tool_call(
                            start_time,
                            iteration,
                            tool_name,
                            &args_summary,
                            &format!("ERROR: {}", e),
                            false,
                        );
                        messages.push(ChatCompletionRequestMessage::Tool(
                            async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                                .tool_call_id(&tool_call.id)
                                .content(format!("Error: {}. Please try a different approach.", e))
                                .build()?,
                        ));
                    }
                }
            }

            if should_break {
                break;
            }
        } else {
            info!("Model finished without tool calls");
            if let Some(content) = &choice.message.content {
                evolution.summary = Some(content.clone());
            }
            evolution.state = EvolutionState::Generated;
            break;
        }

        // Safety limits
        if iteration > MAX_ITERATIONS {
            warn!(
                "⚠️ Evolution exceeded maximum iterations ({}) - aborting",
                MAX_ITERATIONS
            );
            emit_evolve_event(
                app,
                EvolveEvent::error(start_time, Some(iteration), "Maximum iterations exceeded"),
            );
            return Err(anyhow!("Evolution exceeded maximum iterations"));
        }

        if build_attempts >= MAX_BUILD_ATTEMPTS {
            warn!(
                "⚠️ Evolution exceeded maximum build attempts ({}) - aborting",
                MAX_BUILD_ATTEMPTS
            );
            emit_evolve_event(
                app,
                EvolveEvent::error(
                    start_time,
                    Some(iteration),
                    &format!("Failed after {} build attempts", MAX_BUILD_ATTEMPTS),
                ),
            );
            return Err(anyhow!(
                "Failed to produce a valid configuration after {} build attempts",
                MAX_BUILD_ATTEMPTS
            ));
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

    Ok(evolution)
}

/// Build an assistant message from optional content and tool calls.
fn build_assistant_message(
    content: Option<&str>,
    tool_calls: Option<&Vec<async_openai::types::ChatCompletionMessageToolCall>>,
) -> Result<ChatCompletionRequestMessage> {
    let msg = match (content, tool_calls) {
        (Some(content), Some(tool_calls)) => ChatCompletionRequestAssistantMessageArgs::default()
            .content(content)
            .tool_calls(tool_calls.clone())
            .build()?
            .into(),
        (Some(content), None) => ChatCompletionRequestAssistantMessageArgs::default()
            .content(content)
            .build()?
            .into(),
        (None, Some(tool_calls)) => ChatCompletionRequestAssistantMessageArgs::default()
            .tool_calls(tool_calls.clone())
            .build()?
            .into(),
        (None, None) => ChatCompletionRequestAssistantMessageArgs::default()
            .build()?
            .into(),
    };
    Ok(msg)
}

/// Truncate string for logging
fn truncate_for_log(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
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
                            if s.len() > 50 {
                                format!("\"{}...\"", &s[..50])
                            } else {
                                format!("\"{}\"", s)
                            }
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
        ToolResult::BuildResult { success, .. } => {
            if *success {
                ("PASSED".to_string(), true)
            } else {
                ("FAILED".to_string(), false)
            }
        }
        ToolResult::Done(s) => (format!("done: {}", truncate_for_log(s, 50)), true),
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
) -> Result<(ChatCompletionRequestMessage, Option<bool>)> {
    let (message, should_break) = match result {
        ToolResult::Think { category, thought } => {
            info!("🧠 THINK [{}]:", category);
            for line in thought.lines() {
                info!("   │ {}", line);
            }
            info!("   └─────────────────────────────────────────");

            evolution.add_thought(start_time, iteration, category, thought);

            let msg = ChatCompletionRequestMessage::Tool(
                async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                    .tool_call_id(tool_call_id)
                    .content("Thought recorded. Continue with your plan.")
                    .build()?,
            );
            (msg, Some(false))
        }

        ToolResult::Continue(content) => {
            debug!("Tool returned {} bytes", content.len());
            let msg = ChatCompletionRequestMessage::Tool(
                async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                    .tool_call_id(tool_call_id)
                    .content(content.clone())
                    .build()?,
            );
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
            let msg = ChatCompletionRequestMessage::Tool(
                async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                    .tool_call_id(tool_call_id)
                    .content(
                        "Edit applied successfully. Remember to run build_check before calling done.",
                    )
                    .build()?,
            );
            (msg, Some(false))
        }

        ToolResult::BuildResult { success, output } => {
            if *success {
                info!("✅ BUILD CHECK PASSED");
                *build_verified = true;
                let msg = ChatCompletionRequestMessage::Tool(
                    async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                        .tool_call_id(tool_call_id)
                        .content(format!(
                            "{}\n\nBuild verified! You may now call 'done' with your summary.",
                            output
                        ))
                        .build()?,
                );
                (msg, Some(false))
            } else {
                *build_attempts += 1;
                warn!(
                    "❌ BUILD CHECK FAILED (attempt {}/{})",
                    build_attempts, MAX_BUILD_ATTEMPTS
                );
                for line in output.lines().take(20) {
                    warn!("   │ {}", line);
                }
                let msg = ChatCompletionRequestMessage::Tool(
                    async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                        .tool_call_id(tool_call_id)
                        .content(format!(
                            "{}\n\nUse the 'think' tool to analyze the error, then fix the issue and run build_check again.",
                            output
                        ))
                        .build()?,
                );
                (msg, Some(false))
            }
        }

        ToolResult::Done(summary) => {
            if *build_verified {
                info!("✅ EVOLUTION COMPLETE (build verified)");
                info!("Summary: {}", summary);
                evolution.summary = Some(summary.clone());
                evolution.state = EvolutionState::Generated;
                let msg = ChatCompletionRequestMessage::Tool(
                    async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                        .tool_call_id(tool_call_id)
                        .content("Evolution complete.")
                        .build()?,
                );
                (msg, Some(true))
            } else if evolution.has_edits() {
                info!("⚠️ Agent called done without build verification");
                let msg = ChatCompletionRequestMessage::Tool(
                    async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                        .tool_call_id(tool_call_id)
                        .content(format!(
                            "Before completing, you must verify your changes compile. \
                             Run build_check with host='{}' to validate, then call done again.",
                            host_attr
                        ))
                        .build()?,
                );
                (msg, None) // Break inner loop, continue outer
            } else {
                info!("✅ EVOLUTION COMPLETE (no edits)");
                info!("Summary: {}", summary);
                evolution.summary = Some(summary.clone());
                evolution.state = EvolutionState::Generated;
                let msg = ChatCompletionRequestMessage::Tool(
                    async_openai::types::ChatCompletionRequestToolMessageArgs::default()
                        .tool_call_id(tool_call_id)
                        .content("Evolution complete.")
                        .build()?,
                );
                (msg, Some(true))
            }
        }
    };

    Ok((message, should_break))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evolution_creation() {
        // create template repo
        let dir = tempfile::tempdir().map_err(|e| anyhow!("Failed to create temp dir: {}", e))?;
        // copy template/minimal
        std::fs::copy("template/minimal", dir.path()).unwrap();
        let config_dir = dir.path().to_str().unwrap();
        std::fs::create_dir_all(config_dir).unwrap();
        assert!(dir.path().join("flake.nix").exists());
    }
}
