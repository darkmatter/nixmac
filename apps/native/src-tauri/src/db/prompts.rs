//! Prompt persistence operations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Insert a prompt into the database.
/// Returns the inserted prompt's ID.
#[allow(dead_code)]
pub async fn insert_prompt(db_path: &Path, text: &str) -> Result<i64> {
    let path = db_path.to_path_buf();
    let text = text.to_string();

    tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&path)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO prompts (text, created_at) VALUES (?1, ?2)",
            (&text, now),
        )?;

        Ok(conn.last_insert_rowid())
    })
    .await?
}
