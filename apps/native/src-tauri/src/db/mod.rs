//! SQLite database for persisting evolution history, summaries, and prompts.

pub mod changesets;
pub mod commits;
pub mod evolutions;
pub mod pool;
pub mod restore_commits;
mod schema;
pub mod store_bare_changeset;
pub mod store_whole_diff_changeset;
pub(crate) mod tables;

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::debug::TimerGuard;
pub use pool::DbPool;

/// Resolved once on first access and cached for the process lifetime.
/// This avoids repeated filesystem lookups and ensures all modules agree
/// on the same path even if the app-data directory resolution changes.
static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Get the database file path (in app data directory)
pub fn get_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(path) = DB_PATH.get() {
        return Ok(path.clone());
    }

    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    let path = app_data.join("nixmac.db");
    // fire-and-forget: OnceLock::set returns Err if already initialised (race on first call).
    // The first writer wins; the value is the same path, so ignoring the Err is correct.
    let _ = DB_PATH.set(path.clone());
    Ok(path)
}

/// Initialize the database (create file and run migrations)
pub async fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let _timer = TimerGuard::new("db::init");
    let path = get_db_path(app)?;
    let pool = init_pool_at_path(&path).await?;
    if !app.manage(pool) {
        log::debug!("DbPool was already managed");
    }
    Ok(())
}

/// Initialize a database path and return a pooled Diesel connection manager.
pub async fn init_pool_at_path(db_path: &Path) -> Result<DbPool> {
    schema::init_schema(db_path).await?;
    pool::build_pool(db_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::{dsl::count_star, prelude::*};

    #[tokio::test]
    async fn init_pool_at_path_runs_migrations_and_returns_working_diesel_connection() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");

        let pool = init_pool_at_path(&db_path).await.unwrap();
        let mut conn = pool.get().unwrap();

        let count = crate::db::tables::commits::table
            .select(count_star())
            .first::<i64>(&mut conn)
            .unwrap();
        assert_eq!(count, 0);
    }
}
