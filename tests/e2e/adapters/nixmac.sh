#!/bin/bash
# =============================================================================
# macos-e2e — nixmac adapter
#
# App-specific configuration and helpers for testing the nixmac Tauri app.
# Sourced by the runner when E2E_ADAPTER=nixmac.
# =============================================================================

# --- Config ---
NIXMAC_APP_NAME="nixmac"
NIXMAC_APP_PATH="${NIXMAC_APP_PATH:-/Applications/nixmac.app}"
NIXMAC_BUNDLE_ID="com.darkmatter.nixmac"
NIX_INSTALLER="/nix/nix-installer"
NIX_BINARY="/nix/var/nix/profiles/default/bin/nix"

# Clear app state (Tauri webview, sqlite DB, caches)
# Required between runs so the app shows the install screen fresh
nixmac_clear_state() {
    log "Clearing nixmac app state..."
    rm -rf ~/Library/Application\ Support/${NIXMAC_BUNDLE_ID} 2>/dev/null || true
    rm -rf ~/Library/WebKit/${NIXMAC_BUNDLE_ID} 2>/dev/null || true
    rm -rf ~/Library/Caches/${NIXMAC_BUNDLE_ID} 2>/dev/null || true
    rm -rf ~/Library/Saved\ Application\ State/${NIXMAC_BUNDLE_ID}.savedState 2>/dev/null || true
    defaults delete ${NIXMAC_BUNDLE_ID} 2>/dev/null || true
    pass "App state cleared"
}

# --- Nix helpers ---

nix_is_installed() {
    [ -f "$NIX_BINARY" ] && "$NIX_BINARY" --version &>/dev/null 2>&1
}

nix_version() {
    "$NIX_BINARY" --version 2>/dev/null || echo "not installed"
}

nix_uninstall() {
    if [ -f "$NIX_INSTALLER" ]; then
        log "Uninstalling Nix..."
        sudo "$NIX_INSTALLER" uninstall --no-confirm 2>&1 | tee -a "$E2E_LOG_FILE"
        pass "Nix uninstalled"
    else
        debug "No Nix installer found at $NIX_INSTALLER — skipping uninstall"
    fi
}

nix_ensure_clean() {
    if nix_is_installed; then
        warn "Nix is installed. Uninstalling for clean state..."
        nix_uninstall
    fi
    pass "Nix is not installed (clean state)"
}

nix_verify() {
    if nix_is_installed; then
        pass "Nix binary works: $(nix_version)"
        return 0
    else
        fail "Nix binary not functional"
        return 1
    fi
}

nix_wait_for_binary() {
    local timeout="${1:-30}"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if nix_is_installed; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    return 1
}

# --- nixmac app helpers ---

nixmac_launch() {
    local wait="${1:-8}"
    app_launch "$NIXMAC_APP_PATH" "$NIXMAC_APP_NAME" "$wait"
    
    # Bail early if process isn't even running (crash on launch)
    if ! app_is_running "$NIXMAC_APP_NAME"; then
        # Grab any crash info before failing
        local crash_log
        crash_log=$(find ~/Library/Logs/DiagnosticReports -name "*nixmac*" -newer "$E2E_LOG_FILE" 2>/dev/null | head -1)
        if [ -n "$crash_log" ]; then
            log "Crash report found: $crash_log"
            head -30 "$crash_log" 2>/dev/null | tee -a "$E2E_LOG_FILE"
        fi
        die "nixmac process not running after launch — app likely crashed on startup"
    fi
    
    # macOS shows permission dialogs (Desktop/Documents access) on first launch.
    # Accept them immediately so they don't block the app's permission check flow.
    sleep 2
    dismiss_dialogs 10
    
    # Tauri apps may start without a visible window. Bring to front.
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" 2>/dev/null || true
    sleep 1
    
    # Verify we can see the window
    local retries=0
    while [ $retries -lt 5 ]; do
        # Re-check process is alive (may have crashed after initial launch)
        if ! app_is_running "$NIXMAC_APP_NAME"; then
            die "nixmac process died during window wait (crash after launch)"
        fi
        
        # Dismiss any late-appearing system dialogs (e.g. Documents access
        # appears after Desktop access is granted)
        dismiss_dialogs 3
        
        local json
        json=$(peek_elements "$NIXMAC_APP_NAME") || true
        local count
        count=$(echo "$json" | jq -r '.data.ui_elements | length' 2>/dev/null || echo "0")
        count="${count//[^0-9]/}"  # strip non-numeric chars
        [ -z "$count" ] && count=0
        if [ "$count" -gt 1 ]; then
            debug "nixmac window visible ($count elements)"
            return 0
        fi
        debug "Window not visible yet, retrying... ($retries)"
        peekaboo_run app switch --to "$NIXMAC_APP_NAME" 2>/dev/null || true
        sleep 3
        retries=$((retries + 1))
    done
    
    die "nixmac window not visible after 15s (app is running but UI did not render)"
}

nixmac_quit() {
    app_quit "$NIXMAC_APP_NAME"
}

nixmac_text() {
    peek_text "$NIXMAC_APP_NAME"
}

nixmac_screenshot() {
    screenshot "${1:-nixmac}" "$NIXMAC_APP_NAME"
}

nixmac_click_button() {
    click_button "$1" --app "$NIXMAC_APP_NAME" "${@:2}"
}

nixmac_wait_for_text() {
    wait_for_text "$1" --app "$NIXMAC_APP_NAME" "${@:2}"
}

nixmac_wait_for_button() {
    wait_for_button "$1" --app "$NIXMAC_APP_NAME" "${@:2}"
}

# Wait for the app to show the Nix install button (initial state)
nixmac_wait_for_install_screen() {
    local timeout="${1:-30}"
    if nixmac_wait_for_button "[Ii]nstall.*[Nn]ix|^[Ii]nstall$" --timeout "$timeout"; then
        pass "Install screen loaded"
        return 0
    else
        fail "Install screen did not appear within ${timeout}s"
        return 1
    fi
}

# Click "Install Nix" and handle system dialogs
nixmac_click_install() {
    dismiss_dialogs
    nixmac_screenshot "pre-install"
    
    local json
    json=$(peek_elements "$NIXMAC_APP_NAME")
    local btn
    btn=$(peek_find_button "$json" "[Ii]nstall.*[Nn]ix|^[Ii]nstall$")
    
    if [ -z "$btn" ]; then
        fail "Install button not found"
        return 1
    fi
    
    log "Found install button: $btn"
    peek_click "$btn" "$json"
    pass "Clicked Install button"
    sleep 2
    nixmac_screenshot "after-click-install"
}

# Wait for .pkg download (Installer.app opens when download completes)
nixmac_wait_for_download() {
    local timeout="${1:-300}"
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        if pgrep -f "Installer" &>/dev/null; then
            pass "Installer.app detected — download complete"
            return 0
        fi
        
        local text
        text=$(nixmac_text)
        if echo "$text" | grep -qi "error\|failed"; then
            nixmac_screenshot "download-error"
            fail "Download failed"
            return 1
        fi
        
        sleep 3
        elapsed=$((elapsed + 3))
        [ $((elapsed % 30)) -eq 0 ] && log "Still downloading... (${elapsed}s)"
    done
    
    fail "Download timed out after ${timeout}s"
    return 1
}

# Handle the macOS .pkg installer (CLI bypass)
nixmac_handle_pkg_install() {
    nixmac_screenshot "installer-app"
    sleep 2
    
    local pkg_path
    pkg_path=$(pkg_find "Determinate Nix.pkg")
    if [ -z "$pkg_path" ]; then
        pkg_path=$(pkg_find "*.pkg")
    fi
    
    if [ -z "$pkg_path" ]; then
        fail "Could not find downloaded .pkg file"
        return 1
    fi
    
    log "Found .pkg: $pkg_path"
    
    # Kill GUI installer, use CLI
    installer_kill
    pkg_install "$pkg_path"
    
    nixmac_screenshot "nix-installed"
    
    # Wait for binary
    if nix_wait_for_binary 30; then
        pass "Nix binary verified: $(nix_version)"
    else
        fail "Nix binary not found after installation"
        return 1
    fi
}

# Wait for app to detect Nix and start prefetching
nixmac_wait_for_detection() {
    local timeout="${1:-60}"
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        local text
        text=$(nixmac_text)
        
        if echo "$text" | grep -qi "prefetch\|preparing.*darwin\|nix-darwin"; then
            pass "App detected Nix, prefetching darwin-rebuild"
            nixmac_screenshot "prefetching"
            return 0
        fi
        
        if echo "$text" | grep -qi "complete\|success\|ready\|dashboard\|welcome\|Welcome\|Getting Started"; then
            pass "App completed full setup"
            nixmac_screenshot "setup-complete"
            return 0
        fi
        
        sleep 3
        elapsed=$((elapsed + 3))
    done
    
    warn "App detection uncertain after ${timeout}s"
    nixmac_screenshot "detection-uncertain"
    return 1
}

# Wait for darwin-rebuild prefetch to complete
nixmac_wait_for_prefetch() {
    local timeout="${1:-300}"
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        local text
        text=$(nixmac_text)
        
        if echo "$text" | grep -qi "complete\|success\|ready\|dashboard\|welcome\|Welcome\|configuration\|Getting Started"; then
            pass "darwin-rebuild prefetch complete"
            nixmac_screenshot "setup-complete"
            return 0
        fi
        
        if echo "$text" | grep -qi "error\|failed\|timed out"; then
            nixmac_screenshot "prefetch-error"
            fail "Prefetch failed"
            return 1
        fi
        
        sleep 3
        elapsed=$((elapsed + 3))
        [ $((elapsed % 30)) -eq 0 ] && log "Still prefetching... (${elapsed}s)"
    done
    
    fail "Prefetch timed out after ${timeout}s"
    return 1
}

# --- Adapter cleanup ---

adapter_cleanup() {
    nixmac_quit
    installer_kill
    if [ "${E2E_CLEANUP_NIX:-1}" = "1" ] && nix_is_installed; then
        nix_uninstall
    fi
}
