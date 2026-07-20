//! Shared type definitions for Tauri command responses.
//!
//! These structs are serialized to JSON when returned to the frontend.
//! The `#[serde(rename = "...")]` attributes ensure camelCase naming
//! for JavaScript/TypeScript consumption.

pub(crate) use crate::shared_types::{
    Config, EvolutionTelemetry, EvolveEvent, EvolveEventDetail, EvolveEventType,
    FeedbackAiProviderModelInfo, FeedbackFlakeInputEntry, FeedbackFlakeInputsSnapshot,
    FeedbackMetadata, FeedbackMetadataRequest, FeedbackSystemInfo, FeedbackUsageStats,
    QuestionKind,
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
            detail: None,
            telemetry: None,
            conversational_response: None,
        }
    }

    fn with_detail(mut self, detail: EvolveEventDetail) -> Self {
        self.detail = Some(detail);
        self
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
        .with_detail(EvolveEventDetail::Thinking {
            category: category.to_string(),
            text: thought.to_string(),
        })
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
        .with_detail(EvolveEventDetail::Edit {
            file: path.to_string(),
            action: None,
        })
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
        .with_detail(EvolveEventDetail::Edit {
            file: edit.path.clone(),
            action: Some(edit.action.clone()),
        })
    }

    /// A streamed chunk of build-check output. `raw` carries the chunk so
    /// the Console mirror and session transcripts get the log; the timeline
    /// renders it as the active row's log tail instead of as rows.
    pub(crate) fn build_output(start_time: i64, iter: usize, chunk: &str) -> Self {
        Self::new(
            EvolveEventType::BuildCheck,
            chunk.to_string(),
            "Checking the configuration builds...".to_string(),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::BuildOutput {
            chunk: chunk.to_string(),
        })
    }

    /// A streamed slice of the assistant response being generated. `raw`
    /// carries the delta so the Console mirror and session transcripts see
    /// the text as it arrives; the timeline renders the accumulated tail in
    /// the active row instead of as rows.
    pub(crate) fn stream_delta(start_time: i64, iter: usize, text: &str) -> Self {
        Self::new(
            EvolveEventType::StreamDelta,
            text.to_string(),
            "Thinking...".to_string(),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::StreamDelta {
            text: text.to_string(),
        })
    }

    /// The provider abandoned a partial streamed response and is retrying;
    /// marks where the visible stream tail restarts. Deltas before this
    /// marker belong to the discarded attempt (kept in the Console and
    /// transcripts for diagnostics).
    pub(crate) fn stream_reset(start_time: i64, iter: usize) -> Self {
        Self::new(
            EvolveEventType::StreamDelta,
            "Response interrupted; retrying...".to_string(),
            "Retrying...".to_string(),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::StreamReset)
    }

    pub(crate) fn build_pass(start_time: i64, iter: usize, attempt: usize) -> Self {
        Self::new(
            EvolveEventType::BuildPass,
            "Build check passed".to_string(),
            "Build check passed ✓".to_string(),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::Build {
            pass: true,
            attempt,
            output: String::new(),
        })
    }

    pub(crate) fn build_fail(start_time: i64, iter: usize, attempt: usize, output: &str) -> Self {
        let summary = match first_error_line(output) {
            Some(line) => format!("Build check failed: {}", truncate(line, 120)),
            None => "Build check failed, retrying...".to_string(),
        };
        let output_tail = build_output_tail(output, 6000);
        Self::new(
            EvolveEventType::BuildFail,
            format!("Build check failed: {}", truncate(output_tail, 6000)),
            summary,
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::Build {
            pass: false,
            attempt,
            output: truncate(output_tail, 6000),
        })
    }

    pub(crate) fn search_packages(
        start_time: i64,
        iter: usize,
        query: &str,
        found: &[String],
    ) -> Self {
        const SHOWN: usize = 3;
        let for_query = if query.is_empty() {
            String::new()
        } else {
            format!(" for '{}'", truncate(query, 60))
        };
        let summary = if found.is_empty() {
            format!("Searched packages{} — no matches", for_query)
        } else {
            let shown = found
                .iter()
                .take(SHOWN)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(", ");
            let more = found.len().saturating_sub(SHOWN);
            if more > 0 {
                format!("Searched packages{} → {} +{} more", for_query, shown, more)
            } else {
                format!("Searched packages{} → {}", for_query, shown)
            }
        };
        Self::new(
            EvolveEventType::SearchPackages,
            format!(
                "Searched packages{}; found {}: {}",
                for_query,
                found.len(),
                found.join(", ")
            ),
            summary,
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::SearchPackages {
            query: query.to_string(),
            found: found.to_vec(),
        })
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
        let with_object = match tool {
            "read_file" => arg("path").map(|path| format!("Reading {}...", shorten_path(path))),
            "edit_file" | "edit_nix_file" => {
                arg("path").map(|path| format!("Editing {}...", shorten_path(path)))
            }
            "list_files" => arg("pattern")
                .filter(|pattern| *pattern != "**/*")
                .map(|pattern| format!("Listing files matching {}...", quoted(pattern))),
            "search_code" => {
                arg("pattern").map(|p| format!("Searching the config for {}...", quoted(p)))
            }
            "search_packages" => {
                arg("query").map(|q| format!("Searching packages for {}...", quoted(q)))
            }
            "search_docs" => arg("query").map(|q| format!("Searching docs for {}...", quoted(q))),
            "ensure_secret" => {
                arg("name").map(|name| format!("Setting up secret {}...", quoted(name)))
            }
            _ => None,
        };
        let summary = with_object
            .or_else(|| tool_action_label(tool))
            // Only `think` has no action label; its summary is its thought.
            .unwrap_or_else(|| "Thinking...".to_string());
        Self::new(
            EvolveEventType::ToolCall,
            format!("{} | args: {}", tool, args_summary),
            summary,
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::ToolCall {
            tool: tool.to_string(),
            args: args.clone(),
        })
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
        max_iterations: usize,
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
        .with_detail(EvolveEventDetail::Progress {
            tokens: total_tokens,
            budget: max_token_budget,
            iteration: iter,
            limit: max_iterations,
        })
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
        kind: QuestionKind,
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
        .with_detail(EvolveEventDetail::Question {
            text: question.to_string(),
            choices: choices.clone(),
            kind,
        })
    }

    /// Assistant narration between tool calls: the model explaining what it
    /// is doing or about to do, in its own words.
    pub(crate) fn narration(start_time: i64, iter: usize, text: &str) -> Self {
        Self::new(
            EvolveEventType::Narration,
            truncate(text, 2000),
            truncate(first_sentence(text), 100),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::Narration {
            text: text.to_string(),
        })
    }

    /// The user's answer to the pending question; pairs with the preceding
    /// `Question` event so the timeline records the full exchange.
    pub(crate) fn answered(start_time: i64, iter: usize, answer: &str) -> Self {
        Self::new(
            EvolveEventType::Answered,
            format!("User answered: {}", answer),
            format!("Answered: {}", truncate(answer, 100)),
            Some(iter),
            start_time,
        )
        .with_detail(EvolveEventDetail::Answered {
            text: answer.to_string(),
        })
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

/// Generic action label for a tool, without the object being acted on. The
/// single source for how a tool presents to the user: the tool_call summary
/// falls back to it when the object argument is missing, and the stream
/// announcements use it before the arguments have finished generating. None
/// for `think`, which presents as its thought text instead.
pub(crate) fn tool_action_label(tool: &str) -> Option<String> {
    let label = match tool {
        "think" => return None,
        "read_file" => "Reading file...",
        "edit_file" | "edit_nix_file" => "Editing configuration...",
        "list_files" => "Listing files...",
        "search_code" => "Searching the config...",
        "search_packages" => "Searching packages...",
        "search_docs" => "Searching docs...",
        "ensure_secret" => "Setting up a secret...",
        "build_check" => "Checking the configuration builds...",
        "ask_user" => "Asking a question...",
        "done" => "Finishing up...",
        other => return Some(format!("Using {} tool...", other)),
    };
    Some(label.to_string())
}

/// The slice of build output worth keeping when it exceeds `max_len`: from
/// the last "error:" line onward (nix prints the failure after pages of
/// evaluation/progress chatter), falling back to the tail. Head-truncating
/// oversized output instead would keep only the chatter and cut the error.
fn build_output_tail(output: &str, max_len: usize) -> &str {
    if output.len() <= max_len {
        return output;
    }
    let mut error_offset = None;
    let mut pos = 0;
    for line in output.split_inclusive('\n') {
        if line.to_lowercase().contains("error:") {
            error_offset = Some(pos);
        }
        pos += line.len();
    }
    let start = error_offset
        .unwrap_or_else(|| output.floor_char_boundary(output.len().saturating_sub(max_len)));
    &output[start..]
}

/// First line of build output that looks like the actual error, falling back
/// to the first non-empty line. Nix errors are prefixed with "error:", often
/// preceded by pages of trace/progress noise (which can mention "error"
/// inside file paths, hence the colon-anchored match is tried first).
fn first_error_line(output: &str) -> Option<&str> {
    let non_empty = || output.lines().map(str::trim).filter(|l| !l.is_empty());
    non_empty()
        .find(|l| l.to_lowercase().contains("error:"))
        .or_else(|| non_empty().find(|l| l.to_lowercase().contains("error")))
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
    // Append to the session transcript if an evolution is currently
    // recording. Queued rather than spawned so high-frequency stream events
    // land in emission order.
    if let Some(path) = crate::state::session_log::active_session_path() {
        let event_json = serde_json::to_value(&event).unwrap_or_default();
        crate::state::session_log::append_event_ordered(path, "evolve_event", event_json);
    }

    if let Some(window) = app.get_webview_window("main") {
        // A question blocks the run until the user answers; nudge them if
        // they are looking elsewhere.
        if matches!(event.event_type, EvolveEventType::Question)
            && !window.is_focused().unwrap_or(false)
        {
            notify_question(app, &window, &event.summary);
        }
        if let Err(e) = tauri::Emitter::emit(&window, EVOLVE_EVENT_CHANNEL, &event) {
            log::warn!("Failed to emit evolve event: {}", e);
        }
    }
}

/// OS-level nudge for a question that arrived while the app was unfocused:
/// a notification plus a request for attention (dock bounce on macOS).
fn notify_question<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    question: &str,
) {
    use tauri_plugin_notification::NotificationExt;

    if let Err(e) = window.request_user_attention(Some(tauri::UserAttentionType::Informational)) {
        log::warn!("Failed to request user attention: {}", e);
    }
    if let Err(e) = app
        .notification()
        .builder()
        .title("nixmac needs your input")
        .body(truncate(question, 120))
        .show()
    {
        log::warn!("Failed to send question notification: {}", e);
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
    fn search_packages_summary_should_show_query_and_top_results() {
        let found = ["spotify", "spotifyd", "spotify-player", "ncspot"]
            .map(String::from)
            .to_vec();
        let event = EvolveEvent::search_packages(0, 1, "spotify", &found);
        assert_eq!(
            event.summary,
            "Searched packages for 'spotify' → spotify, spotifyd, spotify-player +1 more"
        );
    }

    #[test]
    fn search_packages_summary_should_say_no_matches() {
        let event = EvolveEvent::search_packages(0, 1, "spotfy", &[]);
        assert_eq!(event.summary, "Searched packages for 'spotfy' — no matches");
    }

    #[test]
    fn search_packages_raw_should_list_all_results() {
        let found = ["a", "b", "c", "d"].map(String::from).to_vec();
        let event = EvolveEvent::search_packages(0, 1, "q", &found);
        assert_eq!(event.raw, "Searched packages for 'q'; found 4: a, b, c, d");
    }

    #[test]
    fn build_fail_summary_should_surface_the_error_line() {
        let output = "these 3 derivations will be built:\n\nerror: attribute 'spotfy' missing\n   at /flake.nix:12";
        let event = EvolveEvent::build_fail(0, 1, 1, output);
        assert_eq!(
            event.summary,
            "Build check failed: error: attribute 'spotfy' missing"
        );
    }

    #[test]
    fn build_fail_summary_should_fall_back_to_first_line_without_error_marker() {
        let event = EvolveEvent::build_fail(0, 1, 1, "\nsomething went wrong\nmore context");
        assert_eq!(event.summary, "Build check failed: something went wrong");
    }

    #[test]
    fn build_fail_summary_should_keep_generic_text_for_empty_output() {
        let event = EvolveEvent::build_fail(0, 1, 1, "");
        assert_eq!(event.summary, "Build check failed, retrying...");
    }

    #[test]
    fn build_fail_should_keep_the_error_when_chatter_overflows_the_raw_budget() {
        // Verbose dry-run output: thousands of evaluation lines, error last.
        let chatter = "evaluating file '/nix/store/aaa-source/lib/attrsets.nix'\n".repeat(200);
        let output = format!(
            "{}error: attribute 'spotfy' missing\n   at /flake.nix:12",
            chatter
        );
        let event = EvolveEvent::build_fail(0, 1, 1, &output);
        assert_eq!(
            event.summary,
            "Build check failed: error: attribute 'spotfy' missing"
        );
        assert!(
            event
                .raw
                .starts_with("Build check failed: error: attribute 'spotfy' missing"),
            "raw should start at the error line, got: {}",
            &event.raw[..120.min(event.raw.len())]
        );
    }

    #[test]
    fn build_fail_summary_should_not_anchor_on_paths_mentioning_error() {
        let output =
            "evaluating file '/nix/store/aaa/error-handling.nix'\nerror: attribute 'x' missing";
        let event = EvolveEvent::build_fail(0, 1, 1, output);
        assert_eq!(
            event.summary,
            "Build check failed: error: attribute 'x' missing"
        );
    }

    #[test]
    fn build_fail_should_keep_the_tail_when_oversized_output_has_no_error_line() {
        let output = format!("{}the final line", "chatter line\n".repeat(1000));
        let event = EvolveEvent::build_fail(0, 1, 1, &output);
        assert!(event.raw.contains("the final line"), "tail should survive");
    }

    #[test]
    fn build_output_should_carry_the_chunk_in_raw_and_detail() {
        let event = EvolveEvent::build_output(0, 2, "evaluating derivation\nthese 3 will be built");
        assert_eq!(event.raw, "evaluating derivation\nthese 3 will be built");
        assert_eq!(event.summary, "Checking the configuration builds...");
        assert!(matches!(
            event.detail,
            Some(EvolveEventDetail::BuildOutput { ref chunk })
                if chunk == "evaluating derivation\nthese 3 will be built"
        ));
    }

    #[test]
    fn build_fail_raw_should_carry_full_output() {
        let output = "line one\nerror: boom\nline three";
        let event = EvolveEvent::build_fail(0, 1, 1, output);
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

#[cfg(test)]
mod detail_tests {
    use super::*;
    use crate::shared_types::FileEditAction;

    #[test]
    fn thinking_detail_should_carry_full_text() {
        let event = EvolveEvent::thinking(0, 1, "planning", "First. Second.");
        match event.detail {
            Some(EvolveEventDetail::Thinking { category, text }) => {
                assert_eq!(category, "planning");
                assert_eq!(text, "First. Second.");
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn tool_call_detail_should_carry_tool_and_args() {
        let args = serde_json::json!({"query": "spotify"});
        let event = EvolveEvent::tool_call(0, 1, "search_packages", &args, "");
        match event.detail {
            Some(EvolveEventDetail::ToolCall { tool, args }) => {
                assert_eq!(tool, "search_packages");
                assert_eq!(args["query"], "spotify");
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn editing_semantic_detail_should_carry_action() {
        let edit = crate::shared_types::SemanticFileEdit {
            path: "flake.nix".to_string(),
            action: FileEditAction::Add {
                path: "environment.systemPackages".to_string(),
                values: vec!["ripgrep".to_string()],
            },
        };
        let event = EvolveEvent::editing_semantic(0, 1, &edit);
        match event.detail {
            Some(EvolveEventDetail::Edit {
                file,
                action: Some(FileEditAction::Add { path, values }),
            }) => {
                assert_eq!(file, "flake.nix");
                assert_eq!(path, "environment.systemPackages");
                assert_eq!(values, vec!["ripgrep".to_string()]);
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn build_fail_detail_should_carry_attempt_and_output() {
        let event = EvolveEvent::build_fail(0, 1, 2, "error: boom");
        match event.detail {
            Some(EvolveEventDetail::Build {
                pass,
                attempt,
                output,
            }) => {
                assert!(!pass);
                assert_eq!(attempt, 2);
                assert_eq!(output, "error: boom");
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn api_response_detail_should_carry_budget_progress() {
        let event = EvolveEvent::api_response(0, 3, 1000, 5000, 60_000, 50);
        match event.detail {
            Some(EvolveEventDetail::Progress {
                tokens,
                budget,
                iteration,
                limit,
            }) => {
                assert_eq!(tokens, 5000);
                assert_eq!(budget, 60_000);
                assert_eq!(iteration, 3);
                assert_eq!(limit, 50);
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn question_detail_should_carry_choices_and_kind() {
        let choices = Some(vec!["Yes, keep going".to_string(), "Stop".to_string()]);
        let event = EvolveEvent::question(0, 1, "Keep going?", &choices, QuestionKind::Checkpoint);
        match event.detail {
            Some(EvolveEventDetail::Question {
                text,
                choices: Some(c),
                kind,
            }) => {
                assert_eq!(text, "Keep going?");
                assert_eq!(c.len(), 2);
                assert_eq!(kind, QuestionKind::Checkpoint);
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn narration_summary_should_be_first_sentence() {
        let event = EvolveEvent::narration(0, 1, "The nixpkgs build is broken. I'll use homebrew.");
        assert_eq!(event.summary, "The nixpkgs build is broken.");
        match event.detail {
            Some(EvolveEventDetail::Narration { text }) => {
                assert_eq!(text, "The nixpkgs build is broken. I'll use homebrew.");
            }
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn answered_should_pair_answer_with_detail() {
        let event = EvolveEvent::answered(0, 1, "spotify-player");
        assert_eq!(event.summary, "Answered: spotify-player");
        match event.detail {
            Some(EvolveEventDetail::Answered { text }) => assert_eq!(text, "spotify-player"),
            other => panic!("unexpected detail: {:?}", other),
        }
    }

    #[test]
    fn question_detail_should_serialize_with_camel_case_tag() {
        let event = EvolveEvent::question(0, 1, "Q?", &None, QuestionKind::Agent);
        let json = serde_json::to_value(&event).expect("serializes");
        assert_eq!(json["detail"]["type"], "question");
        assert_eq!(json["detail"]["kind"], "agent");
    }
}
