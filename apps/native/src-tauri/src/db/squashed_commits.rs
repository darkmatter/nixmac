//! Squashed commit relationship persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Insert a squashed commit relationship into the database.
#[allow(dead_code)]
pub fn insert_squashed_commit(db_path: &Path, target_id: i64, source_id: i64) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO squashed_commits (target_id, source_id) VALUES (?1, ?2)",
        (target_id, source_id),
    )?;

    Ok(())
}
