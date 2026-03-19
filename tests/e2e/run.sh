#!/bin/bash
# =============================================================================
# macos-e2e — CLI entry point
#
# Usage:
#   ./run.sh <scenario>                    # Run a scenario
#   ./run.sh <scenario> --no-record        # Skip screen recording
#   ./run.sh <scenario> --no-cleanup       # Don't cleanup after test
#   ./run.sh <scenario> --json             # Output JSON results
#   ./run.sh <scenario> --verbose          # Debug logging
#   ./run.sh --list                        # List available scenarios
#   ./run.sh --help                        # Show help
#
# Examples:
#   ./run.sh nix-install
#   ./run.sh nix-install --no-cleanup --verbose
#   E2E_RECORD=0 ./run.sh nix-install
# =============================================================================
set -uo pipefail

E2E_ROOT="$(cd "$(dirname "$0")" && pwd)"
export E2E_ROOT
export E2E_LIB="$E2E_ROOT/lib"

# --- CLI parsing ---

show_help() {
    cat << 'EOF'
macos-e2e — GUI test framework for macOS apps

Usage:
  ./run.sh <scenario> [options]
  ./run.sh --list
  ./run.sh --help

Options:
  --no-record     Skip screen recording
  --no-cleanup    Don't cleanup Nix/app state after test
  --json          Write JSON results file
  --verbose       Enable debug logging
  --help          Show this help

Environment:
  E2E_RECORD=0|1          Control recording (default: 1)
  E2E_CLEANUP_NIX=0|1     Control Nix cleanup (default: 1)
  E2E_VERBOSE=0|1         Debug logging (default: 0)
  E2E_JSON=0|1            JSON output (default: 0)
  E2E_SCREENSHOT_DIR      Screenshot output dir (default: /tmp/e2e-screenshots)
  E2E_LOG_FILE             Log file (default: /tmp/e2e-test.log)
  E2E_VIDEO_FILE           Video output (default: /tmp/e2e-recording.mp4)
  NIXMAC_APP_PATH          App location (default: /Applications/nixmac.app)

Scenarios:
  Stored in tests/e2e/scenarios/*.sh
  Each scenario defines: E2E_ADAPTER, E2E_FIXTURE, scenario_test()
EOF
}

list_scenarios() {
    echo "Available scenarios:"
    for f in "$E2E_ROOT/scenarios/"*.sh; do
        [ -f "$f" ] || continue
        local name=$(basename "$f" .sh)
        local desc=$(grep -m1 "^# Scenario:" "$f" 2>/dev/null | sed 's/^# Scenario: //' || echo "")
        [ -z "$desc" ] && desc=$(head -5 "$f" | grep "^# Tests\|^# " | head -1 | sed 's/^# //')
        printf "  %-20s %s\n" "$name" "$desc"
    done
}

# Parse args
SCENARIO=""
export E2E_RECORD="${E2E_RECORD:-1}"
export E2E_CLEANUP_NIX="${E2E_CLEANUP_NIX:-1}"
export E2E_VERBOSE="${E2E_VERBOSE:-0}"
export E2E_JSON="${E2E_JSON:-0}"

while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) show_help; exit 0 ;;
        --list|-l) list_scenarios; exit 0 ;;
        --no-record) E2E_RECORD=0; shift ;;
        --no-cleanup) E2E_CLEANUP_NIX=0; shift ;;
        --json) E2E_JSON=1; shift ;;
        --verbose|-v) E2E_VERBOSE=1; shift ;;
        -*) echo "Unknown option: $1"; show_help; exit 1 ;;
        *)
            if [ -z "$SCENARIO" ]; then
                SCENARIO="$1"
            else
                echo "Unexpected argument: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$SCENARIO" ]; then
    echo "Error: No scenario specified."
    echo ""
    list_scenarios
    exit 1
fi

# Resolve scenario file
SCENARIO_FILE="$E2E_ROOT/scenarios/${SCENARIO}.sh"
if [ ! -f "$SCENARIO_FILE" ]; then
    echo "Error: Scenario not found: $SCENARIO_FILE"
    echo ""
    list_scenarios
    exit 1
fi

# Run
source "$E2E_LIB/runner.sh"
runner_exec "$SCENARIO_FILE"
