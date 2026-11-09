//! Commit message pipeline — returns the stored whole-diff summary when
//! available, generating one on demand if missing.

use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let base_ref = crate::summarize::active_summary_base_ref(app);

    let existing = crate::summarize::found_since(app, &base_ref)?
        .and_then(|found| found.generated_commit_message)
        .filter(|message| !message.trim().is_empty());

    if let Some(message) = existing {
        return Ok(message);
    }

    // No cached message (e.g. summarizeCurrent never ran, or the previous
    // model call failed). summarize_since will create or refresh the snapshot
    // and retry the commit-message generation.
    crate::summarize::summarize_since(app, &base_ref, None).await?;

    crate::summarize::found_since(app, &base_ref)?
        .and_then(|found| found.generated_commit_message)
        .filter(|message| !message.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("no generated commit message found"))
}
