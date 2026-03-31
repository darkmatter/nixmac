//! Evolution persistence helpers.

use anyhow::Result;
use std::path::Path;

/// Insert a new evolution record and return its id.
pub fn insert(db_path: &Path, origin_branch: &str) -> Result<i64> {
    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO evolutions (origin_branch, merged, builds) VALUES (?1, 0, 0)",
        rusqlite::params![origin_branch],
    )?;
    Ok(conn.last_insert_rowid())
}
