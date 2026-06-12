use super::helpers::capture_err;
use crate::{evolve, shared_types};

/// Handles the complete evolution cycle. All state (git status, evolve state,
/// change map) flows through the `*_changed` cell events, and the run's result
/// data (telemetry, conversational response) travels on the terminal
/// `darwin:evolve:event` `Complete` payload; the command itself only signals
/// success or failure.
#[tauri::command]
pub async fn darwin_evolve(app: tauri::AppHandle, description: String) -> Result<(), String> {
    // Reset cancellation flag at the start of a new evolution
    evolve::session_control::set_evolve_cancelled(false);

    // Create a session transcript log for this evolution and record the prompt.
    let session_log = crate::state::session_log::create_session_log().ok();
    if let Some(ref path) = session_log {
        crate::state::session_log::set_session_path(Some(path.clone()));
        crate::state::session_log::append_event(
            path,
            "prompt",
            &serde_json::json!({ "description": description }),
        )
        .await;
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

                // The failure path restored the working tree (backup branch), so
                // refresh the change-map cell to match; the cell write emits
                // `change_map_changed`.
                crate::summarize::refresh_change_map(&app);

                if is_cancelled {
                    log::info!(
                        "[darwin_evolve] cancelled after {} iterations and {} build attempts",
                        failure.telemetry.iterations,
                        failure.telemetry.build_attempts
                    );
                    // Don't send to Sentry if it was a user-initiated cancellation
                    crate::state::session_log::set_session_path(None);
                    return Err(failure.error);
                }

                log::warn!(
                    "[darwin_evolve] failed after {} iterations and {} build attempts",
                    failure.telemetry.iterations,
                    failure.telemetry.build_attempts
                );
                crate::state::session_log::set_session_path(None);
                return Err(capture_err("darwin_evolve", failure.error));
            }
        };

    // Record the evolution result, then clear the active session.
    if let Some(ref path) = session_log {
        let result_json = serde_json::to_value(&result)
            .unwrap_or(serde_json::json!({ "error": "serialization failed" }));
        crate::state::session_log::append_event(path, "result", &result_json).await;
    }
    crate::state::session_log::set_session_path(None);

    Ok(())
}

/// Cancel an in-progress evolution operation.
#[tauri::command]
pub async fn darwin_evolve_cancel() -> Result<shared_types::EvolveCancelResult, String> {
    evolve::session_control::set_evolve_cancelled(true);
    log::info!("Evolution cancellation requested");
    Ok(shared_types::EvolveCancelResult {
        ok: true,
        message: "Cancellation requested".to_string(),
    })
}

/// Respond to an agent question during evolution.
#[tauri::command]
pub async fn darwin_evolve_answer(answer: String) -> Result<shared_types::OkResult, String> {
    log::info!("User answered agent question: {}", answer);
    evolve::session_control::send_question_response(answer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(shared_types::OkResult::yes())
}
