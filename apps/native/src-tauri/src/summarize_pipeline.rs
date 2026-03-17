//! Pipeline orchestration: Stage 1 (semantic map) → Stage 2 (group summaries).
//!
//! See `temp/ai/sr-guide-summarization.md` for the design rationale.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

use crate::providers::TokenUsage;
use crate::sqlite_types::Change;
use crate::summarize_changes::{HunkSummary, SemanticMap};
use crate::summarize_pipeline_logging as dbg;
use crate::summarize_token_budgets as budgets;

pub struct SummarizedHunk {
    pub change: Change,
    pub group_summary: Option<HunkSummary>,
    pub own_summary: Option<HunkSummary>,
}

#[allow(dead_code)]
pub struct SummarizePipelineResult {
    pub hunks: Vec<SummarizedHunk>,
    pub excluded: Vec<Change>,
    pub semantic_map: SemanticMap,
    pub generated_commit_message: String,
}

pub async fn run<R: Runtime>(
    changes: Vec<Change>,
    excluded: Vec<Change>,
    commit_message: Option<&str>,
    app_handle: Option<&AppHandle<R>>,
) -> Result<SummarizePipelineResult> {
    dbg::log_changes_from_diff(&changes, &excluded);

    if changes.is_empty() {
        return Ok(SummarizePipelineResult {
            hunks: vec![],
            excluded,
            semantic_map: SemanticMap {
                semantic_changes: vec![],
            },
            generated_commit_message: String::new(),
        });
    }

    // ── Stage 1 — holistic semantic map ─────────────────────────────────
    let stage1_budget = budgets::stage_one_budget(&changes);

    let map = match crate::summarize_changes::analyze_hunks(
        &changes,
        commit_message.unwrap_or(""),
        stage1_budget.max_output_tokens,
        Some(stage1_budget.num_ctx),
        app_handle,
    )
    .await
    {
        Ok((map, usage)) => {
            dbg::log_semantic_map(&map, stage1_budget.max_output_tokens, &usage);
            map
        }
        Err(e) => {
            log::error!("[summarize_pipeline] analyze_hunks failed: {}", e);
            return Err(e);
        }
    };

    // ── Stage 2 —────────────────────────────────────────────────────────
    // concurrent group summarization + commit message if not passed in
    let commit_msg_tokens = budgets::commit_msg_budget(map.semantic_changes.len() as u32);

    let commit_msg_task: Option<tokio::task::JoinHandle<(String, TokenUsage)>> =
        if commit_message.is_none() {
            let titles: Vec<String> = map
                .semantic_changes
                .iter()
                .map(|sc| sc.title.clone())
                .collect();
            let app_clone = app_handle.map(|a| a.clone());
            Some(tokio::spawn(async move {
                match crate::summarize_changes::generate_commit_message_from_map(
                    titles,
                    commit_msg_tokens,
                    app_clone.as_ref(),
                )
                .await
                {
                    Ok(result) => result,
                    Err(e) => {
                        log::warn!(
                            "[summarize_pipeline] commit message generation failed: {}",
                            e
                        );
                        (String::new(), TokenUsage::default())
                    }
                }
            }))
        } else {
            None
        };

    let change_index: std::collections::HashMap<&str, &Change> =
        changes.iter().map(|c| (c.hash.as_str(), c)).collect();

    // JoinSet tuple: (sc_idx, title, max_output_tokens, usage, Result<SemanticChangeSummary>)
    let mut group_set: tokio::task::JoinSet<(
        usize,
        String,
        u32,
        TokenUsage,
        anyhow::Result<crate::summarize_changes::SemanticChangeSummary>,
    )> = tokio::task::JoinSet::new();

    for (sc_idx, sc) in map.semantic_changes.iter().enumerate() {
        let main_with_reasoning: Vec<_> = sc
            .main_summary_hunks
            .iter()
            .filter_map(|ha| {
                change_index
                    .get(ha.hash.as_str())
                    .copied()
                    .cloned()
                    .map(|c| (c, ha.reasoning.clone()))
            })
            .collect();

        let sub_changes: Vec<_> = sc
            .sub_summary_hunks
            .iter()
            .filter_map(|ha| {
                change_index
                    .get(ha.hash.as_str())
                    .copied()
                    .cloned()
                    .map(|c| (c, ha.reasoning.clone()))
            })
            .collect();

        let line_cap = budgets::stage_two_lines_cap();
        let total_capped_lines: u32 = main_with_reasoning
            .iter()
            .chain(sub_changes.iter())
            .map(|(c, _)| (c.diff.lines().count() as u32).min(line_cap))
            .sum();
        let group_budget = budgets::stage_two_group_budget(total_capped_lines);

        let title = sc.title.clone();
        let app_clone = app_handle.map(|a| a.clone());
        group_set.spawn(async move {
            match crate::summarize_changes::summarize_semantic_change(
                main_with_reasoning,
                sub_changes,
                title.clone(),
                group_budget.max_output_tokens,
                Some(group_budget.num_ctx),
                app_clone,
            )
            .await
            {
                Ok((summary, usage)) => (
                    sc_idx,
                    title,
                    group_budget.max_output_tokens,
                    usage,
                    Ok(summary),
                ),
                Err(e) => (
                    sc_idx,
                    title,
                    group_budget.max_output_tokens,
                    TokenUsage::default(),
                    Err(e),
                ),
            }
        });
    }

    // Warn about hunks not assigned to any semantic change
    let assigned: std::collections::HashSet<&str> = map
        .semantic_changes
        .iter()
        .flat_map(|sc| {
            sc.main_summary_hunks
                .iter()
                .chain(sc.sub_summary_hunks.iter())
        })
        .map(|ha| ha.hash.as_str())
        .collect();

    for c in changes
        .iter()
        .filter(|c| !assigned.contains(c.hash.as_str()))
    {
        log::warn!(
            "[summarize_pipeline] hunk not assigned to any semantic change: {} [{}]",
            c.filename,
            c.hash
        );
    }

    // Drain group results
    let mut stage2_results: Vec<(
        usize,
        String,
        u32,
        TokenUsage,
        anyhow::Result<crate::summarize_changes::SemanticChangeSummary>,
    )> = Vec::new();
    while let Some(join_result) = group_set.join_next().await {
        if let Ok(item) = join_result {
            stage2_results.push(item);
        }
    }

    dbg::log_stage2_results(&stage2_results);

    // ── Build lookup structures ──────────────────────────────────────────
    let single_hunk_scs: std::collections::HashSet<usize> = map
        .semantic_changes
        .iter()
        .enumerate()
        .filter(|(_, sc)| sc.main_summary_hunks.len() + sc.sub_summary_hunks.len() == 1)
        .map(|(idx, _)| idx)
        .collect();

    // hash → sc_idx (owned keys to avoid lifetime issues when map moves later)
    let mut hash_to_sc_idx: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for (sc_idx, sc) in map.semantic_changes.iter().enumerate() {
        for ha in &sc.main_summary_hunks {
            hash_to_sc_idx.entry(ha.hash.clone()).or_insert(sc_idx);
        }
        for ha in &sc.sub_summary_hunks {
            hash_to_sc_idx.entry(ha.hash.clone()).or_insert(sc_idx);
        }
    }

    // sc_idx → SemanticChangeSummary (borrowed from stage2_results)
    let result_by_idx: std::collections::HashMap<
        usize,
        &crate::summarize_changes::SemanticChangeSummary,
    > = stage2_results
        .iter()
        .filter_map(|(idx, _, _, _, r)| r.as_ref().ok().map(|s| (*idx, s)))
        .collect();

    // hash → own HunkSummary (cloned — stage2_results dropped after this block)
    let mut own_by_hash: std::collections::HashMap<String, HunkSummary> = result_by_idx
        .values()
        .flat_map(|sc_result| {
            sc_result
                .own_summaries
                .iter()
                .map(|(h, s)| (h.clone(), s.clone()))
        })
        .collect();

    // sc_idx → group HunkSummary (cloned)
    let mut group_by_sc_idx: std::collections::HashMap<usize, HunkSummary> = result_by_idx
        .iter()
        .map(|(&idx, s)| (idx, s.group.clone()))
        .collect();

    // Patch in Stage 1 fallbacks for any SC whose Stage 2 call failed.
    // Own: (sc.title, hunk.reasoning). Group: (sc.title, first main → first sub reasoning).
    for (sc_idx, sc) in map.semantic_changes.iter().enumerate() {
        if !single_hunk_scs.contains(&sc_idx) {
            group_by_sc_idx
                .entry(sc_idx)
                .or_insert_with(|| HunkSummary {
                    title: sc.title.clone(),
                    description: sc
                        .main_summary_hunks
                        .first()
                        .or_else(|| sc.sub_summary_hunks.first())
                        .map(|ha| ha.reasoning.clone())
                        .unwrap_or_default(),
                });
        }
        for ha in sc
            .main_summary_hunks
            .iter()
            .chain(sc.sub_summary_hunks.iter())
        {
            own_by_hash
                .entry(ha.hash.clone())
                .or_insert_with(|| HunkSummary {
                    title: sc.title.clone(),
                    description: ha.reasoning.clone(),
                });
        }
    }

    // ── Assemble SummarizedHunk vec ──────────────────────────────────────
    let hunks: Vec<SummarizedHunk> = changes
        .into_iter()
        .map(|change| {
            let sc_idx = hash_to_sc_idx.get(&change.hash).copied();
            let group_summary = sc_idx.and_then(|idx| {
                if single_hunk_scs.contains(&idx) {
                    None
                } else {
                    group_by_sc_idx.get(&idx).cloned()
                }
            });
            let own_summary = own_by_hash.get(&change.hash).cloned();
            SummarizedHunk {
                change,
                group_summary,
                own_summary,
            }
        })
        .collect();

    dbg::log_all_changes(&hunks, &excluded);

    let generation_attempted = commit_msg_task.is_some();
    let (generated_commit_message, commit_usage) = if let Some(handle) = commit_msg_task {
        match handle.await {
            Ok(result) => result,
            Err(e) => {
                log::warn!("[summarize_pipeline] commit message task panicked: {}", e);
                (String::new(), TokenUsage::default())
            }
        }
    } else {
        (String::new(), TokenUsage::default())
    };

    dbg::log_generated_commit_message(
        &generated_commit_message,
        generation_attempted,
        commit_msg_tokens,
        &commit_usage,
    );

    Ok(SummarizePipelineResult {
        hunks,
        excluded,
        semantic_map: map,
        generated_commit_message,
    })
}
