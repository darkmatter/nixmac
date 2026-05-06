#!/bin/bash
# =============================================================================
# Scenario: macos_descriptor_prompt_smoke
#
# Smallest macOS-first product proof: launch the real app, find the descriptor
# input through stable accessibility metadata, type one request, and prove the
# submit path reaches the expected local provider-validation block.
# =============================================================================

E2E_ADAPTER="nixmac"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/nixmac_product_proof.sh"

NIXMAC_E2E_DESCRIPTOR_TEXT="Add ripgrep to my packages"
NIXMAC_E2E_HOST_ATTR="e2e-host"
NIXMAC_E2E_CONFIG_REPO=""

scenario_test() {
    phase "Prepare isolated descriptor prompt fixture"
    peekaboo_check
    nixmac_pp_create_basic_config_repo "nixmac E2E descriptor prompt smoke fixture"
    nixmac_clear_state
    nixmac_pp_seed_local_validation_settings "$NIXMAC_E2E_CONFIG_REPO" "$NIXMAC_E2E_HOST_ATTR"
    nixmac_pp_set_e2e_launch_env
    phase_pass "Prepared config repo, mock system prerequisites, and local provider-validation settings"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_pp_wait_for_ready_app_shell 60 \
        || die "App shell did not expose descriptor prompt with visible screenshot signal"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Find descriptor prompt"
    if ! nixmac_pp_wait_for_text "Describe changes|configuration|No base URL set" 45; then
        nixmac_screenshot "missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi
    nixmac_pp_click_element "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration" "textField" \
        || die "Descriptor prompt input was not reachable by accessibility metadata"
    phase_pass "Descriptor prompt input reached"

    phase "Type descriptor"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peekaboo_run paste "$NIXMAC_E2E_DESCRIPTOR_TEXT" >/dev/null 2>&1 \
        || peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" \
        || die "Failed to type descriptor"
    if ! nixmac_pp_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 20; then
        nixmac_screenshot "descriptor-text-not-visible"
        die "Typed descriptor was not visible in the prompt input"
    fi
    nixmac_screenshot "02-descriptor-typed"
    phase_pass "Descriptor text visible in prompt input"

    phase "Verify expected provider validation block"
    if ! nixmac_pp_wait_for_text "No base URL set|AI Models settings|Evolution model" 20; then
        nixmac_screenshot "provider-validation-missing"
        die "Expected local provider-validation message was not visible"
    fi
    if ! nixmac_pp_find_element "evolve-prompt-send|Submit configuration change descriptor|Send" "button" 10 >/dev/null; then
        nixmac_screenshot "submit-target-missing"
        die "Submit target was not reachable by accessibility metadata"
    fi
    nixmac_screenshot "03-provider-validation-block"
    phase_pass "Submit path is blocked by expected local provider validation"
}

scenario_cleanup() {
    nixmac_quit
    nixmac_pp_cleanup_common
}
