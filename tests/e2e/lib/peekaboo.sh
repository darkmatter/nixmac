#!/bin/bash
# =============================================================================
# macos-e2e — Peekaboo GUI automation library
#
# Wraps Peekaboo CLI for element discovery, clicking, typing, and text reading.
# Handles transient failures gracefully (retries, fallback to empty results).
# =============================================================================

# Resolve peekaboo binary
PEEKABOO="${PEEKABOO:-$(command -v peekaboo 2>/dev/null || echo "peekaboo")}"
PEEKABOO_COMMAND_TIMEOUT="${PEEKABOO_COMMAND_TIMEOUT:-15}"

# --- Low-level helpers ---

peekaboo_run() {
    run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" "$PEEKABOO" "$@"
}

# Get all UI elements as JSON. Returns fallback JSON on failure.
peek_elements() {
    local app="${1:-}"
    local args=""
    [ -n "$app" ] && args="--app $app"
    # shellcheck disable=SC2086
    peekaboo_run see $args --json 2>/dev/null \
        || echo '{"data":{"ui_elements":[],"snapshot_id":""}}'
}

# Get snapshot ID from a peek_elements JSON blob
peek_snapshot_id() {
    local json="$1"
    echo "$json" | jq -r '.data.snapshot_id // ""' 2>/dev/null
}

# Find a button by label pattern. Returns element ID or empty string.
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

# Find any element by role and label pattern
peek_find_element() {
    local json="$1"
    local role="$2"
    local pattern="$3"
    echo "$json" | jq -r "
        .data.ui_elements[]? |
        select(.role == \"$role\") |
        select(.label? // .title? // .value? // \"\" | test(\"$pattern\"; \"i\")) |
        .id
    " 2>/dev/null | head -1
}

# Click an element using its ID and a snapshot
peek_click() {
    local element_id="$1"
    local json="$2"
    local snap_id
    snap_id=$(peek_snapshot_id "$json")
    if [ -z "$snap_id" ]; then
        warn "No snapshot ID for click on $element_id"
        return 1
    fi
    debug "Clicking $element_id (snapshot: $snap_id)"
    peekaboo_run click --on "$element_id" --snapshot "$snap_id" 2>&1
}




# Get all visible text from an app's UI
peek_text() {
    local app="${1:-}"
    local json
    json=$(peek_elements "$app") || true
    echo "$json" | jq -r '
        [.data.ui_elements[]? | .label? // ""] | join(" ")
    ' 2>/dev/null || echo ""
}

# --- High-level helpers ---

# Take a screenshot (annotated by Peekaboo)
screenshot() {
    local name="${1:-screenshot}"
    local app="${2:-}"
    local path="${E2E_SCREENSHOT_DIR}/${name}-$(date +%s).png"
    local args=""
    [ -n "$app" ] && args="--app $app"
    # shellcheck disable=SC2086
    peekaboo_run see $args --annotate --path "$path" 2>/dev/null \
        || peekaboo_run image --mode screen --path "$path" 2>/dev/null \
        || true
    log "Screenshot saved: $path"
    echo "$path"
}

# Wait for text to appear in an app's UI. Returns 0 on match, 1 on timeout.
# Usage: wait_for_text "pattern" [--app name] [--timeout 60] [--interval 3]
wait_for_text() {
    local pattern="$1"; shift
    local app="" timeout=60 interval=3
    
    while [ $# -gt 0 ]; do
        case "$1" in
            --app) app="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            --interval) interval="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local text
        text=$(peek_text "$app")
        if echo "$text" | grep -qiE "$pattern"; then
            debug "Found text matching '$pattern' after ${elapsed}s"
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
        [ $((elapsed % 30)) -eq 0 ] && log "Still waiting for '$pattern'... (${elapsed}s)"
    done
    
    warn "Timed out waiting for text '$pattern' after ${timeout}s"
    return 1
}

# Wait for a button to appear and return its element ID
# Usage: wait_for_button "pattern" [--app name] [--timeout 60]
wait_for_button() {
    local pattern="$1"; shift
    local app="" timeout=60 interval=3
    
    while [ $# -gt 0 ]; do
        case "$1" in
            --app) app="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            --interval) interval="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local json
        json=$(peek_elements "$app")
        local btn
        btn=$(peek_find_button "$json" "$pattern")
        if [ -n "$btn" ]; then
            debug "Found button matching '$pattern': $btn"
            echo "$btn"
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done
    
    warn "Timed out waiting for button '$pattern' after ${timeout}s"
    return 1
}

# Click a button by label pattern. Finds it, clicks it.
# Usage: click_button "Install" [--app name] [--timeout 30]
click_button() {
    local pattern="$1"; shift
    local app="" timeout=30
    
    while [ $# -gt 0 ]; do
        case "$1" in
            --app) app="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    
    local json
    json=$(peek_elements "$app")
    local btn
    btn=$(peek_find_button "$json" "$pattern")
    
    if [ -z "$btn" ]; then
        # Retry with wait
        log "Button '$pattern' not found, waiting up to ${timeout}s..."
        local elapsed=0
        while [ $elapsed -lt $timeout ]; do
            sleep 3
            elapsed=$((elapsed + 3))
            json=$(peek_elements "$app")
            btn=$(peek_find_button "$json" "$pattern")
            [ -n "$btn" ] && break
        done
    fi
    
    if [ -z "$btn" ]; then
        fail "Button '$pattern' not found after ${timeout}s"
        return 1
    fi
    
    log "Clicking button: $btn (matched '$pattern')"
    peek_click "$btn" "$json"
}

# Dismiss system dialogs (Allow, OK, Open, Continue).
#
# Scans ALL windows (not app-scoped) so macOS-level permission prompts
# that float above the app are detected. Clicks the affirmative button
# (Allow, OK, Open, Continue) and avoids negative buttons (Don't Allow,
# Cancel). Repeats up to max_attempts times with a short pause between
# each to catch sequential dialogs (e.g. Desktop then Documents access).
dismiss_dialogs() {
    local max_attempts="${1:-5}"
    local i=0
    while [ $i -lt $max_attempts ]; do
        local json
        # No --app flag: scan the entire screen so we catch system dialogs
        json=$(peek_elements)
        
        # Look for affirmative buttons in system dialogs.
        # Use exact-match patterns to avoid matching "Don't Allow".
        local dialog_button
        dialog_button=$(echo "$json" | jq -r '
            .data.ui_elements[]? |
            select(.role == "button") |
            select(.label? // .title? // "" | test("^(Allow|OK|Open|Continue|Grant Access)$"; "i")) |
            .id
        ' 2>/dev/null | head -1)
        
        if [ -n "$dialog_button" ]; then
            log "Dismissing system dialog (clicking $dialog_button)..."
            peek_click "$dialog_button" "$json" || true
            sleep 2
        else
            break
        fi
        i=$((i + 1))
    done
}

# --- Type and key press ---

peek_type() {
    local text="$1"
    peekaboo_run type --text "$text" 2>&1 || peekaboo_run type "$text" 2>&1
}

peek_press() {
    local key="$1"
    peekaboo_run press "$key" 2>&1
}

peek_hotkey() {
    local combo="$1"
    peekaboo_run hotkey "$combo" 2>&1
}

# --- Screen unlock ---

# Unlock the macOS lock screen by typing the admin password.
# Required when the runner's screen auto-locks between runs.
screen_unlock() {
    local password="${ADMIN_PASSWORD:-}"
    if [ -z "$password" ]; then
        warn "No ADMIN_PASSWORD set, cannot unlock screen"
        return 1
    fi
    
    local json elements has_login
    json=$(peek_elements)
    elements=$(echo "$json" | jq -r '.data.ui_elements | length' 2>/dev/null || echo "0")
    elements="${elements//[^0-9]/}"; [ -z "$elements" ] && elements=0
    has_login=$(echo "$json" | jq -r '.data.ui_elements[]? | .label // ""' 2>/dev/null | grep -ci "Login" || true)
    
    if [ "$has_login" -gt 0 ] && [ "$elements" -lt 50 ]; then
        log "Screen appears locked/logged out ($elements elements, login detected). Unlocking..."
        caffeinate -u -t 2 &>/dev/null &
        sleep 1
        
        # Check if this is a full login screen (has user icons/buttons) vs lock screen
        local has_user_elem snap_id
        has_user_elem=$(echo "$json" | jq -r '.data.ui_elements[]? | select(.label == "admin" or .label == "Admin") | .id' 2>/dev/null | head -1)
        snap_id=$(echo "$json" | jq -r '.data.snapshot_id // ""' 2>/dev/null)
        
        if [ -n "$has_user_elem" ] && [ -n "$snap_id" ]; then
            # Full login screen — click user first
            log "Login screen detected. Clicking user '$has_user_elem'..."
            peekaboo_run click --on "$has_user_elem" --snapshot "$snap_id" 2>/dev/null || true
            sleep 2
        else
            # Lock screen — just wake + type
            peek_press "space" || true
            sleep 2
        fi
        
        peek_type "$password"
        sleep 1
        peek_press "return"
        sleep 5
        
        # Verify unlock
        json=$(peek_elements)
        elements=$(echo "$json" | jq -r '.data.ui_elements | length' 2>/dev/null || echo "0")
        elements="${elements//[^0-9]/}"; [ -z "$elements" ] && elements=0
        if [ "$elements" -gt 50 ]; then
            pass "Screen unlocked ($elements elements visible)"
            return 0
        else
            fail "Failed to unlock screen (only $elements elements)"
            return 1
        fi
    else
        debug "Screen is not locked ($elements elements visible)"
    fi
}

# Prevent screen from locking during test
screen_prevent_lock() {
    # Disable screensaver
    defaults -currentHost write com.apple.screensaver idleTime 0 2>/dev/null || true
    # Keep display awake for 2 hours
    caffeinate -d -t 7200 &>/dev/null &
    debug "Screen lock prevention active"
}

# --- Peekaboo preflight ---

peekaboo_check() {
    if ! peekaboo_run bridge status 2>&1 | grep -qE "remote (gui|onDemand)"; then
        warn "Peekaboo bridge status:"
        peekaboo_run bridge status 2>&1 || true
        die "Peekaboo Bridge not connected. Ensure Peekaboo.app is running."
    fi
    pass "Peekaboo Bridge connected"
    
    if ! peekaboo_run permissions 2>&1 | grep -qi "Screen Recording.*Granted" \
        && ! peekaboo_run permissions status 2>&1 | grep -qi "Screen Recording.*Granted" \
        && ! peekaboo_run list permissions 2>&1 | grep -qi "Screen Recording.*Granted"; then
        die "Screen Recording permission not granted to Peekaboo"
    fi
    pass "Peekaboo permissions OK"
    
    # Unlock screen if locked
    screen_unlock || true
    
    # Prevent future locking
    screen_prevent_lock
}
