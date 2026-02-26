//! Database schema initialization and migrations.

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
            id INTEGER PRIMARY KEY,
            branch TEXT NOT NULL,
            merged INTEGER NOT NULL DEFAULT 0,
            builds INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS evolution_commits (
            evolution_id INTEGER NOT NULL REFERENCES evolutions(id),
            commit_id INTEGER NOT NULL REFERENCES commits(id),
            PRIMARY KEY (evolution_id, commit_id)
        );

        CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY,
            commit_id INTEGER NOT NULL REFERENCES commits(id),
            base_commit_id INTEGER REFERENCES commits(id),
            content_json TEXT NOT NULL,
            diff TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY,
            text TEXT NOT NULL,
            commit_id INTEGER REFERENCES commits(id),
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_commits_tree_hash ON commits(tree_hash);
        CREATE INDEX IF NOT EXISTS idx_evolutions_branch ON evolutions(branch);
        CREATE INDEX IF NOT EXISTS idx_evolution_commits_commit ON evolution_commits(commit_id);
        CREATE INDEX IF NOT EXISTS idx_summaries_commit ON summaries(commit_id);
        CREATE INDEX IF NOT EXISTS idx_summaries_base ON summaries(base_commit_id);
        CREATE INDEX IF NOT EXISTS idx_prompts_commit ON prompts(commit_id);
        "#,
    )?;

    Ok(())
}
