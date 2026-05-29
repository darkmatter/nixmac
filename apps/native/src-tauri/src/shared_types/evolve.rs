use serde::{Deserialize, Serialize};
use specta::Type;

use super::git::{GitStatus, SemanticChangeMap};

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
    // Agent is searching for nix packages
    SearchPackages,
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
    /// Last terminal state observed for this routing session.
    ///
    /// This supports transition-sensitive behavior when returning to Begin
    /// and maybe some other useful things in the future.
    #[serde(default)]
    pub last_evolution_state: Option<EvolutionState>,
}

impl Default for EvolveState {
    fn default() -> Self {
        Self {
            evolution_id: None,
            current_changeset_id: None,
            committable: false,
            backup_branch: None,
            rollback_branch: None,
            rollback_store_path: None,
            rollback_changeset_id: None,
            step: EvolveStep::Begin,
            last_evolution_state: None,
        }
    }
}

/// Evolution lifecycle state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionState {
    /// Initial state before generation starts.
    Pending,
    /// Currently generating/processing.
    Loading,
    /// Generation complete, ready for review.
    Generated,
    /// Changes have been applied (darwin-rebuild ran).
    Applied,
    /// Changes have been committed.
    Committed,
    /// An error occurred.
    Failed,
    /// Agent responded conversationally without making any environment changes.
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

/// Acknowledgement from `darwin_evolve_cancel`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EvolveCancelResult {
    /// Whether the cancellation request was accepted.
    pub ok: bool,
    /// Human-readable cancellation result.
    pub message: String,
}

/// Result of a successful `finalize_apply` or `finalize_rollback` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeApplyResult {
    /// Git status after finalization.
    pub git_status: GitStatus,
    /// Evolve state after finalization.
    pub evolve_state: EvolveState,
}
