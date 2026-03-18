//! Post-build finalization after a successful darwin-rebuild.
//!
//! `finalize_apply` always runs after a successful build:
//! - handles uncommitted changes if present (manual changes edge-case)
//! - tags HEAD as built

use anyhow::{Context, Result};
use log::info;
use tauri::AppHandle;

use crate::{
    db,
    evolution::{EvolutionResult, EvolutionTelemetry},
    evolve::EvolutionState,
    find_summary, git, store, summarize,
    types::{slugify, GitStatus, SummaryItem, SummaryResponse},
};

/// Finalize a successful darwin-rebuild.
pub async fn finalize_apply(app: &AppHandle) -> Result<EvolutionResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    // Capture status before any git operations.
    let status = git::status(&config_dir).context("Failed to get git status")?;

    // Conditionally handle uncommitted changes (branch + commit + DB).
    let summary = if !status.clean_head {
        info!(
            "[finalize_apply] Uncommitted changes present | branch={:?}",
            status.branch
        );
        record_uncommitted_built_changes(app, &config_dir, &status).await?
    } else {
        info!("[finalize_apply] HEAD is clean — looking up existing summary");
        // Return summary
        find_summary::find_summary(app)
            .ok()
            .flatten()
            .unwrap_or_else(|| SummaryResponse {
                items: vec![],
                instructions: String::new(),
                commit_message: String::new(),
                diff: String::new(),
            })
    };

    // Always tag HEAD as built (after any commit above).
    git::tag_as_built(&config_dir).context("Failed to tag HEAD as built")?;

    // Get final git status and sync watcher cache.
    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    Ok(EvolutionResult {
        summary,
        git_status: final_status,
        telemetry: EvolutionTelemetry {
            // We don't have evolution run metadata here; this is a post-build finalizer.
            // Use `Applied` to indicate the build step completed (commit may have been recorded).
            state: EvolutionState::Applied,
            iterations: 0,
            build_attempts: 0,
            total_tokens: 0,
            edits_count: 0,
            thinking_count: 0,
            tool_calls_count: 0,
            duration_ms: 0,
        },
    })
}

/// Branch (if on main with unclean_head), commit, and register uncommitted changes in the DB.
async fn record_uncommitted_built_changes(
    app: &AppHandle,
    config_dir: &str,
    status: &GitStatus,
) -> Result<SummaryResponse> {
    // Generate AI summary from the pre-commit diff.
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();
    let (change_summary, commit_message) =
        summarize::summarize_for_preview(&status.diff, &file_list, Some(app))
            .await
            .context("Failed to generate summary")?;

    info!(
        "[finalize_apply] Summary generated | commit_message={}",
        commit_message
    );

    // Branch off main if needed.
    let branch_name = if status.is_main_branch {
        let base_name = format!("nixmac-evolve/{}", slugify(&commit_message));
        let created =
            git::checkout_new_branch(config_dir, &base_name).context("Failed to create branch")?;
        info!("[finalize_apply] Created branch: {}", created);
        Some(created)
    } else {
        None
    };

    // Commit.
    let commit_info =
        git::commit_all(config_dir, &commit_message).context("Failed to commit changes")?;

    info!(
        "[finalize_apply] Committed | hash={}",
        &commit_info.hash[..8]
    );

    // Save data as if this were a normal evolution commit, ensuring we end on merge step with summary and other change metadata.
    let db_path = db::get_db_path(app).context("Failed to get database path")?;
    let summary_json =
        serde_json::to_string(&change_summary).context("Failed to serialize summary")?;
    let branch_for_db = branch_name
        .or_else(|| status.branch.clone())
        .context("Failed to determine branch for DB record")?;

    db::operations::save_evolution_complete(
        &db_path,
        db::operations::EvolutionData {
            commit_hash: commit_info.hash.clone(),
            tree_hash: commit_info.tree_hash.clone(),
            commit_message: commit_message.clone(),
            branch: branch_for_db,
            summary_json,
            diff: status.diff.clone(),
            prompt: None,
        },
    )
    .context("Failed to save manual changes to database")?;

    Ok(SummaryResponse {
        items: change_summary
            .items
            .into_iter()
            .map(|i| SummaryItem {
                title: i.title,
                description: i.description,
            })
            .collect(),
        instructions: change_summary.instructions,
        commit_message,
        diff: status.diff.clone(),
    })
}
