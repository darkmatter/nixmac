//! Database schema initialization and migrations via `rusqlite_migration`.
//!
//! ## Adding a migration
//! 1. Create a new directory under `migrations/` (e.g. `03-my-change/up.sql`).
//! 2. Append an `M::up(include_str!(...))` entry to `MIGRATIONS` below.
//!
//! Keep table definitions in sync with the Rust structs in `src/sqlite_types.rs`.

use anyhow::Result;
use rusqlite::{Connection, Transaction};
use rusqlite_migration::{HookResult, Migrations, M};
use std::path::Path;

fn migrations() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../../migrations/01-initial/up.sql")),
        M::up(include_str!("../../migrations/02-restore-commits/up.sql")),
        M::up_with_hook(
            include_str!("../../migrations/03-evolutions-origin-branch/up.sql"),
            repair_legacy_evolutions_schema,
        ),
    ]
}

/// Initialize schema, running any pending migrations.
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let mut conn = Connection::open(&path)?;
        let migrations = Migrations::new(migrations());
        migrations
            .to_latest(&mut conn)
            .map_err(|e| anyhow::anyhow!("Migration failed: {e}"))?;
        Ok(())
    })
    .await?
}

fn repair_legacy_evolutions_schema(tx: &Transaction) -> HookResult {
    let needs_repair =
        table_exists(tx, "evolutions")? && !table_has_column(tx, "evolutions", "origin_branch")?;
    if !needs_repair {
        return Ok(());
    }

    if table_has_column(tx, "evolutions", "branch")? {
        tx.execute_batch("ALTER TABLE evolutions RENAME COLUMN branch TO origin_branch;")?;
    } else {
        tx.execute_batch(
            "ALTER TABLE evolutions ADD COLUMN origin_branch TEXT NOT NULL DEFAULT '';",
        )?;
    }

    tx.execute(
        "CREATE INDEX IF NOT EXISTS idx_evolutions_origin_branch ON evolutions(origin_branch)",
        [],
    )?;

    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    let exists = conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    );

    match exists {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(err) => Err(err),
    }
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migrations_are_valid() {
        let migrations = Migrations::new(migrations());
        assert!(migrations.validate().is_ok());
    }

    #[test]
    fn init_schema_upgrades_legacy_evolutions_branch_column() {
        for user_version in [1, 2] {
            let temp_dir = tempfile::tempdir().unwrap();
            let db_path = temp_dir.path().join("legacy.db");
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(&format!(
                r#"
                    CREATE TABLE evolutions (
                        id INTEGER PRIMARY KEY,
                        branch TEXT NOT NULL,
                        merged INTEGER NOT NULL DEFAULT 0,
                        builds INTEGER NOT NULL DEFAULT 0
                    );
                    INSERT INTO evolutions (id, branch, merged, builds) VALUES (1, 'main', 0, 0);
                    PRAGMA user_version = {user_version};
                    "#
            ))
            .unwrap();
            drop(conn);

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(init_schema(&db_path)).unwrap();

            let conn = Connection::open(&db_path).unwrap();
            let origin_branch: String = conn
                .query_row(
                    "SELECT origin_branch FROM evolutions WHERE id = 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(origin_branch, "main");

            let migrated_version: i32 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(migrated_version, 3);

            crate::db::evolutions::upsert(&db_path, None, "feature").unwrap();
        }
    }
}
