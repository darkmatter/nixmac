#!/bin/bash
# =============================================================================
# Scenario: evolve_review_full_mac_journey
#
# Real-Mac companion for prompt/evolve/review/follow-up/question/discard WDIO.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="nix-installed"

source "$E2E_LIB/nixmac_full_mac.sh"

SCENARIO_CONFIG_REPO=""
SCENARIO_HOST=""

scenario_test() {
    phase "Seed mock-provider configured app state"
    nixmac_quit || true
    nixmac_clear_state
    SCENARIO_HOST="$(nixmac_e2e_hostname)"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_start_mock_vllm "add-font.jsonl"
    nixmac_seed_vllm_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST" "$NIXMAC_MOCK_VLLM_BASE_URL"
    nixmac_wait_settings_jq \
        '.evolveProvider == "vllm" and .vllmApiBaseUrl != null and .configDir != null and .hostAttr != null' \
        "Mock vLLM settings seeded" \
        5
    phase_pass "Mock-provider state seeded"

    phase "Prompt suggestion submits to evolve review"
    nixmac_launch || die "App failed to launch"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History" --timeout 45 \
        || die "Prompt screen did not render"
    nixmac_screenshot "01-prompt-ready"
    nixmac_submit_prompt_from_suggestion "Install vim" \
        || die "Failed to submit prompt suggestion"
    nixmac_wait_for_text "JetBrains Mono|jetbrains-mono|Build & Test|Discard|fonts.nix" --timeout 90 \
        || die "Evolve review did not render after prompt"
    nixmac_wait_git_diff_contains "$SCENARIO_CONFIG_REPO" "jetbrains-mono" 90 \
        || die "Generated diff did not contain jetbrains-mono"
    nixmac_screenshot "02-review-jetbrains-mono"
    phase_pass "Initial evolve review verified"

    phase "Follow-up prompt preserves first diff"
    nixmac_set_mock_vllm_files "add-fira-code.jsonl"
    nixmac_submit_prompt_from_suggestion "Add Rectangle app" \
        || die "Failed to submit follow-up prompt"
    nixmac_wait_for_text "Fira Code|fira-code|Programming Fonts|Build & Test|Discard" --timeout 90 \
        || die "Follow-up evolve review did not render"
    nixmac_wait_git_diff_contains "$SCENARIO_CONFIG_REPO" "jetbrains-mono" 90 \
        || die "Follow-up diff lost jetbrains-mono"
    nixmac_wait_git_diff_contains "$SCENARIO_CONFIG_REPO" "fira-code" 90 \
        || die "Follow-up diff did not contain fira-code"
    nixmac_screenshot "03-review-fira-code"
    phase_pass "Follow-up evolve review verified"

    phase "Discard cancellation keeps review state"
    nixmac_click_button "^Discard$" --timeout 30 || die "Failed to open discard confirmation"
    nixmac_wait_for_text "Discard all current changes|Cancel|Discard changes" --timeout 20 \
        || die "Discard confirmation did not render"
    nixmac_screenshot "04-discard-confirmation"
    nixmac_click_button "^Cancel$" --timeout 20 || die "Failed to cancel discard"
    nixmac_wait_for_text "Build & Test|Discard|fira-code|Fira Code" --timeout 30 \
        || die "Review state was not preserved after discard cancel"
    nixmac_screenshot "05-discard-cancelled"
    phase_pass "Discard cancel verified"

    phase "Discard confirmation returns to prompt"
    nixmac_click_button "^Discard$" --timeout 30 || die "Failed to reopen discard confirmation"
    nixmac_wait_for_text "Discard all current changes|Discard changes" --timeout 20 \
        || die "Discard confirmation did not render for confirm path"
    nixmac_click_button "^Discard changes$" --timeout 20 || die "Failed to confirm discard"
    nixmac_wait_for_text "Install vim|Add Rectangle|Describe changes|Settings" --timeout 45 \
        || die "Prompt screen did not return after discard"
    nixmac_screenshot "06-after-discard"
    phase_pass "Discard confirm verified"

    phase "Inline question-answer flow reaches review"
    nixmac_quit || true
    nixmac_clear_state
    rm -rf "$SCENARIO_CONFIG_REPO"
    SCENARIO_CONFIG_REPO="$(nixmac_create_config_repo "$SCENARIO_HOST")"
    nixmac_set_mock_vllm_files "ask-question.jsonl,add-font.jsonl"
    nixmac_seed_vllm_settings "$SCENARIO_CONFIG_REPO" "$SCENARIO_HOST" "$NIXMAC_MOCK_VLLM_BASE_URL"
    nixmac_launch || die "App failed to relaunch for question-answer flow"
    nixmac_wait_for_text "Install vim|Add Rectangle|Settings|History" --timeout 45 \
        || die "Prompt screen did not render for question-answer flow"
    nixmac_submit_prompt_from_suggestion "Install vim" \
        || die "Failed to submit question-answer prompt"
    nixmac_wait_for_text "What question would you like me to ask|question" --timeout 60 \
        || die "Inline question did not render"
    nixmac_screenshot "07-question"
    nixmac_answer_inline_question "Add a programming font" \
        || die "Failed to answer inline question"
    nixmac_wait_for_text "JetBrains Mono|jetbrains-mono|Build & Test|Discard|fonts.nix" --timeout 90 \
        || die "Question-answer flow did not continue to review"
    nixmac_wait_git_diff_contains "$SCENARIO_CONFIG_REPO" "jetbrains-mono" 90 \
        || die "Question-answer diff did not contain jetbrains-mono"
    nixmac_screenshot "08-question-answer-review"
    phase_pass "Question-answer flow verified"
}

scenario_cleanup() {
    nixmac_stop_mock_vllm
    nixmac_quit
    [ -n "$SCENARIO_CONFIG_REPO" ] && rm -rf "$SCENARIO_CONFIG_REPO"
}
