//! Diesel connection pool for the application SQLite database.
//!
//! Every query path acquires its connection from this pool via
//! `tauri::State<DbPool>`; no module opens SQLite directly.

use anyhow::{Context, Result};
use diesel::{r2d2::ConnectionManager, sqlite::SqliteConnection};
use std::path::Path;

/// SQLite is file-locked; a large pool just adds contention without benefit
/// on a single-user desktop app. 4 connections cover the main thread, a
/// background summarizer, and one spare for a concurrent read.
const MAX_POOL_SIZE: u32 = 4;

/// Shared SQLite connection pool managed in `tauri::State`.
pub type DbPool = diesel::r2d2::Pool<ConnectionManager<SqliteConnection>>;

/// Build a Diesel SQLite pool for an already-initialized database path.
pub fn build_pool(db_path: &Path) -> Result<DbPool> {
    let database_url = db_path.to_string_lossy().into_owned();
    let manager = ConnectionManager::<SqliteConnection>::new(database_url);
    diesel::r2d2::Pool::builder()
        .max_size(MAX_POOL_SIZE)
        .build(manager)
        .context("failed to build SQLite connection pool")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_size_is_small_for_desktop_sqlite_usage() {
        let temp_dir = tempfile::tempdir().unwrap();
        let pool = build_pool(&temp_dir.path().join("pool.db")).unwrap();

        assert_eq!(pool.max_size(), MAX_POOL_SIZE);
    }
}
