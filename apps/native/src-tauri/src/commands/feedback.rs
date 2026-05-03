use super::helpers::capture_err;
use crate::{feedback, types};
use tauri::AppHandle;

/// Gathers feedback metadata based on user opt-in flags.
#[tauri::command]
pub async fn feedback_gather_metadata(
    app: AppHandle,
    request: types::FeedbackMetadataRequest,
) -> Result<types::FeedbackMetadata, String> {
    feedback::gather_metadata(&app, request).map_err(|e| capture_err("feedback_gather_metadata", e))
}

/// Submits feedback: tries to POST, saves to disk on failure, flushes pending.
#[tauri::command]
pub async fn feedback_submit(app: AppHandle, payload: String) -> Result<bool, String> {
    feedback::submit(&app, payload)
        .await
        .map_err(|e| capture_err("feedback_submit", e))
}
