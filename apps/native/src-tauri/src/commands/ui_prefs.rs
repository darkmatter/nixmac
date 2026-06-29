use super::helpers::capture_err;
use crate::commands::debug::TimerGuard;
use crate::shared_types;
use crate::state::ui_prefs;
use crate::storage::secrets;
use tauri::AppHandle;

/// Returns the global preferences slice (no secrets, no API keys).
#[tauri::command]
pub async fn get_global_preferences(
    app: AppHandle,
) -> Result<crate::state::preferences::GlobalPreferences, String> {
    crate::state::preferences::try_read(&app)
        .ok_or_else(|| "GlobalPreferences observable is not managed".to_string())
}

/// Returns all UI preferences.
#[tauri::command]
pub async fn ui_get_prefs(app: AppHandle) -> Result<shared_types::UiPrefs, String> {
    let _timer = TimerGuard::new("ui_get_prefs");
    ui_prefs::assemble_ui_prefs(&app).map_err(|e| capture_err("ui_get_prefs", e))
}

/// Updates UI preferences from a typed partial update object.
#[tauri::command]
pub async fn ui_set_prefs(
    app: AppHandle,
    prefs: shared_types::UiPrefsUpdate,
) -> Result<shared_types::OkResult, String> {
    ui_prefs::apply_ui_prefs_update(&app, &prefs).map_err(|e| capture_err("ui_set_prefs", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Verifies a direct OpenAI API key outside the webview so browser CORS cannot
/// turn valid keys into frontend network failures.
#[tauri::command]
pub async fn verify_openai_api_key(api_key: String) -> Result<bool, String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Ok(false);
    }

    let url = format!("{}/models", secrets::OPENAI_BASE_URL);
    let response = crate::http_client::logged()
        .get(url)
        .bearer_auth(trimmed_key)
        .send()
        .await
        .map_err(|e| capture_err("verify_openai_api_key", e))?;

    Ok(response.status().is_success())
}

/// Gets the cached list of models for a provider.
#[tauri::command]
pub async fn get_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<Option<Vec<String>>, String> {
    crate::storage::store::get_cached_models(&app, &provider)
        .map_err(|e| capture_err("get_cached_models", e))
}

/// Clears the cached models for a provider.
#[tauri::command]
pub async fn clear_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<shared_types::OkResult, String> {
    crate::storage::store::clear_cached_models(&app, &provider)
        .map_err(|e| capture_err("clear_cached_models", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Sets the cached list of models for a provider.
#[tauri::command]
pub async fn set_cached_models(
    app: AppHandle,
    provider: String,
    models: Vec<String>,
) -> Result<shared_types::OkResult, String> {
    crate::storage::store::set_cached_models(&app, &provider, &models)
        .map_err(|e| capture_err("set_cached_models", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Gets the prompt history in reverse chron order.
#[tauri::command]
pub async fn get_prompt_history(app: AppHandle) -> Result<Vec<String>, String> {
    crate::storage::store::get_prompt_history(&app)
        .map_err(|e| capture_err("get_prompt_history", e))
}

/// Adds a prompt to the history.
#[tauri::command]
pub async fn add_to_prompt_history(
    app: AppHandle,
    prompt: String,
) -> Result<shared_types::OkResult, String> {
    crate::storage::store::add_to_prompt_history(&app, &prompt)
        .map_err(|e| capture_err("add_to_prompt_history", e))?;
    Ok(shared_types::OkResult::yes())
}
