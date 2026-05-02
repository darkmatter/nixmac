#!/bin/bash
# =============================================================================
# macos-e2e — Screen recording via ffmpeg AVFoundation
#
# Records the macOS screen by launching ffmpeg in a GUI context through
# Terminal.app (which has Screen Recording TCC permission).
# =============================================================================

_RECORDER_PID=""

start_recording() {
    local output="${1:-$E2E_VIDEO_FILE}"
    local framerate="${2:-5}"
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
        log "Video saved: $output ($(du -h "$output" | cut -f1))"
    else
        warn "No video file found at $output"
    fi
}
