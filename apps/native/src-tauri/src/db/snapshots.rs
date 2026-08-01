//! Snapshot persistence — caches the generated commit message for an exact set
//! of change hashes, content-addressed by `snapshot_key`.
//!
//! The integer `id` is the value historically plumbed as `changeset_id`
//! throughout evolve/build state, so callers can keep using an `i64` handle.

use anyhow::Result;
use diesel::prelude::*;

use crate::db::DbPool;
use crate::db::tables::snapshots;

/// A cached snapshot row.
pub struct Snapshot {
    pub id: i64,
    pub generated_commit_message: Option<String>,
}

/// Upsert a snapshot by `snapshot_key`, returning its id.
///
/// When the key already exists, the row is reused and its
/// `generated_commit_message` is updated only when a non-empty message is
/// supplied — a bare (build-check) upsert must not clobber a real message.
pub fn upsert(
    pool: &DbPool,
    snapshot_key: &str,
    generated_commit_message: Option<&str>,
    evolution_id: Option<i64>,
    created_at: i64,
) -> Result<i64> {
    let mut conn = pool.get()?;

    let existing: Option<i64> = snapshots::table
        .filter(snapshots::snapshot_key.eq(snapshot_key))
        .select(snapshots::id)
        .first::<i64>(&mut conn)
        .optional()?;

    if let Some(id) = existing {
        let has_message = generated_commit_message.is_some_and(|m| !m.trim().is_empty());
        if has_message {
            diesel::update(snapshots::table.filter(snapshots::id.eq(id)))
                .set((
                    snapshots::generated_commit_message.eq(generated_commit_message),
                    snapshots::evolution_id.eq(evolution_id),
                ))
                .execute(&mut conn)?;
        }
        return Ok(id);
    }

    diesel::insert_into(snapshots::table)
        .values((
            snapshots::snapshot_key.eq(snapshot_key),
            snapshots::generated_commit_message.eq(generated_commit_message),
            snapshots::evolution_id.eq(evolution_id),
            snapshots::created_at.eq(created_at),
        ))
        .execute(&mut conn)?;

    Ok(snapshots::table
        .filter(snapshots::snapshot_key.eq(snapshot_key))
        .select(snapshots::id)
        .first::<i64>(&mut conn)?)
}

/// Fetch a snapshot by its content key.
pub fn get_by_key(pool: &DbPool, snapshot_key: &str) -> Result<Option<Snapshot>> {
    let mut conn = pool.get()?;
    Ok(snapshots::table
        .filter(snapshots::snapshot_key.eq(snapshot_key))
        .select((snapshots::id, snapshots::generated_commit_message))
        .first::<(i64, Option<String>)>(&mut conn)
        .optional()?
        .map(|(id, generated_commit_message)| Snapshot {
            id,
            generated_commit_message,
        }))
}

/// Fetch the content key for a snapshot id, used to verify build state without
/// re-storing membership.
pub fn get_key_by_id(pool: &DbPool, id: i64) -> Result<Option<String>> {
    let mut conn = pool.get()?;
    Ok(snapshots::table
        .filter(snapshots::id.eq(id))
        .select(snapshots::snapshot_key)
        .first::<String>(&mut conn)
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upsert_reuses_key_and_preserves_existing_message() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let first = upsert(&pool, "key-a", Some("feat: thing"), None, 1).unwrap();
        // Bare upsert (null message) must not clobber the stored message.
        let same = upsert(&pool, "key-a", None, None, 2).unwrap();
        assert_eq!(first, same);

        let snap = get_by_key(&pool, "key-a").unwrap().unwrap();
        assert_eq!(snap.id, first);
        assert_eq!(
            snap.generated_commit_message.as_deref(),
            Some("feat: thing")
        );
        assert_eq!(
            get_key_by_id(&pool, first).unwrap().as_deref(),
            Some("key-a")
        );
    }
}
