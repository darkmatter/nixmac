//! Converts a `SemanticChangeMap` into a `SimplifiedMap` used by AI to extract meaning


#![allow(dead_code)]

use crate::changes_from_diff::SHORT_HASH_LEN;
use crate::shared_types::{ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap};
use crate::summarize::sumlog as dbg;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimplifiedChange {
    pub hash: String,
    pub filename: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimplifiedGroup {
    pub group_id: i64,
    pub title: String,
    pub description: String,
    pub changes: Vec<SimplifiedChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimplifiedMap {
    pub groups: Vec<SimplifiedGroup>,
    pub singles: Vec<SimplifiedChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missed_hashes: Option<Vec<String>>,
}

fn simplify(map: &SemanticChangeMap) -> SimplifiedMap {
    SimplifiedMap {
        groups: map.groups.iter().map(simplify_group).collect(),
        singles: map.singles.iter().map(simplify_change).collect(),
        missed_hashes: Some(map.missed_hashes.clone()),
    }
}

pub fn full(map: &SemanticChangeMap) -> SimplifiedMap {
    let result = simplify(map);
    dbg::simplify_log_result(&result);
    result
}

pub fn for_hash_placement(map: &SemanticChangeMap) -> SimplifiedMap {
    let mut result = simplify(map);
    // model sees this for existing, missed hashes are analyzed in full
    result.missed_hashes = None;
    for group in &mut result.groups {
        for change in &mut group.changes {
            change.hash.truncate(SHORT_HASH_LEN);
        }
    }
    // model occasionally chokes on full hashes
    for single in &mut result.singles {
        single.hash.truncate(SHORT_HASH_LEN);
    }
    result
}

pub fn json(map: &SemanticChangeMap) -> anyhow::Result<String> {
    serde_json::to_string_pretty(&simplify(map))
        .map_err(|e| anyhow::anyhow!("failed to serialize simplified map: {}", e))
}

fn simplify_group(group: &SemanticChangeGroup) -> SimplifiedGroup {
    SimplifiedGroup {
        group_id: group.summary.id,
        title: group.summary.title.clone(),
        description: group.summary.description.clone(),
        changes: group.changes.iter().map(simplify_change).collect(),
    }
}

pub fn from_change_with_summary(c: &ChangeWithSummary) -> SimplifiedChange {
    SimplifiedChange {
        hash: c.hash.clone(),
        filename: c.filename.clone(),
        title: c.title.clone(),
        description: c.description.clone(),
    }
}

fn simplify_change(c: &ChangeWithSummary) -> SimplifiedChange {
    from_change_with_summary(c)
}
