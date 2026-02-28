//! Summary persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Insert a summary into the database.
/// Returns the inserted summary's ID.
///
/// Note: For the main evolution workflow, use `operations::save_evolution_complete`
/// which handles all related inserts in a single transaction.
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
