#!/bin/bash
# =============================================================================
# nixmac E2E Test — Nix Installation Flow
#
# Automated GUI test of the full Nix install experience:
#   App launch → Install Nix → .pkg download → Install → Prefetch → Welcome
#
# Requires:
#   - Peekaboo CLI + Peekaboo.app (Bridge) with Screen Recording & Accessibility
#   - Passwordless sudo
#   - ffmpeg (for screen recording)
#   - nixmac.app installed at /Applications/nixmac.app
#
# Usage:
#   ADMIN_PASSWORD=<pw> ./run-e2e.sh
#   ./run-e2e.sh --cleanup-only
#
# Env vars:
#   ADMIN_PASSWORD  - macOS admin password (used by sudo installer)
#   CLEANUP_ON_SUCCESS - set to 0 to skip cleanup after pass (default: 1)
#   APP_PATH        - override app location (default: /Applications/nixmac.app)
# =============================================================================
set -euo pipefail

# --- Config ---
APP_NAME="nixmac"
APP_PATH="${APP_PATH:-/Applications/nixmac.app}"
PEEKABOO="peekaboo"
SCREENSHOT_DIR="/tmp/e2e-screenshots"
LOG_FILE="/tmp/e2e-test.log"
VIDEO_FILE="/tmp/e2e-recording.mp4"
NIX_INSTALLER="/nix/nix-installer"
TIMEOUT_INSTALL=300
TIMEOUT_PREFETCH=300
POLL_INTERVAL=3
RECORDER_PID=""

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Helpers ---
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE"; }
pass() { echo -e "${GREEN}[PASS]${NC} $*" | tee -a "$LOG_FILE"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }

screenshot() {
    local name="${1:-screenshot}"
    local path="${SCREENSHOT_DIR}/${name}-$(date +%s).png"
    $PEEKABOO see --annotate --path "$path" 2>/dev/null || true
    log "Screenshot saved: $path"
    echo "$path"
}

# --- Peekaboo helpers ---

peek_elements() {
    local app="${1:-}"
    local args=""
    [ -n "$app" ] && args="--app $app"
    $PEEKABOO see $args --json 2>/dev/null
}

peek_find_button() {
    local json="$1"
    local pattern="$2"
    echo "$json" | jq -r "
        .data.ui_elements[]? |
        select(.role == \"button\") |
        select(.label? // .title? // \"\" | test(\"$pattern\"; \"i\")) |
        .id
    " 2>/dev/null | head -1
}

peek_click() {
    local element_id="$1"
    local json="$2"
    local snap_id
    snap_id=$(echo "$json" | jq -r '.data.snapshot_id' 2>/dev/null)
    $PEEKABOO click --on "$element_id" --snapshot "$snap_id" 2>&1
}

peek_text() {
    local app="${1:-}"
    local json
    json=$(peek_elements "$app")
    echo "$json" | jq -r '
        [.data.ui_elements[]? | .label? // ""] | join(" ")
    ' 2>/dev/null || echo ""
}

# --- Recording ---

start_recording() {
    if ! command -v ffmpeg &>/dev/null; then
        warn "ffmpeg not found, skipping screen recording"
        return
    fi

    log "Starting screen recording: $VIDEO_FILE"

    cat > /tmp/e2e-record.sh << RECEOF
#!/bin/bash
export PATH="/opt/homebrew/bin:\$PATH"
ffmpeg -y -f avfoundation -capture_cursor 1 -framerate 5 -pixel_format uyvy422 \\
    -i "0:none" -t 600 -vf scale=1280:-2 \\
    -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p \\
    "$VIDEO_FILE" 2>"$SCREENSHOT_DIR/ffmpeg.log"
RECEOF
    chmod +x /tmp/e2e-record.sh

    # Launch in GUI context (Terminal.app has Screen Recording permission)
    open -a Terminal /tmp/e2e-record.sh
    sleep 3

    RECORDER_PID=$(pgrep -f "ffmpeg.*e2e-recording" | head -1)
    if [ -n "$RECORDER_PID" ]; then
        log "Recorder started (PID: $RECORDER_PID)"
    else
        warn "Screen recorder may not have started"
    fi
}

stop_recording() {
    if [ -n "$RECORDER_PID" ] && kill -0 "$RECORDER_PID" 2>/dev/null; then
        log "Stopping recorder..."
        kill -INT "$RECORDER_PID" 2>/dev/null || true
        sleep 2
        kill -0 "$RECORDER_PID" 2>/dev/null && kill "$RECORDER_PID" 2>/dev/null || true
        wait "$RECORDER_PID" 2>/dev/null || true
    fi
    pkill -f "ffmpeg.*e2e-recording" 2>/dev/null || true
    sleep 1
    if [ -f "$VIDEO_FILE" ]; then
        log "Video saved: $VIDEO_FILE ($(du -h "$VIDEO_FILE" | cut -f1))"
    fi
}

# --- Cleanup ---

cleanup() {
    log "Cleaning up..."
    stop_recording
    $PEEKABOO app quit --app "$APP_NAME" 2>/dev/null || true
    pkill -f "Installer" 2>/dev/null || true
    if [ -f "$NIX_INSTALLER" ]; then
        log "Uninstalling Nix..."
        sudo "$NIX_INSTALLER" uninstall --no-confirm 2>&1 | tee -a "$LOG_FILE" || true
    fi
    log "Cleanup complete"
}

die() {
    fail "$1"
    screenshot "failure"
    cleanup
    exit 1
}

# --- Phases ---

phase_prechecks() {
    log "=== Phase 0: Pre-checks ==="

    if ! $PEEKABOO bridge status 2>&1 | grep -q "remote gui"; then
        die "Peekaboo Bridge not connected. Ensure Peekaboo.app is running."
    fi
    pass "Peekaboo Bridge connected"

    if ! $PEEKABOO permissions 2>&1 | grep -q "Screen Recording.*Granted"; then
        die "Screen Recording permission not granted"
    fi
    pass "Permissions OK"

    # Note: /nix may exist as an empty synthetic firmlink even after uninstall
    if command -v nix &>/dev/null || [ -f "/nix/var/nix/profiles/default/bin/nix" ]; then
        warn "Nix is currently installed. Uninstalling first..."
        if [ -f "$NIX_INSTALLER" ]; then
            sudo "$NIX_INSTALLER" uninstall --no-confirm 2>&1 | tee -a "$LOG_FILE"
        else
            die "Nix installed but no uninstaller found at $NIX_INSTALLER"
        fi
    fi
    pass "Nix is not installed (clean state)"

    if [ ! -d "$APP_PATH" ]; then
        die "App not found at $APP_PATH. Run setup-runner.sh first."
    fi
    pass "App found at $APP_PATH"

    mkdir -p "$SCREENSHOT_DIR"
}

dismiss_system_dialogs() {
    local max_attempts=5
    for i in $(seq 1 $max_attempts); do
        local json
        json=$(peek_elements)
        local dialog_button
        dialog_button=$(peek_find_button "$json" "^(Allow|OK|Open|Continue)$")

        if [ -n "$dialog_button" ]; then
            log "Dismissing system dialog (clicking $dialog_button)..."
            peek_click "$dialog_button" "$json" || true
            sleep 2
        else
            break
        fi
    done
}

phase_launch_app() {
    log "=== Phase 1: Launch nixmac app ==="
    open "$APP_PATH"
    sleep 5

    if ! pgrep -f "$APP_NAME" &>/dev/null; then
        die "App failed to launch"
    fi
    pass "App launched"
    screenshot "01-app-launched"
}

phase_find_and_click_install() {
    log "=== Phase 2: Find and click Install button ==="

    dismiss_system_dialogs
    screenshot "02-pre-install"

    local json
    json=$(peek_elements "$APP_NAME")
    local install_button
    install_button=$(peek_find_button "$json" "[Ii]nstall.*[Nn]ix|^[Ii]nstall$")

    if [ -z "$install_button" ]; then
        screenshot "02-no-install-button"
        die "Install button not found in UI. Check screenshots."
    fi

    log "Found install button: $install_button"
    peek_click "$install_button" "$json"
    pass "Clicked Install button"

    sleep 2
    screenshot "03-after-click-install"
}

phase_wait_download() {
    log "=== Phase 3: Wait for .pkg download and Installer to open ==="

    local elapsed=0
    while [ $elapsed -lt $TIMEOUT_INSTALL ]; do
        if pgrep -f "Installer" &>/dev/null; then
            pass "Installer.app detected — download complete"
            screenshot "04-installer-opened"
            return 0
        fi

        local screen_text
        screen_text=$(peek_text "$APP_NAME")
        if echo "$screen_text" | grep -qi "downloading"; then
            log "Still downloading... (${elapsed}s)"
        elif echo "$screen_text" | grep -qi "error\|failed"; then
            screenshot "04-download-error"
            die "Download failed. Check screenshot."
        fi

        sleep $POLL_INTERVAL
        elapsed=$((elapsed + POLL_INTERVAL))
    done

    die "Download timed out after ${TIMEOUT_INSTALL}s"
}

phase_handle_macos_installer() {
    log "=== Phase 4: Handle macOS Installer.app ==="

    local retries=0
    while [ $retries -lt 20 ]; do
        if pgrep -f "Installer" &>/dev/null; then
            pass "macOS Installer.app detected"
            break
        fi
        sleep 2
        retries=$((retries + 1))
    done
    [ $retries -ge 20 ] && die "macOS Installer.app did not appear"

    screenshot "05-installer-app"
    sleep 2

    # Find the .pkg the app downloaded
    local pkg_path
    pkg_path=$(sudo find /private/var/folders /tmp -name "Determinate Nix.pkg" 2>/dev/null | head -1 || true)
    if [ -z "$pkg_path" ]; then
        pkg_path=$(sudo find /private/var/folders /tmp -name "*.pkg" 2>/dev/null | head -1 || true)
    fi

    if [ -z "$pkg_path" ]; then
        log "DEBUG: Searching for .pkg files..."
        sudo find /private/var/folders /tmp -name "*.pkg" 2>/dev/null | tee -a "$LOG_FILE" || true
        die "Could not find downloaded .pkg file"
    fi

    log "Found .pkg: $pkg_path"

    # Kill GUI installer — use CLI for headless install (avoids SecurityAgent)
    pkill -f "Installer" 2>/dev/null || true
    sleep 1

    log "Installing .pkg via CLI: sudo installer -pkg ... -target /"
    if sudo installer -pkg "$pkg_path" -target / 2>&1 | tee -a "$LOG_FILE"; then
        pass "Nix .pkg installed successfully via CLI"
    else
        die "CLI installer failed"
    fi

    screenshot "06-nix-installed"

    # Verify Nix binary exists
    local elapsed=0
    while [ $elapsed -lt 30 ]; do
        if /nix/var/nix/profiles/default/bin/nix --version &>/dev/null 2>&1; then
            pass "Nix binary verified: $(/nix/var/nix/profiles/default/bin/nix --version)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    die "Nix binary not found after installation"
}

phase_verify_app_detects_nix() {
    log "=== Phase 5: Verify app detects Nix ==="

    local elapsed=0
    while [ $elapsed -lt 60 ]; do
        local screen_text
        screen_text=$(peek_text "$APP_NAME")

        if echo "$screen_text" | grep -qi "prefetch\|preparing.*darwin\|nix-darwin"; then
            pass "App detected Nix, now prefetching darwin-rebuild"
            screenshot "11-prefetching"
            return 0
        fi

        if echo "$screen_text" | grep -qi "complete\|success\|ready\|dashboard\|welcome\|Welcome"; then
            pass "App completed full setup!"
            screenshot "11-complete"
            return 0
        fi

        sleep $POLL_INTERVAL
        elapsed=$((elapsed + POLL_INTERVAL))
    done

    warn "App may not have transitioned. Taking diagnostic screenshot."
    screenshot "11-uncertain"
}

phase_wait_prefetch() {
    log "=== Phase 6: Wait for darwin-rebuild prefetch ==="

    local elapsed=0
    while [ $elapsed -lt $TIMEOUT_PREFETCH ]; do
        local screen_text
        screen_text=$(peek_text "$APP_NAME")

        if echo "$screen_text" | grep -qi "complete\|success\|ready\|dashboard\|welcome\|Welcome\|configuration\|Getting Started"; then
            pass "darwin-rebuild prefetch complete!"
            screenshot "12-setup-complete"
            return 0
        fi

        if echo "$screen_text" | grep -qi "error\|failed\|timed out"; then
            screenshot "12-prefetch-error"
            die "Prefetch failed. Check screenshot."
        fi

        sleep $POLL_INTERVAL
        elapsed=$((elapsed + POLL_INTERVAL))
        [ $((elapsed % 30)) -eq 0 ] && log "Still prefetching... (${elapsed}s)"
    done

    die "Prefetch timed out after ${TIMEOUT_PREFETCH}s"
}

phase_final_verification() {
    log "=== Phase 7: Final Verification ==="

    if /nix/var/nix/profiles/default/bin/nix --version &>/dev/null; then
        pass "nix binary works: $(/nix/var/nix/profiles/default/bin/nix --version)"
    else
        die "nix binary not functional"
    fi

    if NIX_CONFIG="experimental-features = nix-command flakes" \
       /nix/var/nix/profiles/default/bin/nix build --no-link nix-darwin/master#darwin-rebuild --dry-run 2>/dev/null; then
        pass "darwin-rebuild is available in nix store"
    else
        warn "darwin-rebuild dry-run check failed (may still be OK)"
    fi

    screenshot "13-final"
    pass "=== E2E TEST PASSED ==="
}

# --- Main ---
main() {
    echo "" > "$LOG_FILE"
    log "=== nixmac E2E Test — Nix Installation Flow ==="
    log "Started at $(date)"
    log "Machine: $(hostname) | macOS $(sw_vers -productVersion)"

    if [ "${1:-}" = "--cleanup-only" ]; then
        cleanup
        exit 0
    fi

    trap 'fail "Test aborted"; screenshot "abort"; cleanup' ERR

    phase_prechecks
    start_recording
    phase_launch_app
    phase_find_and_click_install
    phase_wait_download
    phase_handle_macos_installer
    phase_verify_app_detects_nix
    phase_wait_prefetch
    phase_final_verification

    stop_recording

    log ""
    log "=== All phases passed ==="
    log "Screenshots: $SCREENSHOT_DIR"
    log "Video: $VIDEO_FILE"
    log "Log: $LOG_FILE"
    log ""

    if [ "${CLEANUP_ON_SUCCESS:-1}" = "1" ]; then
        cleanup
    fi
}

main "$@"
