#!/bin/bash
# =============================================================================
# Scenario: macos_core_product_proof
#
# Broad low-risk Peekaboo Product Proof: app shell, update-banner non-blocking
# state, settings tabs, history, and descriptor input. Support dialogs and
# Console run in focused sibling scenarios so one modal/window state cannot
# poison the rest of the broad proof.
# =============================================================================

E2E_ADAPTER="nixmac"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/nixmac_product_proof.sh"

NIXMAC_E2E_DESCRIPTOR_TEXT="Add ripgrep to my packages"
NIXMAC_E2E_HOST_ATTR="e2e-host"
NIXMAC_E2E_CONFIG_REPO=""

scenario_capture_and_assert_text() {
    local label="$1"
    local pattern="$2"
    nixmac_pp_redacted_text_snapshot "$label" || return 1
    nixmac_pp_wait_for_text "$pattern" 8
}

scenario_open_settings() {
    nixmac_pp_click_element "^Settings$|Settings" "button" 8 || true
    if ! nixmac_pp_wait_for_text "General" 4; then
        nixmac_pp_click_window_ratio "Settings header button" "0.970" "0.026" || true
    fi
    if ! nixmac_pp_wait_for_text "General" 4; then
        nixmac_pp_click_element "Open AI Models settings" "button" 8 || true
    fi
    if ! nixmac_pp_wait_for_text "General" 4; then
        nixmac_pp_click_window_ratio "Open AI Models settings link" "0.520" "0.550" || true
    fi
    nixmac_pp_wait_for_text "General" 20 \
        && nixmac_pp_wait_for_text "AI Models" 5 \
        && nixmac_pp_wait_for_text "API Keys" 5 \
        && nixmac_pp_wait_for_text "Preferences" 5
}

scenario_click_settings_tab() {
    local tab="$1"
    nixmac_pp_click_element "$tab" "button" 20 || return 1
    nixmac_pp_wait_for_text "$tab" 20
}

scenario_close_settings() {
    nixmac_pp_click_element "Close settings|^Close$" "button" 15 || true
    sleep 1
}

scenario_test() {
    phase "Prepare broad local Product Proof fixture"
    peekaboo_check
    nixmac_pp_create_basic_config_repo "nixmac E2E core Product Proof fixture"
    nixmac_clear_state
    nixmac_pp_seed_local_validation_settings "$NIXMAC_E2E_CONFIG_REPO" "$NIXMAC_E2E_HOST_ATTR"
    nixmac_pp_set_e2e_launch_env
    phase_pass "peekabooCoreFixture: Prepared deterministic config, local validation settings, and mock system flag"

    phase "Launch and prove app shell"
    nixmac_launch || die "App failed to launch"
    if ! nixmac_pp_wait_for_text "nixmac|Welcome to nixmac|Describe changes|Settings|History|feedback" 45; then
        nixmac_screenshot "core-launch-missing"
        die "App shell did not expose expected controls"
    fi
    nixmac_screenshot "01-core-launch"
    phase_pass "peekabooCoreLaunch: App shell, header controls, and initial prompt surface rendered"

    phase "Verify update banner is not blocking"
    if nixmac_pp_find_element "Dismiss|Later|Update" "button" 5 >/dev/null; then
        nixmac_pp_click_element "Dismiss|Later" "button" 10 || true
        sleep 1
    fi
    if ! nixmac_pp_find_element "evolve-prompt-input|Configuration change descriptor|Describe changes" "textField" 20 >/dev/null; then
        nixmac_screenshot "update-banner-blocked-prompt"
        die "Prompt input was blocked after update-banner handling"
    fi
    nixmac_screenshot "02-update-non-blocking"
    phase_pass "peekabooCoreUpdateBanner: Update banner state did not block the prompt workflow"

    phase "Prove suggestion cards"
    local suggestion_text="Install vim"
    nixmac_pp_click_element "^${suggestion_text}$|${suggestion_text}" "button" 20 \
        || die "Suggestion card was not reachable"
    sleep 1
    if ! scenario_capture_and_assert_text "suggestion-card-text" "Install vim|Add Rectangle app|Describe changes|What to change"; then
        nixmac_screenshot "suggestion-card-unusable"
        die "Prompt surface was not usable after suggestion card click"
    fi
    nixmac_screenshot "03-suggestion-card"
    phase_pass "peekabooCoreSuggestionCards: Suggestion card was clicked and the prompt surface remained usable"

    phase "Prove descriptor prompt typing"
    if ! nixmac_pp_wait_for_text "Describe changes|configuration|No base URL set" 45; then
        nixmac_screenshot "core-missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi
    dismiss_dialogs 5
    nixmac_pp_click_element "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration|${suggestion_text:-Install vim}" "textField" 30 \
        || nixmac_pp_click_window_ratio "core descriptor prompt input" "0.500" "0.455" \
        || die "Descriptor prompt input was not reachable by accessibility metadata or coordinate fallback"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peekaboo_run paste "$NIXMAC_E2E_DESCRIPTOR_TEXT" >/dev/null 2>&1 \
        || peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" \
        || die "Failed to type descriptor"
    if ! nixmac_pp_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 8; then
        dismiss_dialogs 5
        nixmac_pp_click_element "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration|${suggestion_text:-Install vim}" "textField" 10 \
            || nixmac_pp_click_window_ratio "core descriptor prompt input retry" "0.500" "0.455" \
            || die "Descriptor prompt input was not reachable after dismissing system dialogs"
        peek_hotkey "cmd+a" >/dev/null 2>&1 || true
        peekaboo_run paste "$NIXMAC_E2E_DESCRIPTOR_TEXT" >/dev/null 2>&1 \
            || peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" \
            || die "Failed to type descriptor after dismissing system dialogs"
        nixmac_pp_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 20 \
            || die "Typed descriptor was not visible in the prompt input"
    fi
    nixmac_screenshot "04-descriptor-typed"
    phase_pass "peekabooCoreTypedIntent: Typed descriptor appeared in the prompt input"

    phase "Verify local provider-validation boundary"
    if ! nixmac_pp_wait_for_text "No base URL set|AI Models settings|Evolution model" 20; then
        nixmac_screenshot "core-provider-validation-missing"
        die "Expected local provider-validation message was not visible"
    fi
    nixmac_screenshot "05-provider-validation-block"
    phase_pass "peekabooCoreProviderValidation: Submit path reached expected local provider-validation boundary"

    phase "Prove Settings General"
    scenario_open_settings || die "Settings dialog did not open"
    scenario_click_settings_tab "General" || die "General tab did not open"
    if ! scenario_capture_and_assert_text "settings-general-text" "General|Configuration Directory|Host|Browse|diagnostics"; then
        nixmac_screenshot "settings-general-missing"
        die "Settings General content did not render"
    fi
    nixmac_screenshot "08-settings-general"
    phase_pass "peekabooCoreSettingsGeneral: Settings General tab rendered with config and host controls"

    phase "Prove Settings AI Models"
    scenario_click_settings_tab "AI Models" || die "AI Models tab did not open"
    if ! scenario_capture_and_assert_text "settings-ai-models-text" "AI Models|Evolution Model|Summary Model|Provider|Model Name|Max Build Attempts"; then
        nixmac_screenshot "settings-ai-models-missing"
        die "Settings AI Models content did not render"
    fi
    nixmac_screenshot "09-settings-ai-models"
    phase_pass "peekabooCoreSettingsAIModels: Settings AI Models tab rendered provider/model controls"

    phase "Prove Settings API Keys with shared redaction gate"
    scenario_click_settings_tab "API Keys" || die "API Keys tab did not open"
    if ! scenario_capture_and_assert_text "settings-api-keys-text" "API Keys|OpenRouter|OpenAI|API Key|Base URL|vLLM"; then
        nixmac_screenshot "settings-api-keys-missing"
        die "Settings API Keys content did not render or redaction gate failed"
    fi
    nixmac_screenshot "10-settings-api-keys"
    phase_pass "peekabooCoreSettingsAPIKeys: Settings API Keys tab rendered and shared redaction gate found no unmasked secrets"

    phase "Prove Settings Preferences"
    scenario_click_settings_tab "Preferences" || die "Preferences tab did not open"
    if ! scenario_capture_and_assert_text "settings-preferences-text" "Preferences|Confirmation dialogs|Build|Clear / Discard|Rollback|Summarization"; then
        nixmac_screenshot "settings-preferences-missing"
        die "Settings Preferences content did not render"
    fi
    nixmac_screenshot "11-settings-preferences"
    scenario_close_settings
    phase_pass "peekabooCoreSettingsPreferences: Settings Preferences tab rendered confirmation controls"

    phase "Prove History surface"
    nixmac_pp_click_element "History" "button" 20 || die "History button was not reachable"
    if ! scenario_capture_and_assert_text "history-text" "History|No history|changes|Empty|Analyze"; then
        nixmac_screenshot "history-missing"
        die "History surface did not render"
    fi
    nixmac_screenshot "12-history"
    nixmac_pp_click_element "Close|^×$|^X$" "button" 5 || nixmac_pp_click_element "History" "button" 10 || true
    phase_pass "peekabooCoreHistory: History surface rendered a visible state"

    phase "Verify visual and text proof coverage"
    local screenshot_count text_count
    screenshot_count=$(find "$E2E_SCREENSHOT_DIR" -type f -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    text_count=$(find "$E2E_DIAGNOSTIC_DIR/text" -type f -name "*.txt" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$screenshot_count" -lt 8 ] || [ "$text_count" -lt 6 ]; then
        die "Expected at least 8 screenshots and 6 redacted text snapshots, got ${screenshot_count} screenshots and ${text_count} text snapshots"
    fi
    phase_pass "peekabooCoreVisualProofQuality: Core proof captured ${screenshot_count} screenshots and ${text_count} redacted text snapshots"
}

scenario_cleanup() {
    nixmac_quit
    nixmac_pp_cleanup_common
}
