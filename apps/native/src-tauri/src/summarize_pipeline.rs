//! Pipeline orchestration: Stage 1 (semantic map) → Stage 2 (group summaries).
//!
//! See `temp/ai/sr-guide-summarization.md` for the design rationale.

use anyhow::Result;
use std::collections::{BTreeSet, HashMap, HashSet};
use tauri::{AppHandle, Runtime};

use crate::providers::TokenUsage;
use crate::sqlite_types::Change;
use crate::summarize_changes::HunkSummary;
use crate::summarize_pipeline_logging as dbg;
use crate::summarize_token_budgets as budgets;

pub struct SummarizedHunk {
    pub change: Change,
    pub own_summary: Option<HunkSummary>,
}

pub struct SummarizedSemanticChange {
    pub group_summary: Option<HunkSummary>,
    pub hashes: BTreeSet<String>,
    pub hunks: Vec<SummarizedHunk>,
}

pub struct SummarizePipelineResult {
    pub semantic_changes: Vec<SummarizedSemanticChange>,
    pub sensitive_or_opaque: Vec<Change>,
    pub generated_commit_message: String,
}

pub async fn run<R: Runtime>(
    changes: Vec<Change>,
    sensitive_or_opaque: Vec<Change>,
    commit_message: Option<&str>,
    app_handle: Option<&AppHandle<R>>,
) -> Result<SummarizePipelineResult> {
    dbg::log_changes_from_diff(&changes, &sensitive_or_opaque);

    if changes.is_empty() {
        return Ok(SummarizePipelineResult {
            semantic_changes: vec![],
            sensitive_or_opaque,
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
            let app_clone = app_handle.cloned();
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

    let mut group_set: tokio::task::JoinSet<(usize, SummarizedSemanticChange)> =
        tokio::task::JoinSet::new();

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
        let app_clone = app_handle.cloned();
        group_set.spawn(async move {
            let is_single_hunk = main_with_reasoning.len() + sub_changes.len() == 1;

            // Save everything needed for fallbacks and hunk assembly before consuming the vecs.
            let all_changes: Vec<Change> = main_with_reasoning
                .iter()
                .chain(sub_changes.iter())
                .map(|(c, _)| c.clone())
                .collect();
            let hashes: BTreeSet<String> = all_changes.iter().map(|c| c.hash.clone()).collect();
            let fallback_group_desc: String = main_with_reasoning
                .first()
                .or_else(|| sub_changes.first())
                .map(|(_, r)| r.clone())
                .unwrap_or_default();
            let fallback_own: HashMap<String, HunkSummary> = main_with_reasoning
                .iter()
                .chain(sub_changes.iter())
                .map(|(c, r)| {
                    (
                        c.hash.clone(),
                        HunkSummary {
                            title: title.clone(),
                            description: r.clone(),
                        },
                    )
                })
                .collect();

            let (group_summary, own_summaries) =
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
                    Ok((summary, usage)) => {
                        dbg::log_stage2_result(
                            &title,
                            group_budget.max_output_tokens,
                            &usage,
                            &summary,
                        );
                        (summary.group, summary.own_summaries)
                    }
                    Err(e) => {
                        log::warn!("[summarize_pipeline] stage 2 failed for '{}': {}", title, e);
                        (
                            HunkSummary {
                                title: title.clone(),
                                description: fallback_group_desc,
                            },
                            fallback_own,
                        )
                    }
                };

            let group_summary = if is_single_hunk {
                None
            } else {
                Some(group_summary)
            };

            let hunks: Vec<SummarizedHunk> = all_changes
                .into_iter()
                .map(|c| {
                    let own_summary = own_summaries.get(&c.hash).cloned();
                    SummarizedHunk {
                        change: c,
                        own_summary,
                    }
                })
                .collect();

            (
                sc_idx,
                SummarizedSemanticChange {
                    group_summary,
                    hashes,
                    hunks,
                },
            )
        });
    }

    // Drain group results
    let mut stage2_results: Vec<(usize, SummarizedSemanticChange)> = Vec::new();
    while let Some(join_result) = group_set.join_next().await {
        if let Ok(item) = join_result {
            stage2_results.push(item);
        }
    }
    stage2_results.sort_by_key(|(idx, _)| *idx);
    let mut semantic_changes: Vec<SummarizedSemanticChange> =
        stage2_results.into_iter().map(|(_, sc)| sc).collect();

    // Warn about and collect hunks not assigned to any semantic change
    let assigned: HashSet<String> = semantic_changes
        .iter()
        .flat_map(|sc| sc.hunks.iter())
        .map(|h| h.change.hash.clone())
        .collect();

    for (hash, change) in &change_index {
        if !assigned.contains(*hash) {
            log::warn!(
                "[summarize_pipeline] hunk not assigned to any semantic change: {} [{}]",
                change.filename,
                hash
            );
            semantic_changes.push(SummarizedSemanticChange {
                group_summary: None,
                hashes: BTreeSet::from([hash.to_string()]),
                hunks: vec![SummarizedHunk {
                    change: (*change).clone(),
                    own_summary: None,
                }],
            });
        }
    }

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

    dbg::log_all_changes(&semantic_changes, &sensitive_or_opaque);

    Ok(SummarizePipelineResult {
        semantic_changes,
        sensitive_or_opaque,
        generated_commit_message,
    })
}
