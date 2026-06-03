//! Lightweight changeset persistence — no AI, no queued summaries.

use anyhow::Result;
use diesel::connection::Connection;

use crate::db::changesets::{insert_change_or_ignore, insert_change_set, link_change_to_set};
use crate::db::DbPool;
use crate::sqlite_types::Change;
use crate::utils::unix_now;

/// Insert `changes` as bare rows where absent, create a new changeset.
pub fn store(pool: &DbPool, base_commit_id: i64, changes: &[Change]) -> Result<i64> {
    let mut conn = pool.get()?;
    let now = unix_now();

    conn.transaction::<i64, anyhow::Error, _>(|conn| {
        let mut change_ids = Vec::with_capacity(changes.len());
        for change in changes {
            let id = insert_change_or_ignore(conn, change, None)?;
            change_ids.push(id);
        }

        let change_set_id = insert_change_set(conn, None, base_commit_id, None, None, now, None)?;

        for id in change_ids {
            link_change_to_set(conn, change_set_id, id)?;
        }

        Ok(change_set_id)
    })
}
