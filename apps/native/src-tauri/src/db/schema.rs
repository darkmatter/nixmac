//! Database schema initialization and migrations.
//!
//! ## Adding a migration
//! 1. Increment `SCHEMA_VERSION`.
//! 2. Add a `migrate_N` function with the SQL delta (ALTER TABLE, CREATE TABLE, etc.).
//! 3. Add `if version < N { migrate_N(&conn)?; }` to `init_schema`.
//!
//! Each migration only runs when the DB is below its version, so parallel
//! feature branches can add independent migrations without stomping each other.
//!
//! Keep table definitions in sync with the Rust structs in `src/sqlite_types.rs`.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

const SCHEMA_VERSION: i32 = 2;

/// Initialize schema, running any pending migrations.
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&path)?;

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);

        if version < 1 {
            migrate_1(&conn)?;
        }
        if version < 2 {
            migrate_2(&conn)?;
        }

        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    })
    .await?
}

/// Initial schema — all tables and indexes present at launch.
fn migrate_1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS commits (
            id INTEGER PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            tree_hash TEXT NOT NULL,
            message TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS evolutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            origin_branch TEXT NOT NULL,
            merged INTEGER NOT NULL DEFAULT 0,
            builds INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS change_summaries (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
            diff TEXT NOT NULL,
            line_count INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            own_summary_id INTEGER REFERENCES change_summaries(id)
        );

        CREATE TABLE IF NOT EXISTS group_summaries (
            change_id INTEGER NOT NULL REFERENCES changes(id),
            change_summary_id INTEGER NOT NULL REFERENCES change_summaries(id)
        );

        CREATE TABLE IF NOT EXISTS change_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            commit_id INTEGER REFERENCES commits(id),
            base_commit_id INTEGER NOT NULL REFERENCES commits(id),
            commit_message TEXT,
            generated_commit_message TEXT,
            created_at INTEGER NOT NULL,
            evolution_id INTEGER REFERENCES evolutions(id)
        );

        CREATE TABLE IF NOT EXISTS set_changes (
            change_set_id INTEGER NOT NULL REFERENCES change_sets(id),
            change_id INTEGER NOT NULL REFERENCES changes(id),
            PRIMARY KEY (change_set_id, change_id)
        );

        CREATE TABLE IF NOT EXISTS queued_summaries (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
            attempted_count INTEGER NOT NULL DEFAULT 0,
            prompt TEXT NOT NULL,
            model_response TEXT,
            group_summary_id INTEGER REFERENCES change_summaries(id),
            hash_own_summary_id_pairs TEXT,
            type TEXT NOT NULL CHECK(type IN ('NEW_SINGLE', 'NEW_GROUP', 'EVOLVED_GROUP'))
        );

        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY,
            text TEXT NOT NULL,
            commit_id INTEGER REFERENCES commits(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_commits_tree_hash ON commits(tree_hash);
        CREATE INDEX IF NOT EXISTS idx_evolutions_origin_branch ON evolutions(origin_branch);
        CREATE INDEX IF NOT EXISTS idx_prompts_commit ON prompts(commit_id);
        CREATE INDEX IF NOT EXISTS idx_change_sets_commit ON change_sets(commit_id);
        CREATE INDEX IF NOT EXISTS idx_change_sets_base ON change_sets(base_commit_id);
        CREATE INDEX IF NOT EXISTS idx_set_changes_change ON set_changes(change_id);
        CREATE INDEX IF NOT EXISTS idx_queued_summaries_status ON queued_summaries(status);
        "#,
    )?;

    Ok(())
}

/// Add restore_commits table for tracking restore provenance.
fn migrate_2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS restore_commits (
            commit_hash TEXT PRIMARY KEY,
            origin_hash TEXT NOT NULL
        );
        "#,
    )?;

    Ok(())
}
