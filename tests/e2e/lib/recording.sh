#!/bin/bash
# =============================================================================
# macos-e2e — Screen recording via ffmpeg AVFoundation
#
# Records the macOS screen by launching ffmpeg in a GUI context through
# Terminal.app (which has Screen Recording TCC permission).
# =============================================================================

_RECORDER_PID=""
_RECORDING_STOPPED=0

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
    
    if ! command -v ffmpeg &>/dev/null; then
        warn "ffmpeg not found, skipping screen recording"
        return 0
    fi
    
    log "Starting screen recording: $output"
    
    cat > /tmp/e2e-record.sh << RECEOF
#!/bin/bash
export PATH="/opt/homebrew/bin:\$PATH"
ffmpeg -y -f avfoundation -capture_cursor 1 -framerate $framerate -pixel_format uyvy422 \\
    -i "0:none" -t $max_duration -vf scale=1280:-2 \\
    -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p \\
    "$output" 2>/tmp/e2e-ffmpeg.log
RECEOF
    chmod +x /tmp/e2e-record.sh
    
    # Launch in GUI context (Terminal.app has Screen Recording TCC permission)
    open -a Terminal /tmp/e2e-record.sh
    sleep 3
    
    _RECORDER_PID=$(pgrep -f "ffmpeg.*$(basename "$output")" 2>/dev/null | head -1 || true)
    if [ -n "$_RECORDER_PID" ]; then
        log "Recorder started (PID: $_RECORDER_PID)"
    else
        warn "Screen recorder may not have started"
    fi
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
    pkill -f "ffmpeg.*$(basename "$output")" 2>/dev/null || true
    sleep 1
    
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
