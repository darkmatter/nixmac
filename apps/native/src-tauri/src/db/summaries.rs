//! Summary persistence — content-addressed patch (single) and group summaries.
//!
//! A summary describes *what a patch does*. It is keyed only by the content
//! hash(es) of the change(s) it covers — never by a base commit. Groups are
//! first-class and identified by `group_key = hash(sorted member hashes)`.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::DbPool;
use crate::db::keys;
use crate::db::tables::{patch_summaries, summary_group_members, summary_groups};

/// A stored per-change (single / fallback) summary.
#[derive(Clone)]
#[allow(dead_code)] // `change_hash`/`created_at` retained for completeness / future use.
pub struct PatchRow {
    pub change_hash: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub created_at: i64,
}

/// A stored group summary together with its exact membership.
#[derive(Clone)]
pub struct GroupRow {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub created_at: i64,
    pub members: Vec<String>,
}

/// Upsert a per-change summary keyed by `change_hash`, on a borrowed connection.
///
/// Caller is responsible for committing (or rolling back) the enclosing
/// transaction so a failure mid-pipeline leaves no partial rows committed.
pub fn store_patch_tx(
    conn: &mut SqliteConnection,
    change_hash: &str,
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<()> {
    diesel::insert_into(patch_summaries::table)
        .values((
            patch_summaries::change_hash.eq(change_hash),
            patch_summaries::title.eq(title),
            patch_summaries::description.eq(description),
            patch_summaries::status.eq(status),
            patch_summaries::created_at.eq(created_at),
        ))
        .on_conflict(patch_summaries::change_hash)
        .do_update()
        .set((
            patch_summaries::title.eq(title),
            patch_summaries::description.eq(description),
            patch_summaries::status.eq(status),
            patch_summaries::created_at.eq(created_at),
        ))
        .execute(conn)?;
    Ok(())
}

/// Upsert a per-change summary keyed by `change_hash`.
pub fn store_patch(
    pool: &DbPool,
    change_hash: &str,
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<()> {
    let mut conn = pool.get()?;
    store_patch_tx(
        &mut conn,
        change_hash,
        title,
        description,
        status,
        created_at,
    )
}

/// Upsert a group summary keyed by the content hash of its members, replacing
/// membership so the group's identity always matches its exact member set, on a
/// borrowed connection inside the caller's transaction.
pub fn store_group_tx(
    conn: &mut SqliteConnection,
    member_hashes: &[String],
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<String> {
    let group_key = keys::group_key(member_hashes);

    diesel::insert_into(summary_groups::table)
        .values((
            summary_groups::group_key.eq(&group_key),
            summary_groups::title.eq(title),
            summary_groups::description.eq(description),
            summary_groups::status.eq(status),
            summary_groups::created_at.eq(created_at),
        ))
        .on_conflict(summary_groups::group_key)
        .do_update()
        .set((
            summary_groups::title.eq(title),
            summary_groups::description.eq(description),
            summary_groups::status.eq(status),
            summary_groups::created_at.eq(created_at),
        ))
        .execute(conn)?;

    diesel::delete(
        summary_group_members::table.filter(summary_group_members::group_key.eq(&group_key)),
    )
    .execute(conn)?;

    let mut unique: Vec<&String> = member_hashes.iter().collect();
    unique.sort_unstable();
    unique.dedup();
    for hash in unique {
        diesel::insert_into(summary_group_members::table)
            .values((
                summary_group_members::group_key.eq(&group_key),
                summary_group_members::change_hash.eq(hash),
            ))
            .on_conflict((
                summary_group_members::group_key,
                summary_group_members::change_hash,
            ))
            .do_nothing()
            .execute(conn)?;
    }

    Ok(group_key)
}

/// Upsert a group summary keyed by the content hash of its members, replacing
/// membership so the group's identity always matches its exact member set.
pub fn store_group(
    pool: &DbPool,
    member_hashes: &[String],
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<String> {
    let mut conn = pool.get()?;
    conn.transaction::<_, anyhow::Error, _>(|c| {
        store_group_tx(c, member_hashes, title, description, status, created_at)
    })
}

/// Load every group whose full membership is contained in `live_hashes`.
///
/// A group only qualifies when *all* of its members are live, so partially
/// present groups never surface (their identity is exact).
pub fn groups_within(pool: &DbPool, live_hashes: &[String]) -> Result<Vec<GroupRow>> {
    if live_hashes.is_empty() {
        return Ok(vec![]);
    }
    let live_set: HashSet<&str> = live_hashes.iter().map(String::as_str).collect();
    let mut conn = pool.get()?;

    // Candidate group keys: any group that has at least one live member.
    let candidate_keys: Vec<String> = summary_group_members::table
        .filter(summary_group_members::change_hash.eq_any(live_hashes))
        .select(summary_group_members::group_key)
        .distinct()
        .load::<String>(&mut conn)?;

    if candidate_keys.is_empty() {
        return Ok(vec![]);
    }

    // Full membership of every candidate group.
    let member_rows: Vec<(String, String)> = summary_group_members::table
        .filter(summary_group_members::group_key.eq_any(&candidate_keys))
        .select((
            summary_group_members::group_key,
            summary_group_members::change_hash,
        ))
        .load::<(String, String)>(&mut conn)?;

    let mut members_by_key: HashMap<String, Vec<String>> = HashMap::new();
    for (key, hash) in member_rows {
        members_by_key.entry(key).or_default().push(hash);
    }

    // Keep only groups whose entire membership is live.
    let qualifying: Vec<String> = members_by_key
        .iter()
        .filter(|(_, members)| members.iter().all(|h| live_set.contains(h.as_str())))
        .map(|(key, _)| key.clone())
        .collect();

    if qualifying.is_empty() {
        return Ok(vec![]);
    }

    let group_rows: Vec<(i64, String, String, String, String, i64)> = summary_groups::table
        .filter(summary_groups::group_key.eq_any(&qualifying))
        .select((
            summary_groups::id,
            summary_groups::group_key,
            summary_groups::title,
            summary_groups::description,
            summary_groups::status,
            summary_groups::created_at,
        ))
        .load(&mut conn)?;

    Ok(group_rows
        .into_iter()
        .map(|(id, key, title, description, status, created_at)| {
            let members = members_by_key.remove(&key).unwrap_or_default();
            GroupRow {
                id,
                title,
                description,
                status,
                created_at,
                members,
            }
        })
        .collect())
}

/// Load per-change summaries for the given change hashes, keyed by hash.
pub fn patches_for(pool: &DbPool, hashes: &[String]) -> Result<HashMap<String, PatchRow>> {
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    let mut conn = pool.get()?;
    let rows: Vec<(String, String, String, String, i64)> = patch_summaries::table
        .filter(patch_summaries::change_hash.eq_any(hashes))
        .select((
            patch_summaries::change_hash,
            patch_summaries::title,
            patch_summaries::description,
            patch_summaries::status,
            patch_summaries::created_at,
        ))
        .load(&mut conn)?;

    Ok(rows
        .into_iter()
        .map(|(change_hash, title, description, status, created_at)| {
            (
                change_hash.clone(),
                PatchRow {
                    change_hash,
                    title,
                    description,
                    status,
                    created_at,
                },
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn group_only_matches_when_all_members_live() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        store_group(&pool, &["a".into(), "b".into()], "title", "desc", "DONE", 0).unwrap();

        // Both members live → group surfaces.
        let found = groups_within(&pool, &["a".into(), "b".into(), "c".into()]).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].members.len(), 2);

        // Only one member live → group is excluded (exact identity).
        let partial = groups_within(&pool, &["a".into(), "c".into()]).unwrap();
        assert!(partial.is_empty());
    }

    #[tokio::test]
    async fn store_patch_upserts_by_hash() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        store_patch(&pool, "h1", "t1", "d1", "DONE", 0).unwrap();
        store_patch(&pool, "h1", "t2", "d2", "DONE", 5).unwrap();

        let map = patches_for(&pool, &["h1".into()]).unwrap();
        let row = map.get("h1").unwrap();
        assert_eq!(row.title, "t2");
        assert_eq!(row.description, "d2");
    }
}
