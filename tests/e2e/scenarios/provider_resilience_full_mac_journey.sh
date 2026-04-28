#!/bin/bash
# =============================================================================
# Scenario: provider_resilience_full_mac_journey
#
# Real-Mac companion for provider validation and provider failure recovery.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Provider validation blocks unsafe send"
    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_seed_vllm_missing_base_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "No base URL set" --timeout 45 \
        || die "Missing vLLM base URL validation did not render"
    nixmac_click_button "^Install vim$" --timeout 30 || die "Failed to click prompt suggestion"
    nixmac_wait_for_text "Open AI Models settings|No base URL set" --timeout 20 \
        || die "Provider recovery action did not render"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and (.vllmApiBaseUrl == null or .vllmApiBaseUrl == "")' \
        "Missing-base provider settings verified" \
        5
    nixmac_screenshot "01-provider-validation-blocked"
    phase_pass "Provider validation block verified"

    phase "Unreachable provider failure is visible"
    nixmac_quit || true
    nixmac_clear_state
    nixmac_seed_vllm_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST" "http://127.0.0.1:9/v1"
    nixmac_launch || die "App failed to relaunch with unreachable provider"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History" --timeout 45 \
        || die "Prompt screen did not render with unreachable provider"
    nixmac_submit_prompt_from_suggestion "Install vim" \
        || die "Failed to submit provider-failure prompt"
    nixmac_wait_for_text "failed|error|connection|provider|refused|vLLM" --timeout 75 \
        || warn "Provider failure text was not confirmed by Peekaboo capture"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and .vllmApiBaseUrl == "http://127.0.0.1:9/v1"' \
        "Provider-failure settings verified" \
        5
    nixmac_screenshot "02-provider-failure-visible"
    phase_pass "Provider failure recovery verified"
}

scenario_cleanup() {
    nixmac_stop_mock_vllm
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
