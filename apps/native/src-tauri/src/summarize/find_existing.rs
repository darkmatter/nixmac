//! Orchestrators for querying change sets and summarized changes from the DB.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

use crate::summarize::sumlog as dbg;
use crate::shared_types::SummarizedChangeSet;

/// Used by history to look up each commit's summarized changes.
pub fn by_commit_pair(
    db_path: &Path,
    commit_id: i64,
    base_commit_id: i64,
) -> Result<Option<SummarizedChangeSet>> {
    let conn = Connection::open(db_path)?;
    crate::db::changesets::query_change_set_for_commit_pair(&conn, commit_id, base_commit_id)
}

/// Looks up summarized changes for the current git state.
pub fn for_current_state(db_path: &Path, dir: &str) -> Result<Vec<SummarizedChangeSet>> {
    let status = crate::git::status(dir)?;

    let Some(head_hash) = status.head_commit_hash.as_deref() else {
        return Ok(vec![]);
    };
    let Some(commit) = crate::db::commits::get_commit_by_hash(db_path, head_hash)? else {
        return Ok(vec![]);
    };

    let hashes: Vec<String> = status.changes.into_iter().map(|c| c.hash).collect();
    dbg::find_log_path(&dbg::FindPath {
        head_hash,
        commit_id: commit.id,
        hashes: &hashes,
    });
    let conn = Connection::open(db_path)?;
    let result: Vec<SummarizedChangeSet> =
        crate::db::changesets::query_change_set_for_base_with_hashes(&conn, commit.id, &hashes)?
            .into_iter()
            .collect();

    dbg::find_log_result(&result);
    Ok(result)
}
