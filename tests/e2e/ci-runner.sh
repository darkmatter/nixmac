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
pkill -f nixmac 2>/dev/null || true
pkill -f Installer 2>/dev/null || true
if [ -f "/nix/nix-installer" ]; then
    echo "[ci] Uninstalling existing Nix..."
    sudo /nix/nix-installer uninstall --no-confirm 2>&1
fi
rm -rf /tmp/e2e-screenshots /tmp/e2e-recording.mp4 /tmp/e2e-test.log /tmp/e2e-runner.lock
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
cd /tmp
rm -rf nixmac-e2e-checkout
CLONE_URL="https://github.com/${REPO}.git"
if [ -n "${GH_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
fi
git clone --filter=blob:none --sparse "$CLONE_URL" nixmac-e2e-checkout 2>&1 || {
    echo "[ci] ERROR: Failed to clone repo"
    exit 1
}
cd nixmac-e2e-checkout
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

# --- Run scenario ---
echo ""
echo "[ci] Running scenario: $SCENARIO"
echo ""

export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export E2E_CLEANUP_NIX=1
export E2E_JSON=1
export NIXMAC_DISABLE_UPDATER=1   # Updater can crash in CI (unsigned builds, empty platforms)
export NIXMAC_SKIP_PERMISSIONS=1  # CI Mac may not have FDA granted; skip permissions screen

# macOS `open` launches apps via Launch Services which ignores shell env vars.
# Use launchctl setenv so the app process inherits these flags.
launchctl setenv NIXMAC_DISABLE_UPDATER 1
launchctl setenv NIXMAC_SKIP_PERMISSIONS 1

EXIT_CODE=0
bash "$E2E_DIR/run.sh" "$SCENARIO" || EXIT_CODE=$?

# --- Results ---
echo ""
echo "[ci] Test completed (exit: $EXIT_CODE)"
echo "[ci] Artifacts:"
[ -f "/tmp/e2e-recording.mp4" ] && echo "  Video:       /tmp/e2e-recording.mp4 ($(du -h /tmp/e2e-recording.mp4 | cut -f1))"
[ -f "/tmp/e2e-test.log" ]      && echo "  Log:         /tmp/e2e-test.log"
[ -d "/tmp/e2e-screenshots" ]   && echo "  Screenshots: /tmp/e2e-screenshots/ ($(ls /tmp/e2e-screenshots/*.png 2>/dev/null | wc -l | tr -d ' ') files)"
[ -f "/tmp/e2e-test-results.json" ] && echo "  Results:     /tmp/e2e-test-results.json"
[ -d "/tmp/e2e-artifacts" ] && echo "  Report:      /tmp/e2e-artifacts"

# Clean up launchctl env vars so they don't persist on the CI Mac
launchctl unsetenv NIXMAC_DISABLE_UPDATER 2>/dev/null || true
launchctl unsetenv NIXMAC_SKIP_PERMISSIONS 2>/dev/null || true

exit $EXIT_CODE
