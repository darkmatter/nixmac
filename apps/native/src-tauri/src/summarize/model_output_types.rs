//! Shared output types for model calls.

use serde::{Deserialize, Serialize};

/// Title + description pair returned for a hunk or group summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkSummary {
    pub title: String,
    pub description: String,
}

/// Result of a group summarization call.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct EvolvedGroupSummary {
    pub former_group_id: i64,
    pub group: HunkSummary,
    /// hash → own summary for each hunk
    pub own_summaries: std::collections::HashMap<String, HunkSummary>,
}

/// Flat placement decision returned by `map_relations_to_existing`.
#[derive(Serialize, Deserialize)]
pub struct RawHunkPlacement {
    pub hash: String,
    pub group_id: Option<i64>,
    pub pair_hash: Option<String>,
    pub reason: String,
}

/// Per-hunk grouping entry returned by `map_relations`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawNewMapEntry {
    pub hash: String,
    pub group_id: Option<i64>,
    pub reason: String,
}
