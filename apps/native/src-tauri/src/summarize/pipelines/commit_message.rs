//! Commit message pipeline — returns the stored whole-diff summary when available.

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

use crate::summarize::find_existing;

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<crate::db::DbPool>();

    let change_sets = find_existing::for_current_state(&pool, &config_dir)?;

    change_sets
        .iter()
        .find_map(|entry| {
            entry
                .change_set
                .as_ref()
                .and_then(|cs| cs.generated_commit_message.as_deref())
                .filter(|message| !message.trim().is_empty())
        })
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("no generated commit message found"))
}
