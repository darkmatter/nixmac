//! Persists an evolved summarization pipeline result to the database.

use anyhow::Result;
use rusqlite::Transaction;
use std::path::Path;

use crate::db::changesets::{
    build_pairs_json, get_change_id_by_hash, insert_change_set, insert_change_summary,
    insert_queued_summary, link_change_to_group_summary, link_change_to_set, upsert_change,
};
use crate::shared_types::SemanticChangeMap;
use crate::summarize::assignments::{
    Assignments, EvolvedGroupAssignment, NewGroupAssignment, NewSingleAssignment,
};

pub fn store(
    db_path: &Path,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    assignments: &mut Assignments,
    semantic_map: &SemanticChangeMap,
    evolution_id: Option<i64>,
) -> Result<(i64, Vec<i64>)> {
    let mut conn = rusqlite::Connection::open(db_path)?;
    let now = crate::utils::unix_now();
    let tx = conn.transaction()?;

    let mut queued_ids = Vec::new();
    for a in &mut assignments.evolved {
        queued_ids.push(store_evolved(&tx, a, now)?);
    }
    for a in &mut assignments.new_groups {
        queued_ids.push(store_new_group(&tx, a, now)?);
    }
    for a in &mut assignments.new_singles {
        queued_ids.push(store_new_single(&tx, a, now)?);
    }

    let change_set_id =
        insert_change_set(&tx, commit_id, base_commit_id, commit_message, None, now, evolution_id)?;

    // Collect all change IDs — HashSet deduplicates existing + new overlaps.
    let mut all_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for a in &assignments.evolved {
        for &id in &a.change_ids {
            all_ids.insert(id);
        }
    }
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
    // Include all existing changes from the map (groups/singles with no new placements).
    for group in &semantic_map.groups {
        for c in &group.changes {
            all_ids.insert(c.id);
        }
    }
    for single in &semantic_map.singles {
        all_ids.insert(single.id);
    }

    for &id in &all_ids {
        link_change_to_set(&tx, change_set_id, id)?;
    }

    tx.commit()?;
    Ok((change_set_id, queued_ids))
}

fn store_evolved(tx: &Transaction, a: &mut EvolvedGroupAssignment, now: i64) -> Result<i64> {
    for nc in &mut a.new_changes {
        nc.own_summary_id = Some(insert_change_summary(tx, "", "", "QUEUED", now)?);
    }
    let group_summary_id = insert_change_summary(tx, "", "", "QUEUED", now)?;
    a.group_summary_id = Some(group_summary_id);

    for nc in &mut a.new_changes {
        upsert_change(tx, &nc.change, nc.own_summary_id)?;
        let change_id = get_change_id_by_hash(tx, &nc.change.hash)?;
        nc.change_id = Some(change_id);
        a.change_ids.push(change_id);
    }

    for &id in &a.change_ids {
        link_change_to_group_summary(tx, id, group_summary_id)?;
    }

    let pairs = build_pairs_json(&a.new_changes);
    let queued_id = insert_queued_summary(
        tx,
        &a.prompt,
        "EVOLVED_GROUP",
        Some(group_summary_id),
        Some(&pairs),
    )?;

    Ok(queued_id)
}

fn store_new_group(tx: &Transaction, a: &mut NewGroupAssignment, now: i64) -> Result<i64> {
    for c in &mut a.changes {
        c.own_summary_id = Some(insert_change_summary(tx, "", "", "QUEUED", now)?);
    }
    let group_summary_id = insert_change_summary(tx, "", "", "QUEUED", now)?;
    a.group_summary_id = Some(group_summary_id);

    for c in &mut a.changes {
        upsert_change(tx, &c.change, c.own_summary_id)?;
        let change_id = get_change_id_by_hash(tx, &c.change.hash)?;
        c.change_id = Some(change_id);
        a.change_ids.push(change_id);
    }

    for &id in &a.change_ids {
        link_change_to_group_summary(tx, id, group_summary_id)?;
    }

    let pairs = build_pairs_json(&a.changes);
    let queued_id =
        insert_queued_summary(tx, &a.prompt, "NEW_GROUP", Some(group_summary_id), Some(&pairs))?;

    Ok(queued_id)
}

fn store_new_single(tx: &Transaction, a: &mut NewSingleAssignment, now: i64) -> Result<i64> {
    a.pending.own_summary_id = Some(insert_change_summary(tx, "", "", "QUEUED", now)?);
    upsert_change(tx, &a.pending.change, a.pending.own_summary_id)?;
    let change_id = get_change_id_by_hash(tx, &a.pending.change.hash)?;
    a.pending.change_id = Some(change_id);

    let pairs = serde_json::to_string(&[serde_json::json!({
        "hash": a.pending.change.hash,
        "summary_id": a.pending.own_summary_id.unwrap()
    })])
    .unwrap_or_default();
    let queued_id = insert_queued_summary(tx, &a.prompt, "NEW_SINGLE", None, Some(&pairs))?;

    Ok(queued_id)
}

