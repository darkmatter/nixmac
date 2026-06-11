use super::helpers::capture_err;
use super::helpers::wrap_result_and_capture_err;
use crate::commands::debug::TimerGuard;
use crate::shared_types;
use crate::storage::store;
use tauri::AppHandle;

/// Returns all UI preferences.
#[tauri::command]
pub async fn ui_get_prefs(app: AppHandle) -> Result<shared_types::UiPrefs, String> {
    let _timer = TimerGuard::new("ui_get_prefs");

    let openrouter_api_key = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_effective_openrouter_api_key(&app),
    )?;
    let openai_api_key =
        wrap_result_and_capture_err("ui_get_prefs", store::get_effective_openai_api_key(&app))?;
    let send_diagnostics =
        wrap_result_and_capture_err("ui_get_prefs", store::get_send_diagnostics(&app))?;

    let evolve_provider =
        wrap_result_and_capture_err("ui_get_prefs", store::get_evolve_provider(&app))?;
    let evolve_model = wrap_result_and_capture_err("ui_get_prefs", store::get_evolve_model(&app))?;
    let summary_provider =
        wrap_result_and_capture_err("ui_get_prefs", store::get_summary_provider(&app))?;
    let summary_model =
        wrap_result_and_capture_err("ui_get_prefs", store::get_summary_model(&app))?;

    let max_iterations =
        Some(store::get_max_iterations(&app).unwrap_or(store::DEFAULT_MAX_ITERATIONS));
    let max_token_budget =
        Some(store::get_max_token_budget(&app).unwrap_or(store::DEFAULT_MAX_TOKEN_BUDGET));
    let max_build_attempts = Some(store::get_max_build_attempts(&app).unwrap_or(5));
    let max_output_tokens =
        Some(store::get_max_output_tokens(&app).unwrap_or(store::DEFAULT_MAX_OUTPUT_TOKENS));
    let ollama_api_base_url: Option<String> =
        wrap_result_and_capture_err("ui_get_prefs", store::get_ollama_api_base_url(&app))?;
    let vllm_api_base_url: Option<String> =
        wrap_result_and_capture_err("ui_get_prefs", store::get_vllm_api_base_url(&app))?;
    let vllm_api_key =
        wrap_result_and_capture_err("ui_get_prefs", store::get_effective_vllm_api_key(&app))?;

    let confirm_build = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::CONFIRM_BUILD_KEY, true),
    )?;
    let confirm_clear = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::CONFIRM_CLEAR_KEY, true),
    )?;
    let confirm_rollback = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::CONFIRM_ROLLBACK_KEY, true),
    )?;
    let auto_summarize_on_focus = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::AUTO_SUMMARIZE_ON_FOCUS_KEY, false),
    )?;
    let scan_homebrew_on_startup = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::SCAN_HOMEBREW_ON_STARTUP_KEY, true),
    )?;
    let default_to_diff_tab = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::DEFAULT_TO_DIFF_TAB_KEY, false),
    )?;
    let experimental_spinning_mascot = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::EXPERIMENTAL_SPINNING_MASCOT_KEY, false),
    )?;
    let developer_mode = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_bool_pref(&app, store::DEVELOPER_MODE_KEY, false),
    )?;
    let pinned_version = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_string_pref_public(&app, store::PINNED_VERSION_KEY),
    )?;
    let update_channel = wrap_result_and_capture_err(
        "ui_get_prefs",
        store::get_json_pref_or(
            &app,
            store::UPDATE_CHANNEL_KEY,
            shared_types::UpdateChannel::default(),
        ),
    )?;

    Ok(shared_types::UiPrefs {
        openrouter_api_key,
        openai_api_key,

        evolve_provider,
        evolve_model,
        summary_provider,
        summary_model,

        max_iterations,
        max_token_budget,
        max_build_attempts,
        max_output_tokens,

        ollama_api_base_url,
        vllm_api_base_url,
        vllm_api_key,
        send_diagnostics,

        confirm_build,
        confirm_clear,
        confirm_rollback,
        auto_summarize_on_focus,
        scan_homebrew_on_startup,
        default_to_diff_tab,
        experimental_spinning_mascot,
        developer_mode,
        pinned_version,
        update_channel,
    })
}

/// Updates UI preferences from a typed partial update object.
#[tauri::command]
pub async fn ui_set_prefs(
    app: AppHandle,
    prefs: shared_types::UiPrefsUpdate,
) -> Result<shared_types::OkResult, String> {
    if let Some(openrouter_api_key) = prefs.openrouter_api_key {
        store::set_openrouter_api_key(&app, &openrouter_api_key)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(openai_api_key) = prefs.openai_api_key {
        store::set_openai_api_key(&app, &openai_api_key)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(evolve_provider) = prefs.evolve_provider {
        store::set_evolve_provider(&app, &evolve_provider)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(evolve_model) = prefs.evolve_model {
        store::set_evolve_model(&app, &evolve_model).map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(summary_provider) = prefs.summary_provider {
        store::set_summary_provider(&app, &summary_provider)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(summary_model) = prefs.summary_model {
        store::set_summary_model(&app, &summary_model)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_iterations) = prefs.max_iterations {
        store::set_max_iterations(&app, max_iterations)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_token_budget) = prefs.max_token_budget {
        store::set_max_token_budget(&app, max_token_budget)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_build_attempts) = prefs.max_build_attempts {
        store::set_max_build_attempts(&app, max_build_attempts)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(max_output_tokens) = prefs.max_output_tokens {
        store::set_max_output_tokens(&app, max_output_tokens)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(ollama_api_base_url) = prefs.ollama_api_base_url {
        store::set_ollama_api_base_url(&app, &ollama_api_base_url)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(vllm_api_base_url) = prefs.vllm_api_base_url {
        store::set_vllm_api_base_url(&app, &vllm_api_base_url)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(vllm_api_key) = prefs.vllm_api_key {
        store::set_vllm_api_key(&app, &vllm_api_key).map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(send_diagnostics) = prefs.send_diagnostics {
        store::set_send_diagnostics(&app, send_diagnostics)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_build) = prefs.confirm_build {
        store::set_bool_pref(&app, store::CONFIRM_BUILD_KEY, confirm_build)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_clear) = prefs.confirm_clear {
        store::set_bool_pref(&app, store::CONFIRM_CLEAR_KEY, confirm_clear)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(confirm_rollback) = prefs.confirm_rollback {
        store::set_bool_pref(&app, store::CONFIRM_ROLLBACK_KEY, confirm_rollback)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(auto_summarize_on_focus) = prefs.auto_summarize_on_focus {
        store::set_bool_pref(
            &app,
            store::AUTO_SUMMARIZE_ON_FOCUS_KEY,
            auto_summarize_on_focus,
        )
        .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(scan_homebrew_on_startup) = prefs.scan_homebrew_on_startup {
        store::set_bool_pref(
            &app,
            store::SCAN_HOMEBREW_ON_STARTUP_KEY,
            scan_homebrew_on_startup,
        )
        .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(default_to_diff_tab) = prefs.default_to_diff_tab {
        store::set_bool_pref(&app, store::DEFAULT_TO_DIFF_TAB_KEY, default_to_diff_tab)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(experimental_spinning_mascot) = prefs.experimental_spinning_mascot {
        store::set_bool_pref(
            &app,
            store::EXPERIMENTAL_SPINNING_MASCOT_KEY,
            experimental_spinning_mascot,
        )
        .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    if let Some(developer_mode) = prefs.developer_mode {
        store::set_bool_pref(&app, store::DEVELOPER_MODE_KEY, developer_mode)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }
    // pinnedVersion: None → not sent; Some(None) → clear; Some(Some(s)) → set.
    if let Some(pinned_version_opt) = prefs.pinned_version {
        match pinned_version_opt {
            None => {
                store::delete_pref(&app, store::PINNED_VERSION_KEY)
                    .map_err(|e| capture_err("ui_set_prefs", e))?;
            }
            Some(s) => {
                store::set_string_pref(&app, store::PINNED_VERSION_KEY, &s)
                    .map_err(|e| capture_err("ui_set_prefs", e))?;
            }
        }
    }
    if let Some(update_channel) = prefs.update_channel {
        store::set_json_pref(&app, store::UPDATE_CHANNEL_KEY, &update_channel)
            .map_err(|e| capture_err("ui_set_prefs", e))?;
    }

    Ok(shared_types::OkResult::yes())
}

/// Gets the cached list of models for a provider.
#[tauri::command]
pub async fn get_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<Option<Vec<String>>, String> {
    store::get_cached_models(&app, &provider).map_err(|e| capture_err("get_cached_models", e))
}

/// Clears the cached models for a provider.
#[tauri::command]
pub async fn clear_cached_models(
    app: AppHandle,
    provider: String,
) -> Result<shared_types::OkResult, String> {
    store::clear_cached_models(&app, &provider)
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
    store::set_cached_models(&app, &provider, &models)
        .map_err(|e| capture_err("set_cached_models", e))?;
    Ok(shared_types::OkResult::yes())
}

/// Gets the prompt history in reverse chron order.
#[tauri::command]
pub async fn get_prompt_history(app: AppHandle) -> Result<Vec<String>, String> {
    store::get_prompt_history(&app).map_err(|e| capture_err("get_prompt_history", e))
}

/// Adds a prompt to the history.
#[tauri::command]
pub async fn add_to_prompt_history(
    app: AppHandle,
    prompt: String,
) -> Result<shared_types::OkResult, String> {
    store::add_to_prompt_history(&app, &prompt)
        .map_err(|e| capture_err("add_to_prompt_history", e))?;
    Ok(shared_types::OkResult::yes())
}
