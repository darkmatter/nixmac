#!/bin/bash
# =============================================================================
# Fixture: clean-machine
#
# Ensures Nix is not installed and the app is not running.
# Use as a starting point for install flow tests.
# =============================================================================

fixture_clean_machine() {
    phase "Fixture: Clean machine"
    
    peekaboo_check
    
    # Quit app if running
    if app_is_running "$NIXMAC_APP_NAME"; then
        nixmac_quit
    fi
    
    # Clear app state so it shows install screen on next launch
    nixmac_clear_state
    
    # Ensure Nix is not installed
    nix_ensure_clean
    
    # Verify app exists
    if [ ! -d "$NIXMAC_APP_PATH" ]; then
        die "App not found at $NIXMAC_APP_PATH"
    fi
    pass "App found at $NIXMAC_APP_PATH"
    
    phase_pass "Clean machine ready"
}
