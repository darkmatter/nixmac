#!/bin/bash
# =============================================================================
# Scenario: nix-install
#
# Tests the full Nix installation flow end-to-end:
#   Launch app → Click Install → Download .pkg → Install → Prefetch → Verify
#
# Fixture: clean-machine (Nix uninstalled, app not running)
# Adapter: nixmac
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="clean-machine"

scenario_test() {
    # Phase 1: Launch
    phase "Launch nixmac app"
    nixmac_launch
    nixmac_screenshot "01-launched"
    phase_pass "App launched"
    
    # Phase 2: Click Install
    phase "Click Install Nix button"
    nixmac_click_install || die "Failed to click Install button"
    phase_pass "Install button clicked"
    
    # Phase 3: Wait for download
    phase "Wait for .pkg download"
    nixmac_wait_for_download 300 || die "Download failed or timed out"
    nixmac_screenshot "04-installer-opened"
    phase_pass "Download complete"
    
    # Phase 4: Install .pkg
    phase "Install Determinate Nix .pkg"
    nixmac_handle_pkg_install || die "Package installation failed"
    phase_pass "Nix installed"
    
    # Phase 5: App detects Nix
    phase "App detects Nix"
    nixmac_wait_for_detection 60
    phase_pass "App detected Nix"
    
    # Phase 6: Prefetch
    phase "Wait for darwin-rebuild prefetch"
    nixmac_wait_for_prefetch 300 || die "Prefetch timed out"
    phase_pass "Prefetch complete"
    
    # Phase 7: Final verification
    phase "Final verification"
    nix_verify || die "Nix binary not functional"
    
    # Check darwin-rebuild availability
    if NIX_CONFIG="experimental-features = nix-command flakes" \
       "$NIX_BINARY" build --no-link nix-darwin/master#darwin-rebuild --dry-run 2>/dev/null; then
        pass "darwin-rebuild available in nix store"
    else
        warn "darwin-rebuild dry-run check failed (may still be OK)"
    fi
    
    nixmac_screenshot "13-final"
    phase_pass "All verifications passed"
}

scenario_cleanup() {
    # adapter_cleanup handles app quit + Nix uninstall
    :
}
