//! Complete evolution lifecycle orchestration.
//!
//! This module provides a unified API for the evolution workflow:
//! 1. Run AI evolution
//! 2. Return current change map and git status
//!
//! All steps are atomic from the frontend's perspective - one call does everything.

use log::info;
use tauri::{AppHandle, Manager};

use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{
    db, evolve, git,
    shared_types::{
        EvolutionFailureResult, EvolutionResult, EvolutionState, EvolutionTelemetry, EvolveSession,
        SemanticChangeMap,
    },
    summarize,
    types::{EvolveEvent, emit_evolve_event},
};

impl EvolutionTelemetry {
    fn failed_defaults(duration_ms: i64) -> Self {
        Self {
            state: EvolutionState::Failed,
            terminal_reason: None,
            build_verified: false,
            last_build_ok: None,
            tool_names: vec![],
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
            terminal_reason: evolution.terminal_reason,
            build_verified: evolution.build_verified,
            last_build_ok: evolution.last_build_ok,
            tool_names: evolution.tool_names(),
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
            terminal_reason: progress.terminal_reason,
            build_verified: progress.build_verified,
            last_build_ok: progress.last_build_ok,
            tool_names: progress.tool_names.clone(),
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
        git_status: Option<crate::shared_types::GitStatus>,
        telemetry: EvolutionTelemetry,
    ) -> Self {
        Self {
            error,
            git_status,
            telemetry,
            provider_failure: None,
            discarded_diff: None,
        }
    }

    fn defaults(
        error: String,
        git_status: Option<crate::shared_types::GitStatus>,
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
        git_status: Option<crate::shared_types::GitStatus>,
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
    banned_tools: Option<&[&str]>,
) -> std::result::Result<EvolutionResult, EvolutionFailureResult> {
    let start_time_ms: i64 = chrono::Utc::now().timestamp_millis();
    let start_time_s: i64 = start_time_ms / 1000;

    let config_dir: String = match store::ensure_config_dir_exists(app) {
        Ok(dir) => dir,
        Err(e) => {
            return Err(EvolutionFailureResult::defaults(
                format!("Failed to get config directory: {}", e),
                None,
                elapsed_since(start_time_ms),
            ));
        }
    };
    let repo_root = match store::ensure_git_repo_folder(app) {
        Ok(dir) => dir,
        Err(e) => {
            return Err(EvolutionFailureResult::defaults(
                format!("Failed to get git repository root: {}", e),
                None,
                elapsed_since(start_time_ms),
            ));
        }
    };

    let initial_status = match git::status(&repo_root) {
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

    // Record the pre-evolution status; the cell write emits `git_state_changed`
    // and clears any stale external-build flag now that nixmac itself acts.
    crate::state::git_state::update_status(app, initial_status.clone());

    // Step 1: Snapshot the working tree onto a backup branch before AI touches anything.
    let pre_evolve_state = evolve_state::get_session(app);
    let changeset_id = pre_evolve_state.current_changeset_id.unwrap_or(0);
    let backup_branch =
        match git::create_evolution_backup(&repo_root, pre_evolve_state.evolution_id, changeset_id)
        {
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
        // Rollback branch saves the first evolution, so restore repo to pre-evolution state
        let rollback_branch = pre_evolve_state
            .rollback_branch
            .clone()
            .or_else(|| Some(branch.clone()));
        let (rollback_store_path, rollback_changeset_id) =
            if pre_evolve_state.rollback_store_path.is_some() {
                (
                    pre_evolve_state.rollback_store_path.clone(),
                    pre_evolve_state.rollback_changeset_id,
                )
            } else {
                let bs = build_state::get(app).ok();
                (
                    bs.as_ref().and_then(|b| b.nixmac_built_store_path.clone()),
                    bs.as_ref().and_then(|b| b.changeset_id),
                )
            };
        let updated = EvolveSession {
            backup_branch: Some(branch.clone()),
            rollback_branch,
            rollback_store_path,
            rollback_changeset_id,
            ..pre_evolve_state.clone()
        };
        // fire-and-forget: session update before the AI call. Failure is non-fatal —
        // evolution proceeds and the final set_session() below corrects state.
        let _ = evolve_state::set_session(app, updated, &initial_status.changes);
    }

    // Step 2: Run AI evolution
    let evolution = match evolve::generate_evolution(
        app,
        &config_dir,
        description,
        banned_tools.unwrap_or(&[]),
    )
    .await
    {
        Ok(evolution) => evolution,
        Err(e) => {
            let duration_ms = elapsed_since(start_time_ms);
            // Capture the tree's state BEFORE restore_after_failure rolls it
            // back: for a run that died with edits in place (e.g. a transient
            // provider failure at a late iteration), this diff is the only
            // surviving record of the work (N9).
            let git_status = git::status(&repo_root).ok();
            let discarded_diff = git_status
                .as_ref()
                .map(|status| status.diff.clone())
                .filter(|diff| !diff.trim().is_empty());
            restore_after_failure(app, &repo_root, &backup_branch);
            if let Some(run_error) = e.downcast_ref::<evolve::EvolutionRunError>() {
                let mut failure = EvolutionFailureResult::new(
                    run_error.message.clone(),
                    git_status,
                    EvolutionTelemetry::from_failed_progress(&run_error.progress, duration_ms),
                );
                failure.provider_failure = run_error.provider_failure.clone();
                failure.discarded_diff = discarded_diff;
                return Err(failure);
            }
            let mut failure = EvolutionFailureResult::defaults(
                format!("AI evolution failed: {}", e),
                git_status,
                duration_ms,
            );
            failure.discarded_diff = discarded_diff;
            return Err(failure);
        }
    };

    info!(
        "[evolution] AI evolution complete | iterations={}",
        evolution.iterations
    );

    // Short-circuit: conversational responses made no environment changes.
    if evolution.state == EvolutionState::Conversational {
        info!("[evolution] Conversational response — skipping git/db workflow");
        let evolve_state = evolve_state::set_session(
            app,
            EvolveSession {
                last_evolution_state: Some(EvolutionState::Conversational),
                ..evolve_state::get_session(app)
            },
            &initial_status.changes,
        )
        .unwrap_or_default();
        let telemetry =
            EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms));
        // Terminal event: every cell this path touches is updated above, so the
        // frontend mirrors are consistent when the completion data arrives.
        emit_evolve_event(
            app,
            EvolveEvent::complete(
                start_time_s,
                evolution.iterations,
                evolution.summary.as_deref().unwrap_or(""),
                telemetry.clone(),
                evolution.summary.clone(),
            ),
        );
        return Ok(EvolutionResult {
            change_map: SemanticChangeMap::default(),
            git_status: initial_status,
            evolve_state,
            conversational_response: evolution.summary.clone(),
            telemetry,
        });
    }

    // Get final git status
    let final_status = match git::status(&repo_root) {
        Ok(status) => status,
        Err(e) => {
            restore_after_failure(app, &repo_root, &backup_branch);
            return Err(EvolutionFailureResult::from_evolution(
                format!("Failed to get final git status: {}", e),
                None,
                &evolution,
                elapsed_since(start_time_ms),
            ));
        }
    };

    emit_evolve_event(app, EvolveEvent::analyzing(start_time_s, None));

    // Record the post-evolution status; the cell write emits `git_state_changed`.
    crate::state::git_state::update_status(app, final_status.clone());

    // Insert a DB evolution record and run the appropriate summarization pipeline.
    let (db_evolution_id, new_changeset_id) = store_metadata(app, &final_status).await;

    let current_state = evolve_state::get_session(app);
    let evolve_state = evolve_state::set_session(
        app,
        EvolveSession {
            evolution_id: db_evolution_id,
            current_changeset_id: new_changeset_id,
            backup_branch,
            last_evolution_state: Some(evolution.state.clone()),
            ..current_state
        },
        &final_status.changes,
    )
    .unwrap_or_default();

    // Build the change map from whatever is now stored in the DB and record it
    // in the cell. The summarize pipeline already writes the cell when it runs,
    // but it short-circuits when summaries exist; this write covers that path.
    let base_ref = summarize::active_summary_base_ref(app);
    let change_map = summarize::change_map_since(app, &base_ref).unwrap_or_default();
    crate::state::change_map::update(app, change_map.clone());

    let telemetry = EvolutionTelemetry::from_evolution(&evolution, elapsed_since(start_time_ms));
    // Terminal event: emitted after the git-state, evolve-state, and change-map
    // cells are all updated, so the frontend mirrors are consistent when the
    // completion data arrives.
    emit_evolve_event(
        app,
        EvolveEvent::complete(
            start_time_s,
            evolution.iterations,
            evolution.summary.as_deref().unwrap_or(""),
            telemetry.clone(),
            None,
        ),
    );

    Ok(EvolutionResult {
        change_map,
        git_status: final_status,
        evolve_state,
        conversational_response: None,
        telemetry,
    })
}

fn restore_after_failure(app: &AppHandle, repo_root: &str, backup_branch: &Option<String>) {
    // Allow skipping the actual git restore calls for debugging/testing.
    // If `DEBUG_SKIP_RESTORE_ALL` is set to a non-zero value, skip restore operations
    // but keep the same state updates and logging behavior.
    let skip_restore = crate::env::debug_skip_restore_all();

    if skip_restore {
        log::warn!("[evolution] DEBUG_SKIP_RESTORE_ALL set — skipping restore_from_branch_ref");
    } else if let Some(branch) = backup_branch {
        let ref_name = format!("refs/heads/{}", branch);
        if let Err(e) = git::restore_from_branch_ref(repo_root, &ref_name) {
            log::error!("[evolution] restore_from_branch_ref failed: {}", e);
        }
    } else {
        log::error!(
            "[evolution] restore_after_failure called without backup_branch — skipping restore"
        );
    }

    // fire-and-forget: clearing backup_branch in an error-recovery path. We are
    // already handling a failure; a secondary store write failure is non-fatal.
    let _ = evolve_state::set_session(
        app,
        EvolveSession {
            backup_branch: None,
            last_evolution_state: Some(EvolutionState::Failed),
            ..evolve_state::get_session(app)
        },
        &[],
    );
}

/// Insert a DB evolution (or reuse the active one), and summarize a changeset to link to it.
pub async fn store_metadata(
    app: &AppHandle,
    status: &crate::shared_types::GitStatus,
) -> (Option<i64>, Option<i64>) {
    // Reuse an in-progress evolution (e.g. after adopt-then-evolve); otherwise insert fresh.
    let existing_id = evolve_state::get_session(app).evolution_id;
    let pool = app.state::<db::DbPool>();
    let evolution_id = match db::evolutions::upsert(
        &pool,
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

    // Summarize since we started evolution, falling back to HEAD if the persisted
    // backup/rollback ref has already been removed.
    let base_ref = summarize::active_summary_base_ref(app);

    let changeset_id = match summarize::summarize_since(app, &base_ref, evolution_id).await {
        Ok(id) => id,
        Err(e) => {
            log::error!("[evolution] summarization pipeline failed: {}", e);
            None
        }
    };

    (evolution_id, changeset_id)
}
