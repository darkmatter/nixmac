//! Evolution-commit relationship persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Insert an evolution-commit relationship into the database.
#[allow(dead_code)]
pub fn insert_evolution_commit(db_path: &Path, evolution_id: i64, commit_id: i64) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO evolution_commits (evolution_id, commit_id) VALUES (?1, ?2)",
        (evolution_id, commit_id),
    )?;

    Ok(())
}
