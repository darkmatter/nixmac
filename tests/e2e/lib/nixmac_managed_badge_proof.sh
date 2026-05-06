#!/bin/bash
# Shared helpers for managed-badge save/rollback Peekaboo scenarios.
# This file expects macos_provider_evolve_full_smoke.sh to be sourced first.

scenario_managed_badge_prepare() {
    local fixture_label="$1"

    peekaboo_check
    scenario_create_config_repo
    scenario_start_provider
    nixmac_clear_state
    scenario_seed_settings
    export NIXMAC_E2E_HOMEBREW_BREWS="${NIXMAC_E2E_HOMEBREW_BREWS:-ripgrep}"
    export NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE="${NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE:-1}"
    export NIXMAC_E2E_SYSTEM_DEFAULTS_JSON="${NIXMAC_E2E_SYSTEM_DEFAULTS_JSON:-[{\"nixKey\":\"system.defaults.finder.ShowPathbar\",\"label\":\"Show Finder path bar\",\"category\":\"Finder\",\"currentValue\":\"true\",\"defaultValue\":\"false\"}]}"
    nixmac_pp_set_e2e_launch_env
    export NIXMAC_RECORD_COMPLETIONS=1
    export NIXMAC_COMPLETION_LOG_DIR="$NIXMAC_E2E_COMPLETION_LOG_DIR"
    launchctl setenv NIXMAC_RECORD_COMPLETIONS 1
    launchctl setenv NIXMAC_COMPLETION_LOG_DIR "$NIXMAC_E2E_COMPLETION_LOG_DIR"
    scenario_install_system_mock_shim
    phase_pass "peekabooProviderFixture: Prepared $fixture_label fixture, deterministic HTTP provider, completion logging, and mock rebuild flag"
}

scenario_commit_managed_badge_change() {
    local prefix="$1"
    local commit_message="$2"

    log "Using deterministic commit message for $prefix managed-badge change"
    scenario_click_element "commitMsg|Loading|Commit message|Commit Changes" "textField" 15 \
        || nixmac_pp_click_window_ratio "$prefix commit message input" "0.500" "0.660" \
        || die "Commit message input was not reachable for $prefix"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peekaboo_run paste "$commit_message" >/dev/null 2>&1 \
        || peek_type "$commit_message" \
        || die "Failed to type deterministic commit message for $prefix"
    scenario_wait_for_prompt_value "$commit_message" 15 \
        || die "Deterministic commit message did not populate the Save step for $prefix"

    scenario_click_element "Commit( Changes)?" "button" 30 \
        || die "Commit button was not reachable for $prefix"
    scenario_wait_for_describe_prompt 45 \
        || die "Commit did not return to begin step for $prefix"
}

scenario_assert_repo_committed_clean() {
    local prefix="$1"
    local commit_message="$2"
    local latest_message status_short

    latest_message=$(git -C "$NIXMAC_E2E_CONFIG_REPO" log -1 --pretty=%s)
    status_short=$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)
    if [ "$latest_message" != "$commit_message" ]; then
        nixmac_screenshot "$prefix-unexpected-commit-message"
        die "Expected $prefix commit message '$commit_message', got: $latest_message"
    fi
    if [ -n "$status_short" ]; then
        nixmac_screenshot "$prefix-repo-not-clean-after-commit"
        die "$prefix config repo was not clean after commit: $status_short"
    fi
}

scenario_expected_managed_badge_path_pattern() {
    local prefix="$1"

    if [ "$prefix" = "homebrew" ]; then
        printf '%s\n' '^(\.nixmac/default\.nix|\.nixmac/homebrew/(data\.json|default\.nix|meta\.json)|flake\.nix|modules/darwin/homebrew\.nix|flake-modules/darwin\.nix)$'
    elif [ "$prefix" = "customization" ]; then
        printf '%s\n' '(^|/)system-defaults\.nix$|^flake-modules/darwin\.nix$|^flake\.nix$'
    else
        printf '%s\n' '.+'
    fi
}

scenario_assert_expected_managed_badge_paths() {
    local prefix="$1"
    local badge_label="$2"
    local stage="$3"
    local changed_paths="$4"
    local expected_pattern

    expected_pattern=$(scenario_expected_managed_badge_path_pattern "$prefix")
    if ! printf '%s\n' "$changed_paths" | grep -Eq "$expected_pattern"; then
        nixmac_screenshot "$prefix-$stage-unexpected-paths"
        die "$badge_label $stage did not touch an expected config surface; changed paths: ${changed_paths:-<none>}"
    fi
    if [ "$prefix" = "homebrew" ] && ! printf '%s\n' "$changed_paths" | grep -Eq '^\.nixmac/homebrew/(data\.json|default\.nix|meta\.json)$'; then
        nixmac_screenshot "$prefix-$stage-missing-homebrew-managed-files"
        die "$badge_label $stage did not write the managed Homebrew module files; changed paths: ${changed_paths:-<none>}"
    fi
}

scenario_changed_paths_including_untracked() {
    {
        git -C "$NIXMAC_E2E_CONFIG_REPO" diff --name-only
        git -C "$NIXMAC_E2E_CONFIG_REPO" ls-files --others --exclude-standard
    } | sed '/^$/d' | sort -u
}

scenario_managed_popover_pattern() {
    local prefix="$1"

    if [ "$prefix" = "homebrew" ]; then
        printf '%s\n' "managed-homebrew-popover"
    else
        printf '%s\n' "managed-system-defaults-popover"
    fi
}

scenario_managed_add_button_pattern() {
    local prefix="$1"

    if [ "$prefix" = "homebrew" ]; then
        printf '%s\n' "managed-homebrew-add-to-config|^Add to config$"
    else
        printf '%s\n' "managed-system-defaults-add-to-config|^Add to config$"
    fi
}

scenario_wait_for_managed_popover() {
    local prefix="$1"
    local timeout="${2:-5}"
    local popover_pattern

    popover_pattern=$(scenario_managed_popover_pattern "$prefix")
    scenario_find_element "$popover_pattern" "" "$timeout" >/dev/null 2>&1 \
        || scenario_find_element "^Add to config$" "button" 1 >/dev/null 2>&1
}

scenario_open_managed_badge_popover() {
    local prefix="$1"
    local badge_label="$2"
    local visible_badge_pattern="$3"
    local ratio_x="0.760"
    local ratio_y="0.560"
    local click_query_text="untracked Homebrew"

    if [ "$prefix" = "customization" ]; then
        ratio_x="0.710"
        click_query_text="untracked customization"
    fi

    scenario_wait_for_managed_popover "$prefix" 1 && return 0

    scenario_click_element "$visible_badge_pattern" "button" 5 >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    scenario_click_element_center "$visible_badge_pattern" "button" 3 "$badge_label badge" >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    scenario_cgevent_click_element_center "$visible_badge_pattern" "button" 3 "$badge_label badge" >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    scenario_click_query "$click_query_text" 5000 >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    nixmac_pp_click_window_ratio "$badge_label badge" "$ratio_x" "$ratio_y" >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    nixmac_pp_cgevent_click_window_ratio "$badge_label badge" "$ratio_x" "$ratio_y" >/dev/null 2>&1 || true
    scenario_wait_for_managed_popover "$prefix" 3 && return 0

    return 1
}

scenario_click_managed_add_to_config() {
    local prefix="$1"
    local badge_label="$2"
    local add_button_pattern

    add_button_pattern=$(scenario_managed_add_button_pattern "$prefix")

    scenario_click_element "$add_button_pattern" "button" 10 \
        || scenario_click_element_center "$add_button_pattern" "button" 3 "$badge_label Add to config" \
        || scenario_cgevent_click_element_center "$add_button_pattern" "button" 3 "$badge_label Add to config" \
        || nixmac_pp_system_events_click_button "Add to config" \
        || die "$badge_label Add to config button was not reachable"
}

scenario_restore_managed_badge_baseline() {
    local prefix="$1"
    local deadline

    scenario_restore_baseline_from_history \
        || return 1
    deadline=$(($(date +%s) + 45))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if git -C "$NIXMAC_E2E_CONFIG_REPO" diff --quiet "$NIXMAC_E2E_BASELINE_COMMIT" HEAD -- flake.nix flake.lock \
            && [ -z "$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)" ]; then
            return 0
        fi
        sleep 2
    done

    scenario_log_config_repo_state "$prefix managed restore unresolved"
    return 1
}

scenario_managed_badge_save_rollback() {
    local phase_key="$1"
    local badge_label="$2"
    local badge_pattern="$3"
    local prefix="$4"
    local commit_message="$5"
    local visible_badge_pattern="$badge_pattern"
    local review_changed_paths committed_changed_paths

    if [ "$prefix" = "customization" ]; then
        visible_badge_pattern="[0-9]+ untracked customization|[0-9]+ untracked Mac customization"
    elif [ "$prefix" = "homebrew" ]; then
        visible_badge_pattern="[0-9]+ untracked Homebrew"
    fi

    phase "Launch nixmac for $badge_label proof"
    nixmac_launch || die "App failed to launch"
    scenario_wait_for_text "Describe changes|No base URL set" 45 \
        || die "App shell did not expose prompt for $badge_label proof"
    nixmac_screenshot "01-$prefix-launched"
    phase_pass "peekabooProviderLaunch: App launched for $badge_label proof"

    if ! scenario_wait_for_text "$visible_badge_pattern" 20; then
        nixmac_screenshot "02-$prefix-badge-absent"
        die "$badge_label chip was not visible after deterministic E2E fixture seeding; the suite cannot claim $phase_key coverage from this run"
    fi

    phase "Apply $badge_label to config"
    scenario_open_managed_badge_popover "$prefix" "$badge_label" "$visible_badge_pattern" \
        || die "$badge_label badge was not reachable"
    scenario_wait_for_managed_popover "$prefix" 10 \
        || die "$badge_label popover did not render"
    nixmac_screenshot "02-$prefix-popover"
    if scenario_wait_for_text "Applying changes|Adding" 2; then
        log "$badge_label Add to config was already accepted and is applying"
    else
        scenario_click_managed_add_to_config "$prefix" "$badge_label"
    fi
    scenario_wait_for_text "Ready to test-drive|Build & Test|Discard|Summary|Diff" 90 \
        || die "$badge_label Add to config did not reach Review"
    review_changed_paths=$(scenario_changed_paths_including_untracked)
    if [ -z "$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)" ]; then
        nixmac_screenshot "$prefix-review-no-repo-diff"
        die "$badge_label Add to config reached Review but did not change the disposable repo"
    fi
    scenario_assert_expected_managed_badge_paths "$prefix" "$badge_label" "review" "$review_changed_paths"
    nixmac_screenshot "03-$prefix-review"

    phase "Build and Test $badge_label managed change"
    scenario_build_and_wait_for_commit_step \
        || die "$badge_label Build & Test did not advance to Save/commit step"
    nixmac_screenshot "04-$prefix-save-step-after-build"
    phase_pass "peekabooProviderBuildBoundary: Build & Test advanced to Save step for $badge_label"

    phase "Commit $badge_label managed change"
    scenario_commit_managed_badge_change "$prefix" "$commit_message"
    scenario_assert_repo_committed_clean "$prefix" "$commit_message"
    committed_changed_paths=$(git -C "$NIXMAC_E2E_CONFIG_REPO" diff --name-only "$NIXMAC_E2E_BASELINE_COMMIT"..HEAD)
    scenario_assert_expected_managed_badge_paths "$prefix" "$badge_label" "commit" "$committed_changed_paths"
    nixmac_screenshot "05-$prefix-returned-to-describe"
    phase_pass "peekabooProviderSaveFlow: $badge_label Save step committed changes and returned to Describe"

    phase "Restore $badge_label baseline from History"
    scenario_restore_managed_badge_baseline "$prefix" \
        || die "$badge_label History restore did not return disposable config repo to baseline"
    phase_pass "$phase_key: $badge_label Add to config was built, committed, and rolled back to the disposable baseline"

    phase "Audit $badge_label managed-badge evidence"
    mkdir -p "$E2E_DIAGNOSTIC_DIR/provider"
    cp "$NIXMAC_E2E_PROVIDER_LOG" "$E2E_DIAGNOSTIC_DIR/provider/requests.jsonl" 2>/dev/null || true
    phase_pass "peekabooProviderAudit: Preserved provider/request evidence for $badge_label managed-badge proof"
}
