//! Persists a whole-diff summarization result — one group, one commit message.

use anyhow::Result;
use diesel::connection::Connection;

use crate::db::DbPool;
use crate::db::changesets::{
    get_change_id_by_hash, insert_change_set, insert_change_summary, link_change_to_group_summary,
    link_change_to_set, upsert_change,
};
use crate::sqlite_types::Change;

#[allow(clippy::too_many_arguments)]
pub fn store(
    pool: &DbPool,
    changes: &[Change],
    message: &str,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<i64> {
    let title = message.lines().next().unwrap_or(message).trim();
    let description = message.trim();

    let mut conn = pool.get()?;
    let now = crate::utils::unix_now();

    conn.transaction::<i64, anyhow::Error, _>(|conn| {
        let group_summary_id = insert_change_summary(conn, title, description, "DONE", now)?;

        let mut change_ids = Vec::with_capacity(changes.len());
        for change in changes {
            let own_title = std::path::Path::new(&change.filename)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&change.filename);
            let own_summary_id = insert_change_summary(conn, own_title, description, "DONE", now)?;
            upsert_change(conn, change, Some(own_summary_id))?;
            let change_id = get_change_id_by_hash(conn, &change.hash)?;
            link_change_to_group_summary(conn, change_id, group_summary_id)?;
            change_ids.push(change_id);
        }

        let change_set_id = insert_change_set(
            conn,
            commit_id,
            base_commit_id,
            commit_message,
            Some(message),
            now,
            evolution_id,
        )?;

        for change_id in change_ids {
            link_change_to_set(conn, change_set_id, change_id)?;
        }

        Ok(change_set_id)
    })
}
