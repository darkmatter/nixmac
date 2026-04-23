#!/bin/bash
# =============================================================================
# macos-e2e — macOS app lifecycle management
#
# Generic helpers for launching, quitting, and managing macOS apps.
# App-specific adapters (in adapters/) configure the app name/path.
# =============================================================================

# --- App lifecycle ---

# Launch an app by path or name
app_launch() {
    local app_path="$1"
    local app_name="${2:-$(basename "$app_path" .app)}"
    local wait="${3:-5}"
    
    log "Launching $app_name..."
    open "$app_path"
    sleep "$wait"
    
    if pgrep -f "$app_name" &>/dev/null; then
        pass "App launched: $app_name"
        return 0
    else
        fail "App failed to launch: $app_name"
        return 1
    fi
}

# Quit an app gracefully via Peekaboo, then force-kill if needed
app_quit() {
    local app_name="$1"
    
    peekaboo_run app quit --app "$app_name" 2>/dev/null || true
    sleep 1
    
    if pgrep -f "$app_name" &>/dev/null; then
        debug "App still running, force-killing..."
        pkill -f "$app_name" 2>/dev/null || true
        sleep 1
    fi
    
    if ! pgrep -f "$app_name" &>/dev/null; then
        debug "App quit: $app_name"
    else
        warn "Could not quit $app_name"
    fi
}

# Check if an app is running
app_is_running() {
    local app_name="$1"
    pgrep -f "$app_name" &>/dev/null
}

# Wait for an app process to appear
app_wait_for_process() {
    local process_name="$1"
    local timeout="${2:-30}"
    
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if pgrep -f "$process_name" &>/dev/null; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    return 1
}

# Wait for an app process to disappear
app_wait_for_exit() {
    local process_name="$1"
    local timeout="${2:-30}"
    
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if ! pgrep -f "$process_name" &>/dev/null; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    return 1
}

# Install a .pkg file via CLI (bypasses SecurityAgent GUI)
pkg_install() {
    local pkg_path="$1"
    local target="${2:-/}"
    
    log "Installing .pkg via CLI: $pkg_path"
    if sudo installer -pkg "$pkg_path" -target "$target" 2>&1 | tee -a "$E2E_LOG_FILE"; then
        pass ".pkg installed successfully"
        return 0
    else
        fail ".pkg installation failed"
        return 1
    fi
}

# Find a .pkg file (search common locations)
pkg_find() {
    local name_pattern="${1:-*.pkg}"
    sudo find /private/var/folders /tmp -name "$name_pattern" 2>/dev/null | head -1 || true
}

# Kill macOS Installer.app if running
installer_kill() {
    pkill -f "Installer" 2>/dev/null || true
    sleep 1
}
