//! Orchestrators for querying change sets and summarized changes from the DB.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

use crate::summarize::sumlog as dbg;
use crate::shared_types::{SummarizedChange, SummarizedChangeSet};
use crate::sqlite_types::ChangeSet;

/// Intermediate type shared only between `for_current_state` and `group_existing::from_change_sets`.
/// Mirrors `SummarizedChangeSet` but with `change_set: Option<ChangeSet>` so that when the DB
/// has no record for the current HEAD we can still carry all diff hashes as `missed_hashes`.
pub struct FoundSetForCurrent {
    pub change_set: Option<ChangeSet>,
    pub changes: Vec<SummarizedChange>,
    pub missed_hashes: Vec<String>,
}

impl From<SummarizedChangeSet> for FoundSetForCurrent {
    fn from(cs: SummarizedChangeSet) -> Self {
        Self {
            change_set: Some(cs.change_set),
            changes: cs.changes,
            missed_hashes: cs.missed_hashes,
        }
    }
}

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
/// Returns [`FoundSetForCurrent`] values consumed by `group_existing::from_change_sets`.
///
/// When the DB has no record for the current HEAD (e.g. after dropping the DB), returns a
/// single entry with no changes but all diff hashes in `missed_hashes`, so callers can
/// detect that there are unsummarized changes even with an empty DB.
pub fn for_current_state(db_path: &Path, dir: &str) -> Result<Vec<FoundSetForCurrent>> {
    let status = crate::git::status(dir)?;

    let Some(head_hash) = status.head_commit_hash.as_deref() else {
        return Ok(vec![]);
    };

    let diff_hashes: Vec<String> = status.changes.iter().map(|c| c.hash.clone()).collect();

    let Some(commit) = crate::db::commits::get_commit_by_hash(db_path, head_hash)? else {
        // DB has no record for this commit — surface all hashes as missed so the
        // frontend knows there are unsummarized changes.
        return Ok(vec![FoundSetForCurrent {
            change_set: None,
            changes: vec![],
            missed_hashes: diff_hashes,
        }]);
    };

    dbg::find_log_path(&dbg::FindPath {
        head_hash,
        commit_id: commit.id,
        hashes: &diff_hashes,
    });
    let conn = Connection::open(db_path)?;
    let result: Vec<FoundSetForCurrent> =
        crate::db::changesets::query_change_set_for_base_with_hashes(&conn, commit.id, &diff_hashes)?
            .into_iter()
            .map(FoundSetForCurrent::from)
            .collect();

    dbg::find_log_result(result.iter().map(|e| (e.change_set.is_some(), e.changes.len(), e.missed_hashes.len())));
    Ok(result)
}
