#!/bin/bash
# =============================================================================
# Scenario: onboarding_settings_contract_full_mac_journey
#
# Real-Mac companion for onboarding_existing_repo. This intentionally verifies
# first-launch setup routing plus the persisted repo/host contract; it does not
# claim native file-picker coverage.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Fresh state shows setup/onboarding"
    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "System Setup|Configuration|Browse|Host|nixmac needs|Get Started" --timeout 45 \
        || die "Fresh state did not show setup/onboarding"
    nixmac_screenshot "01-setup-screen"
    phase_pass "Fresh onboarding screen verified"

    phase "Configured repo/host reaches prompt"
    nixmac_quit || true
    nixmac_clear_state
    NIXMAC_SETTINGS_CONFIG_DIR="$SCENARIO_CONFIG_REPO" \
    NIXMAC_SETTINGS_HOST="$SCENARIO_HOST" \
    NIXMAC_SETTINGS_EVOLVE_PROVIDER="vllm" \
    NIXMAC_SETTINGS_SUMMARY_PROVIDER="vllm" \
    NIXMAC_SETTINGS_VLLM_BASE_URL="http://127.0.0.1:8000/v1" \
    nixmac_write_settings_json
    nixmac_launch || die "App failed to relaunch with configured repo"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History|Describe changes" --timeout 45 \
        || die "Configured app did not reach prompt screen"
    local config_filter host_filter
    config_filter="$(printf '%s' "$SCENARIO_CONFIG_REPO" | jq -Rr @json)"
    host_filter="$(printf '%s' "$SCENARIO_HOST" | jq -Rr @json)"
    nixmac_wait_settings_jq \
        ".configDir == ${config_filter} and .hostAttr == ${host_filter}" \
        "Configured repo and host persisted" \
        10
    nixmac_screenshot "02-configured-prompt"
    phase_pass "Repo/host settings contract verified"
}

scenario_cleanup() {
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
