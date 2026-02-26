//! Commit persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Insert a commit into the database.
/// Returns the inserted commit's ID.
pub fn insert_commit(db_path: &Path, hash: &str, tree_hash: &str, message: &str) -> Result<i64> {
    let conn = Connection::open(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO commits (hash, tree_hash, message, created_at) VALUES (?1, ?2, ?3, ?4)",
        (hash, tree_hash, message, now),
    )?;

    Ok(conn.last_insert_rowid())
}
