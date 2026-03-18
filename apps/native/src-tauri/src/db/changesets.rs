//! Change-set persistence helpers.
//!
//! Write helpers take `&Transaction` to participate in the caller's transaction.
//! Read helpers take `&Connection` — reads don't need a transaction.

use anyhow::Result;
use rusqlite::{Connection, Transaction};

use crate::query_return_types::{SummarizedChanges, SummarizedChange};
use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

pub fn insert_change_summary(
    tx: &Transaction,
    title: &str,
    description: &str,
    group_summary_for: Option<&str>,
    created_at: i64,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_summaries (title, description, group_summary_for, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![title, description, group_summary_for, created_at],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn upsert_change(
    tx: &Transaction,
    change: &Change,
    group_summary_id: Option<i64>,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, group_summary_id, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            group_summary_id, own_summary_id,
        ],
    )?;
    tx.execute(
        "UPDATE changes SET group_summary_id = ?1, own_summary_id = ?2 WHERE hash = ?3",
        rusqlite::params![group_summary_id, own_summary_id, &change.hash],
    )?;
    Ok(())
}

pub fn insert_change_or_ignore(
    tx: &Transaction,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO changes \
         (hash, filename, diff, line_count, created_at, group_summary_id, own_summary_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        rusqlite::params![
            &change.hash, &change.filename, &change.diff, change.line_count, change.created_at,
            own_summary_id,
        ],
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
) -> Result<i64> {
    tx.execute(
        "INSERT INTO change_sets \
         (commit_id, base_commit_id, commit_message, generated_commit_message, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            commit_id, base_commit_id, commit_message, generated_commit_message, created_at,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn get_change_id_by_hash(tx: &Transaction, hash: &str) -> Result<i64> {
    Ok(tx.query_row(
        "SELECT id FROM changes WHERE hash = ?1",
        [hash],
        |row| row.get(0),
    )?)
}

pub fn link_change_to_set(tx: &Transaction, change_set_id: i64, change_id: i64) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO set_changes (change_set_id, change_id) VALUES (?1, ?2)",
        rusqlite::params![change_set_id, change_id],
    )?;
    Ok(())
}

fn map_summarized_change(row: &rusqlite::Row) -> rusqlite::Result<SummarizedChange> {
    let change = Change {
        id: row.get(0)?,
        hash: row.get(1)?,
        filename: row.get(2)?,
        diff: row.get(3)?,
        line_count: row.get(4)?,
        created_at: row.get(5)?,
        group_summary_id: row.get(6)?,
        own_summary_id: row.get(7)?,
    };
    let own_summary = if row.get::<_, Option<i64>>(8)?.is_some() {
        Some(ChangeSummary {
            id: row.get(8)?,
            title: row.get(9)?,
            description: row.get(10)?,
            group_summary_for: row.get(11)?,
            created_at: row.get(12)?,
        })
    } else {
        None
    };
    let group_summary = if row.get::<_, Option<i64>>(13)?.is_some() {
        Some(ChangeSummary {
            id: row.get(13)?,
            title: row.get(14)?,
            description: row.get(15)?,
            group_summary_for: row.get(16)?,
            created_at: row.get(17)?,
        })
    } else {
        None
    };
    Ok(SummarizedChange { change, own_summary, group_summary })
}

const CHANGE_SELECT: &str = "SELECT c.id, c.hash, c.filename, c.diff, c.line_count, c.created_at,
        c.group_summary_id, c.own_summary_id,
        os.id, os.title, os.description, os.group_summary_for, os.created_at,
        gs.id, gs.title, gs.description, gs.group_summary_for, gs.created_at";

pub fn query_change_set_for_commit_pair(
    conn: &Connection,
    commit_id: i64,
    base_commit_id: i64,
) -> Result<Option<SummarizedChanges>> {
    let cs_result = conn.query_row(
        "SELECT id, commit_id, base_commit_id, commit_message, generated_commit_message, created_at
         FROM change_sets WHERE commit_id = ?1 AND base_commit_id = ?2
         ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![commit_id, base_commit_id],
        |row| {
            Ok(ChangeSet {
                id: row.get(0)?,
                commit_id: row.get(1)?,
                base_commit_id: row.get(2)?,
                commit_message: row.get(3)?,
                generated_commit_message: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    );

    let change_set = match cs_result {
        Ok(cs) => cs,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let change_set_id = change_set.id;
    let mut stmt = conn.prepare(&format!(
        "{CHANGE_SELECT}
         FROM set_changes sc
         JOIN changes c ON c.id = sc.change_id
         LEFT JOIN change_summaries os ON os.id = c.own_summary_id
         LEFT JOIN change_summaries gs ON gs.id = c.group_summary_id
         WHERE sc.change_set_id = ?1"
    ))?;
    let changes: Vec<SummarizedChange> = stmt
        .query_map([change_set_id], map_summarized_change)?
        .collect::<rusqlite::Result<_>>()?;

    Ok(Some(SummarizedChanges { change_set, changes }))
}

#[allow(dead_code)]
pub fn query_changes_by_hashes_for_base(
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
    let sql = format!(
        "{CHANGE_SELECT}
         FROM changes c
         JOIN set_changes sc ON sc.change_id = c.id
         JOIN change_sets cs ON cs.id = sc.change_set_id
         LEFT JOIN change_summaries os ON os.id = c.own_summary_id
         LEFT JOIN change_summaries gs ON gs.id = c.group_summary_id
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
