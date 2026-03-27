//! Async background service that drains the `queued_summaries` table.
//!
//! Callers spawn this via:
//! ```ignore
//! tauri::async_runtime::spawn(queue_summarizer::process(Some(ids), app.clone(), db_path));
//! ```
//! The future returns once the queue is empty ("goes dormant").

use anyhow::Result;
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime};

use crate::query_return_types::SemanticChangeMap;
use crate::sqlite_types::QueuedSummary;
use crate::summarize::model_output_types::HunkSummary;

const FAILED_AFTER_TRIES: i64 = 4;

#[derive(serde::Deserialize)]
struct HashSummaryPair {
    hash: String,
    summary_id: i64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizerEvent {
    pub semantic_map: SemanticChangeMap,
}

// ── Public entry point ────────────────────────────────────────────────────────

pub async fn process<R: Runtime>(
    ids: Option<Vec<i64>>,
    app: AppHandle<R>,
    db_path: std::path::PathBuf,
) -> Result<()> {
    let mut first_pass = true;
    loop {
        let items = {
            let conn = rusqlite::Connection::open(&db_path)?;
            if first_pass {
                match &ids {
                    Some(specific_ids) => {
                        crate::db::changesets::fetch_queued_summaries_by_ids(
                            &conn,
                            specific_ids,
                        )?
                    }
                    None => crate::db::changesets::fetch_all_queued_summaries(&conn)?,
                }
            } else {
                crate::db::changesets::fetch_all_queued_summaries(&conn)?
            }
        };
        first_pass = false;

        if items.is_empty() {
            break;
        }

        for item in &items {
            process_item(item, &app, &db_path).await;
            emit_update(&app, &db_path);
        }
    }
    Ok(())
}

// ── Per-item processing ───────────────────────────────────────────────────────

async fn process_item<R: Runtime>(item: &QueuedSummary, app: &AppHandle<R>, db_path: &Path) {
    if let Err(e) = try_process_item(item, app, db_path).await {
        log::warn!("[queue_summarizer] item {} error: {:#}", item.id, e);
    }
}

async fn try_process_item<R: Runtime>(
    item: &QueuedSummary,
    app: &AppHandle<R>,
    db_path: &Path,
) -> Result<()> {
    // Already exhausted retries on a previous run — fail immediately.
    if item.attempted_count >= FAILED_AFTER_TRIES {
        let mut conn = rusqlite::Connection::open(db_path)?;
        let tx = conn.transaction()?;
        crate::db::changesets::mark_queued_failed(&tx, item.id)?;
        fail_change_summaries(&tx, item)?;
        tx.commit()?;
        return Ok(());
    }

    // Optimistically increment the attempt counter before the model call.
    {
        let mut conn = rusqlite::Connection::open(db_path)?;
        let tx = conn.transaction()?;
        crate::db::changesets::increment_queued_attempts(&tx, item.id)?;
        tx.commit()?;
    }
    let new_count = item.attempted_count + 1;

    match item.summary_type.as_str() {
        "NEW_SINGLE" => handle_new_single(item, app, db_path, new_count).await?,
        "NEW_GROUP" => handle_new_group(item, app, db_path, new_count).await?,
        "EVOLVED_GROUP" => handle_evolved_group(item, app, db_path, new_count).await?,
        other => log::warn!("[queue_summarizer] unknown summary_type: {}", other),
    }

    Ok(())
}

// ── Type-specific handlers ────────────────────────────────────────────────────

async fn handle_new_single<R: Runtime>(
    item: &QueuedSummary,
    app: &AppHandle<R>,
    db_path: &Path,
    new_count: i64,
) -> Result<()> {
    match crate::summarize::model_calls::summarize_new_single(&item.prompt, Some(app)).await {
        Ok((summary, _)) => {
            let pairs = parse_pairs(item)?;
            if let Some(pair) = pairs.first() {
                let mut conn = rusqlite::Connection::open(db_path)?;
                let tx = conn.transaction()?;
                crate::db::changesets::update_change_summary_content(
                    &tx,
                    pair.summary_id,
                    &summary.title,
                    &summary.description,
                )?;
                let model_response =
                    serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                crate::db::changesets::mark_queued_done(&tx, item.id, &model_response)?;
                tx.commit()?;
            }
        }
        Err(e) => {
            log::warn!("[queue_summarizer] NEW_SINGLE {} failed: {:#}", item.id, e);
            if new_count >= FAILED_AFTER_TRIES {
                let mut conn = rusqlite::Connection::open(db_path)?;
                let tx = conn.transaction()?;
                crate::db::changesets::mark_queued_failed(&tx, item.id)?;
                fail_change_summaries(&tx, item)?;
                tx.commit()?;
            }
        }
    }
    Ok(())
}

async fn handle_new_group<R: Runtime>(
    item: &QueuedSummary,
    app: &AppHandle<R>,
    db_path: &Path,
    new_count: i64,
) -> Result<()> {
    match crate::summarize::model_calls::summarize_new_group(&item.prompt, Some(app)).await {
        Ok((summary, _)) => {
            let pairs = parse_pairs(item)?;
            let group_summary_id = item.group_summary_id.unwrap_or(0);
            let mut conn = rusqlite::Connection::open(db_path)?;
            let tx = conn.transaction()?;
            crate::db::changesets::update_change_summary_content(
                &tx,
                group_summary_id,
                &summary.group.title,
                &summary.group.description,
            )?;
            for pair in &pairs {
                if let Some(own) = summary.own_summaries.get(&pair.hash) {
                    crate::db::changesets::update_change_summary_content(
                        &tx,
                        pair.summary_id,
                        &own.title,
                        &own.description,
                    )?;
                }
            }
            let model_response = serialize_group_response(&summary.group, &pairs, &summary.own_summaries);
            crate::db::changesets::mark_queued_done(&tx, item.id, &model_response)?;
            tx.commit()?;
        }
        Err(e) => {
            log::warn!("[queue_summarizer] NEW_GROUP {} failed: {:#}", item.id, e);
            if new_count >= FAILED_AFTER_TRIES {
                let mut conn = rusqlite::Connection::open(db_path)?;
                let tx = conn.transaction()?;
                crate::db::changesets::mark_queued_failed(&tx, item.id)?;
                fail_change_summaries(&tx, item)?;
                tx.commit()?;
            }
        }
    }
    Ok(())
}

async fn handle_evolved_group<R: Runtime>(
    item: &QueuedSummary,
    app: &AppHandle<R>,
    db_path: &Path,
    new_count: i64,
) -> Result<()> {
    let group_summary_id = item.group_summary_id.unwrap_or(0);
    match crate::summarize::model_calls::summarize_evolved_group(
        &item.prompt,
        group_summary_id,
        Some(app),
    )
    .await
    {
        Ok((summary, _)) => {
            let pairs = parse_pairs(item)?;
            let mut conn = rusqlite::Connection::open(db_path)?;
            let tx = conn.transaction()?;
            crate::db::changesets::update_change_summary_content(
                &tx,
                group_summary_id,
                &summary.group.title,
                &summary.group.description,
            )?;
            for pair in &pairs {
                if let Some(own) = summary.own_summaries.get(&pair.hash) {
                    crate::db::changesets::update_change_summary_content(
                        &tx,
                        pair.summary_id,
                        &own.title,
                        &own.description,
                    )?;
                }
            }
            let model_response = serialize_group_response(&summary.group, &pairs, &summary.own_summaries);
            crate::db::changesets::mark_queued_done(&tx, item.id, &model_response)?;
            tx.commit()?;
        }
        Err(e) => {
            log::warn!("[queue_summarizer] EVOLVED_GROUP {} failed: {:#}", item.id, e);
            if new_count >= FAILED_AFTER_TRIES {
                let mut conn = rusqlite::Connection::open(db_path)?;
                let tx = conn.transaction()?;
                crate::db::changesets::mark_queued_failed(&tx, item.id)?;
                fail_change_summaries(&tx, item)?;
                tx.commit()?;
            }
        }
    }
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_pairs(item: &QueuedSummary) -> Result<Vec<HashSummaryPair>> {
    let json = item.hash_own_summary_id_pairs.as_deref().unwrap_or("[]");
    Ok(serde_json::from_str(json)?)
}

fn fail_change_summaries(tx: &rusqlite::Transaction, item: &QueuedSummary) -> Result<()> {
    if let Some(group_id) = item.group_summary_id {
        crate::db::changesets::mark_change_summary_failed(tx, group_id)?;
    }
    if let Some(pairs_json) = &item.hash_own_summary_id_pairs {
        if let Ok(pairs) = serde_json::from_str::<Vec<HashSummaryPair>>(pairs_json) {
            for pair in pairs {
                crate::db::changesets::mark_change_summary_failed(tx, pair.summary_id)?;
            }
        }
    }
    Ok(())
}

fn serialize_group_response(
    group: &HunkSummary,
    pairs: &[HashSummaryPair],
    own_summaries: &std::collections::HashMap<String, HunkSummary>,
) -> String {
    let changes: Vec<serde_json::Value> = pairs
        .iter()
        .filter_map(|p| {
            own_summaries.get(&p.hash).map(|s| {
                serde_json::json!({
                    "hash": p.hash,
                    "title": s.title,
                    "description": s.description,
                })
            })
        })
        .collect();
    serde_json::to_string(&serde_json::json!({
        "group": { "title": group.title, "description": group.description },
        "changes": changes,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn emit_update<R: Runtime>(app: &AppHandle<R>, db_path: &Path) {
    let result = (|| -> Result<()> {
        let config_dir = crate::store::get_config_dir(app)?;
        let change_sets =
            crate::summarize::find_existing::for_current_state(db_path, &config_dir)?;
        let semantic_map = crate::summarize::group_existing::from_change_sets(change_sets);
        app.emit("summarizer:update", SummarizerEvent { semantic_map })?;
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("[queue_summarizer] emit_update failed: {:#}", e);
    }
}
