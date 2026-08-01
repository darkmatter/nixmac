//! Rust structs that mirror schema table rows exactly.
//!
//! Keep these in sync with the table definitions in `db/schema.rs`
//! and the type registrations in `examples/specta_gen_ts.rs`.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    #[specta(type = f64)]
    pub id: i64,
    pub hash: String,
    pub tree_hash: String,
    pub message: Option<String>,
    #[specta(type = f64)]
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Evolution {
    pub id: i64,
    pub origin_branch: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    #[specta(type = f64)]
    pub id: i64,
    pub hash: String,
    pub filename: String,
    pub diff: String,
    #[specta(type = f64)]
    pub line_count: i64,
    #[specta(type = f64)]
    pub created_at: i64,
    #[specta(type = f64)]
    pub own_summary_id: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    #[specta(type = f64)]
    pub id: i64,
    pub title: String,
    pub description: String,
    /// One of `"QUEUED"`, `"DONE"`, `"FAILED"`, `"CANCELLED"`.
    pub status: String,
    #[specta(type = f64)]
    pub created_at: i64,
}
