//! Persists a completed summarization pipeline result to the database.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::changesets::{
    get_change_id_by_hash, insert_change_or_ignore, insert_change_set, insert_change_summary,
    link_change_to_set, upsert_change,
};
use crate::summarize_pipeline::SummarizePipelineResult;

pub fn store_change_set(
    db_path: &Path,
    commit_id: Option<i64>,
    base_commit_id: Option<i64>,
    commit_message: &str,
    result: &SummarizePipelineResult,
) -> Result<i64> {
    let mut conn = Connection::open(db_path)?;
    let now = unix_now();
    let tx = conn.transaction()?;

    // ── Step 1: Insert change_summaries and upsert changes ───────────────
    let mut all_change_hashes: Vec<String> = Vec::new();

    for sc in &result.semantic_changes {
        let group_id: Option<i64> = if let Some(gs) = &sc.group_summary {
            let hashes: Vec<&str> = sc.hashes.iter().map(String::as_str).collect();
            let group_summary_for = serde_json::to_string(&hashes)?;
            Some(insert_change_summary(&tx, &gs.title, &gs.description, Some(&group_summary_for), now)?)
        } else {
            None
        };

        for hunk in &sc.hunks {
            let own_id: Option<i64> = if let Some(os) = &hunk.own_summary {
                Some(insert_change_summary(&tx, &os.title, &os.description, None, now)?)
            } else {
                None
            };
            upsert_change(&tx, &hunk.change, group_id, own_id)?;
            all_change_hashes.push(hunk.change.hash.clone());
        }
    }

    // Sensitive/opaque changes — INSERT OR IGNORE only (preserve any existing summaries)
    for c in &result.sensitive_or_opaque {
        let own_id = insert_change_summary(
            &tx,
            "Sensitive or Opaque",
            &format!("Unsummarized change in {}", c.filename),
            None,
            now,
        )?;
        insert_change_or_ignore(&tx, c, Some(own_id))?;
        all_change_hashes.push(c.hash.clone());
    }

    // ── Step 2: Insert change_sets row ────────────────────────────────────
    let generated_commit_message: Option<&str> = if result.generated_commit_message.is_empty() {
        None
    } else {
        Some(&result.generated_commit_message)
    };

    let change_set_id = insert_change_set(
        &tx,
        commit_id,
        base_commit_id,
        commit_message,
        generated_commit_message,
        now,
    )?;

    // ── Step 3: Insert set_changes rows ───────────────────────────────────
    for hash in &all_change_hashes {
        let change_id = get_change_id_by_hash(&tx, hash)?;
        link_change_to_set(&tx, change_set_id, change_id)?;
    }

    // ── Step 4: Commit ────────────────────────────────────────────────────
    tx.commit()?;

    Ok(change_set_id)
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
