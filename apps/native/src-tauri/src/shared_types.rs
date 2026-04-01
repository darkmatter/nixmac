//! Shared types exported to TypeScript via Specta — both query results and UI routing state.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

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
