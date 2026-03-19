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
#
# Usage from GitHub Actions:
#   ssh admin@<host> \
#     'ADMIN_PASSWORD=... GH_TOKEN=... BRANCH=... bash -s' < ci-runner.sh
# =============================================================================
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

BRANCH="${BRANCH:-main}"
REPO="darkmatter/nixmac"
ARTIFACT_NAME="nixmac-macos-app"
APP_PATH="/Applications/nixmac.app"
E2E_DIR="/tmp/nixmac-e2e"

echo "=========================================="
echo " nixmac E2E CI Runner"
echo "=========================================="
echo "Branch:  $BRANCH"
echo "Host:    $(hostname)"
echo "macOS:   $(sw_vers -productVersion)"
echo "Date:    $(date)"
echo ""

# --- Preflight ---
echo "[ci] Checking Peekaboo Bridge..."
if ! peekaboo bridge status 2>&1 | grep -q "remote gui"; then
    echo "[ci] ERROR: Peekaboo Bridge not running. Ensure Peekaboo.app is launched."
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
rm -rf /tmp/e2e-screenshots /tmp/e2e-recording.mp4 /tmp/e2e-test.log

# --- Download app ---
echo "[ci] Downloading app from CI (branch: $BRANCH)..."

RUN_ID=$(gh api "repos/${REPO}/actions/runs?branch=${BRANCH}&status=success&per_page=1" \
    --jq '.workflow_runs[0].id' 2>/dev/null)
if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
    echo "[ci] ERROR: No successful CI run for branch $BRANCH"
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

# --- Fetch test scripts (if not already on disk) ---
if [ ! -f "$E2E_DIR/run-e2e.sh" ]; then
    echo "[ci] Fetching test scripts from repo..."
    mkdir -p "$E2E_DIR"
    for script in run-e2e.sh setup-runner.sh; do
        gh api "repos/${REPO}/contents/tests/e2e/${script}?ref=${BRANCH}" \
            --jq '.content' 2>/dev/null | base64 -d > "$E2E_DIR/$script" || true
    done
    chmod +x "$E2E_DIR"/*.sh 2>/dev/null || true
fi

# --- Run E2E ---
echo ""
echo "[ci] Starting E2E test..."
echo ""

export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export CLEANUP_ON_SUCCESS=1

if [ -f "$E2E_DIR/run-e2e.sh" ]; then
    bash "$E2E_DIR/run-e2e.sh"
    EXIT_CODE=$?
else
    echo "[ci] ERROR: run-e2e.sh not found at $E2E_DIR"
    EXIT_CODE=1
fi

# --- Results ---
echo ""
echo "[ci] Test completed (exit: $EXIT_CODE)"
echo "[ci] Artifacts:"
[ -f "/tmp/e2e-recording.mp4" ] && echo "  Video:       /tmp/e2e-recording.mp4 ($(du -h /tmp/e2e-recording.mp4 | cut -f1))"
[ -f "/tmp/e2e-test.log" ]      && echo "  Log:         /tmp/e2e-test.log"
[ -d "/tmp/e2e-screenshots" ]   && echo "  Screenshots: /tmp/e2e-screenshots/ ($(ls /tmp/e2e-screenshots/*.png 2>/dev/null | wc -l | tr -d ' ') files)"

exit $EXIT_CODE
