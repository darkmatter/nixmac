#!/bin/bash
# =============================================================================
# Scenario: macos_console_smoke
#
# Focused Console proof. Runs on a fresh app state so modal/dialog window state
# from broader scenarios cannot interfere with the footer Console control.
# =============================================================================

E2E_ADAPTER="nixmac"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/nixmac_product_proof.sh"

NIXMAC_E2E_HOST_ATTR="e2e-host"
NIXMAC_E2E_CONFIG_REPO=""

scenario_capture_and_assert_text() {
    local label="$1"
    local pattern="$2"
    nixmac_pp_redacted_text_snapshot "$label" || return 1
    nixmac_pp_wait_for_text "$pattern" 8
}

scenario_test() {
    phase "Prepare Console fixture"
    peekaboo_check
    nixmac_pp_create_basic_config_repo "nixmac E2E Console smoke fixture"
    nixmac_clear_state
    nixmac_pp_seed_local_validation_settings "$NIXMAC_E2E_CONFIG_REPO" "$NIXMAC_E2E_HOST_ATTR"
    nixmac_pp_set_e2e_launch_env
    phase_pass "peekabooCoreFixture: Prepared deterministic config and local provider-validation settings"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_pp_wait_for_text "Console|Describe changes|No base URL set" 45 \
        || die "App shell did not expose Console footer"
    nixmac_screenshot "01-console-launch"
    phase_pass "peekabooCoreLaunch: App shell rendered before Console proof"

    phase "Prove Console text surface"
    nixmac_pp_click_element "^Console$" "button" 10 \
        || nixmac_pp_click_window_ratio "Console footer button" 0.060 0.980 \
        || die "Console button was not reachable"
    sleep 1
    if ! scenario_capture_and_assert_text "console-text" "Console|No output yet|Debug Info|Debug|Info|Error"; then
        nixmac_screenshot "console-missing"
        die "Console text surface did not render"
    fi
    nixmac_screenshot "02-console-expanded"
    phase_pass "peekabooCoreConsole: Console rendered text evidence with screenshot proof"
}

scenario_cleanup() {
    nixmac_quit
    nixmac_pp_cleanup_common
}
