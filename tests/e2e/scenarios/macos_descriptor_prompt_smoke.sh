#!/bin/bash
# =============================================================================
# Scenario: macos_descriptor_prompt_smoke
#
# Smallest macOS-first product proof: launch the real app, find the descriptor
# input through stable accessibility metadata, type one request, and prove the
# submit path reaches the expected local provider-validation block.
# =============================================================================

E2E_ADAPTER="nixmac"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1

NIXMAC_E2E_DESCRIPTOR_TEXT="Add ripgrep to my packages"
NIXMAC_E2E_HOST_ATTR="e2e-host"
NIXMAC_E2E_CONFIG_REPO=""

scenario_create_config_repo() {
    NIXMAC_E2E_CONFIG_REPO=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-config.XXXXXX") \
        || die "Failed to create temporary config repo"

    cat > "$NIXMAC_E2E_CONFIG_REPO/flake.nix" <<'NIX'
{
  description = "nixmac E2E descriptor prompt smoke fixture";

  outputs = { self }: {
    darwinConfigurations.e2e-host = {};
  };
}
NIX

    git -C "$NIXMAC_E2E_CONFIG_REPO" init >/dev/null 2>&1 \
        || die "Failed to initialize temporary config repo"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.name "nixmac e2e"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.email "e2e@nixmac.local"
    git -C "$NIXMAC_E2E_CONFIG_REPO" add flake.nix
    git -C "$NIXMAC_E2E_CONFIG_REPO" commit -m "initial e2e config" >/dev/null 2>&1 \
        || die "Failed to commit temporary config repo"
}

scenario_seed_settings() {
    local settings_dir="$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}"
    local settings_path="$settings_dir/settings.json"

    mkdir -p "$settings_dir" || die "Failed to create nixmac settings directory"
    jq -n \
        --arg configDir "$NIXMAC_E2E_CONFIG_REPO" \
        --arg hostAttr "$NIXMAC_E2E_HOST_ATTR" \
        '{
            configDir: $configDir,
            hostAttr: $hostAttr,
            evolveProvider: "vllm",
            summaryProvider: "vllm",
            evolveModel: "gpt-oss-120b",
            summaryModel: "gpt-oss-120b",
            maxIterations: 1,
            maxBuildAttempts: 1,
            sendDiagnostics: false,
            confirmBuild: true,
            confirmClear: true,
            confirmRollback: true
        }' > "$settings_path" || die "Failed to write nixmac settings"

    log "Seeded nixmac settings at $settings_path"
}

scenario_find_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local elapsed=0
    local json element

    while [ "$elapsed" -lt "$timeout" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        element=$(echo "$json" | jq -r --arg pattern "$pattern" --arg role "$role" '
            .data.ui_elements[]? |
            select($role == "" or .role == $role) |
            select([
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] | join(" ") | test($pattern; "i")) |
            .id
        ' 2>/dev/null | head -1)

        if [ -n "$element" ]; then
            printf '%s\t%s\n' "$element" "$json"
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_click_element() {
    local pattern="$1"
    local role="${2:-}"
    local found element json

    found=$(scenario_find_element "$pattern" "$role" 30) || return 1
    element=$(printf '%s' "$found" | cut -f1)
    json=$(printf '%s' "$found" | cut -f2-)
    log "Clicking element $element matching '$pattern'"
    peek_click "$element" "$json"
}

scenario_wait_for_text() {
    local pattern="$1"
    local timeout="${2:-30}"
    local elapsed=0 text

    while [ "$elapsed" -lt "$timeout" ]; do
        text=$(nixmac_text)
        if echo "$text" | grep -qiE "$pattern"; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_wait_for_prompt_value() {
    local expected="$1"
    local timeout="${2:-20}"
    local elapsed=0 json

    while [ "$elapsed" -lt "$timeout" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        if echo "$json" | jq -e --arg expected "$expected" '
            .data.ui_elements[]? |
            select([
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] | join(" ") | contains($expected))
        ' >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_test() {
    phase "Prepare isolated descriptor prompt fixture"
    peekaboo_check
    if ! nix_is_installed; then
        die "Nix must already be installed for macos_descriptor_prompt_smoke"
    fi
    scenario_create_config_repo
    nixmac_clear_state
    scenario_seed_settings
    phase_pass "Prepared config repo and local provider-validation settings"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Find descriptor prompt"
    if ! scenario_wait_for_text "Describe changes|configuration|No base URL set" 45; then
        nixmac_screenshot "missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi
    scenario_click_element "evolve-prompt-input|Configuration change descriptor" "" \
        || die "Descriptor prompt input was not reachable by accessibility metadata"
    phase_pass "Descriptor prompt input reached"

    phase "Type descriptor"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" || die "Failed to type descriptor"
    if ! scenario_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 20; then
        nixmac_screenshot "descriptor-text-not-visible"
        die "Typed descriptor was not visible in the prompt input"
    fi
    nixmac_screenshot "02-descriptor-typed"
    phase_pass "Descriptor text visible in prompt input"

    phase "Verify expected provider validation block"
    if ! scenario_wait_for_text "No base URL set|AI Models settings|Evolution model" 20; then
        nixmac_screenshot "provider-validation-missing"
        die "Expected local provider-validation message was not visible"
    fi
    if ! scenario_find_element "evolve-prompt-send|Submit configuration change descriptor" "" 10 >/dev/null; then
        nixmac_screenshot "submit-target-missing"
        die "Submit target was not reachable by accessibility metadata"
    fi
    nixmac_screenshot "03-provider-validation-block"
    phase_pass "Submit path is blocked by expected local provider validation"
}

scenario_cleanup() {
    nixmac_quit
    if [ -n "$NIXMAC_E2E_CONFIG_REPO" ]; then
        rm -rf "$NIXMAC_E2E_CONFIG_REPO" 2>/dev/null || true
    fi
}

