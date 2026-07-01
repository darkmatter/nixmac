//! Commit message pipeline — returns the stored whole-diff summary when
//! available, generating one on demand if missing.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let base_ref = crate::summarize::active_summary_base_ref(app);
    let change_sets = crate::summarize::found_change_sets_since(app, &base_ref)?;

    let existing = change_sets.iter().find_map(|entry| {
        entry
            .change_set
            .as_ref()
            .and_then(|cs| cs.generated_commit_message.as_deref())
            .filter(|message| !message.trim().is_empty())
    });

    if let Some(message) = existing {
        return Ok(message.to_string());
    }

    // No stored message (e.g. summarizeCurrent never ran, or the previous
    // model call failed). summarize_since will create or refresh the changeset
    // and retry the commit-message generation.
    crate::summarize::summarize_since(app, &base_ref, None).await?;

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
