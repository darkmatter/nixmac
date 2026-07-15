//! Shared type definitions for Tauri command responses.
//!
//! These structs are serialized to JSON when returned to the frontend.
//! The `#[serde(rename = "...")]` attributes ensure camelCase naming
//! for JavaScript/TypeScript consumption.

pub(crate) use crate::shared_types::{
    Config, EvolutionTelemetry, EvolveEvent, EvolveEventType, FeedbackAiProviderModelInfo,
    FeedbackFlakeInputEntry, FeedbackFlakeInputsSnapshot, FeedbackMetadata,
    FeedbackMetadataRequest, FeedbackSystemInfo, FeedbackUsageStats,
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
            telemetry: None,
            conversational_response: None,
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
        let summary = if thought.trim().is_empty() {
            match category {
                "planning" => "Planning approach...",
                "analysis" => "Analyzing the codebase...",
                "debugging" => "Debugging an issue...",
                "verification" => "Verifying changes...",
                _ => "Thinking...",
            }
            .to_string()
        } else {
            truncate(first_sentence(thought), 100)
        };
        Self::new(
            EvolveEventType::Thinking,
            format!("[{}] {}", category, truncate(thought, 2000)),
            summary,
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

    /// Terminal completion event. Emitted once per successful run, after the
    /// lifecycle has updated every state cell, carrying the run's result data.
    pub(crate) fn complete(
        start_time: i64,
        iter: usize,
        summary_text: &str,
        telemetry: EvolutionTelemetry,
        conversational_response: Option<String>,
    ) -> Self {
        Self {
            telemetry: Some(telemetry),
            conversational_response,
            ..Self::new(
                EvolveEventType::Complete,
                format!("Evolution complete: {}", summary_text),
                "Evolution complete!".to_string(),
                Some(iter),
                start_time,
            )
        }
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
            Some(c) => {
                let choices_json = serde_json::to_string(c).unwrap_or_else(|_| "[]".to_string());
                format!(
                    "{}\nChoicesJson: {}\nChoices: {}",
                    question,
                    choices_json,
                    c.join(", ")
                )
            }
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

/// First sentence of a free-form text: up to the first line break or
/// sentence-ending punctuation followed by whitespace.
fn first_sentence(text: &str) -> &str {
    let trimmed = text.trim();
    let end = trimmed
        .char_indices()
        .find_map(|(i, c)| match c {
            '\n' => Some(i),
            '.' | '!' | '?' => {
                let rest = &trimmed[i + c.len_utf8()..];
                rest.chars()
                    .next()
                    .is_none_or(char::is_whitespace)
                    .then_some(i + c.len_utf8())
            }
            _ => None,
        })
        .unwrap_or(trimmed.len());
    trimmed[..end].trim_end()
}

/// Shorten a file path to just the filename or last path component
fn shorten_path(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Event channel for evolve events
pub(crate) const EVOLVE_EVENT_CHANNEL: &str = "darwin:evolve:event";

/// Helper to emit evolve events to the frontend
pub(crate) fn emit_evolve_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: EvolveEvent) {
    // Append to the session transcript if an evolution is currently recording.
    if let Some(path) = crate::state::session_log::active_session_path() {
        let event_json = serde_json::to_value(&event).unwrap_or_default();
        // Fire-and-forget: emit_evolve_event always runs inside the async evolve loop.
        tokio::spawn(async move {
            crate::state::session_log::append_event(&path, "evolve_event", &event_json).await;
        });
    }

    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = tauri::Emitter::emit(&window, EVOLVE_EVENT_CHANNEL, &event) {
            log::warn!("Failed to emit evolve event: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinking_summary_should_be_first_sentence_of_thought() {
        let event = EvolveEvent::thinking(
            0,
            1,
            "planning",
            "The user wants spotify. I'll search nixpkgs first.",
        );
        assert_eq!(event.summary, "The user wants spotify.");
    }

    #[test]
    fn thinking_summary_should_stop_at_line_break() {
        let event = EvolveEvent::thinking(0, 1, "analysis", "Check homebrew section\nthen edit");
        assert_eq!(event.summary, "Check homebrew section");
    }

    #[test]
    fn thinking_summary_should_not_split_inside_version_numbers() {
        let event = EvolveEvent::thinking(0, 1, "analysis", "Pin nixpkgs to 24.05 for stability");
        assert_eq!(event.summary, "Pin nixpkgs to 24.05 for stability");
    }

    #[test]
    fn thinking_summary_should_clamp_long_sentences() {
        let event = EvolveEvent::thinking(0, 1, "planning", &"word ".repeat(100));
        // truncate() clamps to 100 bytes plus the "..." ellipsis
        assert!(event.summary.len() <= 103);
        assert!(event.summary.ends_with("..."));
    }

    #[test]
    fn thinking_summary_should_fall_back_to_category_when_thought_empty() {
        let event = EvolveEvent::thinking(0, 1, "debugging", "  ");
        assert_eq!(event.summary, "Debugging an issue...");
    }

    #[test]
    fn thinking_raw_should_keep_category_prefix() {
        let event = EvolveEvent::thinking(0, 1, "planning", "Some thought.");
        assert_eq!(event.raw, "[planning] Some thought.");
    }
}
