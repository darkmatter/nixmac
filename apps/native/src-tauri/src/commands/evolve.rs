use super::helpers::capture_err;
use crate::{evolve, shared_types};
use tauri::AppHandle;

/// Shared implementation for `darwin_evolve` (invoke) and `darwin.evolve` (oRPC).
pub async fn run_evolve(app: AppHandle, description: String) -> Result<(), String> {
    evolve::session_control::set_evolve_cancelled(false);

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

                crate::summarize::refresh_change_map(&app);

                if is_cancelled {
                    log::info!(
                        "[darwin_evolve] cancelled after {} iterations and {} build attempts",
                        failure.telemetry.iterations,
                        failure.telemetry.build_attempts
                    );
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

    if let Some(ref path) = session_log {
        let result_json = serde_json::to_value(&result)
            .unwrap_or(serde_json::json!({ "error": "serialization failed" }));
        crate::state::session_log::append_event(path, "result", &result_json).await;
    }
    crate::state::session_log::set_session_path(None);

    Ok(())
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
