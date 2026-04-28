#!/bin/bash
# =============================================================================
# Scenario: settings_state_full_mac_journey
#
# Real-Mac companion for settings_controls_persistence and settings_provider_change.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Seed configured app state"
    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    NIXMAC_SETTINGS_CONFIG_DIR="$SCENARIO_CONFIG_REPO" \
    NIXMAC_SETTINGS_HOST="$SCENARIO_HOST" \
    NIXMAC_SETTINGS_OPENROUTER_API_KEY="sk-or-existing-openrouter-e2e-key" \
    NIXMAC_SETTINGS_VLLM_BASE_URL="http://127.0.0.1:8000/v1" \
    NIXMAC_SETTINGS_OLLAMA_BASE_URL="http://127.0.0.1:11434" \
    NIXMAC_SETTINGS_VLLM_API_KEY="test-vllm-key" \
    NIXMAC_SETTINGS_EVOLVE_PROVIDER="vllm" \
    NIXMAC_SETTINGS_SUMMARY_PROVIDER="openai" \
    NIXMAC_SETTINGS_SUMMARY_MODEL="openai/gpt-4o-mini" \
    NIXMAC_SETTINGS_MAX_ITERATIONS=25 \
    NIXMAC_SETTINGS_MAX_BUILD_ATTEMPTS=5 \
    NIXMAC_SETTINGS_CONFIRM_BUILD=true \
    NIXMAC_SETTINGS_CONFIRM_CLEAR=true \
    NIXMAC_SETTINGS_CONFIRM_ROLLBACK=true \
    nixmac_write_settings_json
    nixmac_wait_settings_jq \
        '.configDir != null and .hostAttr != null and .openrouterApiKey == "sk-or-existing-openrouter-e2e-key" and .vllmApiBaseUrl == "http://127.0.0.1:8000/v1"' \
        "Initial settings seeded" \
        5
    phase_pass "Configured state seeded"

    phase "Launch settings dialog"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History" --timeout 45 \
        || die "Configured prompt screen did not render"
    nixmac_screenshot "01-configured-prompt"
    nixmac_click_button "^Settings$" --timeout 20 || die "Failed to open settings"
    nixmac_wait_for_text "Settings" --timeout 20 || die "Settings dialog did not open"
    nixmac_screenshot "02-settings-open"
    phase_pass "Settings dialog launched"

    phase "Preferences persist representative toggles"
    nixmac_open_settings_tab "Preferences" "Confirm|Build|Clear / Discard|Rollback" \
        || die "Preferences controls did not render"
    nixmac_screenshot "03-preferences-before"
    nixmac_click_element_matching "Build" --role "switch" --timeout 20 || die "Failed to toggle Build confirmation"
    nixmac_click_element_matching "Clear / Discard|Clear|Discard" --role "switch" --timeout 20 || die "Failed to toggle Clear / Discard confirmation"
    nixmac_click_element_matching "Rollback" --role "switch" --timeout 20 || die "Failed to toggle Rollback confirmation"
    nixmac_wait_settings_jq \
        '.confirmBuild == false and .confirmClear == false and .confirmRollback == false' \
        "Preference toggles persisted to settings.json" \
        10
    nixmac_screenshot "04-preferences-after"
    phase_pass "Preferences persistence verified"

    phase "API Keys state is hydrated from disk"
    nixmac_open_settings_tab "API Keys" "OpenRouter|OpenAI|Ollama|vLLM" \
        || die "API Keys tab did not render provider controls"
    nixmac_wait_settings_jq \
        '.openrouterApiKey == "sk-or-existing-openrouter-e2e-key" and .ollamaApiBaseUrl == "http://127.0.0.1:11434" and .vllmApiBaseUrl == "http://127.0.0.1:8000/v1" and .vllmApiKey == "test-vllm-key"' \
        "API key/base URL settings remained persisted after UI hydration" \
        10
    nixmac_screenshot "05-api-keys"
    phase_pass "API key settings verified"

    phase "AI Models configured state renders"
    nixmac_open_settings_tab "AI Models" "Evolution Model|Summary Model|Max Iterations|Max Build Attempts|vLLM|OpenAI" \
        || die "AI Models tab did not render expected controls"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and .summaryProvider == "openai" and .maxIterations == 25 and .maxBuildAttempts == 5' \
        "AI model settings remained persisted while tab rendered" \
        5
    nixmac_screenshot "06-ai-models"
    phase_pass "AI Models configured state rendered"
}

scenario_cleanup() {
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
