//! Lightweight changeset persistence — no AI, no queued summaries.

use anyhow::Result;
use std::path::Path;

use crate::db::changesets::{insert_change_or_ignore, insert_change_set, link_change_to_set};
use crate::sqlite_types::Change;
use crate::utils::unix_now;

/// Insert `changes` as bare rows where absent, create a new changeset.
pub fn store(db_path: &Path, base_commit_id: i64, changes: &[Change]) -> Result<i64> {
    let mut conn = rusqlite::Connection::open(db_path)?;
    let now = unix_now();
    let tx = conn.transaction()?;

    let mut change_ids = Vec::with_capacity(changes.len());
    for change in changes {
        let id = insert_change_or_ignore(&tx, change, None)?;
        change_ids.push(id);
    }

    let change_set_id = insert_change_set(&tx, None, base_commit_id, None, None, now, None)?;

    for id in change_ids {
        link_change_to_set(&tx, change_set_id, id)?;
    }

    tx.commit()?;
    Ok(change_set_id)
}
