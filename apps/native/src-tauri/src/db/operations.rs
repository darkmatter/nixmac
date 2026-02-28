//! High-level database operations that span multiple tables.
//!
//! This module provides transactional operations for complex workflows
//! that require coordinating inserts across multiple tables.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Data needed to save a complete evolution workflow to the database.
pub struct EvolutionData {
    pub commit_hash: String,
    pub tree_hash: String,
    pub commit_message: String,
    pub branch: String,
    pub summary_json: String,
    pub diff: String,
    pub prompt: String,
}

/// Save a complete evolution with all related data in a single transaction.
///
/// This function inserts:
/// - A commit record
/// - An evolution record
/// - An evolution-commit relationship
/// - A summary record
/// - A prompt record
///
/// All inserts happen within a transaction, so either all succeed or all fail.
/// Returns the evolution_id on success.
pub fn save_evolution_complete(db_path: &Path, data: EvolutionData) -> Result<i64> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Insert commit
    tx.execute(
        "INSERT INTO commits (hash, tree_hash, message, created_at) VALUES (?1, ?2, ?3, ?4)",
        (
            &data.commit_hash,
            &data.tree_hash,
            &data.commit_message,
            now,
        ),
    )?;
    let commit_id = tx.last_insert_rowid();

    // Insert evolution record
    tx.execute(
        "INSERT INTO evolutions (branch, merged, builds) VALUES (?1, 0, 0)",
        [&data.branch],
    )?;
    let evolution_id = tx.last_insert_rowid();

    // Link evolution to commit
    tx.execute(
        "INSERT INTO evolution_commits (evolution_id, commit_id) VALUES (?1, ?2)",
        (evolution_id, commit_id),
    )?;

    // Insert summary
    tx.execute(
        "INSERT INTO summaries (commit_id, base_commit_id, content_json, diff, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (commit_id, Option::<i64>::None, &data.summary_json, &data.diff, now),
    )?;

    // Insert prompt (linked to commit)
    tx.execute(
        "INSERT INTO prompts (text, commit_id, created_at) VALUES (?1, ?2, ?3)",
        (&data.prompt, Some(commit_id), now),
    )?;

    // Commit the transaction
    tx.commit()?;

    Ok(evolution_id)
}
