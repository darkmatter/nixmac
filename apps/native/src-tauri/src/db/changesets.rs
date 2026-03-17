//! Change-set persistence helpers.
//!
//! Take `&Transaction` to participate in the caller's transaction

use anyhow::Result;
use rusqlite::Transaction;

use crate::sqlite_types::Change;

pub fn insert_change_summary(
    tx: &Transaction,
    title: &str,
    description: &str,
    group_summary_for: Option<&str>,
    created_at: i64,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_summaries (title, description, group_summary_for, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![title, description, group_summary_for, created_at],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn upsert_change(
    tx: &Transaction,
    change: &Change,
    group_summary_id: Option<i64>,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, group_summary_id, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            group_summary_id, own_summary_id,
        ],
    )?;
    tx.execute(
        "UPDATE changes SET group_summary_id = ?1, own_summary_id = ?2 WHERE hash = ?3",
        rusqlite::params![group_summary_id, own_summary_id, &change.hash],
    )?;
    Ok(())
}

pub fn insert_change_or_ignore(
    tx: &Transaction,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, group_summary_id, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            own_summary_id,
        ],
    )?;
    Ok(())
}

pub fn insert_change_set(
    tx: &Transaction,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    generated_commit_message: Option<&str>,
    created_at: i64,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_sets \
         (commit_id, base_commit_id, commit_message, generated_commit_message, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            commit_id, base_commit_id, commit_message, generated_commit_message, created_at,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn get_change_id_by_hash(tx: &Transaction, hash: &str) -> Result<i64> {
    Ok(tx.query_row(
        "SELECT id FROM changes WHERE hash = ?1",
        [hash],
        |row| row.get(0),
    )?)
}

pub fn link_change_to_set(tx: &Transaction, change_set_id: i64, change_id: i64) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO set_changes (change_set_id, change_id) VALUES (?1, ?2)",
        rusqlite::params![change_set_id, change_id],
    )?;
    Ok(())
}
