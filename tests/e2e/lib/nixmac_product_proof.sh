#!/bin/bash
# Shared helpers for nixmac Peekaboo Product Proof scenarios.

NIXMAC_PP_ELEMENTS_JSON_FILE="${NIXMAC_PP_ELEMENTS_JSON_FILE:-${TMPDIR:-/tmp}/nixmac-e2e-elements-$$.json}"
NIXMAC_PP_READY_SHELL_PATTERN="evolve-prompt-input|Configuration change descriptor|Describe changes|Submit configuration change descriptor|evolve-prompt-send|Settings|History|Report Issue|Give feedback|Console|No base URL set"
NIXMAC_PP_READY_SHELL_MIN_ELEMENTS="${NIXMAC_PP_READY_SHELL_MIN_ELEMENTS:-20}"
NIXMAC_PP_E2E_RUNTIME_TTL_SECONDS="${NIXMAC_PP_E2E_RUNTIME_TTL_SECONDS:-1800}"

nixmac_pp_repo_root() {
    cd "$E2E_ROOT/../.." && pwd
}

nixmac_pp_create_basic_config_repo() {
    local description="${1:-nixmac E2E fixture}"
    NIXMAC_E2E_CONFIG_REPO=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-config.XXXXXX") \
        || die "Failed to create temporary config repo"

    cat > "$NIXMAC_E2E_CONFIG_REPO/flake.nix" <<NIX
{
  description = "$description";

  outputs = { self }: {
    darwinConfigurations.e2e-host = {};
  };
}
NIX

    git -C "$NIXMAC_E2E_CONFIG_REPO" init >/dev/null 2>&1 \
        || die "Failed to initialize temporary config repo"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.name "nixmac e2e"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.email "e2e@nixmac.local"
    git -C "$NIXMAC_E2E_CONFIG_REPO" add flake.nix
    git -C "$NIXMAC_E2E_CONFIG_REPO" commit -m "initial e2e config" >/dev/null 2>&1 \
        || die "Failed to commit temporary config repo"
}

nixmac_pp_seed_local_validation_settings() {
    local settings_dir="$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}"
    local settings_path="$settings_dir/settings.json"
    local config_dir="${1:-$NIXMAC_E2E_CONFIG_REPO}"
    local host_attr="${2:-${NIXMAC_E2E_HOST_ATTR:-e2e-host}}"

    mkdir -p "$settings_dir" || die "Failed to create nixmac settings directory"
    jq -n \
        --arg configDir "$config_dir" \
        --arg hostAttr "$host_attr" \
        '{
            configDir: $configDir,
            hostAttr: $hostAttr,
            evolveProvider: "vllm",
            summaryProvider: "vllm",
            evolveModel: "gpt-oss-120b",
            summaryModel: "gpt-oss-120b",
            maxIterations: 1,
            maxBuildAttempts: 1,
            sendDiagnostics: false,
            confirmBuild: true,
            confirmClear: true,
            confirmRollback: true
        }' > "$settings_path" || die "Failed to write nixmac settings"

    log "Seeded nixmac settings at $settings_path"
}

nixmac_pp_runtime_path() {
    printf '%s\n' "$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}/e2e-runtime.json"
}

nixmac_pp_clear_e2e_runtime() {
    rm -f "$(nixmac_pp_runtime_path)" 2>/dev/null || true
}

nixmac_pp_write_e2e_runtime() {
    local path session_id now expires

    path="$(nixmac_pp_runtime_path)"
    mkdir -p "$(dirname "$path")" || die "Failed to create nixmac E2E runtime directory"
    session_id="${E2E_RUN_ID:-${E2E_SCENARIO_NAME:-peekaboo}-$(date +%s)-$$}"
    now="$(date +%s)"
    expires="$((now + NIXMAC_PP_E2E_RUNTIME_TTL_SECONDS))"

    jq -n \
        --arg sessionId "$session_id" \
        --argjson writtenAtUnix "$now" \
        --argjson expiresAtUnix "$expires" \
        --arg mockSystem "${NIXMAC_E2E_MOCK_SYSTEM:-1}" \
        --arg solidCapture "${NIXMAC_E2E_SOLID_CAPTURE:-1}" \
        --arg opaqueWindow "${NIXMAC_E2E_OPAQUE_WINDOW:-0}" \
        --arg webviewWatchdog "${NIXMAC_E2E_WEBVIEW_WATCHDOG:-1}" \
        --arg skipPermissions "${NIXMAC_SKIP_PERMISSIONS:-1}" \
        --arg configDir "${NIXMAC_E2E_CONFIG_DIR:-}" \
        --arg hostAttr "${NIXMAC_E2E_HOST_ATTR:-e2e-host}" \
        --arg brews "${NIXMAC_E2E_HOMEBREW_BREWS:-}" \
        --arg casks "${NIXMAC_E2E_HOMEBREW_CASKS:-}" \
        --arg taps "${NIXMAC_E2E_HOMEBREW_TAPS:-}" \
        --arg defaultsFixture "${NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE:-}" \
        --arg defaultsJson "${NIXMAC_E2E_SYSTEM_DEFAULTS_JSON:-}" \
        --arg recordCompletions "${NIXMAC_RECORD_COMPLETIONS:-}" \
        --arg completionLogDir "${NIXMAC_COMPLETION_LOG_DIR:-}" \
        --arg diagnosticsDir "${NIXMAC_E2E_DIAGNOSTICS_DIR:-}" \
        --arg logFile "${NIXMAC_LOGFILE:-}" \
        --arg rustLog "${RUST_LOG:-}" \
        --arg openai "${OPENAI_API_KEY:-}" \
        --arg openrouter "${OPENROUTER_API_KEY:-}" \
        --arg vllm "${VLLM_API_KEY:-}" \
        '{
            schemaVersion: 1,
            sessionId: $sessionId,
            writtenAtUnix: $writtenAtUnix,
            expiresAtUnix: $expiresAtUnix,
            values: {
                NIXMAC_E2E_MOCK_SYSTEM: $mockSystem,
                NIXMAC_E2E_SOLID_CAPTURE: $solidCapture,
                NIXMAC_E2E_OPAQUE_WINDOW: $opaqueWindow,
                NIXMAC_E2E_WEBVIEW_WATCHDOG: $webviewWatchdog,
                NIXMAC_SKIP_PERMISSIONS: $skipPermissions,
                NIXMAC_E2E_CONFIG_DIR: $configDir,
                NIXMAC_E2E_HOST_ATTR: $hostAttr,
                NIXMAC_E2E_HOMEBREW_BREWS: $brews,
                NIXMAC_E2E_HOMEBREW_CASKS: $casks,
                NIXMAC_E2E_HOMEBREW_TAPS: $taps,
                NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE: $defaultsFixture,
                NIXMAC_E2E_SYSTEM_DEFAULTS_JSON: $defaultsJson,
                NIXMAC_RECORD_COMPLETIONS: $recordCompletions,
                NIXMAC_COMPLETION_LOG_DIR: $completionLogDir,
                NIXMAC_E2E_DIAGNOSTICS_DIR: $diagnosticsDir,
                NIXMAC_LOGFILE: $logFile,
                RUST_LOG: $rustLog,
                OPENAI_API_KEY: $openai,
                OPENROUTER_API_KEY: $openrouter,
                VLLM_API_KEY: $vllm
            }
        } | .values |= with_entries(select(.value != ""))' > "$path" \
        || die "Failed to write nixmac E2E runtime"
    chmod 600 "$path" 2>/dev/null || true
    log "Seeded nixmac E2E runtime at $path (expires $(date -r "$expires" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "$expires"))"
}

nixmac_pp_find_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local deadline json element

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        element=$(peek_ranked_element_id "$json" "$pattern" "$role")

        if [ -n "$element" ]; then
            printf '%s' "$json" > "$NIXMAC_PP_ELEMENTS_JSON_FILE"
            printf '%s\n' "$element"
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_click_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local element json

    element=$(nixmac_pp_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    log "Clicking element $(peek_element_summary "$json" "$element") matching '$pattern'"
    peek_log_ranked_candidates "$json" "$pattern" "$role" 3
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
    sleep 0.2
    peek_click "$element" "$json"
}

nixmac_pp_click_element_center() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local label="${4:-$pattern}"
    local element json

    element=$(nixmac_pp_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    peek_click_element_center "$element" "$json" "$label" "$NIXMAC_APP_NAME"
}

nixmac_pp_cgevent_click_element_center() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local label="${4:-$pattern}"
    local element json

    element=$(nixmac_pp_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    peek_cgevent_click_element_center "$element" "$json" "$label" "$NIXMAC_APP_NAME"
}

nixmac_pp_system_events_click_button() {
    local label="$1"

    command -v /usr/bin/osascript >/dev/null 2>&1 || return 1
    log "System Events button click for '$label'"
    /usr/bin/osascript - "$label" <<'OSA' >/dev/null 2>&1
on run argv
  set targetLabel to item 1 of argv
  tell application "System Events"
    if not (exists process "nixmac") then error "nixmac process not found"
    tell process "nixmac"
      set frontmost to true
      repeat with w in windows
        try
          click (first button of w whose name is targetLabel)
          return
        end try
        try
          click (first button of w whose title is targetLabel)
          return
        end try
        try
          click (first button of w whose description is targetLabel)
          return
        end try
        try
          click (first button of w whose name contains targetLabel)
          return
        end try
        try
          click (first button of w whose title contains targetLabel)
          return
        end try
        try
          click (first button of w whose description contains targetLabel)
          return
        end try
      end repeat
      error "button not found: " & targetLabel
    end tell
  end tell
end run
OSA
}

nixmac_pp_deny_keychain_prompt_if_visible() {
    local json button

    json=$(peek_elements)
    if ! echo "$json" | jq -e '
        [.data.ui_elements[]? | (.label? // .title? // .value? // .description? // "")] |
        join(" ") |
        test("keychain|confidential information stored in"; "i")
    ' >/dev/null 2>&1; then
        return 1
    fi

    button=$(echo "$json" | jq -r '
        .data.ui_elements[]? |
        select(.role == "button") |
        select((.label? // .title? // "") | test("^Deny$|^Don.t Allow$|^Cancel$"; "i")) |
        .id
    ' 2>/dev/null | head -1)
    [ -n "$button" ] || return 1
    log "Denying stale nixmac keychain prompt ($button)"
    peek_click "$button" "$json" >/dev/null 2>&1 || true
    sleep 1
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
}

nixmac_pp_click_window_ratio() {
    local label="$1"
    local x_ratio="$2"
    local y_ratio="$3"
    local bounds coords window_json

    window_json=$(peekaboo_run window list --app "$NIXMAC_APP_NAME" --json 2>/dev/null || true)
    bounds=$(echo "$window_json" | jq -r '
        .data.windows
        | map(select(.bounds?.x != null and .bounds?.y != null and .bounds?.width != null and .bounds?.height != null))
        | sort_by(
            if ((.window_title? // "") | test("^nixmac$"; "i")) then 1 else 0 end,
            (.bounds.width * .bounds.height)
        )
        | reverse
        | .[0].bounds? |
        select(.x != null and .y != null and .width != null and .height != null) |
        "\(.x),\(.y),\(.width),\(.height)"
    ' 2>/dev/null | head -1)
    if [ -z "$bounds" ]; then
        warn "Coordinate fallback could not resolve nixmac window bounds for $label"
        return 1
    fi
    coords=$(printf '%s\n' "$bounds" | awk -F, -v xr="$x_ratio" -v yr="$y_ratio" '
        NF == 4 { printf "%d,%d", $1 + ($3 * xr), $2 + ($4 * yr) }
    ')
    [ -n "$coords" ] || return 1
    log "Coordinate fallback click for $label at $coords"
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
    sleep 0.2
    peekaboo_run click --coords "$coords" >/dev/null 2>&1
}

nixmac_pp_elements_show_ready_shell() {
    local json="$1"
    local min_elements="${2:-$NIXMAC_PP_READY_SHELL_MIN_ELEMENTS}"
    local pattern="${3:-$NIXMAC_PP_READY_SHELL_PATTERN}"

    echo "$json" | jq -e --argjson min "$min_elements" --arg pattern "$pattern" '
        (.data.ui_elements | length) >= $min
        and (
            .data.ui_elements[]? |
            [
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] |
            join(" ") |
            test($pattern; "i")
        )
    ' >/dev/null 2>&1
}

nixmac_pp_screenshot_has_visual_signal() {
    local path="$1"
    local repo_root
    repo_root="$(nixmac_pp_repo_root)"

    node --input-type=module - "$repo_root" "$path" <<'NODE'
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [repoRoot, screenshotPath] = process.argv.slice(2);
const visualProofUrl = pathToFileURL(path.join(repoRoot, 'tools/computer-use-e2e/visual-proof.mjs')).href;
const artifactUtilsUrl = pathToFileURL(path.join(repoRoot, 'tools/computer-use-e2e/artifact-utils.mjs')).href;
const { pngSignalStats, probeCropForImage } = await import(visualProofUrl);
const { pngDimensions } = await import(artifactUtilsUrl);

const probe = {
  label: 'central app content',
  x: 8,
  y: 18,
  w: 84,
  h: 70,
  minYAvg: 6,
  minYMax: 35,
  minYRange: 8,
  maxDarkChromeYAvg: 42,
};

const imageSize = pngDimensions(screenshotPath);
if (!imageSize || imageSize.width < 500 || imageSize.height < 350) {
  console.error(`image dimensions are not ready: ${imageSize ? `${imageSize.width}x${imageSize.height}` : 'unknown'}`);
  process.exit(1);
}

const crop = probeCropForImage(imageSize, probe);
if (!crop) {
  console.error('central app content probe could not be mapped into image pixels');
  process.exit(1);
}

const cropStats = pngSignalStats(screenshotPath, crop);
if (!cropStats.ok) {
  console.error(`ffmpeg could not inspect central app content (${cropStats.error})`);
  process.exit(1);
}

const yMin = cropStats.stats.YMIN;
const yMax = cropStats.stats.YMAX;
const yAvg = cropStats.stats.YAVG;
const yRange = Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : NaN;
if (!Number.isFinite(yAvg) || yAvg < probe.minYAvg) {
  console.error(`central app content is too dark (YAVG ${Number.isFinite(yAvg) ? yAvg : 'unknown'} below ${probe.minYAvg})`);
  process.exit(1);
}
if (!Number.isFinite(yMax) || yMax < probe.minYMax) {
  console.error(`central app content appears blank or occluded (YMAX ${Number.isFinite(yMax) ? yMax : 'unknown'} below ${probe.minYMax})`);
  process.exit(1);
}
if (!Number.isFinite(yRange) || yRange < probe.minYRange) {
  console.error(`central app content has too little visual contrast (Y range ${Number.isFinite(yRange) ? yRange : 'unknown'} below ${probe.minYRange})`);
  process.exit(1);
}
if (Number.isFinite(yAvg) && yAvg > probe.maxDarkChromeYAvg) {
  console.error(`base app chrome is too light for nixmac dark capture proof (YAVG ${yAvg} above ${probe.maxDarkChromeYAvg})`);
  process.exit(1);
}

console.log(`central app content visual signal ready: YAVG ${yAvg}, Y range ${yMin}-${yMax}`);
NODE
}

nixmac_pp_request_native_webview_snapshot() {
    local label="${1:-snapshot}"
    local timeout="${2:-15}"
    local root request_dir safe_label request_id request_path output_path status_path deadline status

    [ -n "${NIXMAC_E2E_DIAGNOSTICS_DIR:-}" ] || return 1
    root="$NIXMAC_E2E_DIAGNOSTICS_DIR/native-webview-snapshots"
    request_dir="$root/requests"
    mkdir -p "$request_dir" "$root" || return 1
    safe_label=$(printf '%s' "$label" | tr -cs 'A-Za-z0-9._-' '-' | sed -E 's/^-+|-+$//g' | cut -c1-80)
    [ -n "$safe_label" ] || safe_label="snapshot"
    request_id="${safe_label}-$(date +%s)-$$-$RANDOM"
    request_path="$request_dir/$request_id.request"
    output_path="$root/$request_id.png"
    status_path="$root/$request_id.json"

    printf '%s\n' "$label" > "$request_path" || return 1
    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -le "$deadline" ]; do
        if [ -s "$status_path" ]; then
            status=$(jq -r '.status // ""' "$status_path" 2>/dev/null || true)
            case "$status" in
                # "rendered" means a fallback produced PNG bytes, not pass-grade proof.
                # Callers must run nixmac_pp_screenshot_has_visual_signal before trusting it.
                passed|rendered)
                    if [ -s "$output_path" ]; then
                        printf '%s\n' "$output_path"
                        return 0
                    fi
                    debug "Native WKWebView snapshot status $status for $label but PNG is not ready yet"
                    ;;
                degraded)
                    debug "Native WKWebView snapshot degraded for $label: $(jq -r '.message // "unknown"' "$status_path" 2>/dev/null || echo unknown)"
                    return 1
                    ;;
                failed)
                    debug "Native WKWebView snapshot failed for $label: $(jq -r '.message // "unknown"' "$status_path" 2>/dev/null || echo unknown)"
                    return 1
                    ;;
            esac
        fi
        sleep 0.2
    done

    debug "Native WKWebView snapshot timed out for $label"
    return 1
}

nixmac_pp_capture_native_visual_signal() {
    local label="${1:-ready-shell}"
    local path result disable_marker disable_marker_dir

    disable_marker="${NIXMAC_E2E_DIAGNOSTICS_DIR:-$E2E_DIAGNOSTIC_DIR}/native-webview-snapshots/.disabled"
    [ ! -f "$disable_marker" ] || return 1
    path=$(nixmac_pp_request_native_webview_snapshot "$label" 5) || {
        disable_marker_dir="$(dirname "$disable_marker")"
        mkdir -p "$disable_marker_dir"
        printf 'request-failed label=%s ts=%s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$disable_marker"
        debug "Native WKWebView snapshot disabled for the rest of this scenario after request failure"
        return 1
    }
    result=$(nixmac_pp_screenshot_has_visual_signal "$path" 2>&1) || {
        debug "Native WKWebView visual signal not established for $path: $result"
        disable_marker_dir="$(dirname "$disable_marker")"
        mkdir -p "$disable_marker_dir"
        printf 'visual-signal-failed label=%s ts=%s path=%s detail=%s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$path" "$result" >"$disable_marker"
        debug "Native WKWebView snapshot promotion disabled for the rest of this scenario after visual-signal failure"
        return 1
    }
    debug "Native WKWebView snapshot visual signal ready for $path: $result"
    printf '%s\n' "$path"
}

nixmac_pp_capture_ready_visual_signal() {
    local label="${1:-ready-shell}"
    local dir path result native_output native_path

    dir="$E2E_DIAGNOSTIC_DIR/visual-readiness"
    mkdir -p "$dir"
    path="$dir/${label//[^a-zA-Z0-9._-]/_}.png"
    if peekaboo_run see --app "$NIXMAC_APP_NAME" --path "$path" >/dev/null 2>&1 \
        || peekaboo_run image --mode screen --path "$path" >/dev/null 2>&1; then
        result=$(nixmac_pp_screenshot_has_visual_signal "$path" 2>&1) && {
            debug "$result"
            return 0
        }
        debug "Ready-shell system visual signal not established for $path: $result"
    else
        result="system screenshot capture failed"
        debug "Ready-shell system visual signal not established for $path: $result"
    fi

    native_output=$(nixmac_pp_capture_native_visual_signal "$label") || {
        debug "Ready-shell visual signal not established for $path: $result"
        return 1
    }
    native_path=$(printf '%s\n' "$native_output" | tail -n 1)
    debug "Ready-shell visual signal established from native WKWebView snapshot: $native_path"
}

nixmac_pp_record_ready_visual_signal() {
    local label="${1:-ready-shell}"
    local dir result_path result

    dir="$E2E_DIAGNOSTIC_DIR/visual-readiness"
    mkdir -p "$dir"
    result_path="$dir/${label//[^a-zA-Z0-9._-]/_}-status.txt"
    if result=$(nixmac_pp_capture_ready_visual_signal "$label" 2>&1); then
        {
            printf 'status=passed\n'
            printf 'detail=%s\n' "$result"
        } >"$result_path"
        return 0
    fi
    {
        printf 'status=failed\n'
        printf 'detail=%s\n' "$result"
    } >"$result_path"
    warn "Ready-shell visual signal unavailable for $label; continuing with driver-visible shell and preserving strict screenshot-signal report gate"
    return 1
}

nixmac_pp_wait_for_ready_app_shell() {
    local timeout="${1:-45}"
    local deadline json count

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        peekaboo_restore_active_app "$NIXMAC_APP_NAME" "$NIXMAC_PP_READY_SHELL_MIN_ELEMENTS" 6 >/dev/null 2>&1 || true
        dismiss_dialogs 2
        nixmac_pp_deny_keychain_prompt_if_visible >/dev/null 2>&1 || true
        json=$(E2E_PEEKABOO_SUPPRESS_EMPTY_DIAG=1 peek_elements "$NIXMAC_APP_NAME") || true
        count=$(peekaboo_element_count "$json")
        if nixmac_pp_elements_show_ready_shell "$json" "$NIXMAC_PP_READY_SHELL_MIN_ELEMENTS" "$NIXMAC_PP_READY_SHELL_PATTERN"; then
            nixmac_pp_record_ready_visual_signal "ready-shell" || true
            debug "nixmac Product Proof shell driver-ready ($count element(s))"
            return 0
        else
            debug "nixmac Product Proof shell not ready yet ($count element(s))"
        fi
        sleep 2
    done

    peekaboo_capture_app_diagnostics "$NIXMAC_APP_NAME" "ready-shell-timeout"
    return 1
}

nixmac_pp_cgevent_click_window_ratio() {
    local label="$1"
    local x_ratio="$2"
    local y_ratio="$3"
    local bounds coords x y window_json

    command -v /usr/bin/swift >/dev/null 2>&1 || return 1
    window_json=$(peekaboo_run window list --app "$NIXMAC_APP_NAME" --json 2>/dev/null || true)
    bounds=$(echo "$window_json" | jq -r '
        .data.windows
        | map(select(.bounds?.x != null and .bounds?.y != null and .bounds?.width != null and .bounds?.height != null))
        | sort_by(
            if ((.window_title? // "") | test("^nixmac$"; "i")) then 1 else 0 end,
            (.bounds.width * .bounds.height)
        )
        | reverse
        | .[0].bounds? |
        select(.x != null and .y != null and .width != null and .height != null) |
        "\(.x),\(.y),\(.width),\(.height)"
    ' 2>/dev/null | head -1)
    if [ -z "$bounds" ]; then
        warn "CGEvent fallback could not resolve nixmac window bounds for $label"
        return 1
    fi
    coords=$(printf '%s\n' "$bounds" | awk -F, -v xr="$x_ratio" -v yr="$y_ratio" '
        NF == 4 { printf "%d,%d", $1 + ($3 * xr), $2 + ($4 * yr) }
    ')
    [ -n "$coords" ] || return 1
    x="${coords%,*}"
    y="${coords#*,}"
    log "CGEvent fallback click for $label at $coords"
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
    sleep 0.2
    /usr/bin/swift -e "import CoreGraphics; import Foundation; let p = CGPoint(x: Double($x), y: Double($y)); CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(100000); CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(120000); CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(100000)" >/dev/null 2>&1
}

nixmac_pp_wait_for_text() {
    local pattern="$1"
    local timeout="${2:-30}"
    local deadline text

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        text=$(nixmac_text)
        if echo "$text" | grep -qiE "$pattern"; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_wait_for_prompt_value() {
    local expected="$1"
    local timeout="${2:-20}"
    local deadline json

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        if echo "$json" | jq -e --arg expected "$expected" '
            .data.ui_elements[]? |
            select([
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] | join(" ") | contains($expected))
        ' >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_wait_for_prompt_value_exact() {
    local expected="$1"
    local timeout="${2:-20}"
    local deadline json

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        if echo "$json" | jq -e --arg expected "$expected" '
            .data.ui_elements[]? |
            select(
                ((.identifier? // "") | test("evolve-prompt-input|Configuration change descriptor"; "i")) or
                ((.label? // "") | test("evolve-prompt-input|Configuration change descriptor|Describe changes"; "i")) or
                ((.description? // "") | test("evolve-prompt-input|Configuration change descriptor|Describe changes"; "i"))
            ) |
            select((.value? // "") == $expected)
        ' >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_redacted_text_snapshot() {
    local label="$1"
    local dir path raw
    dir="$E2E_DIAGNOSTIC_DIR/text"
    mkdir -p "$dir"
    path="$dir/${label//[^a-zA-Z0-9._-]/_}.txt"
    raw=$(nixmac_text)

    printf '%s' "$raw" | node --input-type=module -e '
import path from "node:path";

const repoRoot = process.argv[1];
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  const text = Buffer.concat(chunks).toString("utf8");
  const modulePath = path.join(repoRoot, "tools/computer-use-e2e/redaction.mjs");
  const { redact, containsUnmaskedSecret } = await import(`file://${modulePath}`);
  process.stdout.write(`${redact(text)}\n`);
  if (containsUnmaskedSecret(text)) process.exit(3);
});
' "$(nixmac_pp_repo_root)" > "$path"
    local status=$?
    if [ "$status" -eq 3 ]; then
        fail "Unmasked secret detected while capturing $label text"
        return 1
    fi
    if [ "$status" -ne 0 ]; then
        fail "Failed to redact $label text"
        return 1
    fi
    log "Redacted text snapshot saved: $path"
}

nixmac_pp_cleanup_common() {
    nixmac_pp_unset_launch_env NIXMAC_E2E_MOCK_SYSTEM
    nixmac_pp_unset_launch_env NIXMAC_E2E_SOLID_CAPTURE
    nixmac_pp_unset_launch_env NIXMAC_E2E_OPAQUE_WINDOW
    nixmac_pp_unset_launch_env NIXMAC_E2E_WEBVIEW_WATCHDOG
    nixmac_pp_unset_launch_env NIXMAC_SKIP_PERMISSIONS
    nixmac_pp_unset_launch_env NIXMAC_E2E_CONFIG_DIR
    nixmac_pp_unset_launch_env NIXMAC_E2E_HOST_ATTR
    nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_BREWS
    nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_CASKS
    nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_TAPS
    nixmac_pp_unset_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE
    nixmac_pp_unset_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_JSON
    nixmac_pp_unset_launch_env NIXMAC_E2E_DIAGNOSTICS_DIR
    nixmac_pp_unset_launch_env NIXMAC_LOGFILE
    nixmac_pp_unset_launch_env RUST_LOG
    nixmac_pp_unset_launch_env OPENAI_API_KEY
    nixmac_pp_unset_launch_env OPENROUTER_API_KEY
    nixmac_pp_unset_launch_env VLLM_API_KEY
    nixmac_pp_clear_e2e_runtime
    rm -f "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true
    if [ -n "${NIXMAC_E2E_CONFIG_REPO:-}" ]; then
        rm -rf "$NIXMAC_E2E_CONFIG_REPO" 2>/dev/null || true
    fi
}

nixmac_pp_set_launch_env() {
    local key="$1"
    local value="$2"
    local uid

    launchctl setenv "$key" "$value" 2>/dev/null || true
    uid=$(id -u 2>/dev/null || echo "")
    if [ -n "$uid" ]; then
        launchctl asuser "$uid" launchctl setenv "$key" "$value" 2>/dev/null || true
    fi
}

nixmac_pp_unset_launch_env() {
    local key="$1"
    local uid

    launchctl unsetenv "$key" 2>/dev/null || true
    uid=$(id -u 2>/dev/null || echo "")
    if [ -n "$uid" ]; then
        launchctl asuser "$uid" launchctl unsetenv "$key" 2>/dev/null || true
    fi
}

nixmac_pp_truthy() {
    local value
    value="$(printf '%s' "${1:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    case "$value" in
        1|true|TRUE|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

nixmac_pp_set_e2e_launch_env() {
    nixmac_pp_clear_e2e_runtime
    export NIXMAC_E2E_MOCK_SYSTEM=1
    export NIXMAC_E2E_SOLID_CAPTURE="${NIXMAC_E2E_SOLID_CAPTURE:-1}"
    export NIXMAC_E2E_OPAQUE_WINDOW="${NIXMAC_E2E_OPAQUE_WINDOW:-0}"
    export NIXMAC_E2E_WEBVIEW_WATCHDOG="${NIXMAC_E2E_WEBVIEW_WATCHDOG:-1}"
    export NIXMAC_SKIP_PERMISSIONS=1
    export NIXMAC_E2E_CONFIG_DIR="${NIXMAC_E2E_CONFIG_REPO:-}"
    export NIXMAC_E2E_HOST_ATTR="${NIXMAC_E2E_HOST_ATTR:-e2e-host}"
    export NIXMAC_E2E_DIAGNOSTICS_DIR="${E2E_DIAGNOSTIC_DIR:-${E2E_ARTIFACT_ROOT:-${E2E_SCREENSHOT_DIR:-/tmp}}/${E2E_SCENARIO_NAME:-unknown}/diagnostics}"
    export NIXMAC_LOGFILE="${NIXMAC_E2E_DIAGNOSTICS_DIR}/nixmac-app.log"
    export RUST_LOG="${RUST_LOG:-debug}"
    export OPENAI_API_KEY="[REDACTED]"
    export OPENROUTER_API_KEY="[REDACTED]"
    export VLLM_API_KEY=e2e
    nixmac_pp_set_launch_env NIXMAC_E2E_MOCK_SYSTEM "$NIXMAC_E2E_MOCK_SYSTEM"
    nixmac_pp_set_launch_env NIXMAC_E2E_SOLID_CAPTURE "$NIXMAC_E2E_SOLID_CAPTURE"
    if nixmac_pp_truthy "$NIXMAC_E2E_OPAQUE_WINDOW"; then
        nixmac_pp_set_launch_env NIXMAC_E2E_OPAQUE_WINDOW "$NIXMAC_E2E_OPAQUE_WINDOW"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_OPAQUE_WINDOW
    fi
    nixmac_pp_set_launch_env NIXMAC_E2E_WEBVIEW_WATCHDOG "$NIXMAC_E2E_WEBVIEW_WATCHDOG"
    nixmac_pp_set_launch_env NIXMAC_SKIP_PERMISSIONS "$NIXMAC_SKIP_PERMISSIONS"
    nixmac_pp_set_launch_env NIXMAC_E2E_CONFIG_DIR "$NIXMAC_E2E_CONFIG_DIR"
    nixmac_pp_set_launch_env NIXMAC_E2E_HOST_ATTR "$NIXMAC_E2E_HOST_ATTR"
    mkdir -p "$NIXMAC_E2E_DIAGNOSTICS_DIR" 2>/dev/null || true
    rm -f "$NIXMAC_LOGFILE" "$NIXMAC_E2E_DIAGNOSTICS_DIR/nixmac-frontend-breadcrumbs.jsonl" 2>/dev/null || true
    nixmac_pp_set_launch_env NIXMAC_E2E_DIAGNOSTICS_DIR "$NIXMAC_E2E_DIAGNOSTICS_DIR"
    nixmac_pp_set_launch_env NIXMAC_LOGFILE "$NIXMAC_LOGFILE"
    nixmac_pp_set_launch_env RUST_LOG "$RUST_LOG"
    if [ -n "${NIXMAC_E2E_HOMEBREW_BREWS:-}" ]; then
        nixmac_pp_set_launch_env NIXMAC_E2E_HOMEBREW_BREWS "$NIXMAC_E2E_HOMEBREW_BREWS"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_BREWS
    fi
    if [ -n "${NIXMAC_E2E_HOMEBREW_CASKS:-}" ]; then
        nixmac_pp_set_launch_env NIXMAC_E2E_HOMEBREW_CASKS "$NIXMAC_E2E_HOMEBREW_CASKS"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_CASKS
    fi
    if [ -n "${NIXMAC_E2E_HOMEBREW_TAPS:-}" ]; then
        nixmac_pp_set_launch_env NIXMAC_E2E_HOMEBREW_TAPS "$NIXMAC_E2E_HOMEBREW_TAPS"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_HOMEBREW_TAPS
    fi
    if [ -n "${NIXMAC_E2E_SYSTEM_DEFAULTS_JSON:-}" ]; then
        nixmac_pp_set_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_JSON "$NIXMAC_E2E_SYSTEM_DEFAULTS_JSON"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_JSON
    fi
    if [ -n "${NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE:-}" ]; then
        nixmac_pp_set_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE "$NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE"
    else
        nixmac_pp_unset_launch_env NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE
    fi
    nixmac_pp_set_launch_env OPENAI_API_KEY "$OPENAI_API_KEY"
    nixmac_pp_set_launch_env OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
    nixmac_pp_set_launch_env VLLM_API_KEY "$VLLM_API_KEY"
    nixmac_pp_write_e2e_runtime
}
