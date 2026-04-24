#!/bin/bash
# =============================================================================
# Scenario: release_dmg_app_translocation_smoke
#
# Verifies the installed app launches from /Applications and renders a usable
# first screen without App Translocation / updater / startup crashes.
# =============================================================================

E2E_ADAPTER="nixmac"

scenario_test() {
    phase "Fixture: app installed"
    peekaboo_check
    nixmac_clear_state
    if [ ! -d "$NIXMAC_APP_PATH" ]; then
        die "App not found at $NIXMAC_APP_PATH"
    fi
    phase_pass "App installed at $NIXMAC_APP_PATH"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Verify first screen"
    local text
    text=$(nixmac_text)
    if echo "$text" | grep -qiE "install|nix|configuration|settings|browse|host|welcome|get started"; then
        phase_pass "First screen rendered"
    else
        nixmac_screenshot "unexpected-first-screen"
        die "First screen did not contain expected nixmac text"
    fi
}

scenario_cleanup() {
    nixmac_quit
}
