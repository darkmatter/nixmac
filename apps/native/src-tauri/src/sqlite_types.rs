//! Rust structs that mirror schema table rows exactly.
//!
//! Keep these in sync with the table definitions in `db/schema.rs`
//! and the type registrations in `examples/export_bindings.rs`.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub id: i64,
    pub hash: String,
    pub tree_hash: String,
    pub message: Option<String>,
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SquashedCommitRow {
    pub target_id: i64,
    pub source_id: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionRow {
    pub id: i64,
    pub branch: String,
    pub merged: i64,
    pub builds: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionCommitRow {
    pub evolution_id: i64,
    pub commit_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRow {
    pub id: i64,
    pub commit_id: i64,
    pub base_commit_id: Option<i64>,
    pub content_json: String,
    pub diff: String,
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PromptRow {
    pub id: i64,
    pub text: String,
    pub commit_id: Option<i64>,
    pub created_at: i64,
}

// New change-set pipeline — schema not yet applied.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: i64,
    pub hash: String,
    pub filename: String,
    pub diff: String,
    pub line_count: i64,
    pub created_at: i64,
    pub group_summary_id: Option<i64>,
    pub own_summary_id: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub created_at: i64,
}

/// Groups Changes for a commit→base_commit pair.
/// `change_ids` is stored as a JSON array in SQLite (TEXT column).
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub id: i64,
    pub commit_id: i64,
    pub base_commit_id: Option<i64>,
    pub commit_message: String,
    pub created_at: i64,
    pub change_ids: Vec<i64>,
}
