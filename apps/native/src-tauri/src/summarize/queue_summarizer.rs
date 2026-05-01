//! Async background service that drains the `queued_summaries` table.
//!
//! Callers spawn this via:
//! ```ignore
//! tauri::async_runtime::spawn(queue_summarizer::process(Some(ids), app.clone(), db_path));
//! ```
//! The future returns once the queue is empty ("goes dormant").

use anyhow::{Context, Result};
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime};

use crate::shared_types::SemanticChangeMap;
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
    if let Some(ref specific_ids) = ids {
        crate::summarize::sumlog::queue_log_started(specific_ids);
    }
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

        let mut passed = 0usize;
        let mut retrying = 0usize;
        for item in &items {
            match try_process_item(item, &app, &db_path).await {
                Ok(_) => passed += 1,
                Err(e) => {
                    log::warn!("[queue_summarizer] item {} error: {:#}", item.id, e);
                    retrying += 1;
                }
            }
            emit_update(&app, &db_path);
        }
        crate::summarize::sumlog::queue_log_done(passed, retrying);
    }
    Ok(())
}

// ── Per-item processing ───────────────────────────────────────────────────────

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
        "NEW_GROUP" => {
            handle_group(
                item,
                db_path,
                new_count,
                || crate::summarize::model_calls::summarize_new_group(&item.prompt, Some(app)),
            )
            .await?
        }
        "EVOLVED_GROUP" => {
            let group_summary_id = item.group_summary_id.unwrap_or(0);
            handle_group(
                item,
                db_path,
                new_count,
                || {
                    crate::summarize::model_calls::summarize_evolved_group(
                        &item.prompt,
                        group_summary_id,
                        Some(app),
                    )
                },
            )
            .await?
        }
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
    crate::summarize::sumlog::queue_log_prompt(item.id, &item.prompt);
    match crate::summarize::model_calls::summarize_new_single(&item.prompt, Some(app)).await {
        Ok((summary, _)) => {
            crate::summarize::sumlog::queue_log_response(
                item.id,
                &serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string()),
            );
            let summary = validate_or_retry(
                summary,
                db_path,
                item.id,
                |s| validate_hunk_summary(s, "single"),
                || crate::summarize::model_calls::summarize_new_single(&item.prompt, Some(app)),
            )
            .await?;
            crate::summarize::sumlog::queue_log_validation_ok(item.id, 1);
            let model_response =
                serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
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

/// Shared handler for NEW_GROUP and EVOLVED_GROUP.
/// `call` is invoked for both the initial model request and, if validation fails, the retry.
async fn handle_group<F, Fut>(
    item: &QueuedSummary,
    db_path: &Path,
    new_count: i64,
    call: F,
) -> Result<()>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<
        Output = Result<(
            crate::summarize::model_output_types::EvolvedGroupSummary,
            crate::providers::TokenUsage,
        )>,
    >,
{
    let pairs = parse_pairs(item)?;
    let group_summary_id = item.group_summary_id.unwrap_or(0);

    crate::summarize::sumlog::queue_log_prompt(item.id, &item.prompt);
    match call().await {
        Ok((summary, _)) => {
            crate::summarize::sumlog::queue_log_response(
                item.id,
                &serialize_group_response(&summary.group, &pairs, &summary.own_summaries),
            );
            let summary = validate_or_retry(
                summary,
                db_path,
                item.id,
                |s| validate_group_response(s, &pairs),
                call,
            )
            .await?;
            crate::summarize::sumlog::queue_log_validation_ok(item.id, pairs.len());
            let model_response =
                serialize_group_response(&summary.group, &pairs, &summary.own_summaries);
            let mut conn = rusqlite::Connection::open(db_path)?;
            let tx = conn.transaction()?;
            crate::db::changesets::update_change_summary_content(
                &tx,
                group_summary_id,
                &summary.group.title,
                &summary.group.description,
            )?;
            for pair in &pairs {
                let own = summary
                    .own_summaries
                    .get(&pair.hash)
                    .ok_or_else(|| anyhow::anyhow!("hash {} missing after validation", pair.hash))?;
                crate::db::changesets::update_change_summary_content(
                    &tx,
                    pair.summary_id,
                    &own.title,
                    &own.description,
                )?;
            }
            crate::db::changesets::mark_queued_done(&tx, item.id, &model_response)?;
            tx.commit()?;
        }
        Err(e) => {
            log::warn!("[queue_summarizer] group {} failed: {:#}", item.id, e);
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

fn increment_attempts_now(db_path: &Path, id: i64) -> Result<()> {
    let mut conn = rusqlite::Connection::open(db_path)?;
    let tx = conn.transaction()?;
    crate::db::changesets::increment_queued_attempts(&tx, id)?;
    tx.commit()?;
    Ok(())
}

// ── Retry helper ──────────────────────────────────────────────────────────────

/// Validates a model result. On failure, increments the attempt counter and
/// retries `call` once. Returns the validated result, or an error if the retry
/// also fails validation.
async fn validate_or_retry<T, Retry, Fut>(
    result: T,
    db_path: &Path,
    item_id: i64,
    validate: impl Fn(&T) -> Result<()>,
    retry: Retry,
) -> Result<T>
where
    Retry: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(T, crate::providers::TokenUsage)>>,
{
    match validate(&result) {
        Ok(()) => Ok(result),
        Err(e) => {
            log::warn!(
                "[queue_summarizer] item {} validation failed, retrying: {}",
                item_id,
                e
            );
            increment_attempts_now(db_path, item_id)?;
            let (result2, _) = retry().await.with_context(|| {
                format!("failed to summarize queued item {}, retry model call failed", item_id)
            })?;
            if let Err(e2) = validate(&result2) {
                increment_attempts_now(db_path, item_id)?;
                return Err(e2).with_context(|| {
                    format!(
                        "failed to summarize queued item {}, retry validation also failed",
                        item_id
                    )
                });
            }
            Ok(result2)
        }
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate_hunk_summary(summary: &HunkSummary, label: &str) -> Result<()> {
    if summary.title.trim().is_empty() {
        return Err(anyhow::anyhow!("{}: title is empty", label));
    }
    if summary.description.trim().is_empty() {
        return Err(anyhow::anyhow!("{}: description is empty", label));
    }
    Ok(())
}

fn validate_group_response(
    summary: &crate::summarize::model_output_types::EvolvedGroupSummary,
    pairs: &[HashSummaryPair],
) -> Result<()> {
    validate_hunk_summary(&summary.group, "group")?;
    for pair in pairs {
        match summary.own_summaries.get(&pair.hash) {
            None => {
                return Err(anyhow::anyhow!(
                    "hash {} (summary_id {}) missing from model response",
                    pair.hash,
                    pair.summary_id
                ));
            }
            Some(own) => {
                validate_hunk_summary(own, &format!("hash {}", pair.hash))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summarize::model_output_types::EvolvedGroupSummary;
    use std::collections::HashMap;

    fn hunk(title: &str, description: &str) -> HunkSummary {
        HunkSummary { title: title.into(), description: description.into() }
    }

    fn pair(hash: &str, summary_id: i64) -> HashSummaryPair {
        HashSummaryPair { hash: hash.into(), summary_id }
    }

    fn group_summary(group: HunkSummary, own: HashMap<String, HunkSummary>) -> EvolvedGroupSummary {
        EvolvedGroupSummary { former_group_id: 0, group, own_summaries: own }
    }

    // ── validate_hunk_summary ─────────────────────────────────────────────────

    #[test]
    fn hunk_empty_title_fails() {
        assert!(validate_hunk_summary(&hunk("", "some desc"), "test").is_err());
    }

    #[test]
    fn hunk_empty_description_fails() {
        assert!(validate_hunk_summary(&hunk("Title", ""), "test").is_err());
    }

    #[test]
    fn hunk_whitespace_only_fails() {
        assert!(validate_hunk_summary(&hunk("  ", "  "), "test").is_err());
    }

    #[test]
    fn hunk_valid_passes() {
        assert!(validate_hunk_summary(&hunk("Title", "Description"), "test").is_ok());
    }

    // ── validate_group_response ───────────────────────────────────────────────

    #[test]
    fn group_missing_hash_fails() {
        let summary = group_summary(hunk("Group", "Desc"), HashMap::new());
        let pairs = vec![pair("abc123", 1)];
        assert!(validate_group_response(&summary, &pairs).is_err());
    }

    #[test]
    fn group_empty_changes_array_fails() {
        // Reproduces the exact bug: group present, changes: []
        let summary = group_summary(
            hunk("MyApp Integration", "SOPS key, LaunchAgent, encrypted secret"),
            HashMap::new(),
        );
        let pairs = vec![pair("a3a0d3", 38), pair("37c4ac", 39), pair("f0d85a", 40)];
        assert!(validate_group_response(&summary, &pairs).is_err());
    }

    #[test]
    fn group_empty_individual_title_fails() {
        let mut own = HashMap::new();
        own.insert("a3a0d3".into(), hunk("", "some desc"));
        let summary = group_summary(hunk("Group", "Desc"), own);
        let pairs = vec![pair("a3a0d3", 38)];
        assert!(validate_group_response(&summary, &pairs).is_err());
    }

    #[test]
    fn group_empty_group_title_fails() {
        let mut own = HashMap::new();
        own.insert("a3a0d3".into(), hunk("SOPS Key", "Replaced placeholder"));
        let summary = group_summary(hunk("", "Group desc"), own);
        let pairs = vec![pair("a3a0d3", 38)];
        assert!(validate_group_response(&summary, &pairs).is_err());
    }

    #[test]
    fn group_valid_passes() {
        let mut own = HashMap::new();
        own.insert("a3a0d3".into(), hunk("SOPS Key", "Replaced placeholder with real age key"));
        own.insert("37c4ac".into(), hunk("LaunchAgent", "Adds myapp user launchd service"));
        let summary = group_summary(
            hunk("MyApp Integration", "SOPS key, LaunchAgent, encrypted secret"),
            own,
        );
        let pairs = vec![pair("a3a0d3", 38), pair("37c4ac", 39)];
        assert!(validate_group_response(&summary, &pairs).is_ok());
    }
}
