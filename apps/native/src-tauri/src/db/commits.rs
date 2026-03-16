//! Commit persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

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

/// Returns the full commit row for a given hash, or `None` if not in the DB.
pub fn get_commit_by_hash(
    db_path: &Path,
    hash: &str,
) -> Result<Option<crate::sqlite_types::CommitRow>> {
    let conn = Connection::open(db_path)?;
    let result = conn.query_row(
        "SELECT id, hash, tree_hash, message, created_at FROM commits WHERE hash = ?1",
        [hash],
        |row| {
            Ok(crate::sqlite_types::CommitRow {
                id: row.get(0)?,
                hash: row.get(1)?,
                tree_hash: row.get(2)?,
                message: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    );
    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
