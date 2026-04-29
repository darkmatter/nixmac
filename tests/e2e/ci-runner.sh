#!/bin/bash
# =============================================================================
# CI entry point — piped via SSH from GitHub Actions.
#
# Handles: artifact download, app install, E2E test, artifact collection.
#
# Required env vars:
#   ADMIN_PASSWORD  - macOS admin password
#   GH_TOKEN        - GitHub token (for artifact download)
#   BRANCH          - Git branch to test (default: main)
#   COMMIT_SHA      - Exact commit SHA to test (pins artifact + scripts)
#   SCENARIO        - Scenario to run (default: nix-install)
# =============================================================================
set -uo pipefail  # no -e: we capture exit codes manually

export PATH="/opt/homebrew/bin:$PATH"

BRANCH="${BRANCH:-main}"
COMMIT_SHA="${COMMIT_SHA:-}"
SCENARIO="${SCENARIO:-nix-install}"
REPO="darkmatter/nixmac"
ARTIFACT_NAME="nixmac-macos-app"
APP_PATH="/Applications/nixmac.app"
E2E_DIR="/tmp/nixmac-e2e"
BUILD_WAIT_SECONDS="${BUILD_WAIT_SECONDS:-1800}"
BUILD_POLL_SECONDS="${BUILD_POLL_SECONDS:-30}"
PEEKABOO_COMMAND_TIMEOUT="${PEEKABOO_COMMAND_TIMEOUT:-15}"

run_with_timeout() {
    local seconds="$1"
    shift

    local output_file status command_pid watchdog_pid
    output_file=$(mktemp "${TMPDIR:-/tmp}/e2e-timeout-output.XXXXXX") || return 1

    "$@" >"$output_file" 2>&1 &
    command_pid=$!

    (
        sleep "$seconds"
        if kill -0 "$command_pid" 2>/dev/null; then
            kill "$command_pid" 2>/dev/null || true
            sleep 2
            kill -9 "$command_pid" 2>/dev/null || true
        fi
    ) &
    watchdog_pid=$!

    if wait "$command_pid"; then
        status=0
    else
        status=$?
    fi

    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true

    cat "$output_file"
    rm -f "$output_file"

    if [ "$status" -eq 137 ] || [ "$status" -eq 143 ]; then
        return 124
    fi

    return "$status"
}

cleanup_e2e_recording_processes() {
    pkill -f "ffmpeg.*e2e-recording.mp4" 2>/dev/null || true
    pkill -f "/tmp/nixmac-e2e-recorder-.*\\.sh" 2>/dev/null || true
    pkill -f "/tmp/e2e-record.sh" 2>/dev/null || true
}

cleanup_terminal_saved_state() {
    rm -rf \
        "$HOME/Library/Saved Application State/com.apple.Terminal.savedState" \
        "$HOME/Library/Containers/com.apple.Terminal/Data/Library/Saved Application State/com.apple.Terminal.savedState" \
        2>/dev/null || true
    defaults write com.apple.Terminal NSQuitAlwaysKeepsWindows -bool false 2>/dev/null || true
    defaults write com.apple.Terminal ApplePersistenceIgnoreState -bool true 2>/dev/null || true
}

cleanup_automation_permission_prompt() {
    command -v peekaboo &>/dev/null || return 0
    command -v jq &>/dev/null || return 0

    local capture_dir="/tmp/e2e-peekaboo-captures"
    local json snapshot button
    mkdir -p "$capture_dir"
    json=$(run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" peekaboo see --json --path "$capture_dir/cleanup-ui.png" 2>/dev/null || true)
    [ -n "$json" ] || return 0

    if ! echo "$json" | jq -e '
        [.data.ui_elements[]? | (.label? // .title? // .value? // "")] |
        join(" ") |
        test("sshd-keygen-wrapper.*Terminal"; "i")
    ' >/dev/null 2>&1; then
        return 0
    fi

    snapshot=$(echo "$json" | jq -r '.data.snapshot_id // .snapshot_id // ""' 2>/dev/null)
    button=$(echo "$json" | jq -r '
        .data.ui_elements[]? |
        select(.role == "button") |
        select((.label? // .title? // .value? // "") | test("^Don.?t Allow$"; "i")) |
        .id
    ' 2>/dev/null | head -1)

    if [ -n "$snapshot" ] && [ -n "$button" ]; then
        run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" peekaboo click --on "$button" --snapshot "$snapshot" >/dev/null 2>&1 || true
        echo "[ci] Dismissed stale Terminal Automation permission prompt"
    fi
}

cleanup_e2e_gui_leftovers() {
    # Keep the shared visual runner tidy between proof runs. Peekaboo v3 writes
    # implicit `peekaboo_*.png` captures to Desktop when no path is supplied,
    # and Terminal.app keeps GUI recorder shells open unless explicitly closed.
    cleanup_e2e_recording_processes

    if [ "${E2E_TERMINAL_CLEANUP_MODE:-kill}" = "kill" ]; then
        if pgrep -x Terminal &>/dev/null; then
            pkill -x Terminal 2>/dev/null || true
            sleep 1
            pkill -9 -x Terminal 2>/dev/null || true
            echo "[ci] Terminated stale E2E Terminal.app windows"
        fi
        cleanup_terminal_saved_state
    elif command -v osascript &>/dev/null && pgrep -x Terminal &>/dev/null; then
        osascript >/dev/null 2>&1 <<'OSA' || true
set closeTargets to {}

on shouldCloseTab(tabName, tabTitle)
    if tabTitle starts with "nixmac-e2e-recorder-" then return true
    if tabName contains "nixmac-e2e-recorder-" then return true
    if tabName contains "nixmac-e2e-recording" then return true
    if tabName contains "e2e-record.sh" then return true
    if tabName contains "e2e-record-" then return true
    return false
end shouldCloseTab

tell application "Terminal"
    repeat with terminalWindow in windows
        repeat with terminalTab in tabs of terminalWindow
            set tabName to ""
            set tabTitle to ""
            try
                set tabName to name of terminalTab as text
            end try
            try
                set tabTitle to custom title of terminalTab as text
            end try
            if my shouldCloseTab(tabName, tabTitle) then
                set end of closeTargets to terminalTab
            end if
        end repeat
    end repeat

    repeat with terminalTab in closeTargets
        try
            close terminalTab
        end try
    end repeat
end tell
OSA
        echo "[ci] Closed stale E2E Terminal recorder windows if present"
    fi
    cleanup_automation_permission_prompt

    local desktop="${E2E_DESKTOP_DIR:-$HOME/Desktop}"
    if [ -d "$desktop" ]; then
        local removed=0
        local artifact
        while IFS= read -r artifact; do
            [ -n "$artifact" ] || continue
            rm -f "$artifact" 2>/dev/null || true
            removed=$((removed + 1))
        done < <(find "$desktop" -maxdepth 1 -type f \( \
            -name 'peekaboo_*.png' -o \
            -name 'peekaboo-*.png' -o \
            -name 'peekaboo_*.jpg' -o \
            -name 'peekaboo-*.jpg' \
        \) -print 2>/dev/null)
        if [ "$removed" -gt 0 ]; then
            echo "[ci] Removed $removed stale Peekaboo Desktop artifact(s)"
        fi
    fi

    rm -rf /tmp/e2e-peekaboo-captures
    if command -v peekaboo &>/dev/null; then
        run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" peekaboo clean >/dev/null 2>&1 || true
    fi
}

# shellcheck disable=SC2329 # Invoked by signal/EXIT traps.
cleanup_ci_runner() {
    launchctl unsetenv NIXMAC_DISABLE_UPDATER 2>/dev/null || true
    launchctl unsetenv NIXMAC_SKIP_PERMISSIONS 2>/dev/null || true
    launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM 2>/dev/null || true
    launchctl unsetenv NIXMAC_E2E_UNATTENDED_AUTH 2>/dev/null || true
    launchctl unsetenv NIXMAC_E2E_ADMIN_PASSWORD 2>/dev/null || true
    launchctl unsetenv NIXMAC_RECORD_COMPLETIONS 2>/dev/null || true
    launchctl unsetenv NIXMAC_COMPLETION_LOG_DIR 2>/dev/null || true
    cleanup_e2e_gui_leftovers
}

trap cleanup_ci_runner EXIT
trap 'cleanup_ci_runner; exit 130' INT
trap 'cleanup_ci_runner; exit 143' TERM HUP

peekaboo_with_timeout() {
    run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" peekaboo "$@"
}

echo "=========================================="
echo " macos-e2e CI Runner"
echo "=========================================="
echo "Branch:   $BRANCH"
echo "Commit:   ${COMMIT_SHA:-latest}"
echo "Scenario: $SCENARIO"
echo "Host:     $(hostname)"
echo "macOS:    $(sw_vers -productVersion)"
echo "Date:     $(date)"
echo ""

scenario_requires_unattended_auth() {
    case "$SCENARIO" in
        macos_live_provider_evolve_real_system)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# --- Preflight ---
echo "[ci] Checking Peekaboo Bridge..."
if ! peekaboo_with_timeout bridge status 2>&1 | grep -qE "remote (gui|onDemand)"; then
    echo "[ci] ERROR: Peekaboo Bridge not running. Ensure Peekaboo.app is launched."
    echo "[ci] Bridge status output:"
    peekaboo_with_timeout bridge status 2>&1 || true
    exit 1
fi

echo "[ci] Authenticating GitHub CLI..."
if [ -n "${GH_TOKEN:-}" ]; then
    echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
fi

# --- Clean state ---
echo "[ci] Cleaning previous state..."
cleanup_e2e_gui_leftovers
pkill -f nixmac 2>/dev/null || true
pkill -f Installer 2>/dev/null || true
echo "[ci] Deferring Nix cleanup until the scenario fixture is known"
rm -rf /tmp/e2e-screenshots /tmp/e2e-peekaboo-captures /tmp/e2e-recording.mp4 /tmp/e2e-test.log /tmp/e2e-runner.lock
rm -rf /tmp/e2e-artifacts

# --- Download app artifact pinned to the exact commit SHA ---
echo "[ci] Downloading app from CI (branch: $BRANCH, commit: ${COMMIT_SHA:-missing})..."

if [ -z "$COMMIT_SHA" ]; then
    echo "[ci] ERROR: COMMIT_SHA is required; refusing to test an unpinned app artifact"
    exit 1
fi

find_build_run() {
    gh api "repos/${REPO}/actions/runs?head_sha=${COMMIT_SHA}&per_page=20" \
        --jq '([.workflow_runs[] | select(.name == "Build macOS App")] | sort_by(.created_at) | reverse | .[0]) // empty | [.id, .status, (.conclusion // ""), .html_url] | @tsv' 2>/dev/null || true
}

RUN_ID=""
RUN_STATUS=""
RUN_CONCLUSION=""
RUN_URL=""
deadline=$(( $(date +%s) + BUILD_WAIT_SECONDS ))
while [ "$(date +%s)" -le "$deadline" ]; do
    run_info="$(find_build_run)"
    if [ -n "$run_info" ]; then
        IFS=$'\t' read -r RUN_ID RUN_STATUS RUN_CONCLUSION RUN_URL <<< "$run_info"
        echo "[ci] Found Build macOS App run for $COMMIT_SHA: id=$RUN_ID status=$RUN_STATUS conclusion=${RUN_CONCLUSION:-pending}"
        if [ "$RUN_STATUS" = "completed" ] && [ "$RUN_CONCLUSION" = "success" ]; then
            break
        fi
        if [ "$RUN_STATUS" = "completed" ] && [ "$RUN_CONCLUSION" != "success" ]; then
            echo "[ci] ERROR: Build macOS App completed without success for $COMMIT_SHA: ${RUN_URL:-unknown URL}"
            exit 1
        fi
    else
        echo "[ci] Waiting for Build macOS App run for $COMMIT_SHA..."
    fi
    sleep "$BUILD_POLL_SECONDS"
done

if [ -z "$RUN_ID" ] || [ "$RUN_STATUS" != "completed" ] || [ "$RUN_CONCLUSION" != "success" ]; then
    echo "[ci] ERROR: Timed out waiting for successful Build macOS App run for exact commit $COMMIT_SHA"
    exit 1
fi
echo "[ci] Using exact-SHA CI run: $RUN_ID"

ARTIFACT_ID=$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/artifacts" \
    --jq ".artifacts[] | select(.name==\"${ARTIFACT_NAME}\") | .id" 2>/dev/null)
if [ -z "$ARTIFACT_ID" ]; then
    echo "[ci] ERROR: Artifact '${ARTIFACT_NAME}' not found"
    exit 1
fi

gh api "repos/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip" > /tmp/nixmac-app.zip

# --- Install app ---
sudo rm -rf "$APP_PATH"
cd /tmp && rm -rf nixmac-extract
unzip -o nixmac-app.zip -d nixmac-extract/ >/dev/null
APP_BUNDLE=$(find nixmac-extract -name "*.app" -maxdepth 3 | head -1)
if [ -z "$APP_BUNDLE" ]; then
    echo "[ci] ERROR: No .app bundle in artifact"
    exit 1
fi
sudo cp -R "$APP_BUNDLE" "$APP_PATH"
sudo xattr -cr "$APP_PATH" 2>/dev/null || true
rm -rf nixmac-extract nixmac-app.zip
echo "[ci] App installed at $APP_PATH"

# --- Fetch fresh test framework from the branch under test ---
echo "[ci] Fetching E2E framework from repo (branch: $BRANCH)..."
rm -rf "$E2E_DIR"
mkdir -p "$E2E_DIR"

# Clone just the tests/e2e directory at the exact commit under test.
cd /tmp || exit 1
rm -rf nixmac-e2e-checkout
CLONE_URL="https://github.com/${REPO}.git"
if [ -n "${GH_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
fi
git clone --filter=blob:none --sparse "$CLONE_URL" nixmac-e2e-checkout 2>&1 || {
    echo "[ci] ERROR: Failed to clone repo"
    exit 1
}
cd nixmac-e2e-checkout || exit 1
git fetch --depth 1 origin "$COMMIT_SHA" 2>&1 || {
    echo "[ci] ERROR: Failed to fetch exact commit $COMMIT_SHA"
    exit 1
}
git checkout --detach "$COMMIT_SHA" 2>&1 || {
    echo "[ci] ERROR: Failed to checkout exact commit $COMMIT_SHA"
    exit 1
}
git sparse-checkout set tests/e2e 2>&1
cp -R tests/e2e/* "$E2E_DIR/"
chmod +x "$E2E_DIR"/*.sh "$E2E_DIR"/scenarios/*.sh 2>/dev/null || true
cd /tmp && rm -rf nixmac-e2e-checkout
echo "[ci] E2E framework deployed to $E2E_DIR"

detect_scenario_fixture() {
    local scenario_file="$1"
    [ -f "$scenario_file" ] || return 0
    grep -E '^E2E_FIXTURE=' "$scenario_file" 2>/dev/null \
        | head -1 \
        | cut -d= -f2- \
        | tr -d "\"'" \
        | tr -d '[:space:]'
}

SCENARIO_FIXTURE="$(detect_scenario_fixture "$E2E_DIR/scenarios/${SCENARIO}.sh")"
echo "[ci] Scenario fixture: ${SCENARIO_FIXTURE:-none}"

if [ "${E2E_FORCE_CLEAN_NIX:-0}" = "1" ] || [ "$SCENARIO_FIXTURE" = "clean-machine" ]; then
    if [ -f "/nix/nix-installer" ]; then
        echo "[ci] Uninstalling existing Nix for ${SCENARIO_FIXTURE:-forced clean} scenario..."
        sudo /nix/nix-installer uninstall --no-confirm 2>&1
    else
        echo "[ci] No Nix installer found; clean fixture starts without installed Nix"
    fi
else
    echo "[ci] Preserving existing Nix install for ${SCENARIO_FIXTURE:-no-fixture} scenario"
fi

# --- Run scenario ---
echo ""
echo "[ci] Running scenario: $SCENARIO"
echo ""

export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export NIXMAC_E2E_ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export NIXMAC_E2E_UNATTENDED_AUTH=0
if [ -z "${E2E_CLEANUP_NIX:-}" ]; then
    if [ "$SCENARIO_FIXTURE" = "clean-machine" ]; then
        export E2E_CLEANUP_NIX=1
    else
        export E2E_CLEANUP_NIX=0
    fi
fi
export E2E_JSON=1
export E2E_TERMINAL_CLEANUP_MODE=kill
export E2E_RECORDING_TRIM_START_SECONDS=3
export NIXMAC_DISABLE_UPDATER=1   # Updater can crash in CI (unsigned builds, empty platforms)
export NIXMAC_SKIP_PERMISSIONS=1  # CI Mac may not have FDA granted; skip permissions screen
if scenario_requires_unattended_auth; then
    export NIXMAC_E2E_UNATTENDED_AUTH=1
fi

# macOS `open` launches apps via Launch Services which ignores shell env vars.
# Use launchctl setenv so the app process inherits these flags.
launchctl setenv NIXMAC_DISABLE_UPDATER 1
launchctl setenv NIXMAC_SKIP_PERMISSIONS 1
if scenario_requires_unattended_auth && [ -n "${NIXMAC_E2E_ADMIN_PASSWORD:-}" ]; then
    launchctl setenv NIXMAC_E2E_UNATTENDED_AUTH 1
    launchctl setenv NIXMAC_E2E_ADMIN_PASSWORD "$NIXMAC_E2E_ADMIN_PASSWORD"
fi

EXIT_CODE=0
bash "$E2E_DIR/run.sh" "$SCENARIO" || EXIT_CODE=$?

# --- Results ---
echo ""
echo "[ci] Test completed (exit: $EXIT_CODE)"
echo "[ci] Artifacts:"
[ -f "/tmp/e2e-recording.mp4" ] && echo "  Video:       /tmp/e2e-recording.mp4 ($(du -h /tmp/e2e-recording.mp4 | cut -f1))"
[ -f "/tmp/e2e-test.log" ]      && echo "  Log:         /tmp/e2e-test.log"
[ -d "/tmp/e2e-screenshots" ]   && echo "  Screenshots: /tmp/e2e-screenshots/ ($(find /tmp/e2e-screenshots -maxdepth 1 -name '*.png' -type f 2>/dev/null | wc -l | tr -d ' ') files)"
[ -f "/tmp/e2e-test-results.json" ] && echo "  Results:     /tmp/e2e-test-results.json"
[ -d "/tmp/e2e-artifacts" ] && echo "  Report:      /tmp/e2e-artifacts"

exit $EXIT_CODE
