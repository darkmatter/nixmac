#!/bin/bash
# =============================================================================
# macos-e2e — Screen recording via ffmpeg AVFoundation
#
# Records the macOS screen by launching ffmpeg in a GUI context through
# Terminal.app (which has Screen Recording TCC permission).
# =============================================================================

_RECORDER_PID=""
_RECORDING_STOPPED=0
_RECORDER_SCRIPT=""
_RECORDER_WINDOW_TITLE=""

recording_add_limitation() {
    local limitation="$1"
    if [ -n "${E2E_CAPTURE_LIMITATIONS:-}" ]; then
        export E2E_CAPTURE_LIMITATIONS="${E2E_CAPTURE_LIMITATIONS},${limitation}"
    else
        export E2E_CAPTURE_LIMITATIONS="$limitation"
    fi
}

recording_is_valid() {
    local output="$1"
    local size duration

    [ -f "$output" ] || return 1
    size=$(wc -c < "$output" 2>/dev/null || echo 0)
    size="${size//[^0-9]/}"
    [ -n "$size" ] || size=0
    [ "$size" -gt 1024 ] || return 1

    if ! command -v ffprobe &>/dev/null; then
        return 0
    fi

    duration=$(run_with_timeout 10 ffprobe -v error \
        -select_streams v:0 \
        -show_entries stream=duration \
        -of default=noprint_wrappers=1:nokey=1 \
        "$output" 2>/dev/null | head -1)

    awk -v duration="$duration" 'BEGIN { exit !(duration + 0 > 0) }'
}

start_recording() {
    local output="${1:-$E2E_VIDEO_FILE}"
    local framerate="${2:-${E2E_RECORD_FPS:-20}}"
    local max_duration="${3:-600}"
    local run_id
    local window_title
    local script
    run_id="${E2E_RUN_ID:-$$}-$(date +%s)"
    window_title="nixmac-e2e-recorder-${run_id}"
    script="/tmp/${window_title}.sh"
    
    if ! command -v ffmpeg &>/dev/null; then
        warn "ffmpeg not found, skipping screen recording"
        return 0
    fi
    
    log "Starting screen recording: $output"
    _RECORDING_STOPPED=0
    _RECORDER_SCRIPT="$script"
    _RECORDER_WINDOW_TITLE="$window_title"
    
    cat > "$script" << RECEOF
#!/bin/bash
export PATH="/opt/homebrew/bin:\$PATH"
title="$window_title"
printf '\\033]0;%s\\007' "\$title"
ffmpeg -y -f avfoundation -capture_cursor 1 -framerate $framerate -pixel_format uyvy422 \\
    -i "0:none" -t $max_duration -vf scale=1280:-2 \\
    -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p \\
    "$output" 2>/tmp/e2e-ffmpeg.log
RECEOF
    chmod +x "$script"
    
    # Launch in GUI context (Terminal.app has Screen Recording TCC permission)
    if command -v osascript &>/dev/null; then
        osascript >/dev/null 2>&1 <<OSA || open -a Terminal "$script"
tell application "Terminal"
    set recorderTab to do script "/bin/bash '$script'"
    set custom title of recorderTab to "$window_title"
end tell
OSA
    else
        open -a Terminal "$script"
    fi
    sleep 3
    
    _RECORDER_PID=$(pgrep -f "ffmpeg.*$(basename "$output")" 2>/dev/null | head -1 || true)
    if [ -n "$_RECORDER_PID" ]; then
        log "Recorder started (PID: $_RECORDER_PID)"
    else
        warn "Screen recorder may not have started"
    fi
}

recording_close_terminal_windows() {
    local window_title="${_RECORDER_WINDOW_TITLE:-}"
    local script_name
    script_name="$(basename "${_RECORDER_SCRIPT:-e2e-record}")"

    [ "${E2E_CLOSE_RECORDING_TERMINAL:-1}" = "1" ] || return 0
    command -v osascript &>/dev/null || return 0
    pgrep -x Terminal &>/dev/null || return 0

    osascript >/dev/null 2>&1 <<OSA || true
set recorderTitle to "$window_title"
set recorderScriptName to "$script_name"
set closeTargets to {}

on shouldCloseTab(tabName, tabTitle, recorderTitle, recorderScriptName)
    if recorderTitle is not "" then
        if tabTitle is recorderTitle then return true
        if tabName contains recorderTitle then return true
    end if
    if tabTitle starts with "nixmac-e2e-recorder-" then return true
    if tabTitle starts with "nixmac-e2e-recording" then return true
    if tabName contains "nixmac-e2e-recorder-" then return true
    if tabName contains "nixmac-e2e-recording" then return true
    if recorderScriptName is not "" and tabName contains recorderScriptName then return true
    if tabName contains "e2e-record.sh" then return true
    if tabName contains "e2e-record-" then return true
    return false
end shouldCloseTab

tell application "Terminal"
    repeat with terminalWindow in windows
        repeat with terminalTab in tabs of terminalWindow
            set tabName to ""
            set tabTitle to ""
            try
                set tabName to name of terminalTab as text
            end try
            try
                set tabTitle to custom title of terminalTab as text
            end try
            if my shouldCloseTab(tabName, tabTitle, recorderTitle, recorderScriptName) then
                set end of closeTargets to terminalTab
            end if
        end repeat
    end repeat

    repeat with terminalTab in closeTargets
        try
            close terminalTab
        end try
    end repeat
end tell
OSA
}

recording_cleanup_processes() {
    local output="${1:-$E2E_VIDEO_FILE}"

    pkill -f "ffmpeg.*$(basename "$output")" 2>/dev/null || true
    if [ -n "$_RECORDER_SCRIPT" ]; then
        pkill -f "$_RECORDER_SCRIPT" 2>/dev/null || true
    fi
    pkill -f "/tmp/e2e-record.sh" 2>/dev/null || true
}

stop_recording() {
    local output="${1:-$E2E_VIDEO_FILE}"

    if [ "${E2E_RECORD:-1}" != "1" ]; then
        return 0
    fi

    if [ "$_RECORDING_STOPPED" = "1" ]; then
        return 0
    fi
    _RECORDING_STOPPED=1
    
    if [ -n "$_RECORDER_PID" ] && kill -0 "$_RECORDER_PID" 2>/dev/null; then
        log "Stopping recorder (PID: $_RECORDER_PID)..."
        kill -INT "$_RECORDER_PID" 2>/dev/null || true
        sleep 2
        kill -0 "$_RECORDER_PID" 2>/dev/null && kill "$_RECORDER_PID" 2>/dev/null || true
    fi
    
    # Fallback: kill any lingering ffmpeg recording processes
    recording_cleanup_processes "$output"
    sleep 1
    recording_close_terminal_windows
    rm -f "${_RECORDER_SCRIPT:-}" /tmp/e2e-record.sh 2>/dev/null || true
    
    if [ -f "$output" ]; then
        if recording_is_valid "$output"; then
            log "Video saved: $output ($(du -h "$output" | cut -f1))"
        else
            warn "Screen recording was invalid or empty; excluding video proof"
            recording_add_limitation "screen_recording_invalid"
            mv "$output" "${output}.invalid" 2>/dev/null || rm -f "$output"
        fi
    else
        warn "No video file found at $output"
        recording_add_limitation "screen_recording_missing"
    fi
}
