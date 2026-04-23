#!/bin/bash
# =============================================================================
# Scenario: install_nix_clean_machine
#
# Canonical wrapper around the existing nix-install flow.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="clean-machine"

scenario_test() {
    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Click Install Nix button"
    nixmac_click_install || die "Failed to click Install button"
    phase_pass "Install button clicked"

    phase "Wait for .pkg download"
    nixmac_wait_for_download 300 || die "Download failed or timed out"
    nixmac_screenshot "04-installer-opened"
    phase_pass "Download complete"

    phase "Install Determinate Nix .pkg"
    nixmac_handle_pkg_install || die "Package installation failed"
    phase_pass "Nix installed"

    phase "App detects Nix"
    nixmac_wait_for_detection 60
    phase_pass "App detected Nix"

    phase "Wait for darwin-rebuild prefetch"
    nixmac_wait_for_prefetch 300 || die "Prefetch timed out"
    phase_pass "Prefetch complete"

    phase "Final verification"
    nix_verify || die "Nix binary not functional"
    nixmac_screenshot "13-final"
    phase_pass "All verifications passed"
}

scenario_cleanup() {
    :
}
