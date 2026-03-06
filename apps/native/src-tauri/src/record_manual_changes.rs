//! Runs when building manual changes with nixmac UI.
//!
//! Ensures merge step loads with summary, and preserves metadata.

use anyhow::{Context, Result};
use log::info;
use tauri::AppHandle;

use crate::{
    db, evolution::EvolutionResult, git, store, summarize,
    types::{slugify, SummaryItem, SummaryResponse},
};

/// Always tags last commit as built.
///
/// Summarizes, branches, and commits any manual changes if need be first.
pub async fn handle_uncommitted_built_changes(app: &AppHandle) -> Result<EvolutionResult> {
    let config_dir =
        store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

    // Step 1: Capture current status while diff is available.
    let status = git::status(&config_dir).context("Failed to get git status")?;

    // If HEAD is already clean, just tag and return early.
    if status.clean_head {
        info!("[record_manual_changes] HEAD is clean — tagging as built");
        git::tag_as_built(&config_dir).context("Failed to tag HEAD as built")?;
        let final_status = git::status(&config_dir).context("Failed to get final git status")?;
        let _ = store::set_cached_git_status(app, &final_status);
        return Ok(EvolutionResult {
            summary: SummaryResponse {
                items: vec![],
                instructions: String::new(),
                commit_message: String::new(),
                diff: String::new(),
            },
            git_status: final_status,
        });
    }
    // If HEAD is not clean, mimic evolution flow.
    info!(
        "[record_manual_changes] Uncommitted changes present | branch={:?} | is_main={}",
        status.branch, status.is_main_branch
    );

    // Step 2: Generate AI summary from the pre-commit diff.
    let file_list: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();
    let (change_summary, commit_message) =
        summarize::summarize_for_preview(&status.diff, &file_list, Some(app))
            .await
            .context("Failed to generate summary")?;

    info!(
        "[record_manual_changes] Summary generated | commit_message={}",
        commit_message
    );

    // Step 3: Branch if on main.
    let branch_name = if status.is_main_branch {
        let base_name = format!("nixmac-evolve/{}", slugify(&commit_message));
        let created = git::checkout_new_branch(&config_dir, &base_name)
            .context("Failed to create branch")?;
        info!("[record_manual_changes] Created branch: {}", created);
        Some(created)
    } else {
        None
    };

    // Step 4: Commit. Mirrors evolution.rs step 4: commit_all.
    let commit_info =
        git::commit_all(&config_dir, &commit_message).context("Failed to commit changes")?;

    info!(
        "[record_manual_changes] Committed | hash={}",
        &commit_info.hash[..8]
    );

    // Step 5: Tag HEAD as built.
    git::tag_as_built(&config_dir).context("Failed to tag HEAD as built")?;

    // Step 6: Save to DB. Mirrors evolution.rs step 5: save_evolution_complete (prompt excluded).
    let db_path = db::get_db_path(app).context("Failed to get database path")?;
    let summary_json =
        serde_json::to_string(&change_summary).context("Failed to serialize summary")?;
    let branch_for_db = branch_name.context("Failed to determine branch for DB record")?;

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
    .context("Failed to save to database")?;

    info!("[record_manual_changes] Saved to DB");

    // Step 7: Get final git status and sync watcher cache.
    let final_status = git::status(&config_dir).context("Failed to get final git status")?;
    let _ = store::set_cached_git_status(app, &final_status);

    let summary = SummaryResponse {
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
    };

    Ok(EvolutionResult {
        summary,
        git_status: final_status,
    })
}
