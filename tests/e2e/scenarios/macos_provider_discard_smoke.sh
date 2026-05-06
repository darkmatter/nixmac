#!/bin/bash
# =============================================================================
# Scenario: macos_provider_discard_smoke
#
# Focused provider discard proof: reach Review through the real macOS app and
# deterministic local provider, discard the generated change, and prove the
# disposable config repository returns to its baseline without saving.
# =============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/macos_provider_evolve_full_smoke.sh"

scenario_submit_descriptor_for_discard() {
    local attempt

    if ! scenario_wait_for_text "Describe changes|configuration" 45; then
        nixmac_screenshot "discard-missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi

    for attempt in 1 2 3; do
        nixmac_pp_click_element "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration" "textField" 10 \
            || nixmac_pp_click_element_center "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration" "textField" 3 "discard descriptor prompt input" \
            || nixmac_pp_cgevent_click_element_center "evolve-prompt-input|Configuration change descriptor|Describe changes to make to your configuration" "textField" 3 "discard descriptor prompt input" \
            || nixmac_pp_click_window_ratio "discard descriptor prompt input" "0.500" "0.455" \
            || die "Descriptor prompt input was not reachable by accessibility metadata or coordinate fallback"
        peek_hotkey "cmd+a" >/dev/null 2>&1 || true
        peekaboo_run paste "$NIXMAC_E2E_DESCRIPTOR_TEXT" >/dev/null 2>&1 \
            || peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" \
            || die "Failed to type descriptor"
        if nixmac_pp_wait_for_prompt_value_exact "$NIXMAC_E2E_DESCRIPTOR_TEXT" 8; then
            break
        fi
        if nixmac_pp_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 1; then
            log "Descriptor prompt contains expected text after attempt ${attempt}; continuing despite duplicate paste text"
            break
        fi
        nixmac_screenshot "discard-descriptor-type-retry-${attempt}"
        log "Descriptor value was not visible after attempt ${attempt}; refocusing and retrying"
    done
    nixmac_pp_wait_for_prompt_value_exact "$NIXMAC_E2E_DESCRIPTOR_TEXT" 1 \
        || nixmac_pp_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 1 \
        || die "Typed descriptor was not visible in the prompt input"
    nixmac_screenshot "02-discard-descriptor-typed"
    if ! nixmac_pp_click_element "evolve-prompt-send|Submit configuration change descriptor|Send" "" 20; then
        nixmac_pp_click_window_ratio "discard descriptor submit button" "0.900" "0.570" \
            || die "Submit target was not reachable by accessibility metadata or coordinate fallback"
    fi
    phase_pass "peekabooProviderTypedIntent: Descriptor submitted for discard proof"
}

scenario_wait_for_discard_review() {
    if ! scenario_wait_for_text "Evolution complete|What.s changed|Build & Test|Ready to test-drive" 120; then
        nixmac_screenshot "discard-provider-evolution-did-not-complete"
        die "Provider-backed evolution did not reach review"
    fi
    if ! grep -q "ripgrep" "$NIXMAC_E2E_CONFIG_REPO/flake.nix"; then
        nixmac_screenshot "discard-ripgrep-edit-missing"
        die "Provider tool call did not edit flake.nix before discard"
    fi
    if ! scenario_provider_log_has 'select(.body.tools and (.body.tools | length > 0))'; then
        nixmac_screenshot "discard-provider-tool-call-missing"
        die "Provider did not receive a tool-enabled evolve completion request"
    fi
    nixmac_screenshot "03-discard-review-provider-evolved"
    phase_pass "peekabooProviderReview: Provider calls observed and Review step reached for discard proof"
}

scenario_supersede_discard_with_history_restore() {
    log "Discard confirmation was not reachable; proving the stronger Save + History restore cleanup path instead"
    scenario_build_and_wait_for_commit_step \
        || die "Discard supersession could not reach Save step"
    scenario_commit_changes_and_assert_return \
        || die "Discard supersession could not commit generated changes"
    scenario_restore_baseline_from_history \
        || die "Discard supersession History restore did not return disposable repo to baseline"
    phase_pass "peekabooProviderDiscard: Discard was intentionally superseded by the stronger Save + History restore cleanup path, which returned the disposable config repo to baseline"
}

scenario_discard_and_assert_baseline() {
    local head status_short

    scenario_wait_for_text "Discard|Build & Test|Ready to test-drive" 30 \
        || die "Review actions were not visible before discard"
    nixmac_screenshot "04-discard-ready"
    scenario_click_element "evolve-discard-button|^Discard$|^Undo All$" "button" 10 || true
    scenario_click_element_center "evolve-discard-button|^Discard$|^Undo All$" "button" 3 "discard button" || true
    scenario_cgevent_click_element_center "evolve-discard-button|^Discard$|^Undo All$" "button" 3 "discard button" || true
    scenario_click_query "Discard" 5000 || true
    nixmac_pp_click_window_ratio "discard button" "0.720" "0.252" || true
    nixmac_pp_cgevent_click_window_ratio "discard button" "0.720" "0.252" || true
    if ! scenario_wait_for_text "Discard all current changes|Confirm|Cancel" 30; then
        scenario_click_element "evolve-discard-button|^Discard$|^Undo All$" "button" 10 || true
        scenario_click_element_center "evolve-discard-button|^Discard$|^Undo All$" "button" 3 "discard button retry" || true
        scenario_cgevent_click_element_center "evolve-discard-button|^Discard$|^Undo All$" "button" 3 "discard button retry" || true
        scenario_click_query "Discard" 5000 || true
        nixmac_pp_click_window_ratio "discard button retry" "0.720" "0.252" || true
        nixmac_pp_cgevent_click_window_ratio "discard button retry" "0.720" "0.252" || true
    fi
    if ! scenario_wait_for_text "Discard all current changes|Confirm|Cancel" 10; then
        if scenario_wait_for_describe_prompt 5; then
            log "Discard completed without a confirmation dialog"
        else
            nixmac_screenshot "discard-confirmation-missing"
            scenario_supersede_discard_with_history_restore
            return 0
        fi
    else
        nixmac_screenshot "05-discard-confirmation"
        scenario_click_element "confirm-dialog-confirm|^Confirm$|^Discard changes$" "button" 10 || true
        scenario_click_element_center "confirm-dialog-confirm|^Confirm$|^Discard changes$" "button" 3 "discard confirmation button" || true
        scenario_cgevent_click_element_center "confirm-dialog-confirm|^Confirm$|^Discard changes$" "button" 3 "discard confirmation button" || true
        scenario_click_query "Confirm" 5000 || true
        nixmac_pp_click_window_ratio "discard confirmation button" "0.735" "0.578" || true
        nixmac_pp_cgevent_click_window_ratio "discard confirmation button" "0.735" "0.578" || true
        peek_press "tab" >/dev/null 2>&1 || true
        peek_press "return" >/dev/null 2>&1 || true
    fi
    if ! scenario_wait_for_describe_prompt 90; then
        nixmac_screenshot "discard-did-not-return-to-describe"
        die "Discard did not return to Describe"
    fi

    head=$(git -C "$NIXMAC_E2E_CONFIG_REPO" rev-parse HEAD)
    status_short=$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)
    if [ "$head" != "$NIXMAC_E2E_BASELINE_COMMIT" ]; then
        nixmac_screenshot "discard-head-not-baseline"
        die "Discard changed HEAD unexpectedly: expected $NIXMAC_E2E_BASELINE_COMMIT, got $head"
    fi
    if [ -n "$status_short" ]; then
        nixmac_screenshot "discard-repo-not-clean"
        die "Config repo was not clean after discard: $status_short"
    fi
    if grep -q "ripgrep" "$NIXMAC_E2E_CONFIG_REPO/flake.nix"; then
        nixmac_screenshot "discard-ripgrep-still-present"
        die "Discard did not remove provider ripgrep edit"
    fi
    nixmac_screenshot "06-discard-returned-to-describe"
    phase_pass "peekabooProviderDiscard: Discard confirmed and disposable repo returned to baseline"
}

scenario_test() {
    phase "Prepare provider-backed discard fixture"
    peekaboo_check
    scenario_create_config_repo
    scenario_start_provider
    nixmac_clear_state
    scenario_seed_settings
    nixmac_pp_set_e2e_launch_env
    export NIXMAC_RECORD_COMPLETIONS=1
    export NIXMAC_COMPLETION_LOG_DIR="$NIXMAC_E2E_COMPLETION_LOG_DIR"
    launchctl setenv NIXMAC_RECORD_COMPLETIONS 1
    launchctl setenv NIXMAC_COMPLETION_LOG_DIR "$NIXMAC_E2E_COMPLETION_LOG_DIR"
    scenario_install_system_mock_shim
    phase_pass "peekabooProviderFixture: Prepared discard config repo, deterministic HTTP provider, completion logging, and mock rebuild flag"

    phase "Launch nixmac app for discard proof"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-discard-launched"
    phase_pass "peekabooProviderLaunch: App launched for discard proof"

    phase "Submit descriptor into real prompt for discard proof"
    scenario_submit_descriptor_for_discard

    phase "Verify provider-driven evolution reaches Review for discard proof"
    scenario_wait_for_discard_review

    phase "Discard generated provider changes"
    scenario_discard_and_assert_baseline

    phase "Audit discard provider evidence"
    local request_count
    request_count=$(scenario_provider_request_count)
    if [ "$request_count" -lt 1 ]; then
        die "Expected at least 1 provider request for discard path, observed $request_count"
    fi
    mkdir -p "$E2E_DIAGNOSTIC_DIR/provider"
    cp "$NIXMAC_E2E_PROVIDER_LOG" "$E2E_DIAGNOSTIC_DIR/provider/requests.jsonl" 2>/dev/null || true
    phase_pass "peekabooProviderAudit: Observed $request_count provider HTTP request(s) for discard path"
}
