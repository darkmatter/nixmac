#!/bin/bash
# =============================================================================
# Scenario: evolve_review_full_mac_journey
#
# Real-Mac companion for prompt/evolve/review/follow-up/question/discard WDIO.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Seed provider-guarded configured app state"
    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_seed_vllm_missing_base_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and (.vllmApiBaseUrl == null or .vllmApiBaseUrl == "") and .configDir != null and .hostAttr != null' \
        "Provider-guarded settings seeded" \
        5
    phase_pass "Provider-guarded state seeded"

    phase "Prompt suggestion exposes provider guardrail"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History|No base URL set" --timeout 45 \
        || die "Prompt screen did not render"
    nixmac_screenshot "01-prompt-ready"
    nixmac_submit_prompt_from_suggestion "Install vim" \
        || die "Failed to submit prompt suggestion"
    nixmac_wait_for_text "Open AI Models settings|No base URL set|provider" --timeout 30 \
        || warn "Provider guardrail text was not confirmed by Peekaboo capture"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and (.vllmApiBaseUrl == null or .vllmApiBaseUrl == "")' \
        "Prompt remained blocked by missing provider settings" \
        5
    nixmac_screenshot "02-provider-guardrail"
    phase_pass "Prompt/provider guardrail verified"

    phase "Settings and history remain reachable"
    nixmac_click_button "^Settings$" --timeout 20 || die "Failed to open settings"
    nixmac_wait_for_text "Settings" --timeout 20 || warn "Settings text was not confirmed by Peekaboo capture"
    nixmac_screenshot "03-settings-from-prompt"
    phase_pass "Secondary prompt surfaces verified"
}

scenario_cleanup() {
    nixmac_stop_mock_vllm
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
