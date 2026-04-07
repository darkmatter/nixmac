//! Shared types exported to TypeScript via Specta — both query results and UI routing state.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

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
    pub head_is_built: bool,
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
    pub missed_hashes: Vec<String>,
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
    pub raw_changes: Vec<crate::sqlite_types::Change>,
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
    Merge,
}

/// Persisted evolve state stored in `evolve-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolveState {
    pub evolution_id: Option<i64>,
    pub current_changeset_id: Option<i64>,
    pub changeset_at_build: Option<i64>,
    pub committable: bool,
    pub backup_branch: Option<String>,
    /// Computed from the other fields — always kept in sync by `set`.
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
            step: EvolveStep::Begin,
        }
    }
}

impl EvolveState {
    #[allow(dead_code)]
    pub fn recompute_step(&mut self) {
        self.step = match (self.evolution_id, self.committable) {
            (None, _) => EvolveStep::Begin,
            (Some(_), false) => EvolveStep::Evolve,
            (Some(_), true) => EvolveStep::Merge,
        };
    }
}
