#!/bin/bash
# =============================================================================
# Fixture: nix-installed
#
# Ensures Nix is installed and the app has completed setup.
# If Nix isn't present, runs the full install flow as a prerequisite.
# =============================================================================

fixture_nix_installed() {
    phase "Fixture: Nix installed"
    
    peekaboo_check
    
    if nix_is_installed; then
        pass "Nix already installed: $(nix_version)"
        phase_pass "Nix installed (already present)"
        return 0
    fi
    
    # Need to install Nix via the app flow
    log "Nix not present — running install flow as prerequisite..."
    
    if [ ! -d "$NIXMAC_APP_PATH" ]; then
        die "App not found at $NIXMAC_APP_PATH"
    fi
    
    nixmac_launch
    nixmac_wait_for_install_screen 30
    nixmac_click_install
    nixmac_wait_for_download 300
    nixmac_handle_pkg_install
    nixmac_wait_for_detection 60
    nixmac_wait_for_prefetch 300
    
    if nix_is_installed; then
        pass "Nix installed via app flow: $(nix_version)"
        phase_pass "Nix installed (via app)"
    else
        die "Failed to install Nix via app flow"
    fi
}
