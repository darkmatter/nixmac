//! Rust structs that mirror schema table rows exactly.
//!
//! Keep these in sync with the table definitions in `db/schema.rs`.

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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoricCommitAndSummary {
    pub commit: CommitRow,
    pub summary: Option<SummaryRow>,
}
