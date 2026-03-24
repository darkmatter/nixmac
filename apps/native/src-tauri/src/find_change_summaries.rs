//! Orchestrators for querying change sets and summarized changes from the DB.
//!
//! Opens a connection and delegates to `db::changesets` query helpers.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

use crate::query_return_types::{SummarizedChanges, FoundChanges};

/// Clean HEAD: find the change set for a specific commit→base pair with all changes resolved.
pub fn by_commit_pair(
    db_path: &Path,
    commit_id: i64,
    base_commit_id: i64,
) -> Result<Option<SummarizedChanges>> {
    let conn = Connection::open(db_path)?;
    crate::db::changesets::query_change_set_for_commit_pair(&conn, commit_id, base_commit_id)
}

/// Dirty HEAD: given a base commit and a set of hashes from the current diff,
/// return matched changes with summaries and which hashes still need the pipeline.
#[allow(dead_code)]
pub fn from_base_commit(
    db_path: &Path,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<FoundChanges> {
    let conn = Connection::open(db_path)?;
    let matched =
        crate::db::changesets::query_changes_by_hashes_for_base(&conn, base_commit_id, hashes)?;
    let matched_hashes: std::collections::HashSet<&str> =
        matched.iter().map(|sc| sc.change.hash.as_str()).collect();
    let unsummarized_hashes = hashes
        .iter()
        .filter(|h| !matched_hashes.contains(h.as_str()))
        .cloned()
        .collect();
    Ok(FoundChanges { summarized: matched, unsummarized_hashes })
}
