//! Complete evolution lifecycle orchestration.
//!
//! This module provides a unified API for the evolution workflow:
//! 1. Run AI evolution
//! 2. Return current change map and git status
//!
//! All steps are atomic from the frontend's perspective - one call does everything.

use log::info;
use tauri::AppHandle;

use crate::{
    db,
    evolve::{self, EvolutionState},
    evolve_state, git,
    shared_types::{
        EvolutionFailureResult, EvolutionResult, EvolutionTelemetry, SemanticChangeMap,
    },
    store, summarize,
    types::{emit_evolve_event, EvolveEvent},
};

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

/// Run AI evolution, create a backup branch, and record a changeset.
pub async fn backup_evolve_and_record_changeset(
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
        "[evolution] Starting backup_evolve_and_record_changeset | branch={:?}",
        initial_status.branch
    );

    // Step 1: Snapshot the working tree onto a backup branch before AI touches anything.
    // If evolution_id is None the tree is clean (begin-evolve-warning guarantees this),
    // so create_evolution_backup will skip (clean + changeset_id==0 → None).
    let pre_evolve_state = evolve_state::get(app).unwrap_or_default();
    let changeset_id = pre_evolve_state.current_changeset_id.unwrap_or(0);
    let backup_branch = match git::create_evolution_backup(
        &config_dir,
        pre_evolve_state.evolution_id,
        changeset_id,
    ) {
        Ok(branch) => branch,
        Err(e) => {
            return Err(EvolutionFailureResult::defaults(
                format!("Failed to create backup branch: {}", e),
                None,
                elapsed_since(start_time_ms),
            ));
        }
    };

    if let Some(ref branch) = backup_branch {
        info!("[evolution] backup branch created | branch={}", branch);
        let updated = evolve_state::EvolveState {
            backup_branch: Some(branch.clone()),
            ..pre_evolve_state.clone()
        };
        let _ = evolve_state::set(app, updated);
    }

    // Step 2: Run AI evolution
    let evolution = match evolve::generate_evolution(app, &config_dir, description).await {
        Ok(evolution) => evolution,
        Err(e) => {
            let duration_ms = elapsed_since(start_time_ms);
            let git_status = git::status(&config_dir).ok();
            restore_after_failure(app, &config_dir, &backup_branch);
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
            conversational_response: evolution.summary.clone(),
            telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
        });
    }

    // Get final git status
    let final_status = match git::status(&config_dir) {
        Ok(status) => status,
        Err(e) => {
            restore_after_failure(app, &config_dir, &backup_branch);
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get final git status: {}", e),
                None,
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    emit_evolve_event(app, EvolveEvent::analyzing(start_time_s, None));

    let _ = store::set_cached_git_status(app, &final_status);

    // Insert a DB evolution record and run the appropriate summarization pipeline.
    let (db_evolution_id, new_changeset_id) = store_metadata(app, &final_status).await;

    let evolve_state = evolve_state::set(
        app,
        evolve_state::EvolveState {
            evolution_id: db_evolution_id,
            current_changeset_id: new_changeset_id,
            backup_branch,
            ..Default::default()
        },
    )
    .unwrap_or_default();

    // Build the change map from whatever is now stored in the DB.
    let change_map = db::get_db_path(app)
        .ok()
        .and_then(|db_path| summarize::find_existing::for_current_state(&db_path, &config_dir).ok())
        .map(summarize::group_existing::from_change_sets)
        .unwrap_or_default();

    Ok(EvolutionResult {
        change_map,
        git_status: final_status,
        evolve_state,
        conversational_response: None,
        telemetry: EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms)),
    })
}

fn restore_after_failure(app: &AppHandle, config_dir: &str, backup_branch: &Option<String>) {
    // Allow skipping the actual git restore calls for debugging/testing.
    // If `DEBUG_SKIP_RESTORE_ALL` is set to a non-zero value, skip restore operations
    // but keep the same state updates and logging behavior.
    let skip_restore = match std::env::var("DEBUG_SKIP_RESTORE_ALL") {
        Ok(val) => val != "0",
        Err(_) => false,
    };

    match backup_branch {
        Some(_) => {
            if skip_restore {
                log::warn!("[evolution] DEBUG_SKIP_RESTORE_ALL set — skipping restore_from_backup");
            } else if let Err(e) = git::restore_from_backup(config_dir) {
                log::error!("[evolution] restore_from_backup failed: {}", e);
            }

            let _ = evolve_state::set(
                app,
                evolve_state::EvolveState {
                    backup_branch: None,
                    ..evolve_state::get(app).unwrap_or_default()
                },
            );
        }
        None => {
            if skip_restore {
                log::warn!("[evolution] DEBUG_SKIP_RESTORE_ALL set — skipping restore_all");
            } else if let Err(e) = git::restore_all(config_dir) {
                log::error!("[evolution] restore_all failed: {}", e);
            }
        }
    }
}

/// Insert a DB evolution (or reuse the active one), and summarize a changeset to link to it.
pub async fn store_metadata(
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

    // Reuse an in-progress evolution (e.g. after adopt-then-evolve); otherwise insert fresh.
    let existing_id = evolve_state::get(app).ok().and_then(|s| s.evolution_id);
    let evolution_id = match db::evolutions::upsert(
        &db_path,
        existing_id,
        status.branch.as_deref().unwrap_or("unknown"),
    ) {
        Ok(id) => {
            info!("[evolution] upserted evolution record | id={}", id);
            Some(id)
        }
        Err(e) => {
            log::error!("[evolution] failed to upsert evolution record: {}", e);
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
