#!/usr/bin/env bash
# Simple assertion helper for evolve-state.json and build-state.json using jq.
# Usage examples:
#   ./assert-state.sh --evolve '.evolveState.step == "commit"'
#   ./assert-state.sh --build '.buildState.changesetId != null'
#   ./assert-state.sh --evolve '.evolveState.step == "commit"' --build '.buildState.changesetId != null'

set -euo pipefail

STATE_DIR="$HOME/Library/Application Support/com.darkmatter.nixmac"
EVOLVE_FILE="$STATE_DIR/evolve-state.json"
BUILD_FILE="$STATE_DIR/build-state.json"

E_JQ=""
B_JQ=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --evolve)
      shift
      E_JQ="$1"
      ;;
    --build)
      shift
      B_JQ="$1"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: assert-state.sh [--evolve JQ_EXPR] [--build JQ_EXPR]

Runs the provided jq expressions against the corresponding state files and
exits non-zero if any expression fails (jq returns false or the file is missing).
Examples:
  --evolve '.evolveState.step == "commit"'
  --build '.buildState.changesetId != null'
USAGE
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
  shift
done

fail=0
run_check() {
  local file="$1" expr="$2" label="$3"
  if [[ -z "$expr" ]]; then
    return 0
  fi
  if [[ ! -f "$file" ]]; then
    echo "[FAIL] $label: file not found: $file" >&2
    fail=1
    return
  fi
  if ! jq -e "$expr" "$file" >/dev/null 2>&1; then
    echo "[FAIL] $label: assertion failed: $expr" >&2
    echo "------- $file -------" >&2
    jq . "$file" >&2 || true
    fail=1
  else
    echo "[OK] $label: $expr"
  fi
}

run_check "$EVOLVE_FILE" "$E_JQ" "evolve-state"
run_check "$BUILD_FILE" "$B_JQ" "build-state"

if [[ $fail -ne 0 ]]; then
  exit 2
fi

echo "All assertions passed."
