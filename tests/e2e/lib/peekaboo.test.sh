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
export E2E_ACTIVE_BUNDLE_ID="com.darkmatter.nixmac"

source "$E2E_LIB/core.sh"
source "$E2E_LIB/peekaboo.sh"
source "$E2E_LIB/nixmac_product_proof.sh"

peekaboo_run() {
    case "$*" in
        "app switch --to nixmac")
            echo "$*" >> "$TEST_DIR/app-switch.log"
            PEEKABOO_TEST_RESTORE_READY=1
            echo "✓ Switched to nixmac"
            ;;
        see*"--app nixmac"*)
            if [ "${PEEKABOO_TEST_RESTORE_READY:-0}" = "1" ]; then
                echo '{"data":{"ui_elements":[{"id":"elem_1","role":"window","label":"nixmac"},{"id":"elem_2","role":"button","label":"Settings"}],"snapshot_id":"restored-app"}}'
            else
                echo '{"data":{"ui_elements":[],"snapshot_id":"app-empty"}}'
            fi
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

export E2E_ACTIVE_APP_NAME="nixmac"
PEEKABOO_TEST_RESTORE_READY=0
: > "$TEST_DIR/app-switch.log"
peekaboo_restore_active_app "" 2 3 || {
    echo "expected active app restore to wait for app elements" >&2
    exit 1
}
grep -q "app switch --to nixmac" "$TEST_DIR/app-switch.log" || {
    echo "expected active app restore to switch to nixmac" >&2
    exit 1
}

titlebar_only_json='{"data":{"ui_elements":[{"id":"elem_1","role":"button","label":"close button"},{"id":"elem_2","role":"button","label":"minimize button"},{"id":"elem_3","role":"button","label":"full screen button"},{"id":"elem_4","role":"other","label":"nixmac"},{"id":"elem_5","role":"group","label":"group"}]}}'
if nixmac_pp_elements_show_ready_shell "$titlebar_only_json" 2; then
    echo "expected titlebar-only elements not to satisfy ready shell" >&2
    exit 1
fi

ready_shell_json=$(jq -n '{
    data: {
        ui_elements: (
            [range(0;24) | {id: ("elem_" + tostring), role: "group", label: "group"}]
            + [{id: "prompt", role: "textField", label: "Describe changes to make to your configuration"}]
        )
    }
}')
nixmac_pp_elements_show_ready_shell "$ready_shell_json" 20 || {
    echo "expected product shell marker and sufficient elements to satisfy ready shell" >&2
    exit 1
}

echo "Peekaboo shell fallback self-test passed."
