//! Database schema initialization.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

const SCHEMA_VERSION: i32 = 1;
const CURRENT_SCHEMA_SQL: &str = concat!(
    include_str!("../../migrations/01-initial/up.sql"),
    "\n",
    include_str!("../../migrations/02-restore-commits/up.sql"),
    "\nPRAGMA user_version = 1;\n",
);

/// Initialize schema.
///
/// Older SQLite data is intentionally not migrated. If the on-disk schema
/// version is not the current version, the database is recreated from scratch.
/// This is acceptable because nixmac's DB is a local cache of summaries and
/// commit metadata — the source of truth lives in git and the config repo,
/// so a stale DB can always be rebuilt by re-summarizing.
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        recreate_stale_database(&path)?;
        let conn = Connection::open(&path)?;
        conn.execute_batch(CURRENT_SCHEMA_SQL)?;
        Ok(())
    })
    .await?
}

fn recreate_stale_database(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let conn = Connection::open(path)?;
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    drop(conn);
    if version != SCHEMA_VERSION {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn init_schema_recreates_stale_databases_without_migration() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("stale.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE evolutions (
                id INTEGER PRIMARY KEY,
                branch TEXT NOT NULL,
                merged INTEGER NOT NULL DEFAULT 0,
                builds INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO evolutions (id, branch, merged, builds) VALUES (1, 'main', 0, 0);
            PRAGMA user_version = 3;
            "#,
        )
        .unwrap();
        drop(conn);

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(init_schema(&db_path)).unwrap();

        let conn = Connection::open(&db_path).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM evolutions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(row_count, 0);

        crate::db::evolutions::upsert(&db_path, None, "feature").unwrap();
    }
}
