//! Commit persistence operations.

use anyhow::Result;
use diesel::prelude::*;

use crate::db::DbPool;
use crate::db::tables::commits;

#[derive(Debug, Insertable)]
#[diesel(table_name = commits)]
struct NewCommit<'a> {
    hash: &'a str,
    tree_hash: &'a str,
    message: Option<&'a str>,
    created_at: i64,
}

#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = commits)]
struct CommitRow {
    id: i64,
    hash: String,
    tree_hash: String,
    message: Option<String>,
    created_at: i64,
}

impl From<CommitRow> for crate::sqlite_types::Commit {
    fn from(row: CommitRow) -> Self {
        Self {
            id: row.id,
            hash: row.hash,
            tree_hash: row.tree_hash,
            message: row.message,
            created_at: row.created_at,
        }
    }
}

/// Insert a commit through the managed Diesel pool, returning its id.
pub fn upsert_commit(
    pool: &DbPool,
    hash: &str,
    tree_hash: &str,
    message: Option<&str>,
    created_at: i64,
) -> Result<i64> {
    let mut conn = pool.get()?;

    use commits::dsl;

    match dsl::commits
        .filter(dsl::hash.eq(hash))
        .select(dsl::id)
        .first::<i64>(&mut conn)
    {
        Ok(existing_id) => return Ok(existing_id),
        Err(diesel::result::Error::NotFound) => {}
        Err(e) => return Err(e.into()),
    }

    diesel::insert_into(commits::table)
        .values(NewCommit {
            hash,
            tree_hash,
            message,
            created_at,
        })
        .execute(&mut conn)?;

    Ok(dsl::commits
        .filter(dsl::hash.eq(hash))
        .select(dsl::id)
        .first::<i64>(&mut conn)?)
}

/// Returns the full commit row for a given hash through the managed Diesel pool.
pub fn get_commit_by_hash(
    pool: &DbPool,
    hash: &str,
) -> Result<Option<crate::sqlite_types::Commit>> {
    let mut conn = pool.get()?;
    let row = commits::table
        .filter(commits::hash.eq(hash))
        .select(CommitRow::as_select())
        .first::<CommitRow>(&mut conn)
        .optional()?;

    Ok(row.map(Into::into))
}

/// Passes through `existing` if `Some`; otherwise resolves HEAD from git and upserts it.
pub fn store_head_commit(
    pool: &DbPool,
    config_dir: &str,
    existing: Option<i64>,
) -> Result<Option<i64>> {
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    let Some(hash) = crate::git::get_ref_sha(config_dir, "HEAD") else {
        return Ok(None);
    };
    let Some(tree_hash) = crate::git::get_ref_sha(config_dir, "HEAD^{tree}") else {
        return Ok(None);
    };
    let now = crate::utils::unix_now();
    Ok(Some(upsert_commit(pool, &hash, &tree_hash, None, now)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pool_backed_commit_helpers_upsert_and_fetch_commit_rows() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let first_id = upsert_commit(&pool, "abc123", "tree123", Some("message"), 123).unwrap();
        let second_id = upsert_commit(&pool, "abc123", "tree123", Some("message"), 123).unwrap();
        let commit = get_commit_by_hash(&pool, "abc123").unwrap().unwrap();

        assert_eq!(first_id, second_id);
        assert_eq!(commit.id, first_id);
        assert_eq!(commit.hash, "abc123");
        assert_eq!(commit.tree_hash, "tree123");
        assert_eq!(commit.message.as_deref(), Some("message"));
        assert_eq!(commit.created_at, 123);
    }
}
