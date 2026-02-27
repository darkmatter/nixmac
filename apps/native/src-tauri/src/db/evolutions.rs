//! Evolution persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Insert an evolution into the database.
/// Returns the inserted evolution's ID.
#[allow(dead_code)]
pub fn insert_evolution(db_path: &Path, branch: &str) -> Result<i64> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO evolutions (branch, merged, builds) VALUES (?1, 0, 0)",
        [branch],
    )?;

    Ok(conn.last_insert_rowid())
}
