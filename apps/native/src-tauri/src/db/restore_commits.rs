//! Persistence for restore-origin tracking.
//!
//! Records which commits were created by a restore operation and what their
//! origin commit was. Used by `get_history` to surface restore provenance and
//! copy the origin changeset rather than triggering a fresh summarization run.

use anyhow::Result;
use diesel::prelude::*;

use crate::db::DbPool;
use crate::db::tables::restore_commits;

/// Record that `commit_hash` is a restore of `origin_hash`.
pub fn insert(pool: &DbPool, commit_hash: &str, origin_hash: &str) -> Result<()> {
    let mut conn = pool.get()?;
    diesel::replace_into(restore_commits::table)
        .values((
            restore_commits::commit_hash.eq(commit_hash),
            restore_commits::origin_hash.eq(origin_hash),
        ))
        .execute(&mut conn)?;
    Ok(())
}

/// Return the origin hash for `commit_hash`, or `None` if it is not a restore commit.
pub fn get_origin_hash(pool: &DbPool, commit_hash: &str) -> Result<Option<String>> {
    let mut conn = pool.get()?;
    Ok(restore_commits::table
        .find(commit_hash)
        .select(restore_commits::origin_hash)
        .first::<String>(&mut conn)
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn insert_and_get_origin_hash_round_trips() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        insert(&pool, "abc", "origin-1").unwrap();
        // REPLACE: the second insert overwrites the origin
        insert(&pool, "abc", "origin-2").unwrap();

        assert_eq!(
            get_origin_hash(&pool, "abc").unwrap(),
            Some("origin-2".to_string())
        );
        assert_eq!(get_origin_hash(&pool, "missing").unwrap(), None);
    }
}
