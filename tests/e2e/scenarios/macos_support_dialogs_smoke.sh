#!/bin/bash
# =============================================================================
# Scenario: macos_support_dialogs_smoke
#
# Focused proof for the header Feedback dialog and footer Report Issue dialog.
# Runs independently from the broad core proof because these Radix dialogs and
# macOS window focus interactions are the most sensitive to stale UI state.
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

scenario_close_dialog() {
    nixmac_pp_click_element "^Cancel$" "button" 8 \
        || peek_hotkey "esc" >/dev/null 2>&1 \
        || true
    sleep 1
}

scenario_test() {
    phase "Prepare support dialog fixture"
    peekaboo_check
    nixmac_pp_create_basic_config_repo "nixmac E2E support dialog fixture"
    nixmac_clear_state
    nixmac_pp_seed_local_validation_settings "$NIXMAC_E2E_CONFIG_REPO" "$NIXMAC_E2E_HOST_ATTR"
    nixmac_pp_set_e2e_launch_env
    phase_pass "peekabooCoreFixture: Prepared deterministic config and local provider-validation settings"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_pp_wait_for_ready_app_shell 60 \
        || die "App shell did not expose support controls with visible screenshot signal"
    nixmac_screenshot "01-support-launch"
    phase_pass "peekabooCoreLaunch: App shell rendered before support dialog proof"

    phase "Prove Report Issue dialog"
    nixmac_pp_click_element "Report Issue" "button" 10 \
        || nixmac_pp_click_window_ratio "Report Issue footer button" 0.500 0.935 \
        || die "Report Issue button was not reachable"
    if ! scenario_capture_and_assert_text "report-issue-text" "Report an issue|DESCRIBE WHAT HAPPENED|Send Report|Current app state"; then
        nixmac_pp_click_window_ratio "Report Issue footer button retry" 0.500 0.935 || true
    fi
    if ! scenario_capture_and_assert_text "report-issue-text" "Report an issue|DESCRIBE WHAT HAPPENED|Send Report|Current app state"; then
        nixmac_screenshot "report-issue-missing"
        die "Report Issue dialog did not render"
    fi
    nixmac_screenshot "02-report-issue"
    scenario_close_dialog
    phase_pass "peekabooCoreReportIssue: Report Issue dialog opened and was cancelled without submission"

    phase "Prove Feedback dialog"
    nixmac_pp_click_element "^Give feedback$|Give feedback" "button" 10 \
        || nixmac_pp_click_window_ratio "Give feedback header button" 0.935 0.060 \
        || die "Feedback button was not reachable"
    if ! scenario_capture_and_assert_text "feedback-text" "WHAT WOULD YOU LIKE TO SEE|WHAT'S ON YOUR MIND|Suggestion|Bug|General|Send Feedback"; then
        nixmac_pp_click_window_ratio "Give feedback header button retry" 0.935 0.060 || true
    fi
    if ! scenario_capture_and_assert_text "feedback-text" "WHAT WOULD YOU LIKE TO SEE|WHAT'S ON YOUR MIND|Suggestion|Bug|General|Send Feedback"; then
        nixmac_screenshot "feedback-missing"
        die "Feedback dialog did not render"
    fi
    nixmac_screenshot "03-feedback"
    scenario_close_dialog
    phase_pass "peekabooCoreFeedback: Feedback dialog opened and was cancelled without submission"
}

scenario_cleanup() {
    nixmac_quit
    nixmac_pp_cleanup_common
}
