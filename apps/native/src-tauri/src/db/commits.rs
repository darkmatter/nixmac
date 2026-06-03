//! Commit persistence operations.
//!
//! This module has two parallel code paths for the same logical operations:
//! raw `rusqlite::Connection` calls and managed `DbPool` (Diesel r2d2) calls.
//! The pool-backed variants (`*_in_pool`) are the long-term direction; the
//! raw-connection variants remain until all call sites are migrated onto the
//! shared pool. New code should use the pool-backed functions exclusively.

use anyhow::Result;
use diesel::prelude::*;
use rusqlite::Connection;
use std::path::Path;

use crate::db::tables::commits;

#[derive(Debug, Insertable)]
#[diesel(table_name = commits)]
struct NewCommit<'a> {
    hash: &'a str,
    tree_hash: &'a str,
    message: Option<&'a str>,
    created_at: i64,
}

#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = commits)]
#[cfg(test)]
struct CommitRow {
    id: i64,
    hash: String,
    tree_hash: String,
    message: Option<String>,
    created_at: i64,
}

#[cfg(test)]
impl From<CommitRow> for crate::sqlite_types::Commit {
    fn from(row: CommitRow) -> Self {
        Self {
            id: row.id,
            hash: row.hash,
            tree_hash: row.tree_hash,
            message: row.message,
            created_at: row.created_at,
        }
    }
}

/// Insert a commit into the database, returns id
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
            row.get::<_, i64>("id")
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

/// Passes through `existing` if `Some`; otherwise resolves HEAD from git and upserts it.
pub fn store_head_commit(
    db_path: &Path,
    config_dir: &str,
    existing: Option<i64>,
) -> Result<Option<i64>> {
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    let Some(hash) = crate::git::get_ref_sha(config_dir, "HEAD") else {
        return Ok(None);
    };
    let Some(tree_hash) = crate::git::get_ref_sha(config_dir, "HEAD^{tree}") else {
        return Ok(None);
    };
    let now = crate::utils::unix_now();
    Ok(Some(upsert_commit(db_path, &hash, &tree_hash, None, now)?))
}

/// Returns the full commit row for a given hash, or `None` if not in the DB.
pub fn get_commit_by_hash(
    db_path: &Path,
    hash: &str,
) -> Result<Option<crate::sqlite_types::Commit>> {
    let conn = Connection::open(db_path)?;
    let result = conn.query_row(
        "SELECT id, hash, tree_hash, message, created_at FROM commits WHERE hash = ?1",
        [hash],
        |row| {
            Ok(crate::sqlite_types::Commit {
                id: row.get("id")?,
                hash: row.get("hash")?,
                tree_hash: row.get("tree_hash")?,
                message: row.get("message")?,
                created_at: row.get("created_at")?,
            })
        },
    );
    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
