//! Database schema initialization and migrations via `rusqlite_migration`.
//!
//! ## Adding a migration
//! 1. Create a new directory under `migrations/` (e.g. `03-my-change/up.sql`).
//! 2. Append an `M::up(include_str!(...))` entry to `MIGRATIONS` below.
//!
//! Keep table definitions in sync with the Rust structs in `src/sqlite_types.rs`.

use anyhow::Result;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;

static MIGRATIONS: &[M<'_>] = &[
    M::up(include_str!("../../migrations/01-initial/up.sql")),
    M::up(include_str!("../../migrations/02-restore-commits/up.sql")),
];

/// Initialize schema, running any pending migrations.
pub async fn init_schema(db_path: &Path) -> Result<()> {
    let path = db_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let mut conn = Connection::open(&path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_latest(&mut conn)
            .map_err(|e| anyhow::anyhow!("Migration failed: {e}"))?;
        Ok(())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        assert!(migrations.validate().is_ok());
    }
}
