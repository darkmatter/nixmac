#!/bin/bash
# =============================================================================
# Scenario: product_surface_full_mac_smoke
#
# Exercises cross-cutting product surfaces in the shipped app on a real Mac.
# This is adjacent desktop proof for matching WDIO scenarios, not a replay of
# their deterministic assertions.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

assert_nixmac_text() {
    local pattern="$1"
    local description="$2"
    local text
    text=$(nixmac_text)
    if echo "$text" | grep -qiE "$pattern"; then
        pass "$description"
        return 0
    fi

    nixmac_screenshot "missing-$(echo "$description" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-')"
    die "$description not visible"
}

open_settings_tab() {
    local tab="$1"
    local expected="$2"

    nixmac_click_button "^${tab}$" --timeout 20 || die "Failed to open settings tab: $tab"
    nixmac_wait_for_text "$expected" --timeout 20 \
        || die "Settings tab did not render expected text: $tab"
    nixmac_screenshot "settings-${tab// /-}"
    pass "Settings tab rendered: $tab"
}

scenario_test() {
    phase "Launch product surface"
    nixmac_quit || true
    nixmac_clear_state
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "nixmac|System Setup|Configuration|Settings|Browse|Host|Welcome|Report Issue" --timeout 30 \
        || die "First product surface did not render expected nixmac text"
    nixmac_screenshot "01-product-surface"
    phase_pass "Product surface launched"

    phase "Settings surfaces"
    nixmac_click_button "^Settings$" --timeout 20 || die "Failed to open settings"
    nixmac_wait_for_text "Settings" --timeout 20 || die "Settings dialog did not open"
    nixmac_screenshot "02-settings-general"
    assert_nixmac_text "General|Configuration Directory|diagnostics" "Settings General surface"
    open_settings_tab "AI Models" "Evolution|Summary|Limits"
    open_settings_tab "API Keys" "OpenRouter|OpenAI|Ollama|vLLM"
    open_settings_tab "Preferences" "Confirm|Discard|Rollback"
    nixmac_click_button "^Close$" --timeout 20 || die "Failed to close settings"
    phase_pass "Settings surfaces exercised"

    phase "Header feedback surface"
    nixmac_click_button "^Give feedback$" --timeout 20 || die "Failed to open feedback dialog"
    nixmac_wait_for_text "Give feedback" --timeout 20 || die "Feedback dialog did not open"
    assert_nixmac_text "Suggestion|Bug|General|Send Feedback" "Feedback dialog choices"
    nixmac_screenshot "03-feedback"
    nixmac_click_button "^Cancel$" --timeout 20 || die "Failed to close feedback dialog"
    phase_pass "Feedback surface exercised"

    phase "Footer issue-report surface"
    nixmac_click_button "^Report Issue$" --timeout 20 || die "Failed to open issue-report dialog"
    nixmac_wait_for_text "Report an issue" --timeout 20 || die "Issue-report dialog did not open"
    assert_nixmac_text "Describe|Send Report" "Issue-report dialog copy"
    nixmac_screenshot "04-report-issue"
    nixmac_click_button "^Cancel$" --timeout 20 || die "Failed to close issue-report dialog"
    phase_pass "Issue-report surface exercised"

    phase "History surface"
    nixmac_click_button "^History$" --timeout 20 || die "Failed to open history"
    nixmac_wait_for_text "History" --timeout 20 || die "History view did not open"
    nixmac_screenshot "05-history"
    phase_pass "History surface exercised"
}

scenario_cleanup() {
    nixmac_quit
}
