//! Commit message pipeline — returns the stored whole-diff summary when available.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let base_ref = crate::summarize::active_summary_base_ref(app);
    let change_sets = crate::summarize::found_change_sets_since(app, &base_ref)?;

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
