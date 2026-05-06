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
PEEKABOO_BRIDGE_TIMEOUT="${PEEKABOO_BRIDGE_TIMEOUT:-6}"

# --- Low-level helpers ---

peekaboo_run() {
    run_with_timeout "$PEEKABOO_COMMAND_TIMEOUT" "$PEEKABOO" "$@"
}

peekaboo_bridge_status_text() {
    local PEEKABOO_COMMAND_TIMEOUT="$PEEKABOO_BRIDGE_TIMEOUT"
    peekaboo_run bridge status --verbose 2>&1 || true
}

peekaboo_bridge_is_remote() {
    peekaboo_bridge_status_text | grep -qE "Selected: remote (gui|onDemand)"
}

peekaboo_restore_active_app() {
    local app="${1:-${E2E_ACTIVE_APP_NAME:-}}"
    local min_elements="${2:-2}"
    local timeout="${3:-10}"
    local deadline json count

    [ -n "$app" ] || return 0
    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        peekaboo_run app switch --to "$app" >/dev/null 2>&1 || true
        json=$(peekaboo_run see --app "$app" --json 2>/dev/null || peekaboo_empty_elements_json)
        count=$(peekaboo_element_count "$json")
        if [ "$count" -ge "$min_elements" ]; then
            debug "Restored active app $app ($count element(s))"
            return 0
        fi
        sleep 1
    done

    warn "Timed out restoring active app $app"
    return 1
}

peekaboo_recover_bridge() {
    [ "${E2E_PEEKABOO_RECOVER_BRIDGE:-1}" = "1" ] || return 1

    warn "Peekaboo Bridge is not selected remote; restarting Peekaboo.app..."
    pkill -f "Peekaboo.app/Contents/MacOS/Peekaboo" 2>/dev/null || true
    sleep 2
    open -a Peekaboo 2>/dev/null || true

    local retries=0
    while [ "$retries" -lt 8 ]; do
        sleep 2
        if peekaboo_bridge_is_remote; then
            peekaboo_restore_active_app "" 2 10 >/dev/null 2>&1 || true
            pass "Peekaboo Bridge recovered"
            return 0
        fi
        retries=$((retries + 1))
    done

    warn "Peekaboo Bridge recovery did not restore remote mode"
    return 1
}

peekaboo_ensure_bridge_remote() {
    peekaboo_bridge_is_remote || peekaboo_recover_bridge
}

peekaboo_desktop_dir() {
    echo "${E2E_DESKTOP_DIR:-$HOME/Desktop}"
}

peekaboo_generated_desktop_files() {
    local marker="${1:-}"
    local desktop
    desktop="$(peekaboo_desktop_dir)"
    [ -d "$desktop" ] || return 0

    if [ -n "$marker" ] && [ -f "$marker" ]; then
        find "$desktop" -maxdepth 1 -type f \( \
            -name "peekaboo_*.png" -o \
            -name "peekaboo-*.png" -o \
            -name "peekaboo_*.jpg" -o \
            -name "peekaboo-*.jpg" \
        \) -newer "$marker" -print 2>/dev/null
    else
        find "$desktop" -maxdepth 1 -type f \( \
            -name "peekaboo_*.png" -o \
            -name "peekaboo-*.png" -o \
            -name "peekaboo_*.jpg" -o \
            -name "peekaboo-*.jpg" \
        \) -print 2>/dev/null
    fi
}

peekaboo_cleanup_desktop_artifacts() {
    [ "${E2E_CLEAN_DESKTOP_ARTIFACTS:-1}" = "1" ] || return 0

    local marker="${1:-}"
    local removed=0
    local artifact
    while IFS= read -r artifact; do
        [ -n "$artifact" ] || continue
        rm -f "$artifact" 2>/dev/null || true
        removed=$((removed + 1))
    done < <(peekaboo_generated_desktop_files "$marker")

    if [ "$removed" -gt 0 ]; then
        debug "Removed $removed Peekaboo Desktop artifact(s)"
    fi
}

peekaboo_latest_desktop_artifact_since() {
    local marker="$1"
    peekaboo_generated_desktop_files "$marker" \
        | while IFS= read -r artifact; do
            [ -f "$artifact" ] || continue
            stat -f "%m %N" "$artifact" 2>/dev/null || true
        done \
        | sort -nr \
        | head -1 \
        | cut -d' ' -f2-
}

peekaboo_empty_elements_json() {
    echo '{"data":{"ui_elements":[],"snapshot_id":""}}'
}

peekaboo_element_count() {
    local json="$1"
    local count
    count=$(echo "$json" | jq -r '.data.ui_elements | length' 2>/dev/null || echo "0")
    count="${count//[^0-9]/}"
    [ -n "$count" ] || count=0
    echo "$count"
}

peekaboo_diagnostic_dir() {
    local root="${E2E_DIAGNOSTIC_DIR:-}"
    if [ -z "$root" ]; then
        root="${E2E_ARTIFACT_ROOT:-${E2E_SCREENSHOT_DIR:-/tmp}}/${E2E_SCENARIO_NAME:-unknown}/diagnostics"
    fi
    mkdir -p "$root"
    echo "$root"
}

peekaboo_capture_app_diagnostics() {
    local app="$1"
    local reason="${2:-empty-elements}"
    [ "${E2E_PEEKABOO_DIAGNOSTICS:-1}" = "1" ] || return 0

    local dir stamp prefix
    dir=$(peekaboo_diagnostic_dir)
    stamp=$(date -u +"%Y%m%dT%H%M%SZ")
    prefix="$dir/${stamp}-${app//[^a-zA-Z0-9._-]/_}-${reason//[^a-zA-Z0-9._-]/_}"

    peekaboo_run bridge status --verbose > "${prefix}-bridge.txt" 2>&1 || true
    peekaboo_run permissions > "${prefix}-permissions.txt" 2>&1 || true
    peekaboo_run app list --json > "${prefix}-app-list.json" 2>&1 || true
    peekaboo_run window list --app "$app" --json > "${prefix}-window-list.json" 2>&1 || true
    peekaboo_run image --mode screen --path "${prefix}-screen.png" > "${prefix}-screen.txt" 2>&1 || true
    echo "[diagnostic] Captured Peekaboo diagnostics for $app ($reason): $prefix-*" >> "$E2E_LOG_FILE"
}

peekaboo_app_pid() {
    local app="$1"
    local bundle="${E2E_ACTIVE_BUNDLE_ID:-}"
    local json pid
    json=$(peekaboo_run app list --json 2>/dev/null || echo '{}')
    pid=$(echo "$json" | jq -r --arg app "$app" --arg bundle "$bundle" '
        [
            .. | objects |
            select(
                (.pid? != null) and (
                    ((.name? // "") == $app) or
                    ($bundle != "" and ((.bundle_id? // .bundleId? // "") == $bundle))
                )
            ) |
            .pid
        ][0] // ""
    ' 2>/dev/null | head -1)
    echo "$pid"
}

# Get all UI elements as JSON. Returns fallback JSON on failure.
peek_elements() {
    local app="${1:-}"
    local args=()
    [ -n "$app" ] && args=(--app "$app")
    if [ "${E2E_PEEKABOO_CAPTURE_EVERY_SEE:-0}" = "1" ] && [ -n "${E2E_PEEKABOO_CAPTURE_DIR:-}" ]; then
        mkdir -p "$E2E_PEEKABOO_CAPTURE_DIR"
        args+=("--path" "$E2E_PEEKABOO_CAPTURE_DIR/see-$(date +%s)-$$-$RANDOM.png")
    fi

    local json count recovered pid pid_json pid_count
    if [ "${#args[@]}" -gt 0 ]; then
        json=$(peekaboo_run see "${args[@]}" --json 2>/dev/null || peekaboo_empty_elements_json)
    else
        json=$(peekaboo_run see --json 2>/dev/null || peekaboo_empty_elements_json)
    fi

    if [ -n "$app" ]; then
        count=$(peekaboo_element_count "$json")
        if [ "$count" -le 1 ]; then
            recovered=0
            if ! peekaboo_bridge_is_remote; then
                if ! peekaboo_recover_bridge >/dev/null; then
                    echo "[diagnostic] E2E_INFRA: Peekaboo Bridge is not selected remote while reading $app" >> "$E2E_LOG_FILE"
                    echo "$json"
                    return 0
                fi
                recovered=1
            fi
            if [ "$recovered" -eq 1 ]; then
                peekaboo_restore_active_app "$app" 2 10 >/dev/null 2>&1 || true
                if [ "${#args[@]}" -gt 0 ]; then
                    json=$(peekaboo_run see "${args[@]}" --json 2>/dev/null || peekaboo_empty_elements_json)
                else
                    json=$(peekaboo_run see --json 2>/dev/null || peekaboo_empty_elements_json)
                fi
                count=$(peekaboo_element_count "$json")
            fi
            if [ "${E2E_PEEKABOO_SUPPRESS_EMPTY_DIAG:-0}" != "1" ]; then
                peekaboo_capture_app_diagnostics "$app" "empty-app-scope"
            fi
            pid=$(peekaboo_app_pid "$app")
            if [ -n "$pid" ]; then
                local pid_args=(--pid "$pid")
                if [ "${E2E_PEEKABOO_CAPTURE_EVERY_SEE:-0}" = "1" ] && [ -n "${E2E_PEEKABOO_CAPTURE_DIR:-}" ]; then
                    mkdir -p "$E2E_PEEKABOO_CAPTURE_DIR"
                    pid_args+=("--path" "$E2E_PEEKABOO_CAPTURE_DIR/see-pid-$pid-$(date +%s)-$$-$RANDOM.png")
                fi
                pid_json=$(peekaboo_run see "${pid_args[@]}" --json 2>/dev/null || peekaboo_empty_elements_json)
                pid_count=$(peekaboo_element_count "$pid_json")
                if [ "$pid_count" -gt "$count" ]; then
                    debug "Peekaboo app-scoped read for $app returned $count element(s); pid $pid returned $pid_count"
                    echo "$pid_json"
                    return 0
                fi
            fi
        fi
    fi

    echo "$json"
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

peek_ranked_elements() {
    local json="$1"
    local pattern="$2"
    local role="${3:-}"
    local limit="${4:-1}"

    echo "$json" | jq -c --arg pattern "$pattern" --arg role "$role" --argjson limit "$limit" '
        def text($value): ($value // "" | tostring);
        def role_ok:
            ($role == "") or (text(.role) | test($role; "i"));
        def bounds:
            (.bounds? // .frame? // .rect? // {});
        def area:
            bounds as $bounds |
            (($bounds.width // 999999) * ($bounds.height // 999999));
        def clip($value):
            (text($value) | gsub("[\r\n\t]+"; " ") | if length > 96 then .[0:93] + "..." else . end);
        def field_hits:
            [
                if (text(.identifier) | test($pattern; "i")) then { field: "identifier", score: 0, value: clip(.identifier) } else empty end,
                if (text(.label) | test($pattern; "i")) then { field: "label", score: 10, value: clip(.label) } else empty end,
                if (text(.title) | test($pattern; "i")) then { field: "title", score: 12, value: clip(.title) } else empty end,
                if (text(.value) | test($pattern; "i")) then { field: "value", score: 30, value: clip(.value) } else empty end,
                if (text(.description) | test($pattern; "i")) then { field: "description", score: 40, value: clip(.description) } else empty end
            ];

        [
            .data.ui_elements[]?
            | select(role_ok)
            | field_hits as $hits
            | select(($hits | length) > 0)
            | ($hits | sort_by(.score) | .[0]) as $best
            | . + {
                _score: $best.score,
                _match_field: $best.field,
                _match_value: $best.value,
                _area: area
            }
        ]
        | sort_by(._score, ._area, (.id // ""))
        | .[:$limit][]
    ' 2>/dev/null
}

peek_ranked_element_id() {
    local json="$1"
    local pattern="$2"
    local role="${3:-}"

    peek_ranked_elements "$json" "$pattern" "$role" 1 \
        | jq -r '.id // empty' 2>/dev/null \
        | head -1
}

peek_element_summary() {
    local json="$1"
    local element_id="$2"

    echo "$json" | jq -r --arg id "$element_id" '
        def text($value): ($value // "" | tostring);
        def clip($value):
            (text($value) | gsub("[\r\n\t]+"; " ") | if length > 80 then .[0:77] + "..." else . end);
        .data.ui_elements[]?
        | select(.id == $id)
        | (.bounds? // .frame? // .rect? // {}) as $bounds
        | [
            "id=" + clip(.id),
            "role=" + clip(.role),
            "identifier=" + clip(.identifier),
            "label=" + clip(.label),
            "title=" + clip(.title),
            "value=" + clip(.value),
            "desc=" + clip(.description),
            "bounds=" + (if $bounds.x != null and $bounds.y != null and $bounds.width != null and $bounds.height != null then
                "x=\($bounds.x),y=\($bounds.y),w=\($bounds.width),h=\($bounds.height)"
            else
                "none"
            end)
        ]
        | join(" ")
    ' 2>/dev/null | head -1
}

peek_log_ranked_candidates() {
    local json="$1"
    local pattern="$2"
    local role="${3:-}"
    local limit="${4:-5}"
    local candidate

    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        log "Candidate for '$pattern': $(echo "$candidate" | jq -r '
            def text($value): ($value // "" | tostring);
            def clip($value):
                (text($value) | gsub("[\r\n\t]+"; " ") | if length > 80 then .[0:77] + "..." else . end);
            (.bounds? // .frame? // .rect? // {}) as $bounds
            | [
                "score=" + text(._score),
                "match=" + text(._match_field),
                "id=" + clip(.id),
                "role=" + clip(.role),
                "identifier=" + clip(.identifier),
                "label=" + clip(.label),
                "title=" + clip(.title),
                "bounds=" + (if $bounds.x != null and $bounds.y != null and $bounds.width != null and $bounds.height != null then
                    "x=\($bounds.x),y=\($bounds.y),w=\($bounds.width),h=\($bounds.height)"
                else
                    "none"
                end)
            ]
            | join(" ")
        ' 2>/dev/null)"
    done < <(peek_ranked_elements "$json" "$pattern" "$role" "$limit")
}

peek_element_center_coords() {
    local json="$1"
    local element_id="$2"

    echo "$json" | jq -r --arg id "$element_id" '
        .data.ui_elements[]?
        | select(.id == $id)
        | (.bounds? // .frame? // .rect? // empty)
        | select(.x != null and .y != null and .width != null and .height != null)
        | "\((.x + (.width / 2)) | floor),\((.y + (.height / 2)) | floor)"
    ' 2>/dev/null | head -1
}

peek_click_element_center() {
    local element_id="$1"
    local json="$2"
    local label="${3:-element center}"
    local app="${4:-}"
    local coords

    coords=$(peek_element_center_coords "$json" "$element_id")
    [ -n "$coords" ] || return 1
    log "Coordinate fallback click for $label on $element_id at $coords"
    [ -n "$app" ] && peekaboo_run app switch --to "$app" >/dev/null 2>&1 || true
    sleep 0.2
    peekaboo_run click --coords "$coords" >/dev/null 2>&1
}

peek_cgevent_click_element_center() {
    local element_id="$1"
    local json="$2"
    local label="${3:-element center}"
    local app="${4:-}"
    local coords x y

    command -v /usr/bin/swift >/dev/null 2>&1 || return 1
    coords=$(peek_element_center_coords "$json" "$element_id")
    [ -n "$coords" ] || return 1
    x="${coords%,*}"
    y="${coords#*,}"
    log "CGEvent fallback click for $label on $element_id at $coords"
    [ -n "$app" ] && peekaboo_run app switch --to "$app" >/dev/null 2>&1 || true
    sleep 0.2
    /usr/bin/swift -e "import CoreGraphics; import Foundation; let p = CGPoint(x: Double($x), y: Double($y)); CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(100000); CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(120000); CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(100000)" >/dev/null 2>&1
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
    local path
    local args=""
    local marker=""
    local generated=""
    path="${E2E_SCREENSHOT_DIR}/${name}-$(date +%s).png"
    [ -n "$app" ] && args="--app $app"

    mkdir -p "$E2E_SCREENSHOT_DIR"
    marker=$(mktemp "${TMPDIR:-/tmp}/e2e-peekaboo-marker.XXXXXX" 2>/dev/null || true)
    [ -n "$marker" ] && touch "$marker"

    # shellcheck disable=SC2086
    peekaboo_run see $args --annotate --path "$path" 2>/dev/null \
        || peekaboo_run image --mode screen --path "$path" 2>/dev/null \
        || true

    if [ ! -s "$path" ] && [ -n "$marker" ]; then
        generated=$(peekaboo_latest_desktop_artifact_since "$marker")
        if [ -n "$generated" ] && [ -f "$generated" ]; then
            mv "$generated" "$path" 2>/dev/null || true
        fi
    fi

    [ -n "$marker" ] && peekaboo_cleanup_desktop_artifacts "$marker"
    [ -n "$marker" ] && rm -f "$marker"

    if [ -s "$path" ]; then
        log "Screenshot saved: $path"
    else
        warn "Screenshot capture did not produce a file at $path"
    fi
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
    while [ "$elapsed" -lt "$timeout" ]; do
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
    while [ "$elapsed" -lt "$timeout" ]; do
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
        while [ "$elapsed" -lt "$timeout" ]; do
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

# Find a positive button in a dialog JSON blob. Exact labels avoid Don't Allow.
peek_find_affirmative_dialog_button() {
    local json="$1"
    echo "$json" | jq -r '
        .data.ui_elements[]? |
        select(.role == "button") |
        select(.label? // .title? // "" | test("^(Allow|OK|Open|Continue|Grant Access)$"; "i")) |
        .id
    ' 2>/dev/null | head -1
}

dismiss_dialog_json() {
    local json="$1"
    local source="${2:-active app}"
    local dialog_button

    dialog_button=$(peek_find_affirmative_dialog_button "$json")
    if [ -z "$dialog_button" ]; then
        return 1
    fi

    log "Dismissing system dialog from $source (clicking $dialog_button)..."
    peek_click "$dialog_button" "$json" || true
    sleep 2
    return 0
}

# Dismiss system dialogs (Allow, OK, Open, Continue).
#
# Scans ALL windows (not app-scoped) so macOS-level permission prompts
# that float above the app are detected. Clicks the affirmative button
# (Allow, OK, Open, Continue) and avoids negative buttons (Don't Allow,
# Cancel). Repeats up to max_attempts times with a short pause between
# each to catch sequential dialogs (e.g. Desktop then Documents access).
dismiss_dialogs() {
    [ "${E2E_DIALOG_AUTOMATION:-1}" = "1" ] || return 0

    local max_attempts="${1:-5}"
    local i=0
    while [ "$i" -lt "$max_attempts" ]; do
        local json clicked pid process
        # No --app flag: scan the entire screen so we catch system dialogs
        json=$(peek_elements)
        clicked=0

        if dismiss_dialog_json "$json" "active app"; then
            clicked=1
        fi

        if [ "$clicked" -eq 0 ]; then
            while IFS= read -r line; do
                [ -n "$line" ] || continue
                pid="${line%% *}"
                process="${line#* }"
                [ -n "$pid" ] || continue
                json=$(peekaboo_run see --pid "$pid" --json 2>/dev/null || peekaboo_empty_elements_json)
                if dismiss_dialog_json "$json" "$process pid $pid"; then
                    clicked=1
                    break
                fi
            done < <(ps -axo pid=,comm= 2>/dev/null | awk '
                {
                    pid=$1
                    $1=""
                    sub(/^ +/, "")
                    process=$0
                    split(process, parts, "/")
                    basename=parts[length(parts)]
                    if (basename ~ /^(tccd|SecurityAgent|UserNotificationCenter|CoreServicesUIAgent)$/) {
                        print pid " " process
                    }
                }
            ')
        fi

        if [ "$clicked" -eq 0 ]; then
            return 0
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
    if ! peekaboo_ensure_bridge_remote; then
        warn "Peekaboo bridge status:"
        peekaboo_bridge_status_text || true
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
