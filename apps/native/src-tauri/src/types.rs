//! Shared type definitions for Tauri command responses.
//!
//! These structs are serialized to JSON when returned to the frontend.
//! The `#[serde(rename = "...")]` attributes ensure camelCase naming
//! for JavaScript/TypeScript consumption.

pub(crate) use crate::shared_types::{
    Config, EvolveEvent, EvolveEventType, FeedbackAiProviderModelInfo, FeedbackFlakeInputEntry,
    FeedbackFlakeInputsSnapshot, FeedbackMetadata, FeedbackMetadataRequest, FeedbackSystemInfo,
    FeedbackUsageStats,
};
use crate::utils as global_utils;
use tauri::Manager;

impl EvolveEvent {
    pub(crate) fn new(
        event_type: EvolveEventType,
        raw: impl Into<String>,
        summary: impl Into<String>,
        iteration: Option<usize>,
        start_time: i64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            raw: raw.into(),
            summary: summary.into(),
            event_type,
            iteration,
            timestamp_ms: now - (start_time * 1000),
        }
    }

    pub(crate) fn start(start_time: i64, model: &str, prompt: &str) -> Self {
        Self::new(
            EvolveEventType::Start,
            format!(
                "Starting evolution with model {} for prompt: {}",
                model, prompt
            ),
            "Starting AI evolution...".to_string(),
            None,
            start_time,
        )
    }

    pub(crate) fn iteration(start_time: i64, iter: usize, messages_count: usize) -> Self {
        Self::new(
            EvolveEventType::Iteration,
            format!("Iteration {} | messages={}", iter, messages_count),
            format!("Processing iteration {}...", iter),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn thinking(start_time: i64, iter: usize, category: &str, thought: &str) -> Self {
        let summary = match category {
            "planning" => "Planning approach...",
            "analysis" => "Analyzing the codebase...",
            "debugging" => "Debugging an issue...",
            "verification" => "Verifying changes...",
            _ => "Thinking...",
        };
        Self::new(
            EvolveEventType::Thinking,
            format!("[{}] {}", category, truncate(thought, 200)),
            summary.to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn reading(start_time: i64, iter: usize, path: &str) -> Self {
        Self::new(
            EvolveEventType::Reading,
            format!("Reading file: {}", path),
            format!("Reading {}", shorten_path(path)),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn editing(start_time: i64, iter: usize, path: &str) -> Self {
        Self::new(
            EvolveEventType::Editing,
            format!("Editing file: {}", path),
            format!("Editing {}", shorten_path(path)),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn build_pass(start_time: i64, iter: usize) -> Self {
        Self::new(
            EvolveEventType::BuildPass,
            "Build check passed".to_string(),
            "Build check passed ✓".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn build_fail(start_time: i64, iter: usize, error_preview: &str) -> Self {
        Self::new(
            EvolveEventType::BuildFail,
            format!("Build check failed: {}", error_preview),
            "Build check failed, retrying...".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn search_packages(start_time: i64, iter: usize, packages: &str) -> Self {
        Self::new(
            EvolveEventType::SearchPackages,
            format!("Found packages: {}", packages),
            format!("Found packages: {}", packages),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn tool_call(start_time: i64, iter: usize, tool: &str, args_summary: &str) -> Self {
        let summary = match tool {
            "read_file" => "Reading file...".to_string(),
            "edit_file" => "Editing file...".to_string(),
            "edit_nix_file" => "Editing nix config...".to_string(),
            "list_files" => "Listing files...".to_string(),
            "search_code" => "Searching code...".to_string(),
            "search_packages" => "Searching packages...".to_string(),
            "search_docs" => "Searching docs...".to_string(),
            "build_check" => "Running build check...".to_string(),
            "think" => "Thinking...".to_string(),
            "ask_user" => "Asking a question...".to_string(),
            "ensure_secret" => "Ensuring secret exists...".to_string(),
            "done" => "Finishing up...".to_string(),
            _ => format!("Using {} tool...", tool),
        };
        Self::new(
            EvolveEventType::ToolCall,
            format!("{} | args: {}", tool, args_summary),
            summary,
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn api_request(start_time: i64, iter: usize) -> Self {
        Self::new(
            EvolveEventType::ApiRequest,
            "Sending request to AI provider".to_string(),
            "Querying AI model...".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn api_response(
        start_time: i64,
        iter: usize,
        tokens: u32,
        total_tokens: u32,
        max_token_budget: u32,
    ) -> Self {
        Self::new(
            EvolveEventType::ApiResponse,
            format!(
                "Received response | tokens used: {} | total tokens: {} / {}",
                tokens, total_tokens, max_token_budget
            ),
            format!("Received AI response ({} tokens)", tokens),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn complete(start_time: i64, iter: usize, summary_text: &str) -> Self {
        Self::new(
            EvolveEventType::Complete,
            format!("Evolution complete: {}", summary_text),
            "Evolution complete!".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn error(start_time: i64, iter: Option<usize>, summary: &str, raw: &str) -> Self {
        let mut summary = summary.to_string();
        global_utils::truncate_utf8(&mut summary, 100);
        Self::new(
            EvolveEventType::Error,
            format!("Error: {}", raw),
            format!("Error: {}", summary),
            iter,
            start_time,
        )
    }

    pub(crate) fn info(start_time: i64, iter: Option<usize>, message: &str) -> Self {
        Self::new(
            EvolveEventType::Info,
            message.to_string(),
            message.to_string(),
            iter,
            start_time,
        )
    }

    pub(crate) fn question(
        start_time: i64,
        iter: usize,
        question: &str,
        choices: &Option<Vec<String>>,
    ) -> Self {
        let raw = match choices {
            Some(c) => format!("{}\nChoices: {}", question, c.join(", ")),
            None => question.to_string(),
        };
        Self::new(
            EvolveEventType::Question,
            raw,
            question.to_string(),
            Some(iter),
            start_time,
        )
    }

    pub(crate) fn analyzing(start_time: i64, iter: Option<usize>) -> Self {
        Self::new(
            EvolveEventType::Summarizing,
            "Analyzing changes...".to_string(),
            "Analyzing changes...".to_string(),
            iter,
            start_time,
        )
    }
}

/// Truncate a string to max length with ellipsis
fn truncate(s: &str, max_len: usize) -> String {
    global_utils::truncate_with_ellipsis(s, max_len)
}

/// Shorten a file path to just the filename or last path component
fn shorten_path(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Event channel for evolve events
pub(crate) const EVOLVE_EVENT_CHANNEL: &str = "darwin:evolve:event";

/// Helper to emit evolve events to the frontend
pub(crate) fn emit_evolve_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: EvolveEvent) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = tauri::Emitter::emit(&window, EVOLVE_EVENT_CHANNEL, &event) {
            log::warn!("Failed to emit evolve event: {}", e);
        }
    }
}
