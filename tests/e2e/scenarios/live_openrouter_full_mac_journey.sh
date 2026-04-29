#!/bin/bash
# =============================================================================
# Scenario: live_openrouter_full_mac_journey
#
# Real-Mac companion for live_openrouter_evolve_smoke.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Seed live OpenRouter settings"
    local api_key="${NIXMAC_E2E_OPENROUTER_API_KEY:-}"
    local model="${NIXMAC_E2E_OPENROUTER_MODEL:-openai/gpt-4.1}"
    local summary_model="${NIXMAC_E2E_OPENROUTER_SUMMARY_MODEL:-openai/gpt-4o-mini}"
    [ -n "$api_key" ] || die "NIXMAC_E2E_OPENROUTER_API_KEY is required for live OpenRouter full-Mac scenario"

    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_seed_openrouter_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST" "$api_key" "$model" "$summary_model"
    nixmac_wait_settings_jq \
        '.evolveProvider == "openai" and .openrouterApiKey != null and .configDir != null' \
        "Live OpenRouter settings seeded" \
        5
    phase_pass "Live provider settings seeded"

    phase "Submit live OpenRouter evolve prompt"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History" --timeout 45 \
        || die "Prompt screen did not render"
    nixmac_screenshot "01-live-prompt"
    nixmac_type_prompt_and_submit "In flake.nix, add pkgs.jq next to pkgs.vim in environment.systemPackages." \
        || die "Failed to submit live OpenRouter prompt"
    nixmac_wait_for_text "Build & Test|Discard|pkgs.jq" --timeout 240 \
        || die "Live OpenRouter prompt did not reach review"
    nixmac_wait_git_diff_contains "$SCENARIO_CONFIG_REPO" "pkgs.jq" 240 \
        || die "Live OpenRouter diff did not contain pkgs.jq"
    nixmac_screenshot "02-live-review"
    phase_pass "Live OpenRouter review verified"
}

scenario_cleanup() {
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
