//! Persists a whole-diff summarization result — one or more groups, each with
//! its own commit message, where every change is linked to its group's summary.

use anyhow::Result;
use diesel::connection::Connection;

use crate::db::DbPool;
use crate::db::changesets::{
    get_change_id_by_hash, insert_change_set, insert_change_summary, link_change_to_group_summary,
    link_change_to_set, upsert_change,
};
use crate::sqlite_types::Change;
use crate::summarize::pipelines::whole_diff::GroupedChange;

#[allow(clippy::too_many_arguments)]
pub fn store(
    pool: &DbPool,
    groups: &[GroupedChange],
    generated_commit_message: &str,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<i64> {
    let mut conn = pool.get()?;
    let now = crate::utils::unix_now();

    conn.transaction::<i64, anyhow::Error, _>(|conn| {
        let mut change_ids: Vec<i64> = Vec::with_capacity(groups.len());

        // One group_summary row per distinct summary string; multiple changes
        // sharing a summary are linked to the same row. Summary equality is
        // intentionally string-based — two groups with identical text are
        // collapsed, mirroring how `group_existing` reconstructs groups by
        // `group_summary.id`.
        let mut summary_id_by_text: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();

        for grouped in groups {
            let change = &grouped.change;
            let description = grouped.summary.trim();
            let title = description.lines().next().unwrap_or(description).trim();

            let group_summary_id = if let Some(id) = summary_id_by_text.get(description) {
                *id
            } else {
                let id = insert_change_summary(conn, title, description, "DONE", now)?;
                summary_id_by_text.insert(description.to_string(), id);
                id
            };

            let own_title = std::path::Path::new(&change.filename)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&change.filename);
            // Per-change own_summary mirrors the group summary; the read path
            // treats a change without an own_summary as "unsummarized" and
            // surfaces it in `unsummarized_hashes`, so we set it to keep the
            // change off the re-summarize list.
            let own_summary_id = insert_change_summary(conn, own_title, description, "DONE", now)?;
            upsert_change(conn, change, Some(own_summary_id))?;
            let change_id = get_change_id_by_hash(conn, &change.hash)?;
            link_change_to_group_summary(conn, change_id, group_summary_id)?;
            change_ids.push(change_id);
        }

        let change_set_id = insert_change_set(
            conn,
            commit_id,
            base_commit_id,
            commit_message,
            Some(generated_commit_message),
            now,
            evolution_id,
        )?;

        for change_id in change_ids {
            link_change_to_set(conn, change_set_id, change_id)?;
        }

        Ok(change_set_id)
    })
}

/// Convenience wrapper for callers that still produce a single message for
/// the entire changeset (legacy single-group path).
#[allow(dead_code)]
pub fn store_single(
    pool: &DbPool,
    changes: &[Change],
    message: &str,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<i64> {
    let groups: Vec<GroupedChange> = changes
        .iter()
        .map(|c| GroupedChange {
            change: c.clone(),
            summary: message.to_string(),
        })
        .collect();
    store(
        pool,
        &groups,
        message,
        commit_id,
        base_commit_id,
        commit_message,
        evolution_id,
    )
}
