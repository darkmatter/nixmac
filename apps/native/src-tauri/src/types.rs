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

    /// Editing event for semantic nix edits: the summary states the change
    /// itself ("Adding ripgrep to environment.systemPackages") instead of
    /// just the file touched.
    pub(crate) fn editing_semantic(
        start_time: i64,
        iter: usize,
        edit: &crate::evolve::types::SemanticFileEdit,
    ) -> Self {
        use crate::evolve::types::FileEditAction;
        let list = |values: &[String]| truncate(&values.join(", "), 80);
        let summary = match &edit.action {
            FileEditAction::Add { path, values } => {
                format!("Adding {} to {}", list(values), path)
            }
            FileEditAction::Remove { path, values } => {
                format!("Removing {} from {}", list(values), path)
            }
            FileEditAction::Set { path, value } => {
                format!("Setting {} = {}", path, truncate(&value.to_string(), 60))
            }
            FileEditAction::SetAttrs { path, attrs } => {
                let keys: Vec<&str> = attrs.keys().map(String::as_str).collect();
                format!("Configuring {} ({})", path, truncate(&keys.join(", "), 60))
            }
        };
        let action_json =
            serde_json::to_string(&edit.action).unwrap_or_else(|_| format!("{:?}", edit.action));
        Self::new(
            EvolveEventType::Editing,
            format!("Editing file: {} | {}", edit.path, action_json),
            summary,
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

    pub(crate) fn build_fail(start_time: i64, iter: usize, output: &str) -> Self {
        let summary = match first_error_line(output) {
            Some(line) => format!("Build check failed: {}", truncate(line, 120)),
            None => "Build check failed, retrying...".to_string(),
        };
        Self::new(
            EvolveEventType::BuildFail,
            format!("Build check failed: {}", truncate(output, 6000)),
            summary,
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

    pub(crate) fn tool_call(
        start_time: i64,
        iter: usize,
        tool: &str,
        args: &serde_json::Value,
        args_summary: &str,
    ) -> Self {
        // Name the object being acted on, so the row reads as progress toward
        // the user's goal rather than as loop machinery.
        let arg = |key: &str| {
            args.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
        };
        let quoted = |s: &str| format!("'{}'", truncate(s, 60));
        let summary = match tool {
            "read_file" => match arg("path") {
                Some(path) => format!("Reading {}...", shorten_path(path)),
                None => "Reading file...".to_string(),
            },
            "edit_file" | "edit_nix_file" => match arg("path") {
                Some(path) => format!("Editing {}...", shorten_path(path)),
                None => "Editing configuration...".to_string(),
            },
            "list_files" => match arg("pattern") {
                Some(pattern) if pattern != "**/*" => {
                    format!("Listing files matching {}...", quoted(pattern))
                }
                _ => "Listing files...".to_string(),
            },
            "search_code" => match arg("pattern") {
                Some(pattern) => format!("Searching the config for {}...", quoted(pattern)),
                None => "Searching the config...".to_string(),
            },
            "search_packages" => match arg("query") {
                Some(query) => format!("Searching packages for {}...", quoted(query)),
                None => "Searching packages...".to_string(),
            },
            "search_docs" => match arg("query") {
                Some(query) => format!("Searching docs for {}...", quoted(query)),
                None => "Searching docs...".to_string(),
            },
            "ensure_secret" => match arg("name") {
                Some(name) => format!("Setting up secret {}...", quoted(name)),
                None => "Setting up a secret...".to_string(),
            },
            "build_check" => "Checking the configuration builds...".to_string(),
            "think" => "Thinking...".to_string(),
            "ask_user" => "Asking a question...".to_string(),
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

/// First line of build output that looks like the actual error, falling back
/// to the first non-empty line. Nix errors are prefixed with "error:", often
/// preceded by pages of trace/progress noise.
fn first_error_line(output: &str) -> Option<&str> {
    let non_empty = || output.lines().map(str::trim).filter(|l| !l.is_empty());
    non_empty()
        .find(|l| l.to_lowercase().contains("error"))
        .or_else(|| non_empty().next())
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

    #[test]
    fn tool_call_summary_should_name_the_package_query() {
        let args = serde_json::json!({"query": "spotify"});
        let event = EvolveEvent::tool_call(0, 1, "search_packages", &args, "query=\"spotify\"");
        assert_eq!(event.summary, "Searching packages for 'spotify'...");
    }

    #[test]
    fn tool_call_summary_should_name_the_file_being_read() {
        let args = serde_json::json!({"path": "modules/apps.nix"});
        let event = EvolveEvent::tool_call(0, 1, "read_file", &args, "");
        assert_eq!(event.summary, "Reading apps.nix...");
    }

    #[test]
    fn tool_call_summary_should_fall_back_when_arg_missing() {
        let args = serde_json::json!({});
        let event = EvolveEvent::tool_call(0, 1, "search_packages", &args, "");
        assert_eq!(event.summary, "Searching packages...");
    }

    #[test]
    fn tool_call_summary_should_hide_default_list_pattern() {
        let args = serde_json::json!({"pattern": "**/*"});
        let event = EvolveEvent::tool_call(0, 1, "list_files", &args, "");
        assert_eq!(event.summary, "Listing files...");
    }

    #[test]
    fn build_fail_summary_should_surface_the_error_line() {
        let output = "these 3 derivations will be built:\n\nerror: attribute 'spotfy' missing\n   at /flake.nix:12";
        let event = EvolveEvent::build_fail(0, 1, output);
        assert_eq!(
            event.summary,
            "Build check failed: error: attribute 'spotfy' missing"
        );
    }

    #[test]
    fn build_fail_summary_should_fall_back_to_first_line_without_error_marker() {
        let event = EvolveEvent::build_fail(0, 1, "\nsomething went wrong\nmore context");
        assert_eq!(event.summary, "Build check failed: something went wrong");
    }

    #[test]
    fn build_fail_summary_should_keep_generic_text_for_empty_output() {
        let event = EvolveEvent::build_fail(0, 1, "");
        assert_eq!(event.summary, "Build check failed, retrying...");
    }

    #[test]
    fn build_fail_raw_should_carry_full_output() {
        let output = "line one\nerror: boom\nline three";
        let event = EvolveEvent::build_fail(0, 1, output);
        assert_eq!(event.raw, format!("Build check failed: {}", output));
    }

    #[test]
    fn editing_semantic_summary_should_state_the_change() {
        use crate::evolve::types::{FileEditAction, SemanticFileEdit};
        let edit = SemanticFileEdit {
            path: "flake.nix".to_string(),
            action: FileEditAction::Add {
                path: "environment.systemPackages".to_string(),
                values: vec!["ripgrep".to_string()],
            },
        };
        let event = EvolveEvent::editing_semantic(0, 1, &edit);
        assert_eq!(
            event.summary,
            "Adding ripgrep to environment.systemPackages"
        );
        assert!(event.raw.starts_with("Editing file: flake.nix | "));
    }

    #[test]
    fn editing_semantic_summary_should_render_scalar_sets() {
        use crate::evolve::types::{FileEditAction, SemanticFileEdit};
        let edit = SemanticFileEdit {
            path: "flake.nix".to_string(),
            action: FileEditAction::Set {
                path: "services.tailscale.enable".to_string(),
                value: serde_json::json!(true),
            },
        };
        let event = EvolveEvent::editing_semantic(0, 1, &edit);
        assert_eq!(event.summary, "Setting services.tailscale.enable = true");
    }

    #[test]
    fn tool_call_raw_should_keep_tool_and_args() {
        let args = serde_json::json!({"query": "spotify"});
        let event = EvolveEvent::tool_call(0, 1, "search_packages", &args, "query=\"spotify\"");
        assert_eq!(event.raw, "search_packages | args: query=\"spotify\"");
    }
}
