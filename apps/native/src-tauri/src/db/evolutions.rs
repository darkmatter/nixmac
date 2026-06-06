//! Evolution persistence helpers.

use anyhow::Result;
use diesel::prelude::*;

use crate::db::tables::evolutions;
use crate::db::DbPool;

/// Upsert an evolution by id: if `existing_id` is Some and exists in the DB, return it.
/// Otherwise insert a new evolution record and return its id.
pub fn upsert(pool: &DbPool, existing_id: Option<i64>, origin_branch: &str) -> Result<i64> {
    let mut conn = pool.get()?;

    if let Some(id) = existing_id {
        let exists = evolutions::table
            .find(id)
            .select(evolutions::id)
            .first::<i64>(&mut conn)
            .optional()?
            .is_some();
        if exists {
            return Ok(id);
        }
    }

    diesel::insert_into(evolutions::table)
        .values((
            evolutions::origin_branch.eq(origin_branch),
            evolutions::merged.eq(0),
            evolutions::builds.eq(0),
        ))
        .execute(&mut conn)?;

    let id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
        "last_insert_rowid()",
    ))
    .get_result::<i64>(&mut conn)?;

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upsert_inserts_new_evolution_then_reuses_existing_id() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let first_id = upsert(&pool, None, "feature").unwrap();
        let same_id = upsert(&pool, Some(first_id), "feature").unwrap();
        let other_id = upsert(&pool, Some(9999), "feature").unwrap();

        assert_eq!(first_id, same_id);
        assert_ne!(first_id, other_id);
    }
}
