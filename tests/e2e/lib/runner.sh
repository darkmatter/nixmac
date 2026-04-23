#!/bin/bash
# =============================================================================
# macos-e2e — Test runner
#
# Orchestrates test execution: locking, sourcing libraries, running scenarios,
# recording, cleanup, and result reporting.
# =============================================================================

# --- Runner lock (one test at a time per machine) ---

LOCK_FILE="/tmp/e2e-runner.lock"

runner_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            echo "ERROR: Another E2E run is active (PID $lock_pid). Exiting."
            exit 1
        fi
        echo "WARN: Stale lock file found. Removing."
        rm -f "$LOCK_FILE"
    fi
    echo $$ > "$LOCK_FILE"
}

runner_unlock() {
    rm -f "$LOCK_FILE"
}

# --- Source all libraries ---

runner_source_libs() {
    local lib_dir="$E2E_LIB"
    source "$lib_dir/core.sh"
    source "$lib_dir/peekaboo.sh"
    source "$lib_dir/recording.sh"
    source "$lib_dir/app.sh"
    source "$lib_dir/report.sh"
}

# --- Run a scenario ---

# Usage: runner_exec <scenario_file> [args...]
runner_exec() {
    local scenario_file="$1"; shift
    local scenario_name
    scenario_name=$(basename "$scenario_file" .sh)
    
    # Source libraries
    export E2E_ROOT="${E2E_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    export E2E_LIB="$E2E_ROOT/lib"
    runner_source_libs
    
    # Init
    _e2e_init
    _E2E_REPORT_WRITTEN=0
    runner_lock
    trap 'runner_cleanup' EXIT
    
    # Source scenario first to pick up E2E_ADAPTER/E2E_FIXTURE declarations
    source "$scenario_file"
    
    log "Scenario: $scenario_name"
    export E2E_SCENARIO_NAME="$scenario_name"
    
    # Source adapter if specified in scenario
    if [ -n "${E2E_ADAPTER:-}" ]; then
        local adapter_file="$E2E_ROOT/adapters/${E2E_ADAPTER}.sh"
        if [ -f "$adapter_file" ]; then
            debug "Loading adapter: $E2E_ADAPTER"
            source "$adapter_file"
        else
            die "Adapter not found: $adapter_file"
        fi
    fi
    
    # Source and run fixture if specified
    if [ -n "${E2E_FIXTURE:-}" ]; then
        local fixture_file="$E2E_ROOT/fixtures/${E2E_FIXTURE}.sh"
        if [ -f "$fixture_file" ]; then
            debug "Loading fixture: $E2E_FIXTURE"
            source "$fixture_file"
            "fixture_${E2E_FIXTURE//-/_}" || die "Fixture '$E2E_FIXTURE' failed"
        else
            die "Fixture not found: $fixture_file"
        fi
    fi
    
    # Recording
    local do_record="${E2E_RECORD:-1}"
    if [ "$do_record" = "1" ]; then
        start_recording
    fi
    
    # Run the scenario test function
    if declare -f scenario_test &>/dev/null; then
        scenario_test "$@"
    else
        die "Scenario '$scenario_file' does not define scenario_test()"
    fi
    
    # Stop recording
    if [ "$do_record" = "1" ]; then
        stop_recording
    fi
    
    # Results
    print_results
    
    # JSON output for CI
    if [ "${E2E_JSON:-0}" = "1" ]; then
        results_json > "${E2E_LOG_FILE%.log}-results.json"
    fi
    e2e_report_write
    _E2E_REPORT_WRITTEN=1
    
    log ""
    log "Screenshots: $E2E_SCREENSHOT_DIR"
    log "Video: $E2E_VIDEO_FILE"
    log "Log: $E2E_LOG_FILE"
    
    # Exit with failure if any checks failed
    [ "$_E2E_FAIL_COUNT" -eq 0 ] || exit 1
}

# --- Cleanup ---

runner_cleanup() {
    local exit_code=$?
    
    stop_recording 2>/dev/null || true
    
    # Run scenario cleanup if defined
    if declare -f scenario_cleanup &>/dev/null; then
        debug "Running scenario cleanup..."
        scenario_cleanup || true
    fi
    
    # Run adapter cleanup if defined
    if declare -f adapter_cleanup &>/dev/null; then
        debug "Running adapter cleanup..."
        adapter_cleanup || true
    fi
    
    runner_unlock
    
    if [ $exit_code -ne 0 ] && [ "$_E2E_FAIL_COUNT" -eq 0 ]; then
        # Unexpected exit (not from a test failure)
        fail "Test aborted unexpectedly (exit code: $exit_code)"
    fi

    if [ "${_E2E_REPORT_WRITTEN:-0}" != "1" ]; then
        e2e_report_write 2>/dev/null || true
        _E2E_REPORT_WRITTEN=1
    fi
    
    return $exit_code
}
