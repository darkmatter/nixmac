#!/bin/bash
# =============================================================================
# macos-e2e — Core library
#
# Logging, assertions, phase tracking, and test lifecycle.
# Source this first; everything else depends on it.
# =============================================================================

# --- Globals (set by runner, available to scenarios) ---
export E2E_ROOT="${E2E_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export E2E_LIB="$E2E_ROOT/lib"
export E2E_SCREENSHOT_DIR="${E2E_SCREENSHOT_DIR:-/tmp/e2e-screenshots}"
export E2E_LOG_FILE="${E2E_LOG_FILE:-/tmp/e2e-test.log}"
export E2E_VIDEO_FILE="${E2E_VIDEO_FILE:-/tmp/e2e-recording.mp4}"

# Test state
_E2E_PHASE_NUM=0
_E2E_PHASE_NAME=""
_E2E_PASS_COUNT=0
_E2E_FAIL_COUNT=0
_E2E_START_TIME=""
_E2E_PHASE_RESULTS=()

# --- Colors ---
_RED='\033[0;31m'
_GREEN='\033[0;32m'
_YELLOW='\033[1;33m'
_BLUE='\033[0;34m'
_DIM='\033[0;90m'
_NC='\033[0m'

# --- Logging ---

log() {
    echo -e "${_BLUE}[$(date +%H:%M:%S)]${_NC} $*" | tee -a "$E2E_LOG_FILE"
}

debug() {
    if [ "${E2E_VERBOSE:-0}" = "1" ]; then
        echo -e "${_DIM}[$(date +%H:%M:%S)] [debug] $*${_NC}" | tee -a "$E2E_LOG_FILE"
    fi
}

warn() {
    echo -e "${_YELLOW}[WARN]${_NC} $*" | tee -a "$E2E_LOG_FILE"
}

pass() {
    _E2E_PASS_COUNT=$((_E2E_PASS_COUNT + 1))
    echo -e "${_GREEN}[PASS]${_NC} $*" | tee -a "$E2E_LOG_FILE"
}

fail() {
    _E2E_FAIL_COUNT=$((_E2E_FAIL_COUNT + 1))
    echo -e "${_RED}[FAIL]${_NC} $*" | tee -a "$E2E_LOG_FILE"
}

die() {
    fail "$1"
    screenshot "failure-$(date +%s)" 2>/dev/null || true
    # Let the runner's trap handle cleanup
    exit 1
}

# --- Phases ---

phase() {
    local name="$1"
    _E2E_PHASE_NUM=$((_E2E_PHASE_NUM + 1))
    _E2E_PHASE_NAME="$name"
    log "=== Phase $_E2E_PHASE_NUM: $name ==="
}

phase_pass() {
    local msg="${1:-$_E2E_PHASE_NAME}"
    _E2E_PHASE_RESULTS+=("PASS|$_E2E_PHASE_NUM|$msg")
    pass "$msg"
}

phase_fail() {
    local msg="${1:-$_E2E_PHASE_NAME}"
    _E2E_PHASE_RESULTS+=("FAIL|$_E2E_PHASE_NUM|$msg")
    fail "$msg"
}

# --- Assertions ---

assert_true() {
    local description="$1"
    shift
    if "$@"; then
        pass "$description"
        return 0
    else
        fail "$description (command: $*)"
        return 1
    fi
}

assert_equals() {
    local description="$1"
    local expected="$2"
    local actual="$3"
    if [ "$expected" = "$actual" ]; then
        pass "$description"
        return 0
    else
        fail "$description (expected: '$expected', got: '$actual')"
        return 1
    fi
}

assert_contains() {
    local description="$1"
    local haystack="$2"
    local needle="$3"
    if echo "$haystack" | grep -qi "$needle"; then
        pass "$description"
        return 0
    else
        fail "$description (expected to contain: '$needle')"
        return 1
    fi
}

assert_not_contains() {
    local description="$1"
    local haystack="$2"
    local needle="$3"
    if ! echo "$haystack" | grep -qi "$needle"; then
        pass "$description"
        return 0
    else
        fail "$description (expected NOT to contain: '$needle')"
        return 1
    fi
}

assert_file_exists() {
    local path="$1"
    local description="${2:-File exists: $path}"
    if [ -f "$path" ]; then
        pass "$description"
        return 0
    else
        fail "$description"
        return 1
    fi
}

assert_command() {
    local description="$1"
    shift
    local output
    if output=$("$@" 2>&1); then
        pass "$description"
        echo "$output"
        return 0
    else
        fail "$description (exit code: $?, output: $output)"
        return 1
    fi
}

# --- Results ---

print_results() {
    echo ""
    log "=========================================="
    log "  Test Results"
    log "=========================================="
    
    local total=$((_E2E_PASS_COUNT + _E2E_FAIL_COUNT))
    
    for result in "${_E2E_PHASE_RESULTS[@]}"; do
        local status=$(echo "$result" | cut -d'|' -f1)
        local num=$(echo "$result" | cut -d'|' -f2)
        local msg=$(echo "$result" | cut -d'|' -f3-)
        if [ "$status" = "PASS" ]; then
            echo -e "  ${_GREEN}✅${_NC} Phase $num: $msg" | tee -a "$E2E_LOG_FILE"
        else
            echo -e "  ${_RED}❌${_NC} Phase $num: $msg" | tee -a "$E2E_LOG_FILE"
        fi
    done
    
    echo "" | tee -a "$E2E_LOG_FILE"
    if [ "$_E2E_FAIL_COUNT" -eq 0 ]; then
        echo -e "  ${_GREEN}All $total checks passed${_NC}" | tee -a "$E2E_LOG_FILE"
    else
        echo -e "  ${_RED}$_E2E_FAIL_COUNT/$total checks failed${_NC}" | tee -a "$E2E_LOG_FILE"
    fi
    log "=========================================="
}

# --- JSON output (for CI consumption) ---

results_json() {
    local phases="[]"
    for result in "${_E2E_PHASE_RESULTS[@]}"; do
        local status=$(echo "$result" | cut -d'|' -f1)
        local num=$(echo "$result" | cut -d'|' -f2)
        local msg=$(echo "$result" | cut -d'|' -f3-)
        phases=$(echo "$phases" | jq --arg s "$status" --arg n "$num" --arg m "$msg" \
            '. + [{"phase": ($n | tonumber), "status": $s, "message": $m}]')
    done
    
    jq -n \
        --arg scenario "${E2E_SCENARIO_NAME:-unknown}" \
        --arg passed "$_E2E_PASS_COUNT" \
        --arg failed "$_E2E_FAIL_COUNT" \
        --arg duration "$(( $(date +%s) - ${_E2E_START_TIME:-$(date +%s)} ))" \
        --argjson phases "$phases" \
        '{
            scenario: $scenario,
            passed: ($passed | tonumber),
            failed: ($failed | tonumber),
            duration_seconds: ($duration | tonumber),
            success: (($failed | tonumber) == 0),
            phases: $phases
        }'
}

# --- Init ---

_e2e_init() {
    _E2E_START_TIME=$(date +%s)
    mkdir -p "$E2E_SCREENSHOT_DIR"
    echo "" > "$E2E_LOG_FILE"
    log "=== macos-e2e test runner ==="
    log "Started at $(date)"
    log "Machine: $(hostname) | macOS $(sw_vers -productVersion)"
    log "Working directory: $E2E_ROOT"
}
