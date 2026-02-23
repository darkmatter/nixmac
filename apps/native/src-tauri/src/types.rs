//! Shared type definitions for Tauri command responses.
//!
//! These structs are serialized to JSON when returned to the frontend.
//! The `#[serde(rename = "...")]` attributes ensure camelCase naming
//! for JavaScript/TypeScript consumption.

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
pub struct GitStatus {
    /// All files with changes, including detailed status codes.
    pub files: Vec<GitFileStatus>,

    /// Newly created files (staged with 'A').
    pub created: Vec<String>,

    /// Deleted files (staged with 'D').
    pub deleted: Vec<String>,

    /// Modified files (staged with 'M').
    pub modified: Vec<String>,

    /// All staged files (ready to commit).
    pub staged: Vec<String>,

    /// Untracked files (not yet added to git).
    pub not_added: Vec<String>,

    /// Files with merge conflicts.
    pub conflicted: Vec<String>,

    /// Commits ahead of tracking branch (not currently implemented).
    pub ahead: i32,

    /// Commits behind tracking branch (not currently implemented).
    pub behind: i32,

    /// Current branch name.
    pub branch: Option<String>,

    /// Remote tracking branch name.
    pub tracking: Option<String>,

    /// Commit messages on current branch since diverging from main.
    #[serde(rename = "branchCommitMessages")]
    pub branch_commit_messages: Vec<String>,

    /// Quick check for any uncommitted changes.
    #[serde(rename = "hasChanges")]
    pub has_changes: bool,

    /// Files with working_tree changes (not yet staged).
    #[serde(rename = "hasUnstagedChanges")]
    pub has_unstaged_changes: bool,

    /// All changes are staged (no unstaged changes exist).
    #[serde(rename = "allChangesStaged")]
    pub all_changes_staged: bool,

    /// All files cleanly staged (ready to commit - no mixed staged/unstaged).
    #[serde(rename = "allChangesCleanlyStaged")]
    pub all_changes_cleanly_staged: bool,

    /// Whether HEAD has the nixmac-built tag (changes have been built/applied).
    #[serde(rename = "headIsBuilt")]
    pub head_is_built: bool,

    /// Whether the current branch is main or master.
    #[serde(rename = "isMainBranch")]
    pub is_main_branch: bool,

    /// SHA of commit with nixmac-last-build tag, None if no tag exists.
    #[serde(rename = "lastBuiltCommitSha")]
    pub last_built_commit_sha: Option<String>,

    /// True if nixmac-last-build tag points to a commit on current branch
    /// (i.e., the built commit is an ancestor of HEAD).
    #[serde(rename = "branchHasBuiltCommit")]
    pub branch_has_built_commit: bool,

    /// The raw unified diff content (git diff main + untracked file contents).
    pub diff: String,

    /// Number of lines added.
    pub additions: usize,

    /// Number of lines deleted.
    pub deletions: usize,
}

/// Individual file status from `git status --porcelain`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFileStatus {
    /// Relative path to the file.
    pub path: String,

    /// Index (staging area) status character.
    pub index: Option<String>,

    /// Working tree status character.
    pub working_tree: Option<String>,
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

    /// Provider for summarization (openai/ollama).
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
    pub last_prompt: bool,
    pub current_app_state: bool,
    pub system_info: bool,
    pub usage_stats: bool,
    pub evolution_log: bool,
    pub changed_nix_files: bool,
    pub ai_provider_model_info: bool,
    pub build_error_output: bool,
    pub flake_inputs_snapshot: bool,
    pub nix_config: bool,
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
    pub last_prompt_text: Option<String>,
    pub current_app_state_snapshot: Option<Value>,
    pub system_info: Option<FeedbackSystemInfo>,
    pub usage_stats: Option<FeedbackUsageStats>,
    pub evolution_log_content: Option<String>,
    pub changed_nix_files_diff: Option<String>,
    pub ai_provider_model_info: Option<FeedbackAiProviderModelInfo>,
    pub build_error_output: Option<String>,
    pub flake_inputs_snapshot: Option<FeedbackFlakeInputsSnapshot>,
    pub nix_config_snapshot: Option<String>,
    pub app_logs_content: Option<String>,
}

/// A single summary item with a title and description
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryItem {
    /// Short title for the change (2-5 words)
    pub title: String,

    /// Friendly description of what this change does
    pub description: String,
}

/// Response for summarization requests.
/// Contains only AI-generated content. Raw git data (diff, additions, deletions)
/// comes from GitStatus instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    /// List of changes with title and description
    pub items: Vec<SummaryItem>,

    /// Helpful suggestion for testing the changes
    pub instructions: String,

    /// Suggested commit message
    pub commit_message: String,
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

    pub fn error(start_time: i64, iter: Option<usize>, error: &str) -> Self {
        Self::new(
            EvolveEventType::Error,
            format!("Error: {}", error),
            format!("Error: {}", truncate(error, 100)),
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
}

/// Truncate a string to max length with ellipsis
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

/// Shorten a file path to just the filename or last path component
fn shorten_path(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
