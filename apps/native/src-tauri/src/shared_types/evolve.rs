use serde::{Deserialize, Serialize};
use specta::Type;

use super::git::{GitStatus, SemanticChangeMap};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    pub search: String,
    pub replace: String,
}

/// A semantic edit operation on a nix attribute path.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FileEditAction {
    /// Generic add to an attribute path: e.g. { path: "environment.systemPackages", values: ["ripgrep"] }
    Add { path: String, values: Vec<String> },
    /// Generic remove from an attribute path
    Remove { path: String, values: Vec<String> },
    /// Set an attribute path to a scalar JSON value (bool/string/number/null)
    Set {
        path: String,
        value: serde_json::Value,
    },
    /// Create or update an attribute set at a given path, setting multiple scalar key-value pairs.
    /// For missing paths a new attrset assignment is inserted; for existing ones the named keys are
    /// updated in-place (or appended) without disturbing the rest of the block.
    SetAttrs {
        path: String,
        attrs: serde_json::Map<String, serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticFileEdit {
    pub path: String, // the nix file being edited
    pub action: FileEditAction,
}

/// A single thinking entry from the agent's reasoning process
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingEntry {
    /// When this thought occurred (ms since evolution start)
    #[specta(type = f64)]
    pub timestamp_ms: i64,
    /// The iteration number when this thought occurred
    #[specta(type = f64)]
    pub iteration: usize,
    /// Category of thinking (planning, analysis, debugging, etc.)
    pub category: String,
    /// The actual thought content
    pub content: String,
}

/// A tool call record for the activity log
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    /// When this tool was called (ms since evolution start)
    #[specta(type = f64)]
    pub timestamp_ms: i64,
    /// The iteration number
    #[specta(type = f64)]
    pub iteration: usize,
    /// Tool name
    pub tool: String,
    /// Tool arguments (simplified)
    pub args_summary: String,
    /// Result summary
    pub result_summary: String,
    /// Whether the call succeeded
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Evolution {
    pub id: String,
    #[specta(type = f64)]
    pub created_at: i64,
    pub state: EvolutionState,
    pub prompt: String,
    pub edits: Vec<FileEdit>,
    pub commit_hash: Option<String>,
    pub summary: Option<String>,
    /// Full message history for context
    pub messages: Vec<serde_json::Value>,
    /// Agent's thinking/reasoning log
    pub thinking: Vec<ThinkingEntry>,
    /// Tool call activity log
    pub tool_calls: Vec<ToolCallRecord>,
    /// Total tokens used
    pub total_tokens: u32,
    /// Number of iterations
    #[specta(type = f64)]
    pub iterations: usize,
    /// Number of build attempts
    #[specta(type = f64)]
    pub build_attempts: usize,
    /// AI-generated summary of changes for preview
    pub changes_summary: Option<String>,
    /// AI-generated commit message suggestion
    pub suggested_commit_message: Option<String>,
}

/// Who is asking a [`EvolveEventDetail::Question`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QuestionKind {
    /// The agent needs a content decision from the user (`ask_user` tool).
    Agent,
    /// A safety limit was reached and the system asks whether to continue.
    Checkpoint,
}

/// Structured payload carried by an [`EvolveEvent`]. Lets the frontend render
/// events from typed data instead of parsing the formatted `summary`/`raw`
/// strings (which remain the fallback and feed the Console / transcripts).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum EvolveEventDetail {
    /// The `think` tool's full reasoning text.
    Thinking { category: String, text: String },
    /// A tool invocation with its (sanitized) arguments.
    ToolCall {
        tool: String,
        args: serde_json::Value,
    },
    /// A package search and its results.
    SearchPackages { query: String, found: Vec<String> },
    /// A file edit; `action` is present for semantic nix edits.
    Edit {
        file: String,
        action: Option<FileEditAction>,
    },
    /// A build check outcome with the captured output.
    Build {
        pass: bool,
        #[specta(type = f64)]
        attempt: usize,
        output: String,
    },
    /// A streamed chunk of build-check output, emitted in throttled batches
    /// while the check runs.
    BuildOutput { chunk: String },
    /// A streamed slice of assistant text, emitted in throttled batches while
    /// the provider responds; the full text follows as Narration or the
    /// terminal summary once the response completes.
    StreamDelta { text: String },
    /// The provider abandoned a partial streamed response and is retrying;
    /// deltas before this marker belong to the discarded attempt.
    StreamReset,
    /// Assistant narration between tool calls.
    Narration { text: String },
    /// Budget counters, emitted with every provider response.
    Progress {
        /// Cumulative session tokens used.
        tokens: u32,
        /// Session token budget.
        budget: u32,
        /// Current iteration.
        #[specta(type = f64)]
        iteration: usize,
        /// Iteration limit.
        #[specta(type = f64)]
        limit: usize,
    },
    /// A question the run is blocked on.
    Question {
        text: String,
        choices: Option<Vec<String>>,
        kind: QuestionKind,
    },
    /// The user's answer to the pending question.
    Answered { text: String },
}

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
    /// Structured payload for typed rendering; `None` on events that predate
    /// it or have no structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub detail: Option<EvolveEventDetail>,
    /// Telemetry collected during the run; only on the terminal `Complete` event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub telemetry: Option<EvolutionTelemetry>,
    /// Assistant response when no environment changes were produced; only on
    /// the terminal `Complete` event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub conversational_response: Option<String>,
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
    /// User answered the pending question.
    Answered,
    /// Assistant narration between tool calls.
    Narration,
    /// A streamed slice of the assistant response being generated.
    StreamDelta,
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

/// The owned, persisted unit of an evolve session, stored in
/// `evolve-state.json`.
///
/// This is the source of truth: the identity of an active evolution and the
/// bookkeeping needed to roll it back. It deliberately holds NO derived
/// fields — the UI `step` and the `committable` flag are pure functions of
/// this session plus live build/git state, computed on demand by
/// `state::evolve_state::project` and never stored.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EvolveSession {
    /// Active evolution database id.
    pub evolution_id: Option<i64>,
    /// Active changeset id for the current repo state.
    pub current_changeset_id: Option<i64>,
    /// Branch used to reset repo state on evolve failure.
    pub backup_branch: Option<String>,
    /// Branch used to recover repo state during rollback.
    pub rollback_branch: Option<String>,
    /// Nix store path that should be reactivated during rollback.
    pub rollback_store_path: Option<String>,
    /// Changeset id associated with the rollback target.
    pub rollback_changeset_id: Option<i64>,
    /// Last terminal state observed for this routing session.
    ///
    /// This supports transition-sensitive behavior when returning to Begin
    /// and maybe some other useful things in the future.
    pub last_evolution_state: Option<EvolutionState>,
}

/// The evolve routing state as projected for the frontend: the owned
/// [`EvolveSession`] fields joined with the two derived values (`step`,
/// `committable`).
///
/// This is the wire/event type — it is computed by
/// `state::evolve_state::project` and is never persisted or treated as a
/// source of truth on its own. `step` and `committable` are always recomputed
/// from live build/git state, so a value of this type is only a snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveState {
    /// Active evolution database id.
    #[specta(type = Option<f64>)]
    pub evolution_id: Option<i64>,
    /// Active changeset id for the current repo state.
    #[specta(type = Option<f64>)]
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
    #[specta(type = Option<f64>)]
    pub rollback_changeset_id: Option<i64>,
    /// UI step derived from the session plus live build/git state.
    pub step: EvolveStep,
    /// Last terminal state observed for this routing session.
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
    /// Evolution was stopped because a safety limit was reached
    /// (iterations, build attempts, token budget, or stale progress).
    /// Distinguishes "we cut it off" from "the agent finished" so
    /// the eval harness can score runaways correctly.
    LimitReached,
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
