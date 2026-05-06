#!/bin/bash
# =============================================================================
# Scenario: macos_customization_save_rollback_smoke
#
# Focused parity proof for the untracked macOS customizations badge: Add to
# config, Build & Test, Save, and History rollback against a disposable repo.
# =============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/macos_provider_evolve_full_smoke.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/nixmac_managed_badge_proof.sh"

scenario_test() {
    phase "Prepare customization managed-badge fixture"
    scenario_managed_badge_prepare "customization managed-badge"

    scenario_managed_badge_save_rollback \
        "peekabooCustomizationSaveRollback" \
        "Untracked customizations" \
        "untracked customization|untracked Mac customization" \
        "customization" \
        "feat(e2e): import untracked macos customizations"
}

scenario_cleanup() {
    scenario_provider_cleanup
}
