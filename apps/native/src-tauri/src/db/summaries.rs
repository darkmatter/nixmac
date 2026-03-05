//! Summary persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::SummaryResponse;

/// Insert a summary into the database.
/// Evolve now uses operation and not this. May remove this dead code at some point if unused.
#[allow(dead_code)]
pub fn insert_summary(
    db_path: &Path,
    commit_id: i64,
    base_commit_id: Option<i64>,
    content_json: &str,
    diff: &str,
) -> Result<i64> {
    let conn = Connection::open(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO summaries (commit_id, base_commit_id, content_json, diff, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (commit_id, base_commit_id, content_json, diff, now),
    )?;

    Ok(conn.last_insert_rowid())
}

/// Get summary for a commit by its hash.
pub fn get_summary_by_commit_hash(
    db_path: &Path,
    commit_hash: &str,
) -> Result<Option<SummaryResponse>> {
    let conn = Connection::open(db_path)?;

    let result = conn.query_row(
        "SELECT s.content_json FROM summaries s
         JOIN commits c ON s.commit_id = c.id
         WHERE c.hash = ?1",
        [commit_hash],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(json) => Ok(Some(serde_json::from_str(&json)?)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
