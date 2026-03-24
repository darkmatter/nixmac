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
if ! peekaboo bridge status 2>&1 | grep -qE "remote (gui|onDemand)"; then
    echo "[ci] ERROR: Peekaboo Bridge not running. Ensure Peekaboo.app is launched."
    echo "[ci] Bridge status output:"
    peekaboo bridge status 2>&1 || true
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

# --- Download app artifact (pinned to commit SHA if available) ---
echo "[ci] Downloading app from CI (branch: $BRANCH)..."

# Try exact commit first, then fall back to latest successful on branch
RUN_ID=""
if [ -n "$COMMIT_SHA" ]; then
    RUN_ID=$(gh api "repos/${REPO}/actions/runs?head_sha=${COMMIT_SHA}&status=success&per_page=5" \
        --jq "[.workflow_runs[] | select(.name == \"Build macOS App\")] | .[0].id" 2>/dev/null)
    [ "$RUN_ID" = "null" ] && RUN_ID=""
fi

if [ -z "$RUN_ID" ]; then
    echo "[ci] No build for exact commit, trying latest successful on branch $BRANCH..."
    RUN_ID=$(gh api "repos/${REPO}/actions/runs?branch=${BRANCH}&status=success&per_page=10" \
        --jq "[.workflow_runs[] | select(.name == \"Build macOS App\")] | .[0].id" 2>/dev/null)
    [ "$RUN_ID" = "null" ] && RUN_ID=""
fi

if [ -z "$RUN_ID" ]; then
    echo "[ci] No build on branch either, trying latest successful on main..."
    RUN_ID=$(gh api "repos/${REPO}/actions/runs?branch=main&status=success&per_page=10" \
        --jq "[.workflow_runs[] | select(.name == \"Build macOS App\")] | .[0].id" 2>/dev/null)
    [ "$RUN_ID" = "null" ] && RUN_ID=""
fi

if [ -z "$RUN_ID" ]; then
    echo "[ci] ERROR: No successful Build macOS App run found anywhere"
    exit 1
fi
echo "[ci] Using CI run: $RUN_ID"

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
REF="${COMMIT_SHA:-$BRANCH}"

# Clone just the tests/e2e directory
cd /tmp
rm -rf nixmac-e2e-checkout
CLONE_URL="https://github.com/${REPO}.git"
if [ -n "${GH_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
fi
git clone --depth 1 --branch "$BRANCH" --filter=blob:none --sparse \
    "$CLONE_URL" nixmac-e2e-checkout 2>&1 || {
    echo "[ci] ERROR: Failed to clone repo"
    exit 1
}
cd nixmac-e2e-checkout
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
export NIXMAC_DISABLE_UPDATER=1  # Updater can crash in CI (unsigned builds, empty platforms)

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

exit $EXIT_CODE
