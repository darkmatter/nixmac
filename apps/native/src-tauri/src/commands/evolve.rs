use super::helpers::capture_err;
use crate::{evolve, shared_types};
use tauri::AppHandle;

/// Shared implementation for `darwin_evolve` (invoke) and `darwin.evolve` (oRPC).
///
/// A thin single-exit wrapper: whatever path the run takes through
/// [`run_evolve_session`], the transcript queue is flushed (the durability
/// point — the app may exit right after this returns) and the session path
/// cleared exactly once, so no exit path can forget them.
pub async fn run_evolve(app: AppHandle, description: String) -> Result<(), String> {
    let result = run_evolve_session(app, description).await;
    crate::state::session_log::flush_ordered().await;
    crate::state::session_log::set_session_path(None);
    result
}

/// The body of [`run_evolve`]. May return early freely: transcript flushing
/// and session teardown are the wrapper's job.
async fn run_evolve_session(app: AppHandle, description: String) -> Result<(), String> {
    evolve::session_control::set_evolve_cancelled(false);

    let session_log = crate::state::session_log::create_session_log().ok();
    if let Some(ref path) = session_log {
        crate::state::session_log::set_session_path(Some(path.clone()));
        // Through the ordered queue, like the events that follow — a direct
        // write could otherwise land after queued lines.
        crate::state::session_log::append_event_ordered(
            path.clone(),
            "prompt",
            serde_json::json!({ "description": description }),
        );
    }

    let result =
        match evolve::lifecycle::backup_evolve_and_record_changeset(&app, &description, None).await
        {
            Ok(result) => result,
            Err(failure) => {
                let is_cancelled = evolve::session_control::is_evolve_cancelled()
                    || failure
                        .error
                        .contains(evolve::session_control::EVOLUTION_CANCELLED_MSG);

                crate::summarize::refresh_change_map(&app);

                if is_cancelled {
                    log::info!(
                        "[darwin_evolve] cancelled after {} iterations and {} build attempts",
                        failure.telemetry.iterations,
                        failure.telemetry.build_attempts
                    );
                    return Err(failure.error);
                }

                log::warn!(
                    "[darwin_evolve] failed after {} iterations and {} build attempts",
                    failure.telemetry.iterations,
                    failure.telemetry.build_attempts
                );
                return Err(capture_err("darwin_evolve", failure.error));
            }
        };

    if let Some(ref path) = session_log {
        let result_json = serde_json::to_value(&result)
            .unwrap_or(serde_json::json!({ "error": "serialization failed" }));
        crate::state::session_log::append_event_ordered(path.clone(), "result", result_json);
    }

    Ok(())
}

/// Max number of trailing build-log lines to attach as context to a fix run.
const FIX_LOG_TAIL_LINES: usize = 200;

/// Build the natural-language evolve prompt for a "Fix with AI" run.
///
/// The evolve engine is prompt-driven, so the failing line, backend error
/// classification, and a bounded tail of the on-disk rebuild transcript are
/// serialized into a single description string.
fn build_fix_description(error: &str, error_type: Option<&str>, log_tail: &str) -> String {
    let mut description = String::from(
        "The most recent `darwin-rebuild` failed. Diagnose the failure from the build output \
         below and edit the Nix configuration to fix it. Make the smallest change that resolves \
         the error.\n\n",
    );
    if let Some(kind) = error_type {
        description.push_str(&format!("Error type: {kind}\n"));
    }
    description.push_str(&format!("Failing output line:\n{error}\n"));
    if !log_tail.trim().is_empty() {
        description.push_str(&format!(
            "\nBuild output (last {FIX_LOG_TAIL_LINES} lines):\n{log_tail}\n"
        ));
    }
    description
}

/// Shared implementation for `darwin.fixWithAi` (oRPC).
///
/// Assembles build-failure context and routes it into the existing evolve
/// pipeline via [`run_evolve`], reusing the agent loop, build-check
/// verification, backup/changeset bookkeeping, and review/commit gate.
pub async fn run_fix(
    app: AppHandle,
    error: String,
    error_type: Option<String>,
) -> Result<(), String> {
    let log_tail =
        crate::rebuild::read_latest_rebuild_log_tail(FIX_LOG_TAIL_LINES).unwrap_or_default();
    let description = build_fix_description(&error, error_type.as_deref(), &log_tail);
    run_evolve(app, description).await
}

/// Shared implementation for `darwin_evolve_cancel` (invoke) and `darwin.evolveCancel` (oRPC).
pub async fn cancel_evolve() -> Result<shared_types::EvolveCancelResult, String> {
    evolve::session_control::set_evolve_cancelled(true);
    log::info!("Evolution cancellation requested");
    Ok(shared_types::EvolveCancelResult {
        ok: true,
        message: "Cancellation requested".to_string(),
    })
}

/// Shared implementation for `darwin_evolve_answer` (invoke) and `darwin.evolveAnswer` (oRPC).
pub async fn answer_evolve_question(answer: String) -> Result<shared_types::OkResult, String> {
    log::info!("User answered agent question: {}", answer);
    evolve::session_control::send_question_response(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(shared_types::OkResult::yes())
}

#[tauri::command]
pub async fn darwin_evolve(app: AppHandle, description: String) -> Result<(), String> {
    run_evolve(app, description).await
}

#[tauri::command]
pub async fn darwin_evolve_cancel() -> Result<shared_types::EvolveCancelResult, String> {
    cancel_evolve().await
}

#[tauri::command]
pub async fn darwin_evolve_answer(answer: String) -> Result<shared_types::OkResult, String> {
    answer_evolve_question(answer).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fix_description_includes_error_type_and_line() {
        let desc = build_fix_description(
            "error: attribute 'foo' missing",
            Some("evaluation_error"),
            "some build output\nmore output",
        );
        assert!(desc.contains("Error type: evaluation_error"));
        assert!(desc.contains("error: attribute 'foo' missing"));
        assert!(desc.contains("some build output"));
        assert!(desc.contains("edit the Nix configuration"));
    }

    #[test]
    fn fix_description_omits_optional_sections_when_absent() {
        let desc = build_fix_description("boom", None, "   ");
        assert!(!desc.contains("Error type:"));
        // A blank/whitespace-only tail must not add an empty "Build output" block.
        assert!(!desc.contains("Build output"));
        assert!(desc.contains("Failing output line:\nboom"));
    }
}
