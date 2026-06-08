//! Whole-diff pipeline — one model call on the full diff, one summary message.

use anyhow::Result;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::db::DbPool;
use crate::sqlite_types::Change;
use crate::summarize::{build_prompt, sumlog as dbg};

#[allow(clippy::too_many_arguments)]
pub async fn analyze<R: Runtime>(
    changes: Vec<Change>,
    app: &AppHandle<R>,
    commit_id: Option<i64>,
    base_commit_id: Option<i64>,
    base_ref: Option<&str>,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::new_log_changes(&changes);

    if changes.is_empty() {
        return Ok(None);
    }

    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<DbPool>();
    let Some(base_commit_id) =
        crate::db::commits::store_head_commit(&pool, &config_dir, base_commit_id)?
    else {
        return Ok(None);
    };

    let refs: Vec<&Change> = changes.iter().collect();
    let prompt = build_prompt::whole_diff(&refs);
    dbg::new_log_prompt(&prompt);

    let (message, _usage) =
        crate::summarize::model_calls::generate_commit_message(&prompt, Some(app)).await?;

    let change_set_id = crate::db::store_whole_diff_changeset::store(
        &pool,
        &changes,
        &message,
        commit_id,
        base_commit_id,
        commit_message,
        evolution_id,
    )?;

    emit_update(app, &pool, base_ref)?;

    Ok(Some(change_set_id))
}

fn emit_update<R: Runtime>(
    app: &AppHandle<R>,
    pool: &DbPool,
    base_ref: Option<&str>,
) -> Result<()> {
    let semantic_map = if let Some(base_ref) = base_ref {
        crate::summarize::change_map_since(app, base_ref)?
    } else {
        let config_dir = crate::storage::store::get_config_dir(app)?;
        let change_sets = crate::summarize::find_existing::for_current_state(pool, &config_dir)?;
        crate::summarize::group_existing::from_change_sets(change_sets)
    };
    app.emit("change_map_changed", semantic_map)?;
    Ok(())
}
