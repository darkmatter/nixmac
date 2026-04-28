//! Build record operations for darwin_builds and nixmac_builds tables.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};

/// Shared helper: insert or update the darwin_builds row for a given (nix_generation, store_path).
///
/// Checks the most recent row in darwin_builds:
/// - If it matches (nix_generation, store_path) and nixmac_build_id is Some: backfill nixmac_build_id.
/// - If it matches and nixmac_build_id is None: nothing to do (nixmac already recorded this build).
/// - If it doesn't match: INSERT a new row.
///
/// Returns the darwin_builds.id of the affected row (existing or newly inserted).
fn upsert_darwin_build(
    conn: &Connection,
    nix_generation: i64,
    store_path: &str,
    nixmac_build_id: Option<i64>,
    now: i64,
) -> Result<i64> {
    let latest: Option<(i64, i64, String)> = conn
        .query_row(
            "SELECT id, nix_generation, store_path FROM darwin_builds ORDER BY id DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    if let Some((latest_id, latest_gen, ref latest_path)) = latest {
        if latest_gen == nix_generation && latest_path == store_path {
            if let Some(nb_id) = nixmac_build_id {
                // Watcher inserted first with nixmac_build_id = NULL; backfill it now.
                conn.execute(
                    "UPDATE darwin_builds SET nixmac_build_id = ?1 WHERE id = ?2",
                    (nb_id, latest_id),
                )?;
            }
            // else: nixmac already recorded with nixmac_build_id set; watcher is late — nothing to do.
            return Ok(latest_id);
        }
    }

    conn.execute(
        "INSERT INTO darwin_builds (nix_generation, store_path, nixmac_build_id, detected_at) \
         VALUES (?1, ?2, ?3, ?4)",
        (nix_generation, store_path, nixmac_build_id, now),
    )?;
    Ok(conn.last_insert_rowid())
}

/// A nixmac-initiated build. Inserts into nixmac_builds then upserts darwin_builds returning id.
pub fn record_nixmac(
    conn: &Connection,
    nix_generation: i64,
    store_path: &str,
    changeset_id: Option<i64>,
    now: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO nixmac_builds (changeset_id, built_at) VALUES (?1, ?2)",
        (changeset_id, now),
    )?;
    let nixmac_build_id = conn.last_insert_rowid();
    upsert_darwin_build(conn, nix_generation, store_path, Some(nixmac_build_id), now)
}

/// Record a watcher-detected external build (nixmac_build_id = NULL).
/// Skips silently if nixmac already recorded this (nix_generation, store_path).
pub fn record_external(
    conn: &Connection,
    nix_generation: i64,
    store_path: &str,
    now: i64,
) -> Result<()> {
    upsert_darwin_build(conn, nix_generation, store_path, None, now)?;
    Ok(())
}

/// Record that a given darwin_build was active at the time of a commit.
/// Returns the new build_commits.id.
#[allow(dead_code)]
pub fn insert_build_commit(
    conn: &Connection,
    commit_id: i64,
    darwin_build_id: i64,
    created_at: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO build_commits (commit_id, darwin_build_id, created_at) VALUES (?1, ?2, ?3)",
        (commit_id, darwin_build_id, created_at),
    )?;
    Ok(conn.last_insert_rowid())
}
