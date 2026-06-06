//! Persists a new summarization pipeline result to the database.

use anyhow::Result;
use diesel::connection::Connection;
use diesel::sqlite::SqliteConnection;

use crate::db::changesets::{
    build_pairs_json, get_change_id_by_hash, insert_change_set, insert_change_summary,
    insert_queued_summary, link_change_to_group_summary, link_change_to_set, upsert_change,
};
use crate::db::DbPool;
use crate::summarize::assignments::{Assignments, NewGroupAssignment, NewSingleAssignment};

pub fn store(
    pool: &DbPool,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    assignments: &mut Assignments,
    evolution_id: Option<i64>,
) -> Result<(i64, Vec<i64>)> {
    let mut conn = pool.get()?;
    let now = crate::utils::unix_now();

    conn.transaction::<(i64, Vec<i64>), anyhow::Error, _>(|conn| {
        let mut queued_ids = Vec::new();
        for a in &mut assignments.new_groups {
            queued_ids.push(store_new_group(conn, a, now)?);
        }
        for a in &mut assignments.new_singles {
            queued_ids.push(store_new_single(conn, a, now)?);
        }

        let change_set_id = insert_change_set(
            conn,
            commit_id,
            base_commit_id,
            commit_message,
            None,
            now,
            evolution_id,
        )?;

        let mut all_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
        for a in &assignments.new_groups {
            for &id in &a.change_ids {
                all_ids.insert(id);
            }
        }
        for a in &assignments.new_singles {
            if let Some(id) = a.pending.change_id {
                all_ids.insert(id);
            }
        }

        for &id in &all_ids {
            link_change_to_set(conn, change_set_id, id)?;
        }

        Ok((change_set_id, queued_ids))
    })
}

fn store_new_group(
    conn: &mut SqliteConnection,
    a: &mut NewGroupAssignment,
    now: i64,
) -> Result<i64> {
    for c in &mut a.changes {
        c.own_summary_id = Some(insert_change_summary(conn, "", "", "QUEUED", now)?);
    }
    let group_summary_id = insert_change_summary(conn, "", "", "QUEUED", now)?;
    a.group_summary_id = Some(group_summary_id);

    for c in &mut a.changes {
        upsert_change(conn, &c.change, c.own_summary_id)?;
        let change_id = get_change_id_by_hash(conn, &c.change.hash)?;
        c.change_id = Some(change_id);
        a.change_ids.push(change_id);
    }

    for &id in &a.change_ids {
        link_change_to_group_summary(conn, id, group_summary_id)?;
    }

    let pairs = build_pairs_json(&a.changes);
    let queued_id = insert_queued_summary(
        conn,
        &a.prompt,
        "NEW_GROUP",
        Some(group_summary_id),
        Some(&pairs),
    )?;

    Ok(queued_id)
}

fn store_new_single(
    conn: &mut SqliteConnection,
    a: &mut NewSingleAssignment,
    now: i64,
) -> Result<i64> {
    a.pending.own_summary_id = Some(insert_change_summary(conn, "", "", "QUEUED", now)?);
    upsert_change(conn, &a.pending.change, a.pending.own_summary_id)?;
    let change_id = get_change_id_by_hash(conn, &a.pending.change.hash)?;
    a.pending.change_id = Some(change_id);

    let pairs = serde_json::to_string(&[serde_json::json!({
        "hash": a.pending.change.hash,
        "summary_id": a.pending.own_summary_id.expect("own_summary_id set on line above")
    })])
    .unwrap_or_default();
    let queued_id = insert_queued_summary(conn, &a.prompt, "NEW_SINGLE", None, Some(&pairs))?;

    Ok(queued_id)
}
