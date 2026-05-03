//! Shared types exported to TypeScript via Specta — both query results and UI routing state.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

// =============================================================================
// App configuration
// =============================================================================

/// Application configuration returned by `config_get`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub config_dir: String,
    pub host_attr: Option<String>,
}

/// Result of a darwin-rebuild operation from the legacy non-streaming command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DarwinApplyLegacy {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

// =============================================================================
// Feedback metadata
// =============================================================================

/// Options indicating which feedback artifacts the user allows sharing.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSystemInfo {
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub nix_version: Option<String>,
    pub app_version: Option<String>,
}

/// Aggregated usage stats for feedback.
#[allow(dead_code)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackFlakeInputEntry {
    pub rev: Option<String>,
    pub last_modified: Option<i64>,
    pub nar_hash: Option<String>,
}

/// Snapshot of selected flake inputs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FeedbackFlakeInputsSnapshot {
    pub nixpkgs: Option<FeedbackFlakeInputEntry>,
    #[serde(rename = "nix-darwin")]
    pub nix_darwin: Option<FeedbackFlakeInputEntry>,
    #[serde(rename = "home-manager")]
    pub home_manager: Option<FeedbackFlakeInputEntry>,
}

/// Request payload for gathering feedback metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadataRequest {
    pub feedback_type: String,
    pub share: FeedbackShareOptions,
}

/// Metadata collected for feedback submission based on user opt-in.
#[allow(dead_code)]
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

/// Panic/crash information captured when a Rust panic occurs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPanicDetails {
    pub message: String,
    pub location: Option<String>,
    pub backtrace: Option<String>,
    pub timestamp: String,
}

// =============================================================================
// Git status types
// =============================================================================

/// Type of change for a file in git status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ChangeType {
    New,
    Edited,
    Removed,
    Renamed,
}

/// Individual file status parsed from diff headers.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub change_type: ChangeType,
}

/// Comprehensive git repository status.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub branch: Option<String>,
    pub diff: String,
    pub additions: usize,
    pub deletions: usize,
    pub head_commit_hash: Option<String>,
    pub clean_head: bool,
    pub changes: Vec<Change>,
}

/// Event payload emitted by the git status watcher.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WatcherEvent {
    pub git_status: Option<GitStatus>,
    pub change_map: Option<SemanticChangeMap>,
    pub evolve_state: Option<EvolveState>,
    pub error: Option<String>,
    pub external_build_detected: bool,
}

// =============================================================================
// Evolve streaming events
// =============================================================================

/// Event type for streaming evolve progress updates.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveEvent {
    pub raw: String,
    pub summary: String,
    pub event_type: EvolveEventType,
    pub iteration: Option<usize>,
    pub timestamp_ms: i64,
}

/// Types of evolve events for UI rendering.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolveEventType {
    Start,
    Iteration,
    Thinking,
    Reading,
    Editing,
    BuildCheck,
    BuildPass,
    BuildFail,
    ToolCall,
    ApiRequest,
    ApiResponse,
    Complete,
    Error,
    Info,
    Summarizing,
    Question,
}

// =============================================================================
// Homebrew types
// =============================================================================
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewState {
    pub is_installed: bool,
    pub casks: Vec<String>,
    pub brews: Vec<String>,
    pub taps: Vec<String>,
    pub source: Option<String>,
    pub last_checked: i64,
}

// =============================================================================
// Query return types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWithSummary {
    pub id: i64,
    pub hash: String,
    pub filename: String,
    pub diff: String,
    pub line_count: i64,
    pub created_at: i64,
    pub own_summary_id: Option<i64>,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeGroup {
    pub summary: ChangeSummary,
    pub changes: Vec<ChangeWithSummary>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeMap {
    pub groups: Vec<SemanticChangeGroup>,
    pub singles: Vec<ChangeWithSummary>,
    pub unsummarized_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChange {
    pub change: Change,
    pub own_summary: Option<ChangeSummary>,
    pub group_summary: Option<ChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChangeSet {
    pub change_set: ChangeSet,
    pub changes: Vec<SummarizedChange>,
    pub missed_hashes: Vec<String>,
}

/// A commit entry combining git log data, tag-derived flags, optional DB metadata, and raw diff changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub hash: String,
    pub message: Option<String>,
    pub created_at: i64,
    pub is_built: bool,
    pub is_base: bool,
    pub is_external: bool,
    pub file_count: usize,
    pub commit: Option<crate::sqlite_types::Commit>,
    pub change_map: Option<SemanticChangeMap>,
    pub unsummarized_hashes: Vec<String>,
    pub raw_changes: Vec<crate::sqlite_types::Change>,
    pub origin_message: Option<String>,
    pub origin_hash: Option<String>,
    pub is_orphaned_restore: bool,
    pub is_undone: bool,
}

// =============================================================================
// Evolve routing state
// =============================================================================

/// Widget step derived from `EvolveState` fields.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolveStep {
    #[default]
    Begin,
    Evolve,
    #[serde(alias = "merge")]
    Commit,
    ManualEvolve,
    ManualCommit,
}

/// Persisted evolve state stored in `evolve-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveState {
    pub evolution_id: Option<i64>,
    pub current_changeset_id: Option<i64>,
    /// Maintained for compatibility
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub changeset_at_build: Option<i64>,
    /// current state verifyably built
    pub committable: bool,
    /// branch used to reset repo state on evolve failure
    pub backup_branch: Option<String>,
    /// rollback values recover repo state and reapply nix store path
    pub rollback_branch: Option<String>,
    pub rollback_store_path: Option<String>,
    pub rollback_changeset_id: Option<i64>,
    pub step: EvolveStep,
}

impl Default for EvolveState {
    fn default() -> Self {
        Self {
            evolution_id: None,
            current_changeset_id: None,
            changeset_at_build: None,
            committable: false,
            backup_branch: None,
            rollback_branch: None,
            rollback_store_path: None,
            rollback_changeset_id: None,
            step: EvolveStep::Begin,
        }
    }
}

// =============================================================================
// Config dir result types
// =============================================================================

/// Result returned when the config directory is set (typed or picked).
/// `evolve_state` and `hosts` are `Some` only when the directory actually changed.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetDirResult {
    pub dir: String,
    pub evolve_state: Option<EvolveState>,
    pub hosts: Option<Vec<String>>,
}

// =============================================================================
// Rollback result types
// =============================================================================

/// Result returned from a rollback erase operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub git_status: GitStatus,
    pub evolve_state: EvolveState,
    pub rollback_store_path: Option<String>,
    pub rollback_changeset_id: Option<i64>,
}

// =============================================================================
// Evolution command result types
// =============================================================================

/// Evolution lifecycle state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionState {
    /// Initial state before generation starts
    Pending,
    /// Currently generating/processing
    Loading,
    /// Generation complete, ready for review
    Generated,
    /// Changes have been applied (darwin-rebuild ran)
    Applied,
    /// Changes have been committed
    Committed,
    /// An error occurred
    Failed,
    /// Agent responded conversationally without making any environment changes
    Conversational,
}

/// Telemetry counters from a completed evolution run.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionTelemetry {
    pub state: EvolutionState,
    pub iterations: usize,
    pub build_attempts: usize,
    pub total_tokens: u32,
    pub edits_count: usize,
    pub thinking_count: usize,
    pub tool_calls_count: usize,
    pub duration_ms: i64,
}

/// Evolution result returned to the frontend on completion.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionResult {
    pub change_map: SemanticChangeMap,
    pub git_status: GitStatus,
    pub evolve_state: EvolveState,
    pub conversational_response: Option<String>,
    pub telemetry: EvolutionTelemetry,
}

/// Evolution failure payload with partial telemetry.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionFailureResult {
    pub error: String,
    pub git_status: Option<GitStatus>,
    pub telemetry: EvolutionTelemetry,
}

// =============================================================================
// UI Preferences
// =============================================================================

/// User interface preferences (synced to settings.json via tauri-plugin-store).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    pub openrouter_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub ollama_api_base_url: Option<String>,
    pub vllm_api_base_url: Option<String>,
    pub vllm_api_key: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub max_iterations: Option<usize>,
    pub max_build_attempts: Option<usize>,
    pub send_diagnostics: bool,
    pub confirm_build: bool,
    pub confirm_clear: bool,
    pub confirm_rollback: bool,
    pub auto_summarize_on_focus: bool,
    pub scan_homebrew_on_startup: bool,
    pub developer_mode: bool,
    pub pinned_version: Option<String>,
}

// =============================================================================
// Partial UI preferences update (used by ui_set_prefs command)
// =============================================================================

/// Partial update to UI preferences — every field is optional so the caller
/// can send only the fields they wish to change.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefsUpdate {
    pub openrouter_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub max_iterations: Option<usize>,
    pub max_build_attempts: Option<usize>,
    pub ollama_api_base_url: Option<String>,
    pub vllm_api_base_url: Option<String>,
    pub vllm_api_key: Option<String>,
    pub send_diagnostics: Option<bool>,
    pub confirm_build: Option<bool>,
    pub confirm_clear: Option<bool>,
    pub confirm_rollback: Option<bool>,
    pub auto_summarize_on_focus: Option<bool>,
    pub scan_homebrew_on_startup: Option<bool>,
    pub developer_mode: Option<bool>,
    /// `None` → field not sent; `Some(None)` → clear the pinned version.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    pub pinned_version: Option<Option<String>>,
}

#[allow(dead_code)]
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        val: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match val {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Ok(Some(Option::deserialize(d)?))
    }
}

// =============================================================================
// Simple acknowledgement
// =============================================================================

/// Generic acknowledgement returned by fire-and-forget commands.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OkResult {
    pub ok: bool,
}

impl OkResult {
    #[allow(dead_code)]
    pub fn yes() -> Self {
        Self { ok: true }
    }
}

// =============================================================================
// Nix check result
// =============================================================================

/// Result of `nix_check` — reports whether Nix and darwin-rebuild are available.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NixCheckResult {
    pub installed: bool,
    pub version: Option<String>,
    pub darwin_rebuild_available: bool,
}

// =============================================================================
// Build check result
// =============================================================================

/// Result of `darwin_build_check` — dry-run build outcome.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuildCheckResult {
    pub passed: bool,
    pub output: String,
}

// =============================================================================
// Config-edit apply result
// =============================================================================

/// Result of a managed-edit apply operation (homebrew, system-defaults, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEditApplyResult {
    pub ok: bool,
    pub count: usize,
    pub change_map: SemanticChangeMap,
    pub git_status: GitStatus,
    pub evolve_state: EvolveState,
}

// =============================================================================
// CLI tools availability
// =============================================================================

/// Availability of known AI CLI tools.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CliToolsState {
    pub claude: bool,
    pub codex: bool,
    pub opencode: bool,
}

// =============================================================================
// Preview indicator state
// =============================================================================

/// State sent to the preview indicator window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIndicatorState {
    pub visible: bool,
    pub summary: Option<String>,
    pub files_changed: usize,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
    pub is_loading: bool,
}

// =============================================================================
// macOS permissions
// =============================================================================

/// Permission status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    Granted,
    Denied,
    Pending,
    Unknown,
}

/// Individual permission state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub id: String,
    pub name: String,
    pub description: String,
    pub required: bool,
    pub can_request_programmatically: bool,
    pub status: PermissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

/// All permissions state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsState {
    pub permissions: Vec<Permission>,
    pub all_required_granted: bool,
    pub checked_at: Option<i64>,
}

// =============================================================================
// System defaults scanner
// =============================================================================

/// A single macOS system default that differs from the factory value.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefault {
    pub nix_key: String,
    pub label: String,
    pub category: String,
    pub current_value: String,
    pub default_value: String,
}

/// Result of a full system defaults scan.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefaultsScan {
    pub defaults: Vec<SystemDefault>,
    pub total_scanned: usize,
}

/// A recommended prompt based on the user's current macOS settings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedPrompt {
    pub id: String,
    pub prompt_text: String,
}

// =============================================================================
// Editor file entries
// =============================================================================

/// File or directory entry returned by the editor tree.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

// =============================================================================
// Debug / test helpers
// =============================================================================

/// Response from the debug Sentry event command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DebugSentryResult {
    pub ok: bool,
    pub message: String,
}

// =============================================================================
// Evolve cancel / answer acknowledgements
// =============================================================================

/// Acknowledgement from `darwin_evolve_cancel`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EvolveCancelResult {
    pub ok: bool,
    pub message: String,
}

// =============================================================================
// Git commit result
// =============================================================================

/// Result of a successful `git_commit` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub evolve_state: EvolveState,
}

// =============================================================================
// Finalize apply result
// =============================================================================

/// Result of a successful `finalize_apply` or `finalize_rollback` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeApplyResult {
    pub git_status: GitStatus,
    pub evolve_state: EvolveState,
}
