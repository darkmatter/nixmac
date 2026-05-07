#!/bin/bash
# =============================================================================
# Scenario: macos_homebrew_save_rollback_smoke
#
# Focused parity proof for the untracked Homebrew badge: Add to config,
# Build & Test, Save, and History rollback against a disposable config repo.
# =============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/macos_provider_evolve_full_smoke.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/nixmac_managed_badge_proof.sh"

scenario_test() {
    phase "Prepare Homebrew managed-badge fixture"
    scenario_managed_badge_prepare "Homebrew managed-badge"

    scenario_managed_badge_save_rollback \
        "peekabooHomebrewSaveRollback" \
        "Untracked Homebrew items" \
        "untracked Homebrew" \
        "homebrew" \
        "feat(e2e): import untracked homebrew items"
}

scenario_cleanup() {
    scenario_provider_cleanup
}
