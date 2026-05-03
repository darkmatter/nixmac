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
    /// Absolute path to the selected nix-darwin flake/config directory.
    pub config_dir: String,
    /// Selected `darwinConfigurations.<host>` attribute, when configured.
    pub host_attr: Option<String>,
}

/// Result of a darwin-rebuild operation from the legacy non-streaming command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DarwinApplyLegacy {
    /// Whether the rebuild command completed successfully.
    pub ok: bool,
    /// Process exit code when a rebuild process was spawned.
    pub code: Option<i32>,
    /// Captured stdout from the rebuild process.
    pub stdout: Option<String>,
    /// Captured stderr from the rebuild process.
    pub stderr: Option<String>,
}

// =============================================================================
// Feedback metadata
// =============================================================================

/// Options indicating which feedback artifacts the user allows sharing.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackShareOptions {
    /// Include the current widget/store state snapshot.
    pub current_app_state: bool,
    /// Include OS, architecture, Nix, and app version details.
    pub system_info: bool,
    /// Include aggregated usage statistics.
    pub usage_stats: bool,
    /// Include the active evolution log.
    pub evolution_log: bool,
    /// Include the current diff for changed Nix files.
    pub changed_nix_files: bool,
    /// Include selected AI provider/model and usage details.
    pub ai_provider_model_info: bool,
    /// Include the latest build error output, if any.
    pub build_error_output: bool,
    /// Include selected `flake.lock` input metadata.
    pub flake_inputs_snapshot: bool,
    /// Include recent application logs.
    pub app_logs: bool,
}

/// System information captured from the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSystemInfo {
    /// Operating system name, e.g. `macOS`.
    pub os_name: Option<String>,
    /// Operating system version string.
    pub os_version: Option<String>,
    /// Hardware/system architecture, e.g. `aarch64-darwin`.
    pub arch: Option<String>,
    /// Installed Nix version, when detected.
    pub nix_version: Option<String>,
    /// nixmac application version.
    pub app_version: Option<String>,
}

/// Aggregated usage stats for feedback.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackUsageStats {
    /// Number of evolutions recorded locally.
    pub total_evolutions: Option<u64>,
    /// Percentage of evolutions that completed successfully.
    pub success_rate: Option<f64>,
    /// Average number of agent iterations per evolution.
    pub avg_iterations: Option<f64>,
    /// Timestamp when the stats were computed.
    pub last_computed_at: Option<String>,
    /// Additional structured usage fields that are not part of the stable contract.
    pub extra: Option<Value>,
}

/// AI provider/model info and usage signals.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAiProviderModelInfo {
    /// Provider used for evolution requests.
    pub evolve_provider: Option<String>,
    /// Model used for evolution requests.
    pub evolve_model: Option<String>,
    /// Provider used for summary requests.
    pub summary_provider: Option<String>,
    /// Model used for summary requests.
    pub summary_model: Option<String>,
    /// Token count reported for the related AI run.
    pub total_tokens: Option<u32>,
    /// Latency in milliseconds for the related AI run.
    pub latency_ms: Option<i64>,
    /// Iterations completed by the related evolution.
    pub iterations: Option<usize>,
    /// Build attempts completed by the related evolution.
    pub build_attempts: Option<usize>,
}

/// Flake input metadata captured from flake.lock.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackFlakeInputEntry {
    /// Git revision for the flake input.
    pub rev: Option<String>,
    /// Flake input last-modified timestamp from `flake.lock`.
    pub last_modified: Option<i64>,
    /// Store hash for the locked input.
    pub nar_hash: Option<String>,
}

/// Snapshot of selected flake inputs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FeedbackFlakeInputsSnapshot {
    /// Locked `nixpkgs` input metadata.
    pub nixpkgs: Option<FeedbackFlakeInputEntry>,
    /// Locked `nix-darwin` input metadata.
    #[serde(rename = "nix-darwin")]
    pub nix_darwin: Option<FeedbackFlakeInputEntry>,
    /// Locked `home-manager` input metadata.
    #[serde(rename = "home-manager")]
    pub home_manager: Option<FeedbackFlakeInputEntry>,
}

/// Request payload for gathering feedback metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadataRequest {
    /// Feedback category selected by the user.
    pub feedback_type: String,
    /// User opt-in flags controlling which artifacts may be gathered.
    pub share: FeedbackShareOptions,
}

/// Metadata collected for feedback submission based on user opt-in.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadata {
    /// Current frontend/store snapshot, represented as arbitrary JSON.
    pub current_app_state_snapshot: Option<Value>,
    /// Runtime system information.
    pub system_info: Option<FeedbackSystemInfo>,
    /// Aggregated local usage statistics.
    pub usage_stats: Option<FeedbackUsageStats>,
    /// Captured evolution log content.
    pub evolution_log_content: Option<String>,
    /// Diff for changed Nix files at submission time.
    pub changed_nix_files_diff: Option<String>,
    /// AI provider/model metadata for the related run.
    pub ai_provider_model_info: Option<FeedbackAiProviderModelInfo>,
    /// Latest build error output.
    pub build_error_output: Option<String>,
    /// Selected locked flake input metadata.
    pub flake_inputs_snapshot: Option<FeedbackFlakeInputsSnapshot>,
    /// Recent application log content.
    pub app_logs_content: Option<String>,
    /// Panic details when feedback is submitted after a crash.
    pub panic_details: Option<FeedbackPanicDetails>,
}

/// Panic/crash information captured when a Rust panic occurs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPanicDetails {
    /// Panic message captured by the panic hook.
    pub message: String,
    /// Source location reported by Rust, when available.
    pub location: Option<String>,
    /// Captured backtrace, when available.
    pub backtrace: Option<String>,
    /// UTC timestamp when the panic was captured.
    pub timestamp: String,
}

// =============================================================================
// Git status types
// =============================================================================

/// Type of change for a file in git status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ChangeType {
    /// File was added.
    New,
    /// File contents changed.
    Edited,
    /// File was deleted.
    Removed,
    /// File was renamed or moved.
    Renamed,
}

/// Individual file status parsed from diff headers.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// Repository-relative file path.
    pub path: String,
    /// Parsed status category for this file.
    pub change_type: ChangeType,
}

/// Comprehensive git repository status.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Changed files parsed from git status/diff output.
    pub files: Vec<GitFileStatus>,
    /// Current branch name, when the repository has one checked out.
    pub branch: Option<String>,
    /// Unified diff for the current working tree/index changes.
    pub diff: String,
    /// Total added lines in `diff`.
    pub additions: usize,
    /// Total removed lines in `diff`.
    pub deletions: usize,
    /// Current HEAD commit hash, when available.
    pub head_commit_hash: Option<String>,
    /// Whether HEAD is known to be clean relative to tracked changes.
    pub clean_head: bool,
    /// Raw change rows associated with the current diff.
    pub changes: Vec<Change>,
}

/// Event payload emitted by the git status watcher.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WatcherEvent {
    /// Latest git status snapshot, if it could be read.
    pub git_status: Option<GitStatus>,
    /// Latest summarized change map, when summary data is available.
    pub change_map: Option<SemanticChangeMap>,
    /// Latest evolve routing state derived from the snapshot.
    pub evolve_state: Option<EvolveState>,
    /// Error message when the watcher failed to refresh state.
    pub error: Option<String>,
    /// True when a build outside nixmac was detected.
    pub external_build_detected: bool,
}

// =============================================================================
// Evolve streaming events
// =============================================================================

/// Event type for streaming evolve progress updates.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveEvent {
    /// Raw log output or technical details for the event.
    pub raw: String,
    /// Human-readable status text for rendering in the widget.
    pub summary: String,
    /// Event category used by the UI timeline.
    pub event_type: EvolveEventType,
    /// Agent iteration associated with the event, if applicable.
    pub iteration: Option<usize>,
    /// Milliseconds elapsed since the evolution started.
    pub timestamp_ms: i64,
}

/// Types of evolve events for UI rendering.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolveEventType {
    /// Evolution is starting.
    Start,
    /// Agent loop entered a new iteration.
    Iteration,
    /// Model reasoning/thinking content was observed.
    Thinking,
    /// Agent is reading a file.
    Reading,
    /// Agent is editing a file.
    Editing,
    /// Agent is running a build check.
    BuildCheck,
    /// Build check passed.
    BuildPass,
    /// Build check failed.
    BuildFail,
    /// Agent invoked a tool.
    ToolCall,
    /// Request was sent to an AI provider.
    ApiRequest,
    /// Response was received from an AI provider.
    ApiResponse,
    /// Evolution completed successfully.
    Complete,
    /// Evolution failed or emitted an error.
    Error,
    /// Informational event without a more specific category.
    Info,
    /// Change summarization is running.
    Summarizing,
    /// Agent asked the user for input.
    Question,
}

// =============================================================================
// Homebrew types
// =============================================================================
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewState {
    /// Whether Homebrew is installed and discoverable.
    pub is_installed: bool,
    /// Installed cask names.
    pub casks: Vec<String>,
    /// Installed formula names.
    pub brews: Vec<String>,
    /// Configured Homebrew tap names.
    pub taps: Vec<String>,
    /// Source used to collect the state, when known.
    pub source: Option<String>,
    /// Unix timestamp when this state was last collected.
    pub last_checked: i64,
}

// =============================================================================
// Query return types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWithSummary {
    /// Change row identifier.
    pub id: i64,
    /// Stable content hash for the change.
    pub hash: String,
    /// Repository-relative changed file path.
    pub filename: String,
    /// Unified diff content for this change.
    pub diff: String,
    /// Number of lines in the change diff.
    pub line_count: i64,
    /// Unix timestamp when the change was recorded.
    pub created_at: i64,
    /// Direct summary row id assigned to this change, if any.
    pub own_summary_id: Option<i64>,
    /// Summary title used for display.
    pub title: String,
    /// Summary description used for display.
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeGroup {
    /// Shared summary describing the grouped changes.
    pub summary: ChangeSummary,
    /// Changes that belong to this semantic group.
    pub changes: Vec<ChangeWithSummary>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeMap {
    /// Groups of changes that share a generated semantic summary.
    pub groups: Vec<SemanticChangeGroup>,
    /// Changes with their own summaries or no group membership.
    pub singles: Vec<ChangeWithSummary>,
    /// Hashes for changes that could not be summarized.
    pub unsummarized_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChange {
    /// Raw change row.
    pub change: Change,
    /// Summary attached directly to this change.
    pub own_summary: Option<ChangeSummary>,
    /// Summary inherited from this change's group.
    pub group_summary: Option<ChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChangeSet {
    /// Change set represented by this response.
    pub change_set: ChangeSet,
    /// Changes in the set with their available summaries.
    pub changes: Vec<SummarizedChange>,
    /// Change hashes expected in the set but missing from the database.
    pub missed_hashes: Vec<String>,
}

/// A commit entry combining git log data, tag-derived flags, optional DB metadata, and raw diff changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    /// Git commit hash represented by this history row.
    pub hash: String,
    /// Commit message, if available from git or local metadata.
    pub message: Option<String>,
    /// Commit timestamp.
    pub created_at: i64,
    /// Whether this commit corresponds to the active build record.
    pub is_built: bool,
    /// Whether this commit is the configured base commit.
    pub is_base: bool,
    /// Whether this commit was created outside nixmac.
    pub is_external: bool,
    /// Number of files changed in this commit.
    pub file_count: usize,
    /// Matching persisted commit row, if one exists.
    pub commit: Option<crate::sqlite_types::Commit>,
    /// Semantic summaries for this commit's changes.
    pub change_map: Option<SemanticChangeMap>,
    /// Change hashes without summaries.
    pub unsummarized_hashes: Vec<String>,
    /// Raw changes parsed for this history item.
    pub raw_changes: Vec<crate::sqlite_types::Change>,
    /// Message of the commit this entry originated from, for restore/orphan flows.
    pub origin_message: Option<String>,
    /// Hash of the commit this entry originated from, for restore/orphan flows.
    pub origin_hash: Option<String>,
    /// Whether this represents a restored build no longer on the visible branch.
    pub is_orphaned_restore: bool,
    /// Whether this history item has been undone by a later restore operation.
    pub is_undone: bool,
}

// =============================================================================
// Evolve routing state
// =============================================================================

/// Widget step derived from `EvolveState` fields.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolveStep {
    /// Initial prompt entry state.
    #[default]
    Begin,
    /// AI evolution is in progress or ready for review.
    Evolve,
    /// Changes are built and ready to commit.
    #[serde(alias = "merge")]
    Commit,
    /// User is manually editing generated changes.
    ManualEvolve,
    /// Manual changes are ready to commit.
    ManualCommit,
}

/// Persisted evolve state stored in `evolve-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveState {
    /// Active evolution database id.
    pub evolution_id: Option<i64>,
    /// Active changeset id for the current repo state.
    pub current_changeset_id: Option<i64>,
    /// Maintained for compatibility
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub changeset_at_build: Option<i64>,
    /// Whether the current state has been successfully built and can be committed.
    pub committable: bool,
    /// Branch used to reset repo state on evolve failure.
    pub backup_branch: Option<String>,
    /// Branch used to recover repo state during rollback.
    pub rollback_branch: Option<String>,
    /// Nix store path that should be reactivated during rollback.
    pub rollback_store_path: Option<String>,
    /// Changeset id associated with the rollback target.
    pub rollback_changeset_id: Option<i64>,
    /// UI step derived from the routing state.
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
    /// Selected absolute config directory.
    pub dir: String,
    /// Fresh evolve state after changing directories, when applicable.
    pub evolve_state: Option<EvolveState>,
    /// Hosts discovered in the selected flake, when applicable.
    pub hosts: Option<Vec<String>>,
}

// =============================================================================
// Rollback result types
// =============================================================================

/// Result returned from a rollback erase operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    /// Git status after rollback preparation.
    pub git_status: GitStatus,
    /// Evolve state after rollback preparation.
    pub evolve_state: EvolveState,
    /// Store path to reactivate as part of the rollback flow.
    pub rollback_store_path: Option<String>,
    /// Changeset id associated with the rollback target.
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
    /// Final lifecycle state for the evolution.
    pub state: EvolutionState,
    /// Number of agent iterations completed.
    pub iterations: usize,
    /// Number of build attempts completed.
    pub build_attempts: usize,
    /// Total token count reported by the provider.
    pub total_tokens: u32,
    /// Number of edit operations performed.
    pub edits_count: usize,
    /// Number of reasoning/thinking events observed.
    pub thinking_count: usize,
    /// Number of tool calls performed.
    pub tool_calls_count: usize,
    /// Total evolution duration in milliseconds.
    pub duration_ms: i64,
}

/// Evolution result returned to the frontend on completion.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionResult {
    /// Semantic summary of the generated changes.
    pub change_map: SemanticChangeMap,
    /// Git status after evolution completes.
    pub git_status: GitStatus,
    /// Evolve routing state after evolution completes.
    pub evolve_state: EvolveState,
    /// Assistant response when no file changes were produced.
    pub conversational_response: Option<String>,
    /// Telemetry collected during evolution.
    pub telemetry: EvolutionTelemetry,
}

/// Evolution failure payload with partial telemetry.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionFailureResult {
    /// Error message returned to the frontend.
    pub error: String,
    /// Best-effort git status captured after failure.
    pub git_status: Option<GitStatus>,
    /// Partial telemetry captured before failure.
    pub telemetry: EvolutionTelemetry,
}

// =============================================================================
// UI Preferences
// =============================================================================

/// User interface preferences (synced to settings.json via tauri-plugin-store).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    /// OpenRouter API key stored in local app preferences.
    pub openrouter_api_key: Option<String>,
    /// OpenAI API key stored in local app preferences.
    pub openai_api_key: Option<String>,
    /// Base URL for Ollama-compatible local models.
    pub ollama_api_base_url: Option<String>,
    /// Base URL for vLLM-compatible model servers.
    pub vllm_api_base_url: Option<String>,
    /// API key for vLLM-compatible model servers.
    pub vllm_api_key: Option<String>,
    /// Provider used for change summaries.
    pub summary_provider: Option<String>,
    /// Model used for change summaries.
    pub summary_model: Option<String>,
    /// Provider used for AI evolution.
    pub evolve_provider: Option<String>,
    /// Model used for AI evolution.
    pub evolve_model: Option<String>,
    /// Maximum agent iterations per evolution.
    pub max_iterations: Option<usize>,
    /// Maximum build attempts per evolution.
    pub max_build_attempts: Option<usize>,
    /// Whether diagnostic feedback may be sent.
    pub send_diagnostics: bool,
    /// Whether to confirm before running build/apply.
    pub confirm_build: bool,
    /// Whether to confirm before clearing changes.
    pub confirm_clear: bool,
    /// Whether to confirm before rollback.
    pub confirm_rollback: bool,
    /// Whether to auto-summarize changes when the app regains focus.
    pub auto_summarize_on_focus: bool,
    /// Whether Homebrew state should be scanned on app startup.
    pub scan_homebrew_on_startup: bool,
    /// Whether developer-only UI/actions are enabled.
    pub developer_mode: bool,
    /// Version pinned by the user, when update pinning is active.
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
    /// OpenRouter API key update.
    pub openrouter_api_key: Option<String>,
    /// OpenAI API key update.
    pub openai_api_key: Option<String>,
    /// Evolution provider update.
    pub evolve_provider: Option<String>,
    /// Evolution model update.
    pub evolve_model: Option<String>,
    /// Summary provider update.
    pub summary_provider: Option<String>,
    /// Summary model update.
    pub summary_model: Option<String>,
    /// Maximum iteration count update.
    pub max_iterations: Option<usize>,
    /// Maximum build-attempt count update.
    pub max_build_attempts: Option<usize>,
    /// Ollama base URL update.
    pub ollama_api_base_url: Option<String>,
    /// vLLM base URL update.
    pub vllm_api_base_url: Option<String>,
    /// vLLM API key update.
    pub vllm_api_key: Option<String>,
    /// Diagnostics sharing preference update.
    pub send_diagnostics: Option<bool>,
    /// Build confirmation preference update.
    pub confirm_build: Option<bool>,
    /// Clear confirmation preference update.
    pub confirm_clear: Option<bool>,
    /// Rollback confirmation preference update.
    pub confirm_rollback: Option<bool>,
    /// Focus auto-summary preference update.
    pub auto_summarize_on_focus: Option<bool>,
    /// Startup Homebrew scan preference update.
    pub scan_homebrew_on_startup: Option<bool>,
    /// Developer mode preference update.
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
    /// True when the command completed successfully.
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
    /// Whether Nix is installed.
    pub installed: bool,
    /// Installed Nix version string, when available.
    pub version: Option<String>,
    /// Whether `darwin-rebuild` is available.
    pub darwin_rebuild_available: bool,
}

// =============================================================================
// Build check result
// =============================================================================

/// Result of `darwin_build_check` — dry-run build outcome.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuildCheckResult {
    /// Whether the dry-run build passed.
    pub passed: bool,
    /// Build output or failure details.
    pub output: String,
}

// =============================================================================
// Config-edit apply result
// =============================================================================

/// Result of a managed-edit apply operation (homebrew, system-defaults, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEditApplyResult {
    /// Whether the config edit was applied.
    pub ok: bool,
    /// Number of items applied.
    pub count: usize,
    /// Semantic summary after applying the edit.
    pub change_map: SemanticChangeMap,
    /// Git status after applying the edit.
    pub git_status: GitStatus,
    /// Evolve routing state after applying the edit.
    pub evolve_state: EvolveState,
}

// =============================================================================
// CLI tools availability
// =============================================================================

/// Availability of known AI CLI tools.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CliToolsState {
    /// Whether the Claude CLI is installed.
    pub claude: bool,
    /// Whether the Codex CLI is installed.
    pub codex: bool,
    /// Whether the OpenCode CLI is installed.
    pub opencode: bool,
}

// =============================================================================
// Preview indicator state
// =============================================================================

/// State sent to the preview indicator window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIndicatorState {
    /// Whether the floating preview indicator should be visible.
    pub visible: bool,
    /// Summary text displayed in the indicator.
    pub summary: Option<String>,
    /// Number of changed files represented by the indicator.
    pub files_changed: usize,
    /// Added lines displayed in the indicator.
    pub additions: Option<usize>,
    /// Removed lines displayed in the indicator.
    pub deletions: Option<usize>,
    /// Whether the indicator should show a loading state.
    pub is_loading: bool,
}

// =============================================================================
// macOS permissions
// =============================================================================

/// Permission status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    /// Permission has been granted.
    Granted,
    /// Permission was checked and denied.
    Denied,
    /// Permission has not been resolved yet.
    Pending,
    /// Permission state could not be determined.
    Unknown,
}

/// Individual permission state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    /// Stable permission identifier.
    pub id: String,
    /// Human-readable permission name.
    pub name: String,
    /// Why nixmac needs this permission.
    pub description: String,
    /// Whether onboarding requires this permission.
    pub required: bool,
    /// Whether the app can trigger the system prompt directly.
    pub can_request_programmatically: bool,
    /// Current permission status.
    pub status: PermissionStatus,
    /// Manual instructions for permissions that cannot be requested programmatically.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

/// All permissions state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsState {
    /// Individual permission states.
    pub permissions: Vec<Permission>,
    /// True when every required permission is granted.
    pub all_required_granted: bool,
    /// Unix timestamp when permissions were last checked.
    pub checked_at: Option<i64>,
}

// =============================================================================
// System defaults scanner
// =============================================================================

/// A single macOS system default that differs from the factory value.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefault {
    /// nix-darwin option path for this macOS default.
    pub nix_key: String,
    /// Human-readable setting label.
    pub label: String,
    /// UI grouping category.
    pub category: String,
    /// Current value read from macOS defaults.
    pub current_value: String,
    /// Factory/default value used for comparison.
    pub default_value: String,
}

/// Result of a full system defaults scan.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefaultsScan {
    /// Defaults that differ from known factory values.
    pub defaults: Vec<SystemDefault>,
    /// Number of defaults keys scanned.
    pub total_scanned: usize,
}

/// A recommended prompt based on the user's current macOS settings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedPrompt {
    /// Stable prompt identifier.
    pub id: String,
    /// Prompt text suggested to the user.
    pub prompt_text: String,
}

// =============================================================================
// Editor file entries
// =============================================================================

/// File or directory entry returned by the editor tree.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Path relative to the selected config directory.
    pub path: String,
    /// File or directory basename.
    pub name: String,
    /// Whether this entry is a directory.
    pub is_dir: bool,
}

// =============================================================================
// Debug / test helpers
// =============================================================================

/// Response from the debug Sentry event command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DebugSentryResult {
    /// Whether the debug event was sent.
    pub ok: bool,
    /// Human-readable result message.
    pub message: String,
}

// =============================================================================
// Evolve cancel / answer acknowledgements
// =============================================================================

/// Acknowledgement from `darwin_evolve_cancel`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EvolveCancelResult {
    /// Whether the cancellation request was accepted.
    pub ok: bool,
    /// Human-readable cancellation result.
    pub message: String,
}

// =============================================================================
// Git commit result
// =============================================================================

/// Result of a successful `git_commit` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    /// Hash of the commit that was created.
    pub hash: String,
    /// Evolve state after committing.
    pub evolve_state: EvolveState,
}

// =============================================================================
// Finalize apply result
// =============================================================================

/// Result of a successful `finalize_apply` or `finalize_rollback` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeApplyResult {
    /// Git status after finalization.
    pub git_status: GitStatus,
    /// Evolve state after finalization.
    pub evolve_state: EvolveState,
}
