//! Log summarizer for rebuild output.
//!
//! This module provides AI-powered log summarization that:
//! - Buffers incoming raw log lines
//! - Every ~500ms, summarizes buffered lines into a friendly status message
//! - Emits summarized logs for smooth UI animations
//!
//! This solves timing issues where raw logs come in bursts causing janky animations.

use anyhow::Result;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use log::{debug, info, warn};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Fast model for log summarization - needs to be very quick
const LOG_MODEL: &str = "gpt-4.1-nano";
const MAX_TOKENS: u32 = 100;
const TEMPERATURE: f32 = 0.2;

/// Interval between summarized log emissions
const EMIT_INTERVAL_MS: u64 = 500;

/// Maximum number of lines to include in a single summarization request
const MAX_LINES_PER_BATCH: usize = 50;

/// Handle for sending logs to the summarizer
#[derive(Clone)]
pub struct LogSummarizerHandle {
    tx: Sender<LogMessage>,
}

#[derive(Debug)]
enum LogMessage {
    Line(String),
    Complete { success: bool },
}

impl LogSummarizerHandle {
    /// Send a raw log line to the summarizer
    pub fn send_line(&self, line: &str) {
        let _ = self.tx.send(LogMessage::Line(line.to_string()));
    }

    /// Signal that the rebuild is complete
    pub fn complete(&self, success: bool) {
        let _ = self.tx.send(LogMessage::Complete { success });
    }
}

/// Represents the current phase of the rebuild process
#[derive(Debug, Clone, PartialEq)]
enum RebuildPhase {
    Starting,
    Evaluating,
    Downloading,
    Building,
    Activating,
    Complete,
    Error,
}

/// Detected error type for special handling
#[derive(Debug, Clone, PartialEq)]
enum DetectedError {
    None,
    InfiniteRecursion,
    EvaluationError,
    BuildError,
    GenericError,
}

impl DetectedError {
    /// Convert to frontend-compatible string
    fn as_str(&self) -> Option<&'static str> {
        match self {
            DetectedError::None => None,
            DetectedError::InfiniteRecursion => Some("infinite_recursion"),
            DetectedError::EvaluationError => Some("evaluation_error"),
            DetectedError::BuildError => Some("build_error"),
            DetectedError::GenericError => Some("generic_error"),
        }
    }
}

impl RebuildPhase {
    fn from_logs(lines: &[String]) -> Self {
        // Look at recent lines to determine phase
        for line in lines.iter().rev().take(10) {
            let lower = line.to_lowercase();

            // Check for error conditions first
            if lower.contains("infinite recursion") || lower.contains("maximum call depth exceeded")
            {
                return RebuildPhase::Error;
            }
            if lower.contains("error:") && lower.contains("evaluation") {
                return RebuildPhase::Error;
            }
            if lower.contains("build failed") || lower.contains("builder failed") {
                return RebuildPhase::Error;
            }

            if lower.contains("activating") || lower.contains("setting up") {
                return RebuildPhase::Activating;
            }
            if lower.contains("building") || lower.contains("compiling") {
                return RebuildPhase::Building;
            }
            if lower.contains("copying")
                || lower.contains("downloading")
                || lower.contains("fetching")
            {
                return RebuildPhase::Downloading;
            }
            if lower.contains("evaluating") || lower.contains("evaluation") {
                return RebuildPhase::Evaluating;
            }
        }
        RebuildPhase::Starting
    }

    fn as_emoji(&self) -> &'static str {
        match self {
            RebuildPhase::Starting => "🚀",
            RebuildPhase::Evaluating => "🔍",
            RebuildPhase::Downloading => "📦",
            RebuildPhase::Building => "🔨",
            RebuildPhase::Activating => "⚡",
            RebuildPhase::Complete => "✅",
            RebuildPhase::Error => "❌",
        }
    }
}

/// Detect specific error types from log lines
fn detect_error_type(lines: &[String]) -> DetectedError {
    for line in lines.iter().rev().take(50) {
        let lower = line.to_lowercase();

        if lower.contains("infinite recursion")
            || lower.contains("maximum call depth exceeded")
            || lower.contains("stack overflow")
        {
            return DetectedError::InfiniteRecursion;
        }
        if lower.contains("error:") && lower.contains("evaluation") {
            return DetectedError::EvaluationError;
        }
        if lower.contains("build failed") || lower.contains("builder failed") {
            return DetectedError::BuildError;
        }
        if lower.contains("error:") {
            return DetectedError::GenericError;
        }
    }
    DetectedError::None
}

/// State for the summarizer background task
struct SummarizerState {
    lines_buffer: Vec<String>,
    all_lines: Vec<String>, // Keep all lines for error detection
    last_summary: Option<String>,
    last_phase: RebuildPhase,
    detected_error: DetectedError,
    error_emitted: bool,
}

impl SummarizerState {
    fn new() -> Self {
        Self {
            lines_buffer: Vec::new(),
            all_lines: Vec::new(),
            last_summary: None,
            last_phase: RebuildPhase::Starting,
            detected_error: DetectedError::None,
            error_emitted: false,
        }
    }

    /// Drain the buffer and return lines for summarization
    fn drain_buffer(&mut self) -> Vec<String> {
        self.lines_buffer.drain(..).collect()
    }

    /// Get a friendly error message for the detected error type
    fn get_error_message(&self) -> Option<String> {
        match self.detected_error {
            DetectedError::None => None,
            DetectedError::InfiniteRecursion => {
                Some("Infinite recursion detected in Nix configuration".to_string())
            }
            DetectedError::EvaluationError => {
                Some("Error evaluating Nix configuration".to_string())
            }
            DetectedError::BuildError => Some("Build failed".to_string()),
            DetectedError::GenericError => Some("An error occurred during rebuild".to_string()),
        }
    }
}

/// Start the log summarizer background thread
///
/// Returns a handle that can be used to send log lines to the summarizer.
/// The summarizer will emit `darwin:apply:summary` events with friendly status messages.
pub fn start(app: AppHandle) -> LogSummarizerHandle {
    let (tx, rx) = mpsc::channel::<LogMessage>();

    // Spawn the background thread with its own tokio runtime for async AI calls
    thread::spawn(move || {
        summarizer_thread(app, rx);
    });

    LogSummarizerHandle { tx }
}

/// Background thread that processes log lines and emits summaries
fn summarizer_thread(app: AppHandle, rx: Receiver<LogMessage>) {
    // Create a tokio runtime for async AI calls
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            warn!("[log_summarizer] Failed to create tokio runtime: {}", e);
            return;
        }
    };

    // Get API key from store at startup (fall back to env var)
    let api_key = crate::store::get_openai_api_key(&app)
        .ok()
        .flatten()
        .or_else(|| std::env::var("OPENAI_API_KEY").ok());

    let state = Arc::new(Mutex::new(SummarizerState::new()));

    // Emit initial "starting" message
    let _ = app.emit(
        "darwin:apply:summary",
        serde_json::json!({"text": "🚀 Starting system rebuild..."}),
    );

    let mut last_emit = Instant::now();
    let emit_interval = Duration::from_millis(EMIT_INTERVAL_MS);

    loop {
        // Use recv_timeout to periodically check for messages and emit summaries
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(LogMessage::Line(line)) => {
                let mut state = state.lock().unwrap();
                state.lines_buffer.push(line.clone());
                state.all_lines.push(line);
                // Keep all_lines bounded to prevent memory issues
                if state.all_lines.len() > 1000 {
                    state.all_lines.drain(0..500);
                }
            }
            Ok(LogMessage::Complete { success }) => {
                // Emit final summary with error type if applicable
                let emoji = if success { "✅" } else { "❌" };
                let status = if success {
                    "completed successfully"
                } else {
                    "failed"
                };

                // Get error type from state if build failed
                let error_type_str = if !success {
                    let state = state.lock().unwrap();
                    state.detected_error.as_str()
                } else {
                    None
                };

                let _ = app.emit(
                    "darwin:apply:summary",
                    serde_json::json!({
                        "text": format!("{} System rebuild {}", emoji, status),
                        "complete": true,
                        "success": success,
                        "error_type": error_type_str
                    }),
                );
                info!("[log_summarizer] Thread completed");
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Check if it's time to emit a summary
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                info!("[log_summarizer] Channel disconnected, exiting");
                break;
            }
        }

        // Check if we should emit a summary
        if last_emit.elapsed() >= emit_interval {
            let mut state = state.lock().unwrap();

            if !state.lines_buffer.is_empty() {
                let lines = state.drain_buffer();

                // Check for errors in recent output
                let error_type = detect_error_type(&state.all_lines);
                if error_type != DetectedError::None && !state.error_emitted {
                    state.detected_error = error_type;
                    state.error_emitted = true;

                    // Emit error summary immediately
                    if let Some(error_msg) = state.get_error_message() {
                        warn!("[log_summarizer] Detected error: {}", error_msg);
                        let error_type_str = state.detected_error.as_str();
                        let _ = app.emit(
                            "darwin:apply:summary",
                            serde_json::json!({
                                "text": format!("❌ {}", error_msg),
                                "error": true,
                                "error_type": error_type_str
                            }),
                        );
                    }
                    state.last_phase = RebuildPhase::Error;
                    last_emit = Instant::now();
                    continue;
                }

                // Update phase based on content
                let current_phase = RebuildPhase::from_logs(&lines);

                // Skip AI summarization if we already detected an error
                if state.detected_error != DetectedError::None {
                    last_emit = Instant::now();
                    continue;
                }

                // Generate summary (use tokio runtime for async)
                let summary = rt.block_on(generate_log_summary(&lines, &current_phase, api_key.as_deref()));

                match summary {
                    Ok(text) => {
                        // Only emit if different from last summary
                        if state.last_summary.as_ref() != Some(&text)
                            || state.last_phase != current_phase
                        {
                            state.last_summary = Some(text.clone());
                            state.last_phase = current_phase.clone();
                            let emoji = current_phase.as_emoji();
                            let _ = app.emit(
                                "darwin:apply:summary",
                                serde_json::json!({"text": format!("{} {}", emoji, text)}),
                            );
                        }
                    }
                    Err(e) => {
                        warn!("[log_summarizer] Summarization failed: {}", e);
                        // Fall back to a heuristic summary
                        let fallback = generate_fallback_summary(&lines, &current_phase);
                        if state.last_summary.as_ref() != Some(&fallback)
                            || state.last_phase != current_phase
                        {
                            state.last_summary = Some(fallback.clone());
                            state.last_phase = current_phase.clone();
                            let emoji = current_phase.as_emoji();
                            let _ = app.emit(
                                "darwin:apply:summary",
                                serde_json::json!({"text": format!("{} {}", emoji, fallback)}),
                            );
                        }
                    }
                }
            }

            last_emit = Instant::now();
        }
    }
}

/// Generate a summary of the log lines using AI
async fn generate_log_summary(lines: &[String], phase: &RebuildPhase, api_key: Option<&str>) -> Result<String> {
    if lines.is_empty() {
        return Ok("Processing...".to_string());
    }

    // Use provided API key, fall back to environment variable
    let key = api_key
        .map(|k| k.to_string())
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or_else(|| anyhow::anyhow!("No OpenAI API key configured"))?;

    let config = OpenAIConfig::new().with_api_key(&key);
    let client = Client::with_config(config);

    // Take the most recent lines, limiting to MAX_LINES_PER_BATCH
    let recent_lines: Vec<&String> = lines.iter().rev().take(MAX_LINES_PER_BATCH).collect();
    let log_content = recent_lines
        .iter()
        .rev()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let phase_hint = match phase {
        RebuildPhase::Starting => "The rebuild is starting",
        RebuildPhase::Evaluating => "Nix is evaluating the configuration",
        RebuildPhase::Downloading => "Downloading packages from cache",
        RebuildPhase::Building => "Building derivations locally",
        RebuildPhase::Activating => "Activating the new system configuration",
        RebuildPhase::Complete => "Rebuild complete",
        RebuildPhase::Error => "An error has occurred",
    };

    let system_prompt = format!(
        r#"You are a log summarizer for a Nix system rebuild process. {} currently.

Your task is to produce a SINGLE SHORT sentence (max 10 words) that describes what's happening right now.

Guidelines:
- Be specific about what package/component is being processed if visible
- Use friendly, non-technical language when possible
- Examples: "Installing neovim text editor", "Fetching Firefox browser", "Configuring shell environment"
- Keep it under 10 words
- Don't include technical hashes or paths
- Output ONLY the summary sentence, nothing else"#,
        phase_hint
    );

    let request = CreateChatCompletionRequestArgs::default()
        .model(LOG_MODEL)
        .messages(vec![
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt)
                .build()?
                .into(),
            ChatCompletionRequestUserMessageArgs::default()
                .content(format!("Summarize this rebuild output:\n\n{}", log_content))
                .build()?
                .into(),
        ])
        .max_completion_tokens(MAX_TOKENS)
        .temperature(TEMPERATURE)
        .build()?;

    debug!("[log_summarizer] Requesting summary from {}", LOG_MODEL);
    let response = client.chat().create(request).await?;

    let summary = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Processing...".to_string());

    debug!("[log_summarizer] Generated summary: {}", summary);
    Ok(summary)
}

/// Generate a fallback summary when AI is unavailable
fn generate_fallback_summary(lines: &[String], phase: &RebuildPhase) -> String {
    // Try to extract a meaningful name from the logs
    for line in lines.iter().rev() {
        // Look for package names in common formats
        if let Some(name) = extract_package_name(line) {
            return match phase {
                RebuildPhase::Downloading => format!("Downloading {}", name),
                RebuildPhase::Building => format!("Building {}", name),
                RebuildPhase::Activating => format!("Activating {}", name),
                _ => format!("Processing {}", name),
            };
        }
    }

    // Generic fallback based on phase
    match phase {
        RebuildPhase::Starting => "Starting rebuild...".to_string(),
        RebuildPhase::Evaluating => "Evaluating configuration...".to_string(),
        RebuildPhase::Downloading => "Downloading packages...".to_string(),
        RebuildPhase::Building => "Building components...".to_string(),
        RebuildPhase::Activating => "Activating system...".to_string(),
        RebuildPhase::Complete => "Rebuild complete".to_string(),
        RebuildPhase::Error => "Error occurred during rebuild".to_string(),
    }
}

/// Try to extract a package name from a log line
fn extract_package_name(line: &str) -> Option<String> {
    // Pattern: /nix/store/xxxxx-packagename-version/...
    if let Some(start) = line.find("/nix/store/") {
        let after_store = &line[start + 11..];
        // Skip the hash (32 chars + dash)
        if after_store.len() > 33 {
            let after_hash = &after_store[33..];
            // Extract until next slash or end
            let name = after_hash.split('/').next().unwrap_or("");
            // Remove version suffix if present
            if !name.is_empty() {
                // Find the package name (before version numbers)
                let parts: Vec<&str> = name.split('-').collect();
                // Take parts until we hit a numeric version
                let name_parts: Vec<&str> = parts
                    .iter()
                    .take_while(|p| !p.chars().next().map(|c| c.is_numeric()).unwrap_or(false))
                    .copied()
                    .collect();

                if !name_parts.is_empty() {
                    let clean_name = name_parts.join("-");
                    if clean_name.len() > 2 {
                        return Some(clean_name);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_package_name() {
        assert_eq!(
            extract_package_name(
                "copying path '/nix/store/abc123xyz789abc123xyz789abc123xy-neovim-0.9.5/bin/nvim'"
            ),
            Some("neovim".to_string())
        );

        assert_eq!(
            extract_package_name(
                "building '/nix/store/abc123xyz789abc123xyz789abc123xy-firefox-120.0.drv'"
            ),
            Some("firefox".to_string())
        );
    }

    #[test]
    fn test_rebuild_phase_detection() {
        let downloading = vec!["copying path '/nix/store/...'".to_string()];
        assert_eq!(
            RebuildPhase::from_logs(&downloading),
            RebuildPhase::Downloading
        );

        let building = vec!["building '/nix/store/...'".to_string()];
        assert_eq!(RebuildPhase::from_logs(&building), RebuildPhase::Building);

        let activating = vec!["activating system configuration...".to_string()];
        assert_eq!(
            RebuildPhase::from_logs(&activating),
            RebuildPhase::Activating
        );
    }
}
