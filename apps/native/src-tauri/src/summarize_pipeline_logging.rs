//! Optional box-drawing debug logs for the summarization pipeline.
//!
//! Flip `VERBOSE` to `true` to re-enable; all output is suppressed at `false`.
//! These will eventually be replaced by DB-stored pipeline traces.

use crate::providers::TokenUsage;
use crate::sqlite_types::Change;
use crate::summarize_changes::{SemanticChangeSummary, SemanticMap};
use crate::summarize_pipeline::SummarizedHunk;

// Set this to 'true' or 'false' to enable/disable logging for the pipeline
pub const VERBOSE: bool = false;

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

pub fn log_changes_from_diff(changes: &[Change], excluded: &[Change]) {
    if !VERBOSE {
        return;
    }
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!(
        "║  CHANGES_FROM_DIFF  ({} total, {} excluded, {} to pipeline)",
        changes.len() + excluded.len(),
        excluded.len(),
        changes.len()
    );
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    if !excluded.is_empty() {
        log::info!("║  excluded (sensitive/opaque):");
        for change in excluded {
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

pub fn log_stage2_results(
    results: &[(
        usize,
        String,
        u32,
        TokenUsage,
        anyhow::Result<SemanticChangeSummary>,
    )],
) {
    if !VERBOSE {
        return;
    }
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!("║  STAGE 2 — GROUP SUMMARIES  ({} groups)", results.len());
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    for (_, title, max_output, usage, result) in results {
        let label = token_label(usage, *max_output);
        match result {
            Ok(s) => log::info!("║  [{}] {} — {}", label, s.group.title, s.group.description),
            Err(e) => log::error!("║  [{}] {} — ERROR: {}", label, title, e),
        }
    }
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

pub fn log_all_changes(hunks: &[SummarizedHunk], excluded: &[Change]) {
    if !VERBOSE {
        return;
    }
    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!("║  ALL CHANGES — READY FOR DB");
    log::info!("╠══════════════════════════════════════════════════════════════╣");
    for change in excluded {
        let hash_prefix = &change.hash[..8.min(change.hash.len())];
        log::info!(
            "║  [{}] {} (EXCLUDED — sensitive/opaque)",
            hash_prefix,
            change.filename
        );
        log::info!(
            "║    own: Sensitive or Opaque — Changes were made to {}",
            change.filename
        );
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }
    for hunk in hunks {
        let hash_prefix = &hunk.change.hash[..8.min(hunk.change.hash.len())];
        log::info!("║  [{}] {}", hash_prefix, hunk.change.filename);
        if let Some(gs) = &hunk.group_summary {
            log::info!("║    group: {} — {}", gs.title, gs.description);
        }
        match &hunk.own_summary {
            Some(s) => log::info!("║    own:   {} — {}", s.title, s.description),
            None => log::info!("║    own:   (not generated)"),
        }
        log::info!("╠──────────────────────────────────────────────────────────────╣");
    }
    log::info!("╚══════════════════════════════════════════════════════════════╝");
}
