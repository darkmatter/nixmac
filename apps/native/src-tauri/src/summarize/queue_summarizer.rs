//! Async background service that drains the `queued_summaries` table.
//!
//! Startup creates one `SummarizerState` with an mpsc sender. Producers enqueue
//! ids through that state instead of spawning their own processors, so only one
//! worker drains the durable SQLite queue at a time.

use anyhow::{Context, Result};
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;

use crate::sqlite_types::QueuedSummary;
use crate::summarize::model_output_types::HunkSummary;

/// After this many attempts (including the initial try), a queued summary is
/// marked failed and its associated change summaries get a permanent failure
/// marker. The budget is conservative because each retry costs an API call;
/// persistent failures usually indicate a model or prompt problem that retries
/// won't fix.
const FAILED_AFTER_TRIES: i64 = 4;

/// Bounded channel depth for the summarizer's mpsc queue. Keeps memory
/// predictable even if producers enqueue faster than the worker drains.
#[allow(dead_code)]
const SUMMARIZER_QUEUE_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummarizeJob {
    ids: Option<Vec<i64>>,
}

impl SummarizeJob {
    pub fn specific(ids: Vec<i64>) -> Self {
        Self { ids: Some(ids) }
    }
}

#[derive(Clone)]
pub struct SummarizerState {
    tx: mpsc::Sender<SummarizeJob>,
}

impl SummarizerState {
    pub async fn enqueue_ids(&self, ids: Vec<i64>) -> Result<()> {
        self.tx
            .send(SummarizeJob::specific(ids))
            .await
            .context("summarizer worker is not running")
    }
}

#[derive(serde::Deserialize)]
struct HashSummaryPair {
    hash: String,
    summary_id: i64,
}

// ── Public entry point ────────────────────────────────────────────────────────

#[allow(dead_code)]
pub fn start_worker<R: Runtime>(app: &AppHandle<R>) -> Result<SummarizerState> {
    let (tx, rx) = mpsc::channel(SUMMARIZER_QUEUE_DEPTH);
    let app = app.clone();
    let db_path = crate::db::get_db_path(&app)?;

    tauri::async_runtime::spawn(worker_loop(rx, move |job| {
        let app = app.clone();
        let db_path = db_path.clone();
        async move {
            if let Err(error) = process(job.ids, app, db_path).await {
                log::warn!("[queue_summarizer] worker job failed: {error:#}");
            }
        }
    }));

    Ok(SummarizerState { tx })
}

#[allow(dead_code)]
async fn worker_loop<F, Fut>(mut rx: mpsc::Receiver<SummarizeJob>, mut handler: F)
where
    F: FnMut(SummarizeJob) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    while let Some(job) = rx.recv().await {
        handler(job).await;
    }
}

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
                        crate::db::changesets::fetch_queued_summaries_by_ids(&conn, specific_ids)?
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
            handle_group(item, db_path, new_count, || {
                crate::summarize::model_calls::summarize_new_group(&item.prompt, Some(app))
            })
            .await?
        }
        "EVOLVED_GROUP" => {
            let group_summary_id = item.group_summary_id.unwrap_or(0);
            handle_group(item, db_path, new_count, || {
                crate::summarize::model_calls::summarize_evolved_group(
                    &item.prompt,
                    group_summary_id,
                    Some(app),
                )
            })
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
            crate::ai::providers::TokenUsage,
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
                let own = summary.own_summaries.get(&pair.hash).ok_or_else(|| {
                    anyhow::anyhow!("hash {} missing after validation", pair.hash)
                })?;
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
    Fut: std::future::Future<Output = Result<(T, crate::ai::providers::TokenUsage)>>,
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
                format!(
                    "failed to summarize queued item {}, retry model call failed",
                    item_id
                )
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
        let config_dir = crate::storage::store::get_config_dir(app)?;
        let change_sets = crate::summarize::find_existing::for_current_state(db_path, &config_dir)?;
        let semantic_map = crate::summarize::group_existing::from_change_sets(change_sets);
        app.emit("change_map_changed", semantic_map)?;
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
        HunkSummary {
            title: title.into(),
            description: description.into(),
        }
    }

    fn pair(hash: &str, summary_id: i64) -> HashSummaryPair {
        HashSummaryPair {
            hash: hash.into(),
            summary_id,
        }
    }

    fn group_summary(group: HunkSummary, own: HashMap<String, HunkSummary>) -> EvolvedGroupSummary {
        EvolvedGroupSummary {
            former_group_id: 0,
            group,
            own_summaries: own,
        }
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
            hunk(
                "MyApp Integration",
                "SOPS key, LaunchAgent, encrypted secret",
            ),
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
        own.insert(
            "a3a0d3".into(),
            hunk("SOPS Key", "Replaced placeholder with real age key"),
        );
        own.insert(
            "37c4ac".into(),
            hunk("LaunchAgent", "Adds myapp user launchd service"),
        );
        let summary = group_summary(
            hunk(
                "MyApp Integration",
                "SOPS key, LaunchAgent, encrypted secret",
            ),
            own,
        );
        let pairs = vec![pair("a3a0d3", 38), pair("37c4ac", 39)];
        assert!(validate_group_response(&summary, &pairs).is_ok());
    }

    #[tokio::test]
    async fn worker_loop_processes_jobs_one_at_a_time() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        let (tx, rx) = mpsc::channel(8);
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));
        let processed = Arc::new(AtomicUsize::new(0));

        let in_flight_for_worker = in_flight.clone();
        let max_for_worker = max_in_flight.clone();
        let processed_for_worker = processed.clone();
        let worker = tokio::spawn(worker_loop(rx, move |_| {
            let in_flight = in_flight_for_worker.clone();
            let max_in_flight = max_for_worker.clone();
            let processed = processed_for_worker.clone();
            async move {
                let current = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                max_in_flight.fetch_max(current, Ordering::SeqCst);
                tokio::task::yield_now().await;
                processed.fetch_add(1, Ordering::SeqCst);
                in_flight.fetch_sub(1, Ordering::SeqCst);
            }
        }));

        for id in 1..=5 {
            tx.send(SummarizeJob::specific(vec![id])).await.unwrap();
        }
        drop(tx);
        worker.await.unwrap();

        assert_eq!(processed.load(Ordering::SeqCst), 5);
        assert_eq!(max_in_flight.load(Ordering::SeqCst), 1);
    }
}
