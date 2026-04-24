#!/bin/bash
# =============================================================================
# Setup a remote macOS runner for E2E testing.
# Run this once (or when you need to update the app build).
#
# Usage:
#   ./setup-runner.sh                           # Download latest from main
#   ./setup-runner.sh --branch ENG-275/fix-nix-installation  # From PR branch
#   ./setup-runner.sh --local /path/to/nixmac.app.zip        # Use local build
# =============================================================================
set -euo pipefail

BRANCH="${BRANCH:-main}"
REPO="darkmatter/nixmac"
APP_PATH="/Applications/nixmac.app"
ARTIFACT_NAME="nixmac-macos-app"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'
log() { echo -e "${BLUE}[setup]${NC} $*"; }
pass() { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${BLUE}[setup][warn]${NC} $*"; }
die() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

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
    run_with_timeout "${PEEKABOO_COMMAND_TIMEOUT:-15}" peekaboo "$@"
}

# Parse args
LOCAL_BUILD=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --branch) BRANCH="$2"; shift 2 ;;
        --local)  LOCAL_BUILD="$2"; shift 2 ;;
        *) die "Unknown arg: $1" ;;
    esac
done

# --- Step 1: Verify prerequisites ---
log "Checking prerequisites..."
command -v peekaboo &>/dev/null || die "peekaboo not found. Install: brew install steipete/tap/peekaboo"
peekaboo_with_timeout bridge status 2>&1 | grep -qE "remote (gui|onDemand)" || die "Peekaboo Bridge not connected. Open Peekaboo.app"
sudo -n true 2>/dev/null || die "sudo requires password. Set up NOPASSWD."
pass "Prerequisites OK"

# --- Step 2: Get the app ---
if [ -n "$LOCAL_BUILD" ]; then
    log "Using local build: $LOCAL_BUILD"
    cp "$LOCAL_BUILD" /tmp/nixmac-app.zip
else
    log "Downloading latest CI artifact from branch: $BRANCH"

    # Need gh CLI for artifact download
    if ! command -v gh &>/dev/null; then
        log "Installing GitHub CLI..."
        brew install gh 2>/dev/null || die "Failed to install gh CLI"
    fi

    # Check auth
    if ! gh auth status &>/dev/null 2>&1; then
        die "gh not authenticated. Run: gh auth login"
    fi

    # Find the latest successful run on the branch
    RUN_ID=$(gh api "repos/${REPO}/actions/runs?branch=${BRANCH}&status=success&per_page=1" \
        --jq '.workflow_runs[0].id' 2>/dev/null)

    if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
        die "No successful CI run found for branch: $BRANCH"
    fi
    log "Found CI run: $RUN_ID"

    # Download the artifact
    ARTIFACT_ID=$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/artifacts" \
        --jq ".artifacts[] | select(.name==\"${ARTIFACT_NAME}\") | .id" 2>/dev/null)

    if [ -z "$ARTIFACT_ID" ]; then
        die "Artifact '${ARTIFACT_NAME}' not found in run $RUN_ID"
    fi

    log "Downloading artifact $ARTIFACT_ID..."
    gh api "repos/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip" > /tmp/nixmac-app.zip 2>/dev/null
    pass "Downloaded artifact"
fi

# --- Step 3: Install the app ---
log "Installing nixmac app..."

# Remove old version
if [ -d "$APP_PATH" ]; then
    log "Removing existing app..."
    sudo rm -rf "$APP_PATH"
fi

cd /tmp
unzip -o nixmac-app.zip -d nixmac-extract/

# Find the .app inside (might be nested in a folder)
APP_BUNDLE=$(find nixmac-extract -name "*.app" -maxdepth 3 | head -1)
if [ -z "$APP_BUNDLE" ]; then
    die "No .app bundle found in artifact"
fi

log "Found app: $APP_BUNDLE"
sudo cp -R "$APP_BUNDLE" "$APP_PATH"

# Remove quarantine (downloaded app)
sudo xattr -cr "$APP_PATH" 2>/dev/null || true

pass "App installed at $APP_PATH"

# --- Step 4: Uninstall Nix if present (clean slate) ---
if [ -d "/nix" ]; then
    log "Nix is installed. Uninstalling for clean test state..."
    if [ -f "/nix/nix-installer" ]; then
        sudo /nix/nix-installer uninstall --no-confirm
        pass "Nix uninstalled"
    else
        warn "No nix-installer found. Manual cleanup may be needed."
    fi
fi

# --- Step 5: Summary ---
echo ""
pass "Runner setup complete!"
echo ""
log "App:          $APP_PATH"
log "Nix:          $(command -v nix &>/dev/null && echo 'installed (⚠️ uninstall before test)' || echo 'not installed ✓')"
log "Peekaboo:     $(peekaboo_with_timeout bridge status 2>&1 | grep Selected || echo 'status unavailable')"
log ""
log "Run the test:  ADMIN_PASSWORD=<password> ./run-e2e.sh"
echo ""
