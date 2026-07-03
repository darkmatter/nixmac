//! Diesel connection pool for the application SQLite database.
//!
//! Every query path acquires its connection from this pool via
//! `tauri::State<DbPool>`; no module opens SQLite directly.

use anyhow::{Context, Result};
use diesel::{
    connection::SimpleConnection,
    r2d2::{ConnectionManager, CustomizeConnection},
    sqlite::SqliteConnection,
};
use std::path::Path;

/// SQLite is file-locked; a large pool just adds contention without benefit
/// on a single-user desktop app. 4 connections cover the main thread, a
/// background summarizer, and one spare for a concurrent read.
const MAX_POOL_SIZE: u32 = 4;

/// Shared SQLite connection pool managed in `tauri::State`.
pub type DbPool = diesel::r2d2::Pool<ConnectionManager<SqliteConnection>>;

/// Applies the per-connection PRAGMAs that keep SQLite from throwing "database
/// is locked" under the multi-connection pool. SQLite PRAGMAs are
/// per-connection, so this runs on every connection r2d2 creates.
#[derive(Debug, Clone, Copy)]
struct PragmaCustomizer;

// Prevent "Database locked" errors by setting up WAL mode and busy timeout.
impl CustomizeConnection<SqliteConnection, diesel::r2d2::Error> for PragmaCustomizer {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        // Wait up to 2s for a write lock instead of failing immediately —
        // the most important PRAGMA for "database is locked" errors.
        conn.batch_execute("PRAGMA busy_timeout = 2000;")
            .map_err(diesel::r2d2::Error::QueryError)?;
        // WAL lets readers and one writer coexist without blocking.
        conn.batch_execute("PRAGMA journal_mode = WAL;")
            .map_err(diesel::r2d2::Error::QueryError)?;
        // Looser fsync cadence — safe under WAL, much faster on macOS SSDs.
        conn.batch_execute("PRAGMA synchronous = NORMAL;")
            .map_err(diesel::r2d2::Error::QueryError)?;
        Ok(())
    }
}

/// Build a Diesel SQLite pool for an already-initialized database path.
pub fn build_pool(db_path: &Path) -> Result<DbPool> {
    let database_url = db_path.to_string_lossy().into_owned();
    let manager = ConnectionManager::<SqliteConnection>::new(database_url);
    diesel::r2d2::Pool::builder()
        .max_size(MAX_POOL_SIZE)
        .connection_customizer(Box::new(PragmaCustomizer))
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

    /// Confirms the PRAGMA customizer ran on a pooled connection. WAL mode
    /// creates `-wal`/`-shm` sidecar files once a write happens, which is the
    /// observable side effect we care about. The customizer returning an error
    /// would have caused `pool.get()` to fail at acquire time.
    #[test]
    fn pooled_connections_have_pragmas_applied() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("pool.db");
        let pool = build_pool(&db_path).unwrap();

        // Force WAL sidecar files to materialize by writing through the pool.
        let mut conn = pool.get().unwrap();
        conn.batch_execute("CREATE TABLE IF NOT EXISTS _pragma_probe (x);")
            .unwrap();
        conn.batch_execute("INSERT INTO _pragma_probe VALUES (1);")
            .unwrap();
        drop(conn);

        assert!(temp_dir.path().join("pool.db-wal").exists());
        assert!(temp_dir.path().join("pool.db-shm").exists());
    }
}
