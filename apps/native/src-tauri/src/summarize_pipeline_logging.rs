//! Optional box-drawing debug logs for the summarization pipeline.

use crate::providers::TokenUsage;
use crate::sqlite_types::Change;
use crate::summarize_changes::{SemanticChangeSummary, SemanticMap};
use crate::summarize_pipeline::{SummarizedSemanticChange};

// TURN THIS ON / OFF HERE:
pub const VERBOSE: bool = true;

fn token_label(usage: &TokenUsage, max_output: u32) -> String {
    let out = match usage.output {
        Some(u) => format!("{}/{} max", u, max_output),
        None => format!("?/{} max", max_output),
    };
    match usage.input {
        Some(i) => format!("input tokens: {} | output tokens: {}", i, out),
        None => format!("output tokens: {}", out),
    }
}

pub fn log_changes_from_diff(changes: &[Change], sensitive_or_opaque: &[Change]) {
    if !VERBOSE {
        return;
    }
    log::warn!("╔══ TURN OFF IN: summarize_pipeline_logging.rs ══════════════════╗");
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!(
        "║  CHANGES_FROM_DIFF  ({} total, {} sensitive/opaque, {} to pipeline)",
        changes.len() + sensitive_or_opaque.len(),
        sensitive_or_opaque.len(),
        changes.len()
    );
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    if !sensitive_or_opaque.is_empty() {
        log::info!("║  sensitive/opaque (skipped by pipeline):");
        for change in sensitive_or_opaque {
            log::info!("║    - {} [{}]", change.filename, change.hash);
        }
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }
    for change in changes {
        log::info!("║  file : {}", change.filename);
        log::info!("║  hash : {}", change.hash);
        log::info!("║  lines: {}", change.line_count);
        log::info!("║  diff :");
        for line in change.diff.lines() {
            log::info!("║    {}", line);
        }
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }
    log::info!("╚══════════════════════════════════════════════════════════════╝");
}

pub fn log_semantic_map(map: &SemanticMap, max_output: u32, usage: &TokenUsage) {
    if !VERBOSE {
        return;
    }
    let pretty = serde_json::to_string_pretty(map).unwrap_or_else(|_| format!("{:?}", map));
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!(
        "║  STAGE 1 — SEMANTIC MAP  ({} semantic changes, {})",
        map.semantic_changes.len(),
        token_label(usage, max_output)
    );
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    for line in pretty.lines() {
        log::info!("║  {}", line);
    }
    log::info!("╚══════════════════════════════════════════════════════════════╝");
}

pub fn log_stage2_result(
    title: &str,
    max_output: u32,
    usage: &TokenUsage,
    summary: &SemanticChangeSummary,
) {
    if !VERBOSE {
        return;
    }
    let label = token_label(usage, max_output);
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!("║  STAGE 2  [{}]  ({})", title, label);
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    log::info!("║  {} — {}", summary.group.title, summary.group.description);
    log::info!("║  {} hunk summaries", summary.own_summaries.len());
    log::info!("╚══════════════════════════════════════════════════════════════╝");
}

pub fn log_generated_commit_message(
    msg: &str,
    attempted: bool,
    max_output: u32,
    usage: &TokenUsage,
) {
    if !VERBOSE {
        return;
    }
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!(
        "║  GENERATED COMMIT MESSAGE  ({})",
        token_label(usage, max_output)
    );
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    if !attempted {
        log::info!("║  (skipped — commit message provided up-front)");
    } else if msg.is_empty() {
        log::info!("║  (attempted — generation failed or returned empty; see WARN logs)");
    } else {
        log::info!("║  {}", msg);
    }
    log::info!("╚══════════════════════════════════════════════════════════════╝");
}

pub fn log_all_changes(
    semantic_changes: &[SummarizedSemanticChange],
    sensitive_or_opaque: &[Change],
) {
    if !VERBOSE {
        return;
    }
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!("║  ALL CHANGES — READY FOR DB");
    log::info!("╠══════════════════════════════════════════════════════════════╣");

    for change in sensitive_or_opaque {
        let hash_prefix = &change.hash[..8.min(change.hash.len())];
        log::info!(
            "║  [{}] {} (sensitive/opaque — no summary)",
            hash_prefix,
            change.filename
        );
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }

    for sc in semantic_changes {
        if let Some(gs) = &sc.group_summary {
            log::info!("║  ┌─ GROUP: {} — {}", gs.title, gs.description);
            log::info!(
                "║  │  hashes: [{}]",
                sc.hashes.iter().map(|h| &h[..8.min(h.len())]).collect::<Vec<_>>().join(", ")
            );
        } else {
            log::info!("║  ┌─ (single-hunk SC — no group summary)");
        }
        for hunk in &sc.hunks {
            let hash_prefix = &hunk.change.hash[..8.min(hunk.change.hash.len())];
            log::info!("║  │  [{}] {}", hash_prefix, hunk.change.filename);
            match &hunk.own_summary {
                Some(s) => log::info!("║  │    own: {} — {}", s.title, s.description),
                None => log::info!("║  │    own: (not generated)"),
            }
        }
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }

    log::info!("╚══════════════════════════════════════════════════════════════╝");
    log::warn!("╚══ TURN OFF IN: summarize_pipeline_logging.rs ══════════════════╝");
}
