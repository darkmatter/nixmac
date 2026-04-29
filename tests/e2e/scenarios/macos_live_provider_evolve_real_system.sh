#!/bin/bash
# =============================================================================
# Scenario: macos_live_provider_evolve_real_system
#
# No-stub full-Mac provider proof: launch the installed app, call a real
# OpenRouter provider, edit a real nix-darwin flake, run real build_check,
# activate the real system profile, generate the Save-step commit message via
# the provider, and commit the result with 30 fps video proof.
# =============================================================================

# shellcheck disable=SC2034 # Sourced by tests/e2e/lib/runner.sh.
E2E_ADAPTER="nixmac"
E2E_FIXTURE="clean-machine"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1
export E2E_RECORD_MAX_DURATION_SECONDS="${E2E_RECORD_MAX_DURATION_SECONDS:-4500}"

NIXMAC_E2E_DESCRIPTOR_TEXT="Edit flake.nix only. In the top-level environment.systemPackages list, add pkgs.hello on its own line. Use the edit_file tool with the exact file text, run build_check, and do not call done until build_check passes. Do not ask clarifying questions."
NIXMAC_E2E_HOST_ATTR=""
NIXMAC_E2E_CONFIG_REPO=""
NIXMAC_E2E_ELEMENTS_JSON_FILE="${TMPDIR:-/tmp}/nixmac-real-e2e-elements-$$.json"
NIXMAC_E2E_COMPLETION_LOG_DIR=""
NIXMAC_E2E_PREVIOUS_SYSTEM_PATH=""
NIXMAC_E2E_RESTORE_ATTEMPTED=0

scenario_nix() {
    if [ -x "/nix/var/nix/profiles/default/bin/nix" ]; then
        printf '%s\n' "/nix/var/nix/profiles/default/bin/nix"
        return 0
    fi
    command -v nix
}

scenario_darwin_platform() {
    case "$(uname -m)" in
        arm64) printf '%s\n' "aarch64-darwin" ;;
        x86_64) printf '%s\n' "x86_64-darwin" ;;
        *) die "Unsupported macOS architecture for nix-darwin: $(uname -m)" ;;
    esac
}

scenario_host_attr() {
    local host
    host=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
    host="${host:-nixmac-e2e}"
    printf '%s\n' "$host"
}

scenario_current_system_path() {
    local profile="/nix/var/nix/profiles/system"
    [ -e "$profile" ] || return 0
    realpath "$profile" 2>/dev/null \
        || python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$profile" 2>/dev/null \
        || true
}

scenario_sq() {
    printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

scenario_osa() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf "%s" "$value"
}

scenario_create_config_repo() {
    local platform username
    platform=$(scenario_darwin_platform)
    username="${USER:-$(id -un)}"
    NIXMAC_E2E_HOST_ATTR=$(scenario_host_attr)
    NIXMAC_E2E_CONFIG_REPO=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-real-e2e-config.XXXXXX") \
        || die "Failed to create temporary config repo"

    cat > "$NIXMAC_E2E_CONFIG_REPO/flake.nix" <<NIX
{
  description = "nixmac real full-system E2E fixture";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, nix-darwin }: {
    darwinConfigurations."${NIXMAC_E2E_HOST_ATTR}" = nix-darwin.lib.darwinSystem {
      modules = [
        ({ pkgs, ... }: {
          nix.settings.experimental-features = "nix-command flakes";
          nix.enable = false;
          nixpkgs.hostPlatform = "${platform}";
          system.primaryUser = "${username}";
          system.stateVersion = 6;
          environment.systemPackages = [
          ];
        })
      ];
    };
  };
}
NIX

    git -C "$NIXMAC_E2E_CONFIG_REPO" init >/dev/null 2>&1 \
        || die "Failed to initialize temporary config repo"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.name "nixmac e2e"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.email "e2e@nixmac.local"
    git -C "$NIXMAC_E2E_CONFIG_REPO" add flake.nix \
        || die "Failed to stage flake.nix before locking fixture"

    local nix_bin
    nix_bin=$(scenario_nix) || die "Nix is required for real full-system E2E"
    (
        cd "$NIXMAC_E2E_CONFIG_REPO" || exit 1
        NIX_CONFIG="experimental-features = nix-command flakes" \
            "$nix_bin" flake lock --extra-experimental-features "nix-command flakes" \
        --option accept-flake-config true 2>&1 | tee -a "$E2E_LOG_FILE" \
    ) || die "Failed to generate flake.lock for real full-system fixture"

    git -C "$NIXMAC_E2E_CONFIG_REPO" add -A
    git -C "$NIXMAC_E2E_CONFIG_REPO" commit -m "initial real e2e config" >/dev/null 2>&1 \
        || die "Failed to commit temporary config repo"
}

scenario_seed_settings() {
    local settings_dir="$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}"
    local settings_path="$settings_dir/settings.json"
    local openrouter_key="${NIXMAC_E2E_OPENROUTER_API_KEY:-${OPENROUTER_API_KEY:-}}"
    local evolve_model="${NIXMAC_E2E_OPENROUTER_MODEL:-openai/gpt-4.1}"
    local summary_model="${NIXMAC_E2E_OPENROUTER_SUMMARY_MODEL:-openai/gpt-4o-mini}"

    [ -n "$openrouter_key" ] || die "NIXMAC_E2E_OPENROUTER_API_KEY is required for real provider full-Mac E2E"

    NIXMAC_E2E_COMPLETION_LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-real-e2e-completions.XXXXXX") \
        || die "Failed to create completion log dir"

    mkdir -p "$settings_dir" || die "Failed to create nixmac settings directory"
    jq -n \
        --arg configDir "$NIXMAC_E2E_CONFIG_REPO" \
        --arg hostAttr "$NIXMAC_E2E_HOST_ATTR" \
        --arg openrouterApiKey "$openrouter_key" \
        --arg evolveModel "$evolve_model" \
        --arg summaryModel "$summary_model" \
        '{
            configDir: $configDir,
            hostAttr: $hostAttr,
            evolveProvider: "openai",
            summaryProvider: "openai",
            evolveModel: $evolveModel,
            summaryModel: $summaryModel,
            openrouterApiKey: $openrouterApiKey,
            openaiApiKey: "",
            maxIterations: 8,
            maxBuildAttempts: 2,
            sendDiagnostics: false,
            confirmBuild: false,
            confirmClear: true,
            confirmRollback: true
        }' > "$settings_path" || die "Failed to write nixmac settings"

    log "Seeded nixmac settings at $settings_path for real OpenRouter provider"
}

scenario_find_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local deadline json element

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
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
            printf '%s' "$json" > "$NIXMAC_E2E_ELEMENTS_JSON_FILE"
            printf '%s\n' "$element"
            return 0
        fi
        sleep 2
    done
    return 1
}

scenario_click_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local element json

    element=$(scenario_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_E2E_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    log "Clicking element $element matching '$pattern'"
    peek_click "$element" "$json"
}

scenario_wait_for_text() {
    local pattern="$1"
    local timeout="${2:-30}"
    local deadline text

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        text=$(nixmac_text)
        if echo "$text" | grep -qiE "$pattern"; then
            return 0
        fi
        sleep 2
    done
    return 1
}

scenario_wait_for_prompt_value() {
    local expected="$1"
    local timeout="${2:-20}"
    local deadline json

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
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
    done
    return 1
}

scenario_commit_message_value() {
    local json
    json=$(peek_elements "$NIXMAC_APP_NAME")
    echo "$json" | jq -r '
        .data.ui_elements[]? |
        select(.role == "textField") |
        (.value? // "") |
        select(test("^(feat|fix|chore|refactor|docs|style|test|perf)(\\([^)]+\\))?: "; "i")) |
        .
    ' 2>/dev/null | head -1
}

scenario_wait_for_commit_message_value() {
    local timeout="${1:-90}"
    local deadline value

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        value=$(scenario_commit_message_value)
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
        sleep 2
    done
    return 1
}

scenario_completion_count() {
    local prefix="$1"
    find "$NIXMAC_E2E_COMPLETION_LOG_DIR" -name "${prefix}_*.jsonl" -type f -exec cat {} + 2>/dev/null \
        | jq -R 'select(length > 0)' 2>/dev/null \
        | wc -l \
        | tr -d ' '
}

scenario_latest_darwin_log() {
    find "$HOME/Library/Logs/nixmac" -name "darwin-rebuild_*.log" -type f -exec stat -f "%m %N" {} + 2>/dev/null \
        | sort -rn \
        | head -1 \
        | cut -d' ' -f2-
}

scenario_install_nix_with_app() {
    phase "Install Nix through the real app flow"
    nixmac_launch || die "App failed to launch for Nix install"
    nixmac_wait_for_install_screen 45 || die "Install screen did not become visible"
    nixmac_click_install || die "Failed to click Install Nix"
    nixmac_wait_for_download 300 || die "Nix installer download failed or timed out"
    nixmac_handle_pkg_install || die "Package installation failed"
    nixmac_wait_for_detection 90 || die "App did not detect Nix after installation"
    nixmac_wait_for_prefetch 420 || die "darwin-rebuild prefetch timed out"
    nix_verify || die "Nix binary not functional after app install flow"
    nixmac_screenshot "00-nix-installed-through-app"
    phase_pass "Nix installed and detected through the shipped app"
}

scenario_build_and_wait_for_commit_step() {
    scenario_click_element "Build & Test" "button" 45 \
        || die "Build & Test button was not reachable"

    if scenario_wait_for_text "Requesting admin privileges|darwin-rebuild build|All changes active|Commit Changes" 60; then
        nixmac_screenshot "04-real-build-started"
    fi

    scenario_wait_for_text "All changes active|Commit Changes" 900
}

scenario_restore_previous_system() {
    [ "$NIXMAC_E2E_RESTORE_ATTEMPTED" = "1" ] && return 0
    if [ -z "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ]; then
        log "No previous system profile existed before this run; uninstalling test Nix install"
        nix_uninstall || return 1
        NIXMAC_E2E_RESTORE_ATTEMPTED=1
        return 0
    fi
    [ -x "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH/activate" ] || {
        warn "Previous system profile has no activate script: $NIXMAC_E2E_PREVIOUS_SYSTEM_PATH"
        return 1
    }

    local current
    current=$(scenario_current_system_path)
    [ "$current" != "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ] || return 0

    log "Restoring previous system profile: $NIXMAC_E2E_PREVIOUS_SYSTEM_PATH"
    local nix_env admin_password restore_script escaped_script osascript_cmd user_name user_id nix_path prev_path
    nix_env="/nix/var/nix/profiles/default/bin/nix-env"
    [ -x "$nix_env" ] || nix_env=$(command -v nix-env 2>/dev/null || true)
    [ -n "$nix_env" ] || {
        warn "nix-env not found; cannot restore previous system profile"
        return 1
    }

    admin_password="${NIXMAC_E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
    user_name="${USER:-$(id -un)}"
    user_id="$(id -u "$user_name")"
    nix_path="/opt/homebrew/bin:/nix/var/nix/profiles/default/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    prev_path="$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH"

    if [ -n "$admin_password" ]; then
        restore_script=$(cat <<SH
set -e
ACTIVATE='$(scenario_sq "$prev_path/activate")'
NIX_ENV='$(scenario_sq "$nix_env")'
USER_NAME='$(scenario_sq "$user_name")'
USER_ID='$(scenario_sq "$user_id")'
trap 'rm -f /etc/sudoers.d/nixmac-e2e-restore-temp' EXIT
printf '%s ALL=(ALL) NOPASSWD: %s\\n' "\$USER_NAME" "\$ACTIVATE" > /etc/sudoers.d/nixmac-e2e-restore-temp
chmod 440 /etc/sudoers.d/nixmac-e2e-restore-temp
visudo -cf /etc/sudoers.d/nixmac-e2e-restore-temp >/dev/null
export PATH='$(scenario_sq "$nix_path")'
launchctl asuser "\$USER_ID" sudo -E -n "\$ACTIVATE" 2>&1
"\$NIX_ENV" -p /nix/var/nix/profiles/system --set '$(scenario_sq "$prev_path")'
SH
)
        escaped_script=$(scenario_osa "$restore_script")
        osascript_cmd="do shell script \"$escaped_script\" user name \"$(scenario_osa "$user_name")\" password \"$(scenario_osa "$admin_password")\" with administrator privileges"
        osascript -e "$osascript_cmd" 2>&1 | tee -a "$E2E_LOG_FILE" || {
            warn "Primary previous-profile activation failed; trying nix-env system rollback fallback"
            scenario_restore_previous_system_rollback "$nix_env" || return 1
        }
    else
        sudo -n "$prev_path/activate" 2>&1 | tee -a "$E2E_LOG_FILE" || {
            warn "Primary previous-profile activation failed; trying nix-env system rollback fallback"
            scenario_restore_previous_system_rollback "$nix_env" || return 1
        }
        sudo -n "$nix_env" -p /nix/var/nix/profiles/system --set "$prev_path" 2>&1 | tee -a "$E2E_LOG_FILE" || return 1
    fi

    current=$(scenario_current_system_path)
    if [ "$current" = "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ]; then
        NIXMAC_E2E_RESTORE_ATTEMPTED=1
        return 0
    fi
    return 1
}

scenario_restore_previous_system_rollback() {
    local nix_env="$1"
    [ -n "$nix_env" ] || return 1

    local admin_password user_name rollback_script escaped_script osascript_cmd
    admin_password="${NIXMAC_E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
    user_name="${USER:-$(id -un)}"

    if [ -n "$admin_password" ]; then
        rollback_script=$(cat <<SH
set -e
NIX_ENV='$(scenario_sq "$nix_env")'
"\$NIX_ENV" -p /nix/var/nix/profiles/system --rollback
CURRENT=\$(/usr/bin/realpath /nix/var/nix/profiles/system 2>/dev/null || python3 -c 'import os; print(os.path.realpath("/nix/var/nix/profiles/system"))')
test -x "\$CURRENT/activate"
"\$CURRENT/activate" 2>&1
SH
)
        escaped_script=$(scenario_osa "$rollback_script")
        osascript_cmd="do shell script \"$escaped_script\" user name \"$(scenario_osa "$user_name")\" password \"$(scenario_osa "$admin_password")\" with administrator privileges"
        osascript -e "$osascript_cmd" 2>&1 | tee -a "$E2E_LOG_FILE"
    else
        sudo -n "$nix_env" -p /nix/var/nix/profiles/system --rollback 2>&1 | tee -a "$E2E_LOG_FILE" || return 1
        local current
        current=$(scenario_current_system_path)
        [ -n "$current" ] && [ -x "$current/activate" ] || return 1
        sudo -n "$current/activate" 2>&1 | tee -a "$E2E_LOG_FILE"
    fi
}

scenario_preserve_completion_logs() {
    [ -n "$NIXMAC_E2E_COMPLETION_LOG_DIR" ] || return 0
    [ -d "$NIXMAC_E2E_COMPLETION_LOG_DIR" ] || return 0

    local artifact_dir="/tmp/e2e-artifacts/${E2E_SCENARIO_NAME:-macos_live_provider_evolve_real_system}/completion-logs"
    mkdir -p "$artifact_dir" || return 1
    cp -R "$NIXMAC_E2E_COMPLETION_LOG_DIR"/. "$artifact_dir"/ 2>/dev/null || true
}

scenario_test() {
    scenario_install_nix_with_app
    nixmac_quit

    phase "Prepare real provider and real nix-darwin fixture"
    peekaboo_check
    command -v jq >/dev/null 2>&1 || die "jq is required"
    scenario_nix >/dev/null || die "Nix is required"
    NIXMAC_E2E_PREVIOUS_SYSTEM_PATH=$(scenario_current_system_path)
    if [ -n "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ]; then
        log "Preserved previous system profile: $NIXMAC_E2E_PREVIOUS_SYSTEM_PATH"
    else
        log "No previous system profile found; cleanup will uninstall the test Nix install"
    fi
    scenario_create_config_repo
    nixmac_clear_state
    scenario_seed_settings
    unset NIXMAC_E2E_MOCK_SYSTEM
    export NIXMAC_RECORD_COMPLETIONS=1
    export NIXMAC_COMPLETION_LOG_DIR="$NIXMAC_E2E_COMPLETION_LOG_DIR"
    launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM 2>/dev/null || true
    launchctl setenv NIXMAC_RECORD_COMPLETIONS 1
    launchctl setenv NIXMAC_COMPLETION_LOG_DIR "$NIXMAC_E2E_COMPLETION_LOG_DIR"
    if [ -n "${NIXMAC_E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}" ]; then
        launchctl setenv NIXMAC_E2E_UNATTENDED_AUTH 1
        launchctl setenv NIXMAC_E2E_ADMIN_PASSWORD "${NIXMAC_E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
    fi
    phase_pass "Prepared real OpenRouter settings, real nix-darwin flake, and preserved current system profile"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Submit descriptor into real prompt"
    if ! scenario_wait_for_text "Describe changes|configuration" 45; then
        nixmac_screenshot "missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi
    scenario_click_element "evolve-prompt-input|Configuration change descriptor" "textField" \
        || die "Descriptor prompt input was not reachable by accessibility metadata"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" || die "Failed to type descriptor"
    scenario_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 20 \
        || die "Typed descriptor was not visible in the prompt input"
    nixmac_screenshot "02-descriptor-typed"
    scenario_click_element "evolve-prompt-send|Submit configuration change descriptor" "" 20 \
        || die "Submit target was not reachable by accessibility metadata"
    phase_pass "Descriptor submitted"

    phase "Verify live provider evolution reaches Review"
    if ! scenario_wait_for_text "Evolution complete|What.s changed|Build & Test|Ready to test-drive" 420; then
        nixmac_screenshot "live-provider-evolution-did-not-complete"
        die "Live provider evolution did not reach review"
    fi
    if ! grep -Eq 'pkgs\.hello([^A-Za-z0-9_-]|$)' "$NIXMAC_E2E_CONFIG_REPO/flake.nix"; then
        nixmac_screenshot "hello-edit-missing"
        die "Live provider did not edit flake.nix with pkgs.hello"
    fi
    if [ "$(scenario_completion_count evolve_provider_completions)" -lt 1 ]; then
        nixmac_screenshot "evolve-provider-completion-log-missing"
        die "No recorded live evolve provider completion"
    fi
    nixmac_screenshot "03-review-live-provider-evolved"
    phase_pass "Live OpenRouter evolve provider edited flake.nix and reached Review"

    phase "Build and activate real macOS system"
    if ! scenario_build_and_wait_for_commit_step; then
        nixmac_screenshot "real-activation-did-not-reach-commit"
        die "Real Build & Test did not advance to Save/commit step"
    fi
    local latest_log
    latest_log=$(scenario_latest_darwin_log)
    [ -n "$latest_log" ] || die "No darwin-rebuild log was written"
    if grep -qi "E2E mock system enabled" "$latest_log"; then
        die "Real system scenario hit the mock-system path"
    fi
    if ! grep -qi "darwin-rebuild build completed successfully" "$latest_log"; then
        die "darwin-rebuild success was not observed in the real activation log"
    fi
    local new_system_path
    new_system_path=$(scenario_current_system_path)
    if [ -z "$new_system_path" ] || { [ -n "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ] && [ "$new_system_path" = "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ]; }; then
        die "System profile did not change after real activation"
    fi
    nixmac_screenshot "05-save-step-after-real-activation"
    phase_pass "Real darwin-rebuild build and activation advanced to Save step"

    phase "Commit saved changes"
    local commit_message
    commit_message=$(scenario_wait_for_commit_message_value 120) \
        || die "Provider-generated commit message did not populate the Save step"
    log "Observed provider-generated commit message: $commit_message"
    if [ "$(scenario_completion_count summary_provider_completions)" -lt 1 ]; then
        nixmac_screenshot "summary-provider-completion-log-missing"
        die "No recorded summary/commit provider completion"
    fi
    scenario_click_element "Commit( Changes)?" "button" 45 \
        || die "Commit button was not reachable"
    if ! scenario_wait_for_text "Describe changes|What to change" 60; then
        nixmac_screenshot "begin-step-not-restored"
        die "Commit did not return to begin step"
    fi
    local latest_message
    latest_message=$(git -C "$NIXMAC_E2E_CONFIG_REPO" log -1 --pretty=%s)
    if [ "$latest_message" != "$commit_message" ]; then
        nixmac_screenshot "unexpected-commit-message"
        die "Expected committed message to match provider suggestion, got: $latest_message"
    fi
    if [ -n "$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)" ]; then
        nixmac_screenshot "repo-not-clean-after-commit"
        die "Config repo was not clean after commit"
    fi
    nixmac_screenshot "06-returned-to-describe"
    phase_pass "Save step committed provider-generated message and returned to Describe"

    phase "Restore previous system profile"
    scenario_restore_previous_system
    local restored_path
    restored_path=$(scenario_current_system_path)
    if [ -n "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ] && [ "$restored_path" != "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ]; then
        die "Previous system profile was not restored"
    elif [ -z "$NIXMAC_E2E_PREVIOUS_SYSTEM_PATH" ] && nix_is_installed; then
        die "Test Nix install was not removed after no-previous-profile run"
    fi
    phase_pass "Previous system state restored after no-stub activation proof"
}

scenario_cleanup() {
    scenario_preserve_completion_logs || true
    scenario_restore_previous_system
    sudo -n rm -f /etc/sudoers.d/nixmac-e2e-restore-temp 2>/dev/null || true
    nixmac_quit
    launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM 2>/dev/null || true
    launchctl unsetenv NIXMAC_E2E_UNATTENDED_AUTH 2>/dev/null || true
    launchctl unsetenv NIXMAC_RECORD_COMPLETIONS 2>/dev/null || true
    launchctl unsetenv NIXMAC_COMPLETION_LOG_DIR 2>/dev/null || true
    if [ -n "$NIXMAC_E2E_CONFIG_REPO" ]; then
        rm -rf "$NIXMAC_E2E_CONFIG_REPO" 2>/dev/null || true
    fi
    rm -f "$NIXMAC_E2E_ELEMENTS_JSON_FILE" 2>/dev/null || true
    if [ -n "$NIXMAC_E2E_COMPLETION_LOG_DIR" ]; then
        rm -rf "$NIXMAC_E2E_COMPLETION_LOG_DIR" 2>/dev/null || true
    fi
    nixmac_clear_state 2>/dev/null || true
}
