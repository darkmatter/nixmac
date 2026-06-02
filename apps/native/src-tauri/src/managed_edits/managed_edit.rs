//! Reusable managed review helpers for non-AI edits.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{db, git, shared_types, summarize};

pub struct ManagedEditContext {
    pub dir: String,
    pub db_path: std::path::PathBuf,
    pub evolution_id: i64,
    pub evolve_state: shared_types::EvolveState,
}

pub fn prepare_managed_edit(app: &AppHandle) -> Result<ManagedEditContext> {
    let dir = store::ensure_config_dir_exists(app).context("Failed to get config directory")?;
    let db_path = db::get_db_path(app).context("Failed to get DB path")?;
    let pre_edit_status =
        git::status(&dir).context("Failed to get pre-edit working tree status")?;

    let _base_commit_id = db::commits::store_head_commit(&db_path, &dir, None)
        .context("Failed to store HEAD commit")?;

    let pre_state = evolve_state::get(app).unwrap_or_default();
    let branch = git::current_branch(&dir).unwrap_or_else(|| "main".to_string());
    let evolution_id = db::evolutions::upsert(&db_path, pre_state.evolution_id, &branch)
        .context("Failed to upsert evolution")?;

    let changeset_id = pre_state.current_changeset_id.unwrap_or(0);
    let backup_branch = git::create_evolution_backup(&dir, Some(evolution_id), changeset_id)
        .context("Failed to create backup branch")?;

    let rollback_branch = pre_state
        .rollback_branch
        .clone()
        .or_else(|| backup_branch.clone());
    let (rollback_store_path, rollback_changeset_id) = if pre_state.rollback_store_path.is_some() {
        (
            pre_state.rollback_store_path.clone(),
            pre_state.rollback_changeset_id,
        )
    } else {
        let build = build_state::get(app).ok();
        (
            build
                .as_ref()
                .and_then(|state| state.nixmac_built_store_path.clone()),
            build.as_ref().and_then(|state| state.changeset_id),
        )
    };

    let evolve_state = evolve_state::set(
        app,
        shared_types::EvolveState {
            evolution_id: Some(evolution_id),
            current_changeset_id: None,
            changeset_at_build: None,
            committable: false,
            backup_branch,
            rollback_branch,
            rollback_store_path,
            rollback_changeset_id,
            step: shared_types::EvolveStep::Evolve,
            last_evolution_state: None,
        },
        &pre_edit_status.changes,
    )
    .context("Failed to set evolve state")?;

    Ok(ManagedEditContext {
        dir,
        db_path,
        evolution_id,
        evolve_state,
    })
}

pub async fn finalize_managed_edit(
    app: &AppHandle,
    mut context: ManagedEditContext,
    post_edit_status: shared_types::GitStatus,
    count: usize,
    log_tag: &str,
) -> Result<shared_types::ConfigEditApplyResult> {
    context.evolve_state = evolve_state::set(app, context.evolve_state, &post_edit_status.changes)
        .context("Failed to update evolve state for post-edit status")?;

    match summarize::new_changeset(app, Some(context.evolution_id)).await {
        Ok(Some(changeset_id)) => {
            context.evolve_state.current_changeset_id = Some(changeset_id);
            context.evolve_state =
                evolve_state::set(app, context.evolve_state, &post_edit_status.changes)
                    .context("Failed to update evolve state with changeset")?;
        }
        Ok(None) => {
            log::warn!("[{log_tag}] Summarizer returned None - diff may be empty");
        }
        Err(error) => {
            log::error!("[{log_tag}] Summarizer error: {}", error);
        }
    }

    let change_sets =
        summarize::find_existing::for_current_state(context.db_path.as_path(), &context.dir)
            .unwrap_or_default();

    let change_map = summarize::group_existing::from_change_sets(change_sets);
    let git_status =
        git::query::status_and_cache(&context.dir, app).context("Failed to get git status")?;

    Ok(shared_types::ConfigEditApplyResult {
        ok: true,
        count,
        change_map,
        git_status,
        evolve_state: context.evolve_state,
    })
}
