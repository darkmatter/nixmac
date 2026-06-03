//! Orchestrators for querying change sets and summarized changes from the DB.

use anyhow::Result;

use crate::db::DbPool;
use crate::shared_types::{SummarizedChange, SummarizedChangeSet};
use crate::sqlite_types::ChangeSet;
use crate::summarize::sumlog as dbg;

/// Type shared only between `for_current_state` and `group_existing::from_change_sets`.
/// Ensures missing hashes can be passed through when DB had nothing
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

/// Looks up changes for hashes against a known base commit
pub fn by_base_with_hashes(
    pool: &DbPool,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<FoundSetForCurrent> {
    let mut conn = pool.get()?;
    match crate::db::changesets::query_change_set_for_base_with_hashes(
        &mut conn,
        base_commit_id,
        hashes,
    )? {
        Some(cs) => Ok(FoundSetForCurrent::from(cs)),
        None => Ok(FoundSetForCurrent {
            change_set: None,
            changes: vec![],
            missed_hashes: hashes.to_vec(),
        }),
    }
}

/// Retuns existing summaries for head and missed hashes for unsummarized
pub fn for_current_state(pool: &DbPool, dir: &str) -> Result<Vec<FoundSetForCurrent>> {
    let status = crate::git::status(dir)?;

    let Some(head_hash) = status.head_commit_hash.as_deref() else {
        return Ok(vec![]);
    };

    let diff_hashes: Vec<String> = status.changes.iter().map(|c| c.hash.clone()).collect();

    let Some(commit) = crate::db::commits::get_commit_by_hash(pool, head_hash)? else {
        // DB has no record for this commit — surface all hashes as missed
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

    let mut conn = pool.get()?;
    let result: Vec<FoundSetForCurrent> =
        match crate::db::changesets::query_change_set_for_base_with_hashes(
            &mut conn,
            commit.id,
            &diff_hashes,
        )? {
            Some(cs) => vec![FoundSetForCurrent::from(cs)],
            None => vec![FoundSetForCurrent {
                change_set: None,
                changes: vec![],
                missed_hashes: diff_hashes,
            }],
        };

    dbg::find_log_result(result.iter().map(|e| {
        (
            e.change_set.is_some(),
            e.changes.len(),
            e.missed_hashes.len(),
        )
    }));
    Ok(result)
}
