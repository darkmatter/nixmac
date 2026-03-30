//! Database schema initialization and migrations.
//!
//! Keep table definitions here in sync with the Rust structs in `src/sqlite_types.rs`

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

const SCHEMA_VERSION: i32 = 1;

/// Initialize schema, creating tables if needed
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&path)?;

        // Check current version
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);

        if version < SCHEMA_VERSION {
            create_tables(&conn)?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }

        Ok(())
    })
    .await?
}

fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS commits (
            id INTEGER PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            tree_hash TEXT NOT NULL,
            message TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS squashed_commits (
            target_id INTEGER NOT NULL REFERENCES commits(id),
            source_id INTEGER NOT NULL REFERENCES commits(id),
            PRIMARY KEY (target_id, source_id)
        );

        CREATE TABLE IF NOT EXISTS evolutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            origin_branch TEXT NOT NULL,
            merged INTEGER NOT NULL DEFAULT 0,
            builds INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS evolution_commits (
            evolution_id INTEGER NOT NULL REFERENCES evolutions(id),
            commit_id INTEGER NOT NULL REFERENCES commits(id),
            PRIMARY KEY (evolution_id, commit_id)
        );

        -- DEPRECATED: will be replaced by change_sets + change_summaries + changes.
        -- Do not write new code against this table.
        CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY,
            commit_id INTEGER NOT NULL REFERENCES commits(id),
            base_commit_id INTEGER REFERENCES commits(id),
            content_json TEXT NOT NULL,
            diff TEXT NOT NULL,
            created_at INTEGER NOT NULL
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
        CREATE INDEX IF NOT EXISTS idx_evolution_commits_commit ON evolution_commits(commit_id);
        CREATE INDEX IF NOT EXISTS idx_summaries_commit ON summaries(commit_id);
        CREATE INDEX IF NOT EXISTS idx_summaries_base ON summaries(base_commit_id);
        CREATE INDEX IF NOT EXISTS idx_prompts_commit ON prompts(commit_id);
        CREATE INDEX IF NOT EXISTS idx_change_sets_commit ON change_sets(commit_id);
        CREATE INDEX IF NOT EXISTS idx_change_sets_base ON change_sets(base_commit_id);
        CREATE INDEX IF NOT EXISTS idx_set_changes_change ON set_changes(change_id);
        CREATE INDEX IF NOT EXISTS idx_queued_summaries_status ON queued_summaries(status);
        "#,
    )?;

    Ok(())
}
