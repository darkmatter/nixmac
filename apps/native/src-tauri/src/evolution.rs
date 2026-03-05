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

use anyhow::{Context, Result};
use log::{error, info};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    db, evolve, git, store, summarize,
    types::{emit_evolve_event, slugify, EvolveEvent, SummaryItem, SummaryResponse},
};

/// Evolution returns final git status and summary to frontend when done.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionResult {
    pub summary: SummaryResponse,
    pub git_status: crate::types::GitStatus,
}

/// Run a complete evolution workflow: AI generation + summary + branch + commit + DB.
pub async fn evolve_and_commit(app: &AppHandle, description: &str) -> Result<EvolutionResult> {
    let start_time = chrono::Utc::now().timestamp();

    // Get config directory
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    // Check initial git status
    let initial_status = git::status(&config_dir).context("Failed to get initial git status")?;

    let is_on_main = initial_status
        .branch
        .as_ref()
        .map(|b| b == "main" || b == "master")
        .unwrap_or(false);

    info!(
        "[evolution] Starting evolve_and_commit | branch={:?} | is_main={}",
        initial_status.branch, is_on_main
    );

    // Step 1: Run AI evolution (this already emits its own events)
    let evolution = evolve::generate_evolution(app, &config_dir, description)
        .await
        .context("AI evolution failed")?;

    let iteration = Some(evolution.iterations);
    info!(
        "[evolution] AI evolution complete | iterations={}",
        evolution.iterations
    );

    // Step 2: Generate summary (emit event - this is the only slow finalization step)
    emit_evolve_event(app, EvolveEvent::summarizing(start_time, iteration));

    let status = git::status(&config_dir).context("Failed to get git status for summary")?;

    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();

    let (change_summary, commit_message) =
        summarize::summarize_for_preview(&status.diff, &file_list, Some(app))
            .await
            .context("Failed to generate summary")?;

    info!(
        "[evolution] Summary generated | commit_message={}",
        commit_message
    );

    // Step 3: Create branch if on main
    let branch_name = if is_on_main {
        let base_name = format!("nixmac-evolve/{}", slugify(description));
        let created_branch = git::checkout_new_branch(&config_dir, &base_name)?;
        info!("[evolution] Created branch: {}", created_branch);
        Some(created_branch)
    } else {
        None
    };

    // Step 4: Commit changes
    let commit_info =
        git::commit_all(&config_dir, &commit_message).context("Failed to commit changes")?;

    info!(
        "[evolution] Committed | hash={} | tree={}",
        &commit_info.hash[..8],
        &commit_info.tree_hash[..8]
    );

    // Step 5: Save to database (all inserts in a single transaction)
    let db_path = db::get_db_path(app).context("Failed to get database path")?;

    let summary_json =
        serde_json::to_string(&change_summary).context("Failed to serialize summary to JSON")?;

    let branch_for_db = branch_name.as_deref().unwrap_or("main").to_string();

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
        e
    })
    .context("Failed to save evolution data to database")?;

    info!("[evolution] Saved to DB | evolution_id={}", evolution_id);

    // Emit complete event
    emit_evolve_event(
        app,
        EvolveEvent::complete(start_time, evolution.iterations, "Evolution complete"),
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
    let final_status = git::status(&config_dir).context("Failed to get final git status")?;

    // Sync the watcher's change-detection cache so its next poll doesn't spuriously emit
    let _ = store::set_cached_git_status(app, &final_status);

    Ok(EvolutionResult {
        summary,
        git_status: final_status,
    })
}
