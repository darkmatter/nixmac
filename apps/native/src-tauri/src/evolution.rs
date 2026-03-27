//! Complete evolution lifecycle orchestration.
//!
//! This module provides a unified API for the evolution workflow:
//! 1. Run AI evolution
//! 2. Generate summary
//! 3. Create branch (if on main)
//! 4. Commit changes
//! 5. Save to database
//!
//! All steps are atomic from the frontend's perspective - one call does everything.

use log::{error, info};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    db,
    evolve::{self, EvolutionState},
    git, legacy_summarize, store,
    types::{emit_evolve_event, slugify, EvolveEvent, SummaryItem, SummaryResponse},
};

/// Evolution returns final git status and summary to frontend when done.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionResult {
    pub summary: SummaryResponse,
    pub git_status: crate::types::GitStatus,
    #[serde(flatten)]
    pub telemetry: EvolutionTelemetry,
}

/// Shared evolution telemetry for success/failure payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionTelemetry {
    /// Evolution state.
    pub state: EvolutionState,
    /// Number of iterations performed.
    pub iterations: usize,
    /// Number of build attempts.
    pub build_attempts: usize,
    /// Total tokens consumed.
    pub total_tokens: u32,
    /// Number of file edits produced.
    pub edits_count: usize,
    /// Number of thinking / reasoning entries.
    pub thinking_count: usize,
    /// Number of tool call activity records.
    pub tool_calls_count: usize,
    /// Elapsed time for the evolution operation in milliseconds.
    pub duration_ms: i64,
}

impl EvolutionTelemetry {
    fn failed_defaults(duration_ms: i64) -> Self {
        Self {
            state: EvolutionState::Failed,
            iterations: 0,
            build_attempts: 0,
            total_tokens: 0,
            edits_count: 0,
            thinking_count: 0,
            tool_calls_count: 0,
            duration_ms,
        }
    }

    fn from_evolution(evolution: &evolve::Evolution, duration_ms: i64) -> Self {
        Self {
            state: evolution.state.clone(),
            iterations: evolution.iterations,
            build_attempts: evolution.build_attempts,
            total_tokens: evolution.total_tokens,
            edits_count: evolution.edits.len(),
            thinking_count: evolution.thinking.len(),
            tool_calls_count: evolution.tool_calls.len(),
            duration_ms,
        }
    }

    fn from_failed_progress(progress: &evolve::EvolutionProgress, duration_ms: i64) -> Self {
        Self {
            state: progress.state.clone(),
            iterations: progress.iterations,
            build_attempts: progress.build_attempts,
            total_tokens: progress.total_tokens,
            edits_count: progress.edits_count,
            thinking_count: progress.thinking_count,
            tool_calls_count: progress.tool_calls_count,
            duration_ms,
        }
    }
}

/// Evolution failure payload with partial telemetry for CLI/reporting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionFailureResult {
    /// Human-readable error message.
    pub error: String,
    /// Best-effort git status at failure time.
    pub git_status: Option<crate::types::GitStatus>,
    #[serde(flatten)]
    pub telemetry: EvolutionTelemetry,
}

impl EvolutionFailureResult {
    fn new(
        error: String,
        git_status: Option<crate::types::GitStatus>,
        telemetry: EvolutionTelemetry,
    ) -> Self {
        Self {
            error,
            git_status,
            telemetry,
        }
    }

    fn defaults(
        error: String,
        git_status: Option<crate::types::GitStatus>,
        duration_ms: i64,
    ) -> Self {
        Self::new(
            error,
            git_status,
            EvolutionTelemetry::failed_defaults(duration_ms),
        )
    }

    fn from_evolution(
        error: String,
        git_status: Option<crate::types::GitStatus>,
        evolution: &evolve::Evolution,
        duration_ms: i64,
    ) -> Self {
        Self::new(
            error,
            git_status,
            EvolutionTelemetry {
                state: EvolutionState::Failed,
                ..EvolutionTelemetry::from_evolution(evolution, duration_ms)
            },
        )
    }
}

fn elapsed_since(start_time_ms: i64) -> i64 {
    chrono::Utc::now().timestamp_millis() - start_time_ms
}

/// Run a complete evolution workflow: AI generation + summary + branch + commit + DB.
pub async fn evolve_and_commit(
    app: &AppHandle,
    description: &str,
) -> std::result::Result<EvolutionResult, EvolutionFailureResult> {
    let start_time_ms: i64 = chrono::Utc::now().timestamp_millis();
    let start_time_s: i64 = start_time_ms / 1000;

    // Get config directory
    let config_dir = match store::ensure_config_dir_exists(app) {
        Ok(dir) => dir,
        Err(e) => {
            return Err(EvolutionFailureResult::defaults(
                format!("Failed to get config directory: {}", e),
                None,
                elapsed_since(start_time_ms),
            ));
        }
    };

    // Check initial git status
    let initial_status = match git::status(&config_dir) {
        Ok(status) => status,
        Err(e) => {
            return Err(EvolutionFailureResult::defaults(
                format!("Failed to get initial git status: {}", e),
                None,
                elapsed_since(start_time_ms),
            ));
        }
    };

    info!(
        "[evolution] Starting evolve_and_commit | branch={:?} | is_main={}",
        initial_status.branch, initial_status.is_main_branch
    );

    // Step 1: Run AI evolution (this already emits its own events)
    let evolution = match evolve::generate_evolution(app, &config_dir, description).await {
        Ok(evolution) => evolution,
        Err(e) => {
            let duration_ms = elapsed_since(start_time_ms);
            let git_status = git::status(&config_dir).ok();
            if let Some(run_error) = e.downcast_ref::<evolve::EvolutionRunError>() {
                return Err(EvolutionFailureResult::new(
                    run_error.message.clone(),
                    git_status,
                    EvolutionTelemetry::from_failed_progress(&run_error.progress, duration_ms),
                ));
            }

            return Err(EvolutionFailureResult::defaults(
                format!("AI evolution failed: {}", e),
                git_status,
                duration_ms,
            ));
        }
    };

    let iteration = Some(evolution.iterations);
    info!(
        "[evolution] AI evolution complete | iterations={}",
        evolution.iterations
    );

    // Step 1.5. Short-circuit: conversational responses made no environment changes — skip
    // the summarize / branch / commit / DB steps entirely.
    if evolution.state == EvolutionState::Conversational {
        info!("[evolution] Conversational response — skipping git/commit/db workflow");
        return Ok(EvolutionResult {
            summary: SummaryResponse {
                items: vec![],
                instructions: evolution.summary.clone().unwrap_or_default(),
                commit_message: String::new(),
                diff: String::new(),
            },
            git_status: initial_status,
            telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
        });
    }

    // Step 2: Generate summary (emit event - this is the only slow finalization step)
    emit_evolve_event(app, EvolveEvent::summarizing(start_time_s, iteration));

    let status = match git::status(&config_dir) {
        Ok(status) => status,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get git status for summary: {}", e),
                None,
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    let (change_summary, commit_message) =
        match legacy_summarize::summarize_for_preview(&status.diff, &file_list, Some(app)).await {
            Ok(v) => v,
            Err(e) => {
                return Err(EvolutionFailureResult::from_evolution(
                    format!("Failed to generate summary: {}", e),
                    Some(status.clone()),
                    &evolution,
                    elapsed_since(start_time_ms),
                ));
            }
        };

    info!(
        "[evolution] Summary generated | commit_message={}",
        commit_message
    );

    // Step 3: Create branch if on main
    let branch_name = if initial_status.is_main_branch {
        let base_name = format!("nixmac-evolve/{}", slugify(description));
        let created_branch = match git::checkout_new_branch(&config_dir, &base_name) {
            Ok(branch) => branch,
            Err(e) => {
                return Err(EvolutionFailureResult::from_evolution(
                    format!("Failed to create branch: {}", e),
                    Some(status.clone()),
                    &evolution,
                    elapsed_since(start_time_ms),
                ));
            }
        };
        info!("[evolution] Created branch: {}", created_branch);
        Some(created_branch)
    } else {
        None
    };

    // Step 4: Commit changes
    let commit_info = match git::commit_all(&config_dir, &commit_message) {
        Ok(commit) => commit,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to commit changes: {}", e),
                Some(status.clone()),
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    info!(
        "[evolution] Committed | hash={} | tree={}",
        &commit_info.hash[..8],
        &commit_info.tree_hash[..8]
    );

    // Step 5: Save to database (all inserts in a single transaction)
    let db_path = match db::get_db_path(app) {
        Ok(path) => path,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get database path: {}", e),
                Some(status.clone()),
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    let summary_json = match serde_json::to_string(&change_summary) {
        Ok(json) => json,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to serialize summary to JSON: {}", e),
                Some(status.clone()),
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    let branch_for_db = branch_name
        .or_else(|| initial_status.branch.clone())
        .ok_or_else(|| {
            EvolutionFailureResult::from_evolution(
                "Failed to determine branch for DB record".to_string(),
                Some(status.clone()),
                &evolution,
                elapsed_since(start_time_ms),
            )
        })?;

    let evolution_id = db::operations::save_evolution_complete(
        &db_path,
        db::operations::EvolutionData {
            commit_hash: commit_info.hash.clone(),
            tree_hash: commit_info.tree_hash.clone(),
            commit_message: commit_message.clone(),
            branch: branch_for_db,
            summary_json,
            diff: status.diff.clone(),
            prompt: Some(description.to_string()),
        },
    )
    .map_err(|e| {
        error!(
            "[evolution] Failed to save to database (commit {} exists but not recorded): {}",
            &commit_info.hash[..8],
            e
        );
        EvolutionFailureResult::from_evolution(
            format!("Failed to save evolution data to database: {}", e),
            Some(status.clone()),
            &evolution,
            elapsed_since(start_time_ms),
        )
    })?;

    info!("[evolution] Saved to DB | evolution_id={}", evolution_id);

    // Emit complete event
    emit_evolve_event(
        app,
        EvolveEvent::complete(start_time_s, evolution.iterations, "Evolution complete"),
    );

    // Build summary response
    let summary = SummaryResponse {
        items: change_summary
            .items
            .into_iter()
            .map(|item| SummaryItem {
                title: item.title,
                description: item.description,
            })
            .collect(),
        instructions: change_summary.instructions,
        commit_message,
        diff: status.diff.clone(),
    };

    // Get final git status to return to frontend
    let final_status = match git::status(&config_dir) {
        Ok(status) => status,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get final git status: {}", e),
                Some(status),
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    // Sync the watcher's change-detection cache so its next poll doesn't spuriously emit
    let _ = store::set_cached_git_status(app, &final_status);

    Ok(EvolutionResult {
        summary,
        git_status: final_status,
        telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
    })
}
