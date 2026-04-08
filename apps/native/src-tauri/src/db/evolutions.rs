//! Evolution persistence helpers.

use anyhow::Result;
use std::path::Path;

/// Upsert an evolution by id: if `existing_id` is Some and exists in the DB, return it.
/// Otherwise insert a new evolution record and return its id.
pub fn upsert(db_path: &Path, existing_id: Option<i64>, origin_branch: &str) -> Result<i64> {
    let conn = rusqlite::Connection::open(db_path)?;
    if let Some(id) = existing_id {
        let exists = conn
            .query_row("SELECT 1 FROM evolutions WHERE id = ?1", rusqlite::params![id], |_| Ok(()))
            .is_ok();
        if exists {
            return Ok(id);
        }
    }
    conn.execute(
        "INSERT INTO evolutions (origin_branch, merged, builds) VALUES (?1, 0, 0)",
        rusqlite::params![origin_branch],
    )?;
    Ok(conn.last_insert_rowid())
}
