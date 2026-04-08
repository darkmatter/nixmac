//! Rust structs that mirror schema table rows exactly.
//!
//! Keep these in sync with the table definitions in `db/schema.rs`
//! and the type registrations in `examples/specta_gen_ts.rs`.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: i64,
    pub hash: String,
    pub tree_hash: String,
    pub message: Option<String>,
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Evolution {
    pub id: i64,
    pub origin_branch: String,
    pub merged: i64,
    pub builds: i64,
}


#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: i64,
    pub text: String,
    pub commit_id: Option<i64>,
    pub created_at: i64,
}

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
    pub own_summary_id: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub id: i64,
    pub title: String,
    pub description: String,
    /// One of `"QUEUED"`, `"DONE"`, `"FAILED"`, `"CANCELLED"`.
    pub status: String,
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSummary {
    pub id: i64,
    pub status: String,
    pub attempted_count: i64,
    pub prompt: String,
    pub model_response: Option<String>,
    pub group_summary_id: Option<i64>,
    /// JSON-encoded `[{"hash": "...", "summary_id": N}]` pairs used by the
    /// queue processor to link model output back to the right summary rows.
    pub hash_own_summary_id_pairs: Option<String>,
    /// One of `"NEW_SINGLE"`, `"NEW_GROUP"`, or `"EVOLVED_GROUP"`.
    pub summary_type: String,
}

/// Groups Changes for a commit→base_commit pair. `commit_id` is NULL for speculative
/// (uncommitted) changesets. Membership is stored in the `set_changes` join table.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub id: i64,
    pub commit_id: Option<i64>,
    pub base_commit_id: i64,
    pub commit_message: Option<String>,
    pub generated_commit_message: Option<String>,
    pub created_at: i64,
    pub evolution_id: Option<i64>,
}
