//! Complete evolution lifecycle orchestration.
//!
//! This module provides a unified API for the evolution workflow:
//! 1. Run AI evolution
//! 2. Return current change map and git status
//!
//! All steps are atomic from the frontend's perspective - one call does everything.

use log::info;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    db,
    evolve::{self, EvolutionState},
    evolve_state, git, store, summarize,
    query_return_types::SemanticChangeMap,
    types::{emit_evolve_event, EvolveEvent},
};

/// Evolution result returned to the frontend on completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionResult {
    pub change_map: SemanticChangeMap,
    pub git_status: crate::types::GitStatus,
    pub evolve_state: evolve_state::EvolveState,
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

/// Run AI evolution, return current change map and git status.
pub async fn evolve_and_commit(
    app: &AppHandle,
    description: &str,
) -> std::result::Result<EvolutionResult, EvolutionFailureResult> {
    let start_time_ms: i64 = chrono::Utc::now().timestamp_millis();
    let start_time_s: i64 = start_time_ms / 1000;

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
        "[evolution] Starting evolve_and_commit | branch={:?}",
        initial_status.branch
    );

    // Step 1: Run AI evolution
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

    info!(
        "[evolution] AI evolution complete | iterations={}",
        evolution.iterations
    );

    // Short-circuit: conversational responses made no environment changes.
    if evolution.state == EvolutionState::Conversational {
        info!("[evolution] Conversational response — skipping git/db workflow");
        let evolve_state = evolve_state::get(app).unwrap_or_default();
        return Ok(EvolutionResult {
            change_map: SemanticChangeMap::default(),
            git_status: initial_status,
            evolve_state,
            telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
        });
    }

    // Get final git status
    let final_status = match git::status(&config_dir) {
        Ok(status) => status,
        Err(e) => {
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get final git status: {}", e),
                None,
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    emit_evolve_event(
        app,
        EvolveEvent::complete(start_time_s, evolution.iterations, "Evolution complete"),
    );

    let _ = store::set_cached_git_status(app, &final_status);

    // Insert a DB evolution record and run the appropriate summarization pipeline.
    let (db_evolution_id, changeset_id) =
        store_metadata(app, &final_status).await;

    let evolve_state = evolve_state::set(app, evolve_state::EvolveState {
        evolution_id: db_evolution_id,
        current_changeset_id: changeset_id,
        ..Default::default()
    })
    .unwrap_or_default();

    // Build the change map from whatever is now stored in the DB.
    let change_map = db::get_db_path(app)
        .ok()
        .and_then(|db_path| {
            summarize::find_existing::for_current_state(&db_path, &config_dir).ok()
        })
        .map(summarize::group_existing::from_change_sets)
        .unwrap_or_default();

    Ok(EvolutionResult {
        change_map,
        git_status: final_status,
        evolve_state,
        telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
    })
}

/// Insert a DB evolution, and summarize a changeset to link to it
async fn store_metadata(
    app: &AppHandle,
    status: &crate::types::GitStatus,
) -> (Option<i64>, Option<i64>) {
    let db_path = match db::get_db_path(app) {
        Ok(p) => p,
        Err(e) => {
            log::error!("[evolution] failed to get db path: {}", e);
            return (None, None);
        }
    };

    let evolution_id = match db::evolutions::insert(
        &db_path,
        status.branch.as_deref().unwrap_or("unknown"),
    ) {
        Ok(id) => {
            info!("[evolution] inserted evolution record | id={}", id);
            Some(id)
        }
        Err(e) => {
            log::error!("[evolution] failed to insert evolution record: {}", e);
            None
        }
    };

    let changeset_id = match summarize::new_changeset(app, evolution_id).await {
        Ok(id) => id,
        Err(e) => {
            log::error!("[evolution] summarization pipeline failed: {}", e);
            None
        }
    };

    (evolution_id, changeset_id)
}
