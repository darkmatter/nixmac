//! Commit persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Insert a commit into the database if no commit with the same hash exists.
/// Returns the commit's DB id (existing or newly inserted).
pub fn upsert_commit(
    db_path: &Path,
    hash: &str,
    tree_hash: &str,
    message: Option<&str>,
    created_at: i64,
) -> Result<i64> {
    let conn = Connection::open(db_path)?;

    if let Ok(existing_id) =
        conn.query_row("SELECT id FROM commits WHERE hash = ?1", [hash], |row| {
            row.get::<_, i64>(0)
        })
    {
        return Ok(existing_id);
    }

    conn.execute(
        "INSERT INTO commits (hash, tree_hash, message, created_at) VALUES (?1, ?2, ?3, ?4)",
        (hash, tree_hash, message, created_at),
    )?;

    Ok(conn.last_insert_rowid())
}

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
