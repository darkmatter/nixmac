//! Database schema initialization.

use anyhow::{Result, anyhow};
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_types::BigInt;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};
use std::path::Path;

const SCHEMA_VERSION: i64 = 1;
const MIGRATIONS: EmbeddedMigrations = embed_migrations!("./migrations");

/// Initialize schema.
///
/// Older SQLite data is intentionally not migrated. If the on-disk schema
/// version is not the current version, the database is recreated from scratch.
/// This is acceptable because nixmac's DB is a local cache of summaries and
/// commit metadata — the source of truth lives in git and the config repo,
/// so a stale DB can always be rebuilt by re-summarizing.
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || -> Result<()> {
        recreate_stale_database(&path)?;
        let database_url = path.to_string_lossy().into_owned();
        let mut conn = SqliteConnection::establish(&database_url)?;
        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|e| anyhow!("failed to run diesel migrations: {e}"))?;
        conn.batch_execute(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        Ok(())
    })
    .await?
}

fn recreate_stale_database(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let database_url = path.to_string_lossy().into_owned();
    let mut conn = SqliteConnection::establish(&database_url)?;
    let version: i64 = diesel::select(diesel::dsl::sql::<BigInt>(
        "user_version FROM pragma_user_version",
    ))
    .get_result(&mut conn)?;
    drop(conn);
    if version != SCHEMA_VERSION {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_schema_recreates_stale_databases_without_migration() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("stale.db");

        // Seed a stale database (user_version = 3, plus a row that would survive).
        let database_url = db_path.to_string_lossy().into_owned();
        {
            let mut conn = SqliteConnection::establish(&database_url).unwrap();
            conn.batch_execute(
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
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(init_schema(&db_path)).unwrap();

        let mut conn = SqliteConnection::establish(&database_url).unwrap();
        let version: i64 = diesel::select(diesel::dsl::sql::<BigInt>(
            "user_version FROM pragma_user_version",
        ))
        .get_result(&mut conn)
        .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let row_count = crate::db::tables::evolutions::table
            .count()
            .get_result::<i64>(&mut conn)
            .unwrap();
        assert_eq!(row_count, 0);

        drop(conn);
        let pool = rt.block_on(crate::db::init_pool_at_path(&db_path)).unwrap();
        crate::db::evolutions::upsert(&pool, None, "feature").unwrap();
    }
}
