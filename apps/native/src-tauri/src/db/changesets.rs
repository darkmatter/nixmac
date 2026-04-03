//! Change-set persistence helpers.
//!
//! Write helpers take `&Transaction` to participate in the caller's transaction.
//! Read helpers take `&Connection` — reads don't need a transaction.

use anyhow::Result;
use rusqlite::{Connection, Transaction};

use crate::shared_types::{SummarizedChange, SummarizedChangeSet};
use crate::sqlite_types::{Change, ChangeSet, ChangeSummary, QueuedSummary};

pub fn insert_change_summary(
    tx: &Transaction,
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_summaries (title, description, status, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![title, description, status, created_at],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn upsert_change(
    tx: &Transaction,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            own_summary_id,
        ],
    )?;
    tx.execute(
        "UPDATE changes SET own_summary_id = ?1 WHERE hash = ?2",
        rusqlite::params![own_summary_id, &change.hash],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_change_or_ignore(
    tx: &Transaction,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            own_summary_id,
        ],
    )?;
    Ok(())
}

pub fn link_change_to_group_summary(
    tx: &Transaction,
    change_id: i64,
    change_summary_id: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO group_summaries (change_id, change_summary_id) VALUES (?1, ?2)",
        rusqlite::params![change_id, change_summary_id],
    )?;
    Ok(())
}

pub fn insert_change_set(
    tx: &Transaction,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    generated_commit_message: Option<&str>,
    created_at: i64,
    evolution_id: Option<i64>,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_sets \
         (commit_id, base_commit_id, commit_message, generated_commit_message, created_at, evolution_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            commit_id, base_commit_id, commit_message, generated_commit_message, created_at,
            evolution_id,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn get_change_id_by_hash(tx: &Transaction, hash: &str) -> Result<i64> {
    Ok(tx.query_row(
        "SELECT id FROM changes WHERE hash = ?1",
        [hash],
        |row| row.get("id"),
    )?)
}

pub fn link_change_to_set(tx: &Transaction, change_set_id: i64, change_id: i64) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO set_changes (change_set_id, change_id) VALUES (?1, ?2)",
        rusqlite::params![change_set_id, change_id],
    )?;
    Ok(())
}

pub fn insert_queued_summary(
    tx: &Transaction,
    prompt: &str,
    summary_type: &str,
    group_summary_id: Option<i64>,
    hash_own_summary_id_pairs: Option<&str>,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO queued_summaries \
         (status, prompt, type, group_summary_id, hash_own_summary_id_pairs) \
         VALUES ('QUEUED', ?1, ?2, ?3, ?4)",
        rusqlite::params![prompt, summary_type, group_summary_id, hash_own_summary_id_pairs],
    )?;
    Ok(tx.last_insert_rowid())
}

fn map_summarized_change(row: &rusqlite::Row) -> rusqlite::Result<SummarizedChange> {
    let change = Change {
        id: row.get("c_id")?,
        hash: row.get("c_hash")?,
        filename: row.get("c_filename")?,
        diff: row.get("c_diff")?,
        line_count: row.get("c_line_count")?,
        created_at: row.get("c_created_at")?,
        own_summary_id: row.get("c_own_summary_id")?,
    };
    let own_summary = if row.get::<_, Option<i64>>("os_id")?.is_some() {
        Some(ChangeSummary {
            id: row.get("os_id")?,
            title: row.get("os_title")?,
            description: row.get("os_description")?,
            status: row.get("os_status")?,
            created_at: row.get("os_created_at")?,
        })
    } else {
        None
    };
    let group_summary = if row.get::<_, Option<i64>>("gs_id")?.is_some() {
        Some(ChangeSummary {
            id: row.get("gs_id")?,
            title: row.get("gs_title")?,
            description: row.get("gs_description")?,
            status: row.get("gs_status")?,
            created_at: row.get("gs_created_at")?,
        })
    } else {
        None
    };
    Ok(SummarizedChange { change, own_summary, group_summary })
}

const CHANGE_SELECT: &str = "SELECT \
        c.id AS c_id, c.hash AS c_hash, c.filename AS c_filename, c.diff AS c_diff, \
        c.line_count AS c_line_count, c.created_at AS c_created_at, \
        c.own_summary_id AS c_own_summary_id, \
        os.id AS os_id, os.title AS os_title, os.description AS os_description, \
        os.status AS os_status, os.created_at AS os_created_at, \
        gs.id AS gs_id, gs.title AS gs_title, gs.description AS gs_description, \
        gs.status AS gs_status, gs.created_at AS gs_created_at";

pub fn query_change_set_for_commit_pair(
    conn: &Connection,
    commit_id: i64,
    base_commit_id: i64,
) -> Result<Option<SummarizedChangeSet>> {
    let cs_result = conn.query_row(
        "SELECT id, commit_id, base_commit_id, commit_message, generated_commit_message, created_at, evolution_id
         FROM change_sets WHERE commit_id = ?1 AND base_commit_id = ?2
         ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![commit_id, base_commit_id],
        |row| {
            Ok(ChangeSet {
                id: row.get("id")?,
                commit_id: row.get("commit_id")?,
                base_commit_id: row.get("base_commit_id")?,
                commit_message: row.get("commit_message")?,
                generated_commit_message: row.get("generated_commit_message")?,
                created_at: row.get("created_at")?,
                evolution_id: row.get("evolution_id")?,
            })
        },
    );

    let change_set = match cs_result {
        Ok(cs) => cs,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let change_set_id = change_set.id;
    // Subquery picks at most one group summary per change: only summaries whose
    // entire member set is present in this change_set (no orphaned members).
    let mut stmt = conn.prepare(&format!(
        "{CHANGE_SELECT}
         FROM set_changes sc
         JOIN changes c ON c.id = sc.change_id
         LEFT JOIN change_summaries os ON os.id = c.own_summary_id
         LEFT JOIN (
             SELECT g.change_id, MAX(g.change_summary_id) AS change_summary_id
             FROM group_summaries g
             WHERE NOT EXISTS (
                 SELECT 1 FROM group_summaries g2
                 WHERE g2.change_summary_id = g.change_summary_id
                   AND g2.change_id NOT IN (
                       SELECT change_id FROM set_changes WHERE change_set_id = ?1
                   )
             )
             GROUP BY g.change_id
         ) best_gs ON best_gs.change_id = c.id
         LEFT JOIN change_summaries gs ON gs.id = best_gs.change_summary_id
         WHERE sc.change_set_id = ?1"
    ))?;
    let changes: Vec<SummarizedChange> = stmt
        .query_map([change_set_id], map_summarized_change)?
        .collect::<rusqlite::Result<_>>()?;

    Ok(Some(SummarizedChangeSet { change_set, changes, missed_hashes: vec![] }))
}

pub fn query_change_set_for_base_with_hashes(
    conn: &Connection,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<Option<SummarizedChangeSet>> {
    let cs_result: rusqlite::Result<ChangeSet> = conn.query_row(
        "SELECT id, commit_id, base_commit_id, commit_message, generated_commit_message, \
         created_at, evolution_id FROM change_sets WHERE base_commit_id = ?1 \
         ORDER BY created_at DESC LIMIT 1",
        [base_commit_id],
        |row| {
            Ok(ChangeSet {
                id: row.get("id")?,
                commit_id: row.get("commit_id")?,
                base_commit_id: row.get("base_commit_id")?,
                commit_message: row.get("commit_message")?,
                generated_commit_message: row.get("generated_commit_message")?,
                created_at: row.get("created_at")?,
                evolution_id: row.get("evolution_id")?,
            })
        },
    );

    let change_set = match cs_result {
        Ok(cs) => cs,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let matched = query_changes_by_hashes_for_base(conn, base_commit_id, hashes)?;
    let matched_set: std::collections::HashSet<&str> =
        matched.iter().map(|sc| sc.change.hash.as_str()).collect();
    let missed_hashes =
        hashes.iter().filter(|h| !matched_set.contains(h.as_str())).cloned().collect();

    Ok(Some(SummarizedChangeSet { change_set, changes: matched, missed_hashes }))
}

fn query_changes_by_hashes_for_base(
    conn: &Connection,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<Vec<SummarizedChange>> {
    if hashes.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = (2..=hashes.len() + 1)
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    // {placeholders} is reused in both IN clauses; rusqlite numbered params (?2, ?3, ...)
    // are bound once and referenced twice, so no extra entries in the params vec are needed.
    let sql = format!(
        "{CHANGE_SELECT}
         FROM changes c
         JOIN set_changes sc ON sc.change_id = c.id
         JOIN change_sets cs ON cs.id = sc.change_set_id
         LEFT JOIN change_summaries os ON os.id = c.own_summary_id
         LEFT JOIN (
             SELECT g.change_id, MAX(g.change_summary_id) AS change_summary_id
             FROM group_summaries g
             WHERE NOT EXISTS (
                 SELECT 1 FROM group_summaries g2
                 WHERE g2.change_summary_id = g.change_summary_id
                   AND g2.change_id NOT IN (
                       SELECT id FROM changes WHERE hash IN ({placeholders})
                   )
             )
             GROUP BY g.change_id
         ) best_gs ON best_gs.change_id = c.id
         LEFT JOIN change_summaries gs ON gs.id = best_gs.change_summary_id
         WHERE cs.base_commit_id = ?1 AND c.hash IN ({placeholders})"
    );

    use rusqlite::types::ToSql;
    let params: Vec<Box<dyn ToSql>> = std::iter::once(Box::new(base_commit_id) as Box<dyn ToSql>)
        .chain(hashes.iter().map(|h| Box::new(h.clone()) as Box<dyn ToSql>))
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let result = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), map_summarized_change)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(result)
}

// ── Queue-processing helpers ───────────────────────────────────────────────────

fn map_queued_summary(row: &rusqlite::Row) -> rusqlite::Result<QueuedSummary> {
    Ok(QueuedSummary {
        id: row.get("id")?,
        status: row.get("status")?,
        attempted_count: row.get("attempted_count")?,
        prompt: row.get("prompt")?,
        model_response: row.get("model_response")?,
        group_summary_id: row.get("group_summary_id")?,
        hash_own_summary_id_pairs: row.get("hash_own_summary_id_pairs")?,
        summary_type: row.get("type")?,
    })
}

const QUEUED_SUMMARY_SELECT: &str =
    "SELECT id, status, attempted_count, prompt, model_response, \
     group_summary_id, hash_own_summary_id_pairs, type FROM queued_summaries";

/// Fetch specific QUEUED rows by ID, preserving the order of the `ids` slice.
pub fn fetch_queued_summaries_by_ids(
    conn: &Connection,
    ids: &[i64],
) -> Result<Vec<QueuedSummary>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = (1..=ids.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let sql = format!(
        "{QUEUED_SUMMARY_SELECT} WHERE status = 'QUEUED' AND id IN ({placeholders})"
    );
    use rusqlite::types::ToSql;
    let params: Vec<Box<dyn ToSql>> =
        ids.iter().map(|&id| Box::new(id) as Box<dyn ToSql>).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut rows: Vec<QueuedSummary> = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), map_queued_summary)?
        .collect::<rusqlite::Result<_>>()?;
    let id_order: std::collections::HashMap<i64, usize> =
        ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    rows.sort_by_key(|r| id_order.get(&r.id).copied().unwrap_or(usize::MAX));
    Ok(rows)
}

/// Fetch all rows with status = 'QUEUED'.
pub fn fetch_all_queued_summaries(conn: &Connection) -> Result<Vec<QueuedSummary>> {
    let sql = format!("{QUEUED_SUMMARY_SELECT} WHERE status = 'QUEUED'");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_queued_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Atomically increment attempted_count.
pub fn increment_queued_attempts(tx: &Transaction, id: i64) -> Result<()> {
    tx.execute(
        "UPDATE queued_summaries SET attempted_count = attempted_count + 1 WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Mark queued_summary DONE, saving the raw model JSON.
pub fn mark_queued_done(tx: &Transaction, id: i64, model_response: &str) -> Result<()> {
    tx.execute(
        "UPDATE queued_summaries SET status = 'DONE', model_response = ?1 WHERE id = ?2",
        rusqlite::params![model_response, id],
    )?;
    Ok(())
}

/// Mark queued_summary FAILED.
pub fn mark_queued_failed(tx: &Transaction, id: i64) -> Result<()> {
    tx.execute(
        "UPDATE queued_summaries SET status = 'FAILED' WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Write title + description into a change_summaries row, set status = 'DONE'.
pub fn update_change_summary_content(
    tx: &Transaction,
    summary_id: i64,
    title: &str,
    description: &str,
) -> Result<()> {
    tx.execute(
        "UPDATE change_summaries SET title = ?1, description = ?2, status = 'DONE' WHERE id = ?3",
        rusqlite::params![title, description, summary_id],
    )?;
    Ok(())
}

/// Set a change_summaries row to status = 'FAILED'.
pub fn mark_change_summary_failed(tx: &Transaction, summary_id: i64) -> Result<()> {
    tx.execute(
        "UPDATE change_summaries SET status = 'FAILED' WHERE id = ?1",
        [summary_id],
    )?;
    Ok(())
}
