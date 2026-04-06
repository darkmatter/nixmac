//! Shared type definitions for Tauri command responses.
//!
//! These structs are serialized to JSON when returned to the frontend.
//! The `#[serde(rename = "...")]` attributes ensure camelCase naming
//! for JavaScript/TypeScript consumption.

use crate::utils as global_utils;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

/// Application configuration returned by `config_get`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Path to the nix-darwin flake directory.
    #[serde(rename = "configDir")]
    pub config_dir: String,

    /// The darwinConfiguration attribute name (e.g., "Coopers-MacBook-Pro").
    #[serde(rename = "hostAttr")]
    pub host_attr: Option<String>,
}

/// Comprehensive git repository status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// All files with changes, parsed from diff headers.
    pub files: Vec<GitFileStatus>,

    /// Current branch name.
    pub branch: Option<String>,

    /// Whether HEAD has the nixmac-built tag (changes have been built/applied).
    pub head_is_built: bool,

    /// The raw unified diff content (git diff HEAD + untracked file contents).
    pub diff: String,

    /// Number of lines added.
    pub additions: usize,

    /// Number of lines deleted.
    pub deletions: usize,

    /// SHA hash of the current HEAD commit.
    pub head_commit_hash: Option<String>,

    /// Whether the working tree is clean (no uncommitted changes).
    pub clean_head: bool,

    /// Parsed hunks from the current diff. Empty when `clean_head` is true.
    pub changes: Vec<crate::sqlite_types::Change>,
}

/// Individual file status parsed from diff headers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// Relative path to the file.
    pub path: String,

    /// Type of change: "new", "edited", "removed", or "renamed".
    pub change_type: String,
}

/// User interface preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPrefs {
    /// OpenRouter API key for AI features via OpenRouter.
    #[serde(rename = "openrouterApiKey")]
    pub openrouter_api_key: Option<String>,

    /// OpenAI API key for direct OpenAI access.
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: Option<String>,

    /// Ollama API base URL for local model access.
    #[serde(rename = "ollamaApiBaseUrl")]
    pub ollama_api_base_url: Option<String>,

    /// vLLM API base URL (OpenAI-compatible endpoint).
    #[serde(rename = "vllmApiBaseUrl")]
    pub vllm_api_base_url: Option<String>,

    /// vLLM API key (optional — defaults to "none" if not set).
    #[serde(rename = "vllmApiKey")]
    pub vllm_api_key: Option<String>,

    /// Provider for summarization (openai/ollama/vllm).
    #[serde(rename = "summaryProvider")]
    pub summary_provider: Option<String>,

    /// Model name for summarization.
    #[serde(rename = "summaryModel")]
    pub summary_model: Option<String>,

    /// Provider for evolution (openai/ollama).
    #[serde(rename = "evolveProvider")]
    pub evolve_provider: Option<String>,

    /// Model name for evolution.
    #[serde(rename = "evolveModel")]
    pub evolve_model: Option<String>,

    /// Maximum iterations for evolution before giving up.
    #[serde(rename = "maxIterations")]
    pub max_iterations: Option<usize>,

    /// Maximum build attempts for evolution before giving up.
    #[serde(rename = "maxBuildAttempts")]
    pub max_build_attempts: Option<usize>,

    /// Whether to send diagnostics to the nixmac team.
    #[serde(rename = "sendDiagnostics")]
    pub send_diagnostics: bool,

    /// Whether to show a confirmation dialog before building.
    #[serde(rename = "confirmBuild")]
    pub confirm_build: bool,

    /// Whether to show a confirmation dialog before clearing/discarding.
    #[serde(rename = "confirmClear")]
    pub confirm_clear: bool,

    /// Whether to show a confirmation dialog before rolling back.
    #[serde(rename = "confirmRollback")]
    pub confirm_rollback: bool,
}

/// Result of a darwin-rebuild operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    /// Whether the operation succeeded.
    pub ok: bool,

    /// Process exit code.
    pub code: Option<i32>,

    /// Captured stdout output.
    pub stdout: Option<String>,

    /// Captured stderr output.
    pub stderr: Option<String>,
}

// =============================================================================
// Feedback Metadata
// =============================================================================

/// Options indicating which feedback artifacts the user allows sharing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackShareOptions {
    pub current_app_state: bool,
    pub system_info: bool,
    pub usage_stats: bool,
    pub evolution_log: bool,
    pub changed_nix_files: bool,
    pub ai_provider_model_info: bool,
    pub build_error_output: bool,
    pub flake_inputs_snapshot: bool,
    pub app_logs: bool,
}

/// System information captured from the runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSystemInfo {
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub nix_version: Option<String>,
    pub app_version: Option<String>,
}

/// Aggregated usage stats for feedback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackUsageStats {
    pub total_evolutions: Option<u64>,
    pub success_rate: Option<f64>,
    pub avg_iterations: Option<f64>,
    pub last_computed_at: Option<String>,
    pub extra: Option<Value>,
}

/// AI provider/model info and usage signals.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAiProviderModelInfo {
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub total_tokens: Option<u32>,
    pub latency_ms: Option<i64>,
    pub iterations: Option<usize>,
    pub build_attempts: Option<usize>,
}

/// Flake input metadata captured from flake.lock.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackFlakeInputEntry {
    pub rev: Option<String>,
    pub last_modified: Option<i64>,
    pub nar_hash: Option<String>,
}

/// Snapshot of selected flake inputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedbackFlakeInputsSnapshot {
    pub nixpkgs: Option<FeedbackFlakeInputEntry>,
    #[serde(rename = "nix-darwin")]
    pub nix_darwin: Option<FeedbackFlakeInputEntry>,
    #[serde(rename = "home-manager")]
    pub home_manager: Option<FeedbackFlakeInputEntry>,
}

/// Request payload for gathering feedback metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadataRequest {
    pub feedback_type: String,
    pub share: FeedbackShareOptions,
}

/// Metadata collected for feedback submission based on user opt-in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadata {
    pub current_app_state_snapshot: Option<Value>,
    pub system_info: Option<FeedbackSystemInfo>,
    pub usage_stats: Option<FeedbackUsageStats>,
    pub evolution_log_content: Option<String>,
    pub changed_nix_files_diff: Option<String>,
    pub ai_provider_model_info: Option<FeedbackAiProviderModelInfo>,
    pub build_error_output: Option<String>,
    pub flake_inputs_snapshot: Option<FeedbackFlakeInputsSnapshot>,
    pub app_logs_content: Option<String>,
    pub panic_details: Option<FeedbackPanicDetails>,
}

/// Panic/crash information captured when a Rust panic occurs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPanicDetails {
    pub message: String,
    pub location: Option<String>,
    pub backtrace: Option<String>,
    pub timestamp: String,
}

// =============================================================================
// History
// =============================================================================

/// A git commit from the log, with optional DB metadata and change map.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    /// Commit hash (always from git log).
    pub hash: String,
    /// Commit message (always from git log).
    pub message: Option<String>,
    /// Unix timestamp (always from git log).
    pub created_at: i64,
    /// Has `nixmac-last-build` tag.
    pub is_built: bool,
    /// Has `nixmac-base-<hash>` tag.
    pub is_base: bool,
    /// Has no `nixmac-commit-*` or `nixmac-base-*` tag.
    pub is_external: bool,
    /// Changed file count from change_map, or 0.
    pub file_count: usize,
    /// DB record — present only if metadata has been generated for this commit.
    pub commit: Option<crate::sqlite_types::Commit>,
    /// Grouped change map — present only if the summarize pipeline has run for this commit pair.
    pub change_map: Option<crate::shared_types::SemanticChangeMap>,
}

// =============================================================================
// Evolve Streaming Events
// =============================================================================

/// Event type for streaming evolve progress updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveEvent {
    /// Raw log output (detailed technical information)
    pub raw: String,

    /// Human-readable summary of what's happening
    pub summary: String,

    /// Event type for categorization in the UI
    pub event_type: EvolveEventType,

    /// Current iteration number (if applicable)
    pub iteration: Option<usize>,

    /// Timestamp in milliseconds since evolution started
    pub timestamp_ms: i64,
}

/// Types of evolve events for UI rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolveEventType {
    /// Evolution is starting
    Start,
    /// New iteration in the agentic loop
    Iteration,
    /// Model is thinking/reasoning
    Thinking,
    /// Model is reading a file
    Reading,
    /// Model is editing a file
    Editing,
    /// Model is running a build check
    BuildCheck,
    /// Build check passed
    BuildPass,
    /// Build check failed
    BuildFail,
    /// A tool call is being made
    ToolCall,
    /// API request to OpenAI
    ApiRequest,
    /// API response received
    ApiResponse,
    /// Evolution completed successfully
    Complete,
    /// Evolution failed with error
    Error,
    /// Generic info message
    Info,
    /// Generating summary
    Summarizing,
}

impl EvolveEvent {
    pub fn new(
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

    pub fn start(start_time: i64, model: &str, prompt: &str) -> Self {
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

    pub fn iteration(start_time: i64, iter: usize, messages_count: usize) -> Self {
        Self::new(
            EvolveEventType::Iteration,
            format!("Iteration {} | messages={}", iter, messages_count),
            format!("Processing iteration {}...", iter),
            Some(iter),
            start_time,
        )
    }

    pub fn thinking(start_time: i64, iter: usize, category: &str, thought: &str) -> Self {
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

    pub fn reading(start_time: i64, iter: usize, path: &str) -> Self {
        Self::new(
            EvolveEventType::Reading,
            format!("Reading file: {}", path),
            format!("Reading {}", shorten_path(path)),
            Some(iter),
            start_time,
        )
    }

    pub fn editing(start_time: i64, iter: usize, path: &str) -> Self {
        Self::new(
            EvolveEventType::Editing,
            format!("Editing file: {}", path),
            format!("Editing {}", shorten_path(path)),
            Some(iter),
            start_time,
        )
    }

    pub fn build_pass(start_time: i64, iter: usize) -> Self {
        Self::new(
            EvolveEventType::BuildPass,
            "Build check passed".to_string(),
            "Build check passed ✓".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub fn build_fail(start_time: i64, iter: usize, error_preview: &str) -> Self {
        Self::new(
            EvolveEventType::BuildFail,
            format!("Build check failed: {}", error_preview),
            "Build check failed, retrying...".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub fn tool_call(start_time: i64, iter: usize, tool: &str, args_summary: &str) -> Self {
        let summary = match tool {
            "read_file" => "Reading file...".to_string(),
            "edit_file" => "Editing file...".to_string(),
            "list_files" => "Listing files...".to_string(),
            "search_code" => "Searching code...".to_string(),
            "search_packages" => "Searching packages...".to_string(),
            "build_check" => "Running build check...".to_string(),
            "think" => "Thinking...".to_string(),
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

    pub fn api_request(start_time: i64, iter: usize) -> Self {
        Self::new(
            EvolveEventType::ApiRequest,
            "Sending request to AI provider".to_string(),
            "Querying AI model...".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub fn api_response(start_time: i64, iter: usize, tokens: u32) -> Self {
        Self::new(
            EvolveEventType::ApiResponse,
            format!("Received response | tokens used: {}", tokens),
            "Received AI response".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub fn complete(start_time: i64, iter: usize, summary_text: &str) -> Self {
        Self::new(
            EvolveEventType::Complete,
            format!("Evolution complete: {}", summary_text),
            "Evolution complete!".to_string(),
            Some(iter),
            start_time,
        )
    }

    pub fn error(start_time: i64, iter: Option<usize>, summary: &str, raw: &str) -> Self {
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

    pub fn info(start_time: i64, iter: Option<usize>, message: &str) -> Self {
        Self::new(
            EvolveEventType::Info,
            message.to_string(),
            message.to_string(),
            iter,
            start_time,
        )
    }

    pub fn analyzing(start_time: i64, iter: Option<usize>) -> Self {
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
pub const EVOLVE_EVENT_CHANNEL: &str = "darwin:evolve:event";

/// Helper to emit evolve events to the frontend
pub fn emit_evolve_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: EvolveEvent) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = tauri::Emitter::emit(&window, EVOLVE_EVENT_CHANNEL, &event) {
            log::warn!("Failed to emit evolve event: {}", e);
        }
    }
}

