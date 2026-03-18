//! Composed query result types — not schema row mirrors.
//!
//! These are assembled from multiple tables and are separate from `sqlite_types.rs`,
//! which stays as a pure reflection of the DB schema.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChange {
    pub change: Change,
    pub own_summary: Option<ChangeSummary>,
    pub group_summary: Option<ChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChanges {
    pub change_set: ChangeSet,
    pub changes: Vec<SummarizedChange>,
}

/// Result of a dirty-HEAD hash lookup.
/// `unsummarized_hashes` contains hashes with no stored match — these still need the pipeline.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FoundChanges {
    pub summarized: Vec<SummarizedChange>,
    pub unsummarized_hashes: Vec<String>,
}
