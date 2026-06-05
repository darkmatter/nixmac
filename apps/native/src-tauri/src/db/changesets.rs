//! Change-set persistence helpers.
//!
//! All helpers take `&mut diesel::SqliteConnection`. Atomic groups are wrapped
//! at the caller via `conn.transaction(|conn| ...)`.

use anyhow::Result;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Nullable, Text};

use crate::db::tables::{
    change_sets, change_summaries, changes, group_summaries, queued_summaries, set_changes,
};
use crate::shared_types::{SummarizedChange, SummarizedChangeSet};
use crate::sqlite_types::{Change, ChangeSet, ChangeSummary, QueuedSummary};

pub fn insert_change_summary(
    conn: &mut SqliteConnection,
    title: &str,
    description: &str,
    status: &str,
    created_at: i64,
) -> Result<i64> {
    diesel::insert_into(change_summaries::table)
        .values((
            change_summaries::title.eq(title),
            change_summaries::description.eq(description),
            change_summaries::status.eq(status),
            change_summaries::created_at.eq(created_at),
        ))
        .execute(conn)?;
    last_insert_rowid(conn)
}

pub fn upsert_change(
    conn: &mut SqliteConnection,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<()> {
    diesel::insert_into(changes::table)
        .values((
            changes::hash.eq(&change.hash),
            changes::filename.eq(&change.filename),
            changes::diff.eq(&change.diff),
            changes::line_count.eq(change.line_count),
            changes::created_at.eq(change.created_at),
            changes::own_summary_id.eq(own_summary_id),
        ))
        .on_conflict(changes::hash)
        .do_nothing()
        .execute(conn)?;
    diesel::update(changes::table.filter(changes::hash.eq(&change.hash)))
        .set(changes::own_summary_id.eq(own_summary_id))
        .execute(conn)?;
    Ok(())
}

pub fn insert_change_or_ignore(
    conn: &mut SqliteConnection,
    change: &Change,
    own_summary_id: Option<i64>,
) -> Result<i64> {
    diesel::insert_into(changes::table)
        .values((
            changes::hash.eq(&change.hash),
            changes::filename.eq(&change.filename),
            changes::diff.eq(&change.diff),
            changes::line_count.eq(change.line_count),
            changes::created_at.eq(change.created_at),
            changes::own_summary_id.eq(own_summary_id),
        ))
        .on_conflict(changes::hash)
        .do_nothing()
        .execute(conn)?;
    Ok(changes::table
        .filter(changes::hash.eq(&change.hash))
        .select(changes::id)
        .first::<i64>(conn)?)
}

pub fn link_change_to_group_summary(
    conn: &mut SqliteConnection,
    change_id: i64,
    change_summary_id: i64,
) -> Result<()> {
    diesel::insert_into(group_summaries::table)
        .values((
            group_summaries::change_id.eq(change_id),
            group_summaries::change_summary_id.eq(change_summary_id),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn insert_change_set(
    conn: &mut SqliteConnection,
    commit_id: Option<i64>,
    base_commit_id: i64,
    commit_message: Option<&str>,
    generated_commit_message: Option<&str>,
    created_at: i64,
    evolution_id: Option<i64>,
) -> Result<i64> {
    diesel::insert_into(change_sets::table)
        .values((
            change_sets::commit_id.eq(commit_id),
            change_sets::base_commit_id.eq(base_commit_id),
            change_sets::commit_message.eq(commit_message),
            change_sets::generated_commit_message.eq(generated_commit_message),
            change_sets::created_at.eq(created_at),
            change_sets::evolution_id.eq(evolution_id),
        ))
        .execute(conn)?;
    last_insert_rowid(conn)
}

pub fn get_change_id_by_hash(conn: &mut SqliteConnection, hash: &str) -> Result<i64> {
    Ok(changes::table
        .filter(changes::hash.eq(hash))
        .select(changes::id)
        .first::<i64>(conn)?)
}

pub fn link_change_to_set(
    conn: &mut SqliteConnection,
    change_set_id: i64,
    change_id: i64,
) -> Result<()> {
    diesel::insert_into(set_changes::table)
        .values((
            set_changes::change_set_id.eq(change_set_id),
            set_changes::change_id.eq(change_id),
        ))
        .on_conflict((set_changes::change_set_id, set_changes::change_id))
        .do_nothing()
        .execute(conn)?;
    Ok(())
}

pub fn insert_queued_summary(
    conn: &mut SqliteConnection,
    prompt: &str,
    summary_type: &str,
    group_summary_id: Option<i64>,
    hash_own_summary_id_pairs: Option<&str>,
) -> Result<i64> {
    diesel::insert_into(queued_summaries::table)
        .values((
            queued_summaries::status.eq("QUEUED"),
            queued_summaries::prompt.eq(prompt),
            queued_summaries::type_.eq(summary_type),
            queued_summaries::group_summary_id.eq(group_summary_id),
            queued_summaries::hash_own_summary_id_pairs.eq(hash_own_summary_id_pairs),
        ))
        .execute(conn)?;
    last_insert_rowid(conn)
}

// ── Big aliased row used by the JOIN read queries ────────────────────────────

#[derive(QueryableByName)]
struct SummarizedChangeRow {
    #[diesel(sql_type = BigInt)]
    c_id: i64,
    #[diesel(sql_type = Text)]
    c_hash: String,
    #[diesel(sql_type = Text)]
    c_filename: String,
    #[diesel(sql_type = Text)]
    c_diff: String,
    #[diesel(sql_type = BigInt)]
    c_line_count: i64,
    #[diesel(sql_type = BigInt)]
    c_created_at: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    c_own_summary_id: Option<i64>,
    #[diesel(sql_type = Nullable<BigInt>)]
    os_id: Option<i64>,
    #[diesel(sql_type = Nullable<Text>)]
    os_title: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    os_description: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    os_status: Option<String>,
    #[diesel(sql_type = Nullable<BigInt>)]
    os_created_at: Option<i64>,
    #[diesel(sql_type = Nullable<BigInt>)]
    gs_id: Option<i64>,
    #[diesel(sql_type = Nullable<Text>)]
    gs_title: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    gs_description: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    gs_status: Option<String>,
    #[diesel(sql_type = Nullable<BigInt>)]
    gs_created_at: Option<i64>,
}

impl From<SummarizedChangeRow> for SummarizedChange {
    fn from(row: SummarizedChangeRow) -> Self {
        let change = Change {
            id: row.c_id,
            hash: row.c_hash,
            filename: row.c_filename,
            diff: row.c_diff,
            line_count: row.c_line_count,
            created_at: row.c_created_at,
            own_summary_id: row.c_own_summary_id,
        };
        let own_summary = row.os_id.map(|id| ChangeSummary {
            id,
            title: row.os_title.unwrap_or_default(),
            description: row.os_description.unwrap_or_default(),
            status: row.os_status.unwrap_or_default(),
            created_at: row.os_created_at.unwrap_or(0),
        });
        let group_summary = row.gs_id.map(|id| ChangeSummary {
            id,
            title: row.gs_title.unwrap_or_default(),
            description: row.gs_description.unwrap_or_default(),
            status: row.gs_status.unwrap_or_default(),
            created_at: row.gs_created_at.unwrap_or(0),
        });
        SummarizedChange {
            change,
            own_summary,
            group_summary,
        }
    }
}

const CHANGE_SELECT: &str = "SELECT \
        c.id AS c_id, c.hash AS c_hash, c.filename AS c_filename, c.diff AS c_diff, \
        c.line_count AS c_line_count, c.created_at AS c_created_at, \
        c.own_summary_id AS c_own_summary_id, \
        os.id AS os_id, os.title AS os_title, os.description AS os_description, \
        os.status AS os_status, os.created_at AS os_created_at, \
        gs.id AS gs_id, gs.title AS gs_title, gs.description AS gs_description, \
        gs.status AS gs_status, gs.created_at AS gs_created_at";

#[derive(QueryableByName)]
struct ChangeSetRow {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    commit_id: Option<i64>,
    #[diesel(sql_type = BigInt)]
    base_commit_id: i64,
    #[diesel(sql_type = Nullable<Text>)]
    commit_message: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    generated_commit_message: Option<String>,
    #[diesel(sql_type = BigInt)]
    created_at: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    evolution_id: Option<i64>,
}

impl From<ChangeSetRow> for ChangeSet {
    fn from(row: ChangeSetRow) -> Self {
        Self {
            id: row.id,
            commit_id: row.commit_id,
            base_commit_id: row.base_commit_id,
            commit_message: row.commit_message,
            generated_commit_message: row.generated_commit_message,
            created_at: row.created_at,
            evolution_id: row.evolution_id,
        }
    }
}

#[allow(dead_code)]
pub fn query_change_set_for_commit_pair(
    conn: &mut SqliteConnection,
    commit_id: i64,
    base_commit_id: i64,
) -> Result<Option<SummarizedChangeSet>> {
    let cs: Option<ChangeSetRow> = sql_query(
        "SELECT id, commit_id, base_commit_id, commit_message, generated_commit_message, \
         created_at, evolution_id \
         FROM change_sets WHERE commit_id = ?1 AND base_commit_id = ?2 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind::<BigInt, _>(commit_id)
    .bind::<BigInt, _>(base_commit_id)
    .get_result(conn)
    .optional()?;

    let Some(cs) = cs else { return Ok(None) };
    let change_set: ChangeSet = cs.into();
    let change_set_id = change_set.id;

    // Subquery picks at most one group summary per change: only summaries whose
    // entire member set is present in this change_set (no orphaned members).
    let rows: Vec<SummarizedChangeRow> = sql_query(format!(
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
    ))
    .bind::<BigInt, _>(change_set_id)
    .load(conn)?;

    let changes = rows.into_iter().map(Into::into).collect();
    Ok(Some(SummarizedChangeSet {
        change_set,
        changes,
        missed_hashes: vec![],
    }))
}

pub fn query_change_set_for_base_with_hashes(
    conn: &mut SqliteConnection,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<Option<SummarizedChangeSet>> {
    let cs: Option<ChangeSetRow> = sql_query(
        "SELECT id, commit_id, base_commit_id, commit_message, generated_commit_message, \
         created_at, evolution_id FROM change_sets WHERE base_commit_id = ?1 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind::<BigInt, _>(base_commit_id)
    .get_result(conn)
    .optional()?;

    let Some(cs) = cs else { return Ok(None) };
    let change_set: ChangeSet = cs.into();

    let matched = query_changes_by_hashes_for_base(conn, base_commit_id, hashes)?;
    let matched_set: std::collections::HashSet<&str> =
        matched.iter().map(|sc| sc.change.hash.as_str()).collect();
    let missed_hashes = hashes
        .iter()
        .filter(|h| !matched_set.contains(h.as_str()))
        .cloned()
        .collect();

    Ok(Some(SummarizedChangeSet {
        change_set,
        changes: matched,
        missed_hashes,
    }))
}

fn query_changes_by_hashes_for_base(
    conn: &mut SqliteConnection,
    base_commit_id: i64,
    hashes: &[String],
) -> Result<Vec<SummarizedChange>> {
    if hashes.is_empty() {
        return Ok(vec![]);
    }

    // Numbered params (?2, ?3, …) are bound once and referenced twice in the
    // generated SQL, so the bind list is base_commit_id followed by the hashes.
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

    let mut q = sql_query(sql).into_boxed::<diesel::sqlite::Sqlite>();
    q = q.bind::<BigInt, _>(base_commit_id);
    for hash in hashes {
        q = q.bind::<Text, _>(hash.clone());
    }
    let rows: Vec<SummarizedChangeRow> = q.load(conn)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

// ── Queue-processing helpers ───────────────────────────────────────────────────

#[derive(Queryable, Selectable)]
#[diesel(table_name = queued_summaries)]
struct QueuedRow {
    id: i64,
    status: String,
    attempted_count: i64,
    prompt: String,
    model_response: Option<String>,
    group_summary_id: Option<i64>,
    hash_own_summary_id_pairs: Option<String>,
    type_: String,
}

impl From<QueuedRow> for QueuedSummary {
    fn from(row: QueuedRow) -> Self {
        Self {
            id: row.id,
            status: row.status,
            attempted_count: row.attempted_count,
            prompt: row.prompt,
            model_response: row.model_response,
            group_summary_id: row.group_summary_id,
            hash_own_summary_id_pairs: row.hash_own_summary_id_pairs,
            summary_type: row.type_,
        }
    }
}

/// Fetch specific QUEUED rows by ID, preserving the order of the `ids` slice.
pub fn fetch_queued_summaries_by_ids(
    conn: &mut SqliteConnection,
    ids: &[i64],
) -> Result<Vec<QueuedSummary>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = queued_summaries::table
        .filter(queued_summaries::status.eq("QUEUED"))
        .filter(queued_summaries::id.eq_any(ids))
        .select(QueuedRow::as_select())
        .load::<QueuedRow>(conn)?;

    let id_order: std::collections::HashMap<i64, usize> =
        ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    let mut summaries: Vec<QueuedSummary> = rows.into_iter().map(Into::into).collect();
    summaries.sort_by_key(|r| id_order.get(&r.id).copied().unwrap_or(usize::MAX));
    Ok(summaries)
}

/// Fetch all rows with status = 'QUEUED'.
pub fn fetch_all_queued_summaries(conn: &mut SqliteConnection) -> Result<Vec<QueuedSummary>> {
    let rows = queued_summaries::table
        .filter(queued_summaries::status.eq("QUEUED"))
        .select(QueuedRow::as_select())
        .load::<QueuedRow>(conn)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Atomically increment attempted_count.
pub fn increment_queued_attempts(conn: &mut SqliteConnection, id: i64) -> Result<()> {
    diesel::update(queued_summaries::table.find(id))
        .set(queued_summaries::attempted_count.eq(queued_summaries::attempted_count + 1))
        .execute(conn)?;
    Ok(())
}

/// Mark queued_summary DONE, saving the raw model JSON.
pub fn mark_queued_done(
    conn: &mut SqliteConnection,
    id: i64,
    model_response: &str,
) -> Result<()> {
    diesel::update(queued_summaries::table.find(id))
        .set((
            queued_summaries::status.eq("DONE"),
            queued_summaries::model_response.eq(model_response),
        ))
        .execute(conn)?;
    Ok(())
}

/// Mark queued_summary FAILED.
pub fn mark_queued_failed(conn: &mut SqliteConnection, id: i64) -> Result<()> {
    diesel::update(queued_summaries::table.find(id))
        .set(queued_summaries::status.eq("FAILED"))
        .execute(conn)?;
    Ok(())
}

/// Write title + description into a change_summaries row, set status = 'DONE'.
pub fn update_change_summary_content(
    conn: &mut SqliteConnection,
    summary_id: i64,
    title: &str,
    description: &str,
) -> Result<()> {
    diesel::update(change_summaries::table.find(summary_id))
        .set((
            change_summaries::title.eq(title),
            change_summaries::description.eq(description),
            change_summaries::status.eq("DONE"),
        ))
        .execute(conn)?;
    Ok(())
}

/// Set a change_summaries row to status = 'FAILED'.
pub fn mark_change_summary_failed(conn: &mut SqliteConnection, summary_id: i64) -> Result<()> {
    diesel::update(change_summaries::table.find(summary_id))
        .set(change_summaries::status.eq("FAILED"))
        .execute(conn)?;
    Ok(())
}

/// Fetch the change hashes stored in a changeset.
pub fn fetch_hashes_for_changeset(
    conn: &mut SqliteConnection,
    changeset_id: i64,
) -> Result<Vec<String>> {
    let hashes = changes::table
        .inner_join(set_changes::table.on(set_changes::change_id.eq(changes::id)))
        .filter(set_changes::change_set_id.eq(changeset_id))
        .select(changes::hash)
        .load::<String>(conn)?;
    Ok(hashes)
}

fn last_insert_rowid(conn: &mut SqliteConnection) -> Result<i64> {
    Ok(diesel::select(diesel::dsl::sql::<BigInt>("last_insert_rowid()")).get_result(conn)?)
}
