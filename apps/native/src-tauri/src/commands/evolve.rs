use super::helpers::capture_err;
use crate::{evolve, shared_types};

/// Handles the complete evolution cycle returning the git status and summary to react
#[tauri::command]
pub async fn darwin_evolve(
    app: tauri::AppHandle,
    description: String,
) -> Result<shared_types::EvolutionResult, String> {
    // Reset cancellation flag at the start of a new evolution
    evolve::session_control::set_evolve_cancelled(false);

    let result = match evolve::lifecycle::backup_evolve_and_record_changeset(&app, &description).await {
        Ok(result) => result,
        Err(failure) => {
            let is_cancelled = evolve::session_control::is_evolve_cancelled()
                || failure
                    .error
                    .to_ascii_lowercase()
                    .contains("cancelled by user");

            if is_cancelled {
                log::info!(
                    "[darwin_evolve] cancelled after {} iterations and {} build attempts",
                    failure.telemetry.iterations,
                    failure.telemetry.build_attempts
                );
                // Don't send to Sentry if it was a user-initiated cancellation
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

    Ok(result)
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
