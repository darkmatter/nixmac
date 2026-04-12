//! Persistence for restore-origin tracking.
//!
//! Records which commits were created by a restore operation and what their
//! origin commit was. Used by `get_history` to surface restore provenance and
//! copy the origin changeset rather than triggering a fresh summarization run.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Record that `commit_hash` is a restore of `origin_hash`.
pub fn insert(db_path: &Path, commit_hash: &str, origin_hash: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT OR REPLACE INTO restore_commits (commit_hash, origin_hash) VALUES (?1, ?2)",
        (commit_hash, origin_hash),
    )?;
    Ok(())
}

/// Return the origin hash for `commit_hash`, or `None` if it is not a restore commit.
pub fn get_origin_hash(db_path: &Path, commit_hash: &str) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    match conn.query_row(
        "SELECT origin_hash FROM restore_commits WHERE commit_hash = ?1",
        [commit_hash],
        |row| row.get::<_, String>(0),
    ) {
        Ok(hash) => Ok(Some(hash)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
