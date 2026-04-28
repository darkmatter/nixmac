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

recording_clear_terminal_saved_state() {
    rm -rf \
        "$HOME/Library/Saved Application State/com.apple.Terminal.savedState" \
        "$HOME/Library/Containers/com.apple.Terminal/Data/Library/Saved Application State/com.apple.Terminal.savedState" \
        2>/dev/null || true
    defaults write com.apple.Terminal NSQuitAlwaysKeepsWindows -bool false 2>/dev/null || true
    defaults write com.apple.Terminal ApplePersistenceIgnoreState -bool true 2>/dev/null || true
}

recording_dismiss_terminal_automation_prompt() {
    [ "${E2E_TERMINAL_CLEANUP_MODE:-}" = "kill" ] || return 0
    declare -f peekaboo_run >/dev/null || return 0

    local coords
    sleep 1
    # The prompt is a system Automation dialog and is not reliably exposed in
    # the AX tree over SSH. Click the stable button locations at common 1x/2x
    # runner resolutions; harmless if the prompt is absent.
    for coords in "740,383" "860,383" "590,306" "690,306" "1180,612" "1375,612"; do
        peekaboo_run click --coords "$coords" >/dev/null 2>&1 || true
        sleep 0.3
    done
    log "Attempted to dismiss Terminal Automation permission prompt"
}

recording_hide_terminal_windows() {
    [ "${E2E_HIDE_RECORDING_TERMINAL:-1}" = "1" ] || return 0
    command -v osascript &>/dev/null || return 0
    pgrep -x Terminal &>/dev/null || return 0

    local window_title="${_RECORDER_WINDOW_TITLE:-}"

    if [ "${E2E_TERMINAL_CLEANUP_MODE:-}" = "kill" ]; then
        osascript >/dev/null 2>&1 <<'OSA' || true
tell application "System Events"
    if exists process "Terminal" then set visible of process "Terminal" to false
end tell
OSA
        return 0
    fi

    osascript >/dev/null 2>&1 <<OSA || true
set recorderTitle to "$window_title"

on isRecorderWindow(terminalWindow, recorderTitle)
    if recorderTitle is "" then return false
    try
        repeat with terminalTab in tabs of terminalWindow
            set tabName to ""
            set tabTitle to ""
            try
                set tabName to name of terminalTab as text
            end try
            try
                set tabTitle to custom title of terminalTab as text
            end try
            if tabName contains recorderTitle then return true
            if tabTitle is recorderTitle then return true
        end repeat
    end try
    return false
end isRecorderWindow

tell application "Terminal"
    repeat with terminalWindow in windows
        if my isRecorderWindow(terminalWindow, recorderTitle) then
            try
                set miniaturized of terminalWindow to true
            end try
        end if
    end repeat
end tell
OSA
}

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
    local size duration expected_fps actual_fps

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

    awk -v duration="$duration" 'BEGIN { exit !(duration + 0 > 0) }' || return 1

    expected_fps="${E2E_RECORD_FPS:-}"
    if [ -n "$expected_fps" ]; then
        actual_fps=$(run_with_timeout 10 ffprobe -v error \
            -select_streams v:0 \
            -show_entries stream=avg_frame_rate \
            -of default=noprint_wrappers=1:nokey=1 \
            "$output" 2>/dev/null | head -1)
        awk -v actual="$actual_fps" -v expected="$expected_fps" '
            function fps(value, parts) {
                split(value, parts, "/")
                if ((parts[2] + 0) > 0) return (parts[1] + 0) / (parts[2] + 0)
                return value + 0
            }
            BEGIN {
                a = fps(actual)
                e = expected + 0
                tolerance = e * 0.12
                if (tolerance < 2) tolerance = 2
                exit !(a > 0 && a >= e - tolerance && a <= e + tolerance)
            }
        ' || return 1
    fi

    if [ "${E2E_RECORDING_STRICT:-0}" = "1" ]; then
        recording_frame_has_detail "$output" || return 1
    fi

    return 0
}

recording_frame_has_detail() {
    local output="$1"
    local frame_raw

    command -v ffmpeg &>/dev/null || return 1
    command -v perl &>/dev/null || return 1

    frame_raw=$(mktemp "${TMPDIR:-/tmp}/e2e-video-frame.XXXXXX.rgb") || return 1
    if ! run_with_timeout 20 ffmpeg -y -hide_banner -loglevel error \
        -ss 2 -i "$output" \
        -frames:v 1 -vf "scale=64:64,format=rgb24" \
        -f rawvideo "$frame_raw" >/dev/null 2>&1; then
        rm -f "$frame_raw"
        return 1
    fi

    perl -e '
        use strict;
        use warnings;
        my ($path) = @ARGV;
        open my $fh, "<:raw", $path or exit 1;
        local $/;
        my $bytes = <$fh>;
        exit 1 unless defined $bytes && length($bytes) > 0;
        my @values = unpack("C*", $bytes);
        my ($min, $max) = (255, 0);
        for my $value (@values) {
            $min = $value if $value < $min;
            $max = $value if $value > $max;
        }
        exit(($max - $min) >= 12 ? 0 : 1);
    ' "$frame_raw"
    local status=$?
    rm -f "$frame_raw"
    return "$status"
}

recording_duration_seconds() {
    local output="$1"

    command -v ffprobe &>/dev/null || return 1
    run_with_timeout 10 ffprobe -v error \
        -select_streams v:0 \
        -show_entries stream=duration \
        -of default=noprint_wrappers=1:nokey=1 \
        "$output" 2>/dev/null | head -1
}

recording_trim_leadin() {
    local output="$1"
    local trim_seconds="${E2E_RECORDING_TRIM_START_SECONDS:-0}"
    local duration temp_output

    awk -v trim="$trim_seconds" 'BEGIN { exit !(trim + 0 > 0) }' || return 0
    [ -f "$output" ] || return 0
    command -v ffmpeg &>/dev/null || return 0

    duration=$(recording_duration_seconds "$output" || echo 0)
    awk -v duration="$duration" -v trim="$trim_seconds" \
        'BEGIN { exit !(duration + 0 > trim + 1) }' || return 0

    temp_output="${output%.mp4}.trimmed.mp4"
    if run_with_timeout 60 ffmpeg -y -hide_banner -loglevel error \
        -ss "$trim_seconds" -i "$output" \
        -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p \
        "$temp_output" >/dev/null 2>&1 && recording_is_valid "$temp_output"; then
        mv "$temp_output" "$output"
        log "Trimmed ${trim_seconds}s recorder lead-in from screen recording"
    else
        rm -f "$temp_output" 2>/dev/null || true
        warn "Could not trim recorder lead-in; keeping original screen recording"
    fi
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
    
    # Launch in GUI context (Terminal.app has Screen Recording TCC permission).
    # CI uses `open -F` to avoid restoring stale Terminal windows from previous runs.
    if [ "${E2E_TERMINAL_CLEANUP_MODE:-}" = "kill" ]; then
        recording_clear_terminal_saved_state
        open -F -a Terminal "$script"
        recording_dismiss_terminal_automation_prompt
    elif command -v osascript &>/dev/null; then
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
    recording_hide_terminal_windows
}

recording_close_terminal_windows() {
    local window_title="${_RECORDER_WINDOW_TITLE:-}"
    local script_name
    script_name="$(basename "${_RECORDER_SCRIPT:-e2e-record}")"

    [ "${E2E_CLOSE_RECORDING_TERMINAL:-1}" = "1" ] || return 0

    if [ "${E2E_TERMINAL_CLEANUP_MODE:-}" = "kill" ]; then
        pkill -x Terminal 2>/dev/null || true
        sleep 1
        pkill -9 -x Terminal 2>/dev/null || true
        recording_clear_terminal_saved_state
        return 0
    fi

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
        recording_trim_leadin "$output"
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
