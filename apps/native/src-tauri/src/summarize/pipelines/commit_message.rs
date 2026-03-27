//! Commit message pipeline — generates a conventional commit message from the current semantic map.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

use crate::summarize::{build_prompt, find_existing, group_existing, model_calls};

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let db_path = crate::db::get_db_path(app)?;
    let config_dir = crate::store::get_config_dir(app)?;

    let change_sets = find_existing::for_current_state(&db_path, &config_dir)?;
    let map = group_existing::from_change_sets(change_sets);

    if map.groups.is_empty() && map.singles.is_empty() {
        return Err(anyhow::anyhow!("no summarized changes found"));
    }

    let prompt = build_prompt::commit_message(&map);
    let (message, _) = model_calls::generate_commit_message(&prompt, Some(app)).await?;
    Ok(message)
}
