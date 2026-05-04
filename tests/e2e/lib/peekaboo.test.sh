#!/bin/bash
set -euo pipefail

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/peekaboo-lib-test.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

export E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export E2E_LIB="$E2E_ROOT/lib"
export E2E_SCREENSHOT_DIR="$TEST_DIR/screenshots"
export E2E_PEEKABOO_CAPTURE_DIR="$TEST_DIR/captures"
export E2E_DIAGNOSTIC_DIR="$TEST_DIR/diagnostics"
export E2E_LOG_FILE="$TEST_DIR/e2e.log"
export E2E_VIDEO_FILE="$TEST_DIR/video.mp4"
export E2E_ARTIFACT_ROOT="$TEST_DIR/artifacts"
export E2E_SCENARIO_NAME="peekaboo-lib-test"
export E2E_VERBOSE=0
export NIXMAC_BUNDLE_ID="com.darkmatter.nixmac"

source "$E2E_LIB/core.sh"
source "$E2E_LIB/peekaboo.sh"

peekaboo_run() {
    case "$*" in
        see*"--app nixmac"*)
            echo '{"data":{"ui_elements":[],"snapshot_id":"app-empty"}}'
            ;;
        see*"--pid 12345"*)
            echo '{"data":{"ui_elements":[{"id":"elem_1","role":"window","label":"nixmac"},{"id":"elem_2","role":"button","label":"Settings"},{"id":"elem_3","role":"text","label":"No base URL set"}],"snapshot_id":"pid-snapshot"}}'
            ;;
        "app list --json")
            echo '{"data":{"applications":[{"name":"nixmac","bundle_id":"com.darkmatter.nixmac","pid":12345}]}}'
            ;;
        "window list --app nixmac --json")
            echo '{"data":{"windows":[{"window_title":"nixmac","window_id":1}]}}'
            ;;
        "bridge status --verbose")
            echo 'Selected: remote gui via /tmp/bridge.sock'
            ;;
        permissions)
            echo 'Screen Recording (Required): Granted'
            echo 'Accessibility (Required): Granted'
            ;;
        image*"--path"*)
            local path=""
            while [ "$#" -gt 0 ]; do
                if [ "$1" = "--path" ]; then
                    path="$2"
                    break
                fi
                shift
            done
            [ -n "$path" ] && printf 'png' > "$path"
            ;;
        *)
            echo "{}"
            ;;
    esac
}

json="$(peek_elements nixmac)"
count="$(peekaboo_element_count "$json")"
snapshot="$(peek_snapshot_id "$json")"

[ "$count" = "3" ] || {
    echo "expected pid fallback to return 3 elements, got $count" >&2
    exit 1
}

[ "$snapshot" = "pid-snapshot" ] || {
    echo "expected pid fallback snapshot, got $snapshot" >&2
    exit 1
}

find "$E2E_DIAGNOSTIC_DIR" -type f -name '*-app-list.json' | grep -q . || {
    echo "expected persistent app-list diagnostic" >&2
    exit 1
}

echo "Peekaboo shell fallback self-test passed."
