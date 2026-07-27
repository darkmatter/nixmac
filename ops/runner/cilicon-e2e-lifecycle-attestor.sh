#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HOST_TOOL="${NIXMAC_E2E_HOST_TOOL:-$SCRIPT_DIR/cilicon-e2e-host.mjs}"
CILICON_BINARY="${NIXMAC_E2E_CILICON_BINARY:-/Applications/Cilicon.app/Contents/MacOS/Cilicon}"
STOP_TIMEOUT_SECONDS="${NIXMAC_E2E_CILICON_STOP_TIMEOUT_SECONDS:-300}"
RUNNER_FINISHED_TIMEOUT_SECONDS="${NIXMAC_E2E_RUNNER_FINISHED_TIMEOUT_SECONDS:-1200}"
QUARANTINE_HELPER="${NIXMAC_E2E_QUARANTINE_HELPER:-}"
NODE_BINARY="${NIXMAC_E2E_NODE_BINARY:-/opt/homebrew/bin/node}"
GRACEFUL_QUIT_HELPER="${NIXMAC_E2E_GRACEFUL_QUIT_HELPER:-/usr/local/libexec/cilicon-e2e-graceful-quit}"

# The host tool authenticates with two deliberately separate identities:
# NIXMAC_E2E_INVENTORY_APP_ID is Administration read on darkmatter/nixmac;
# NIXMAC_E2E_SINK_APP_ID is Actions write plus Contents read on the protected
# sink. A different writer App exists only in the sink's protected environment.
# It polls /actions/runners until exact runner deregistration, proves the exact
# clone absent twice, signs lifecycleAttestationSigningPayload, computes
# lifecycleAttestationPath, and dispatches the trusted sink workflow. Any ambiguity
# quarantines the host before another cycle can start.

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --contract) CONTRACT="$2"; shift 2 ;;
      --state) STATE="$2"; shift 2 ;;
      --request) REQUEST="$2"; shift 2 ;;
      --runner-finished) RUNNER_FINISHED="$2"; shift 2 ;;
      --cilicon-pid) CILICON_PID="$2"; shift 2 ;;
      --cilicon-config) CILICON_CONFIG="$2"; shift 2 ;;
      --signing-key) SIGNING_KEY="$2"; shift 2 ;;
      --inventory-private-key) INVENTORY_PRIVATE_KEY="$2"; shift 2 ;;
      --sink-private-key) SINK_PRIVATE_KEY="$2"; shift 2 ;;
      --output) OUTPUT="$2"; shift 2 ;;
      --quarantine-sentinel) QUARANTINE_SENTINEL="$2"; shift 2 ;;
      *) echo "unexpected argument: $1" >&2; return 64 ;;
    esac
  done
}

mark_quarantine() {
  local reason="$1"
  mkdir -p "$(dirname "$QUARANTINE_SENTINEL")"
  if [ -n "$QUARANTINE_HELPER" ]; then
    /usr/bin/python3 - "$reason" <<'PY' |
import json
import sys
from datetime import datetime, timezone

print(json.dumps({
    "version": 1,
    "reason": sys.argv[1],
    "markedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}))
PY
      /usr/bin/sudo -n "$QUARANTINE_HELPER"
    return
  fi
  /usr/bin/python3 - "$QUARANTINE_SENTINEL" "$reason" <<'PY'
import json
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timezone

target = pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
body = {
    "version": 1,
    "reason": sys.argv[2],
    "markedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}
fd, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(body, stream, indent=2)
        stream.write("\n")
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
}

owned_cilicon_process() {
  [[ "${CILICON_PID:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  test -f "$CILICON_CONFIG" && test ! -L "$CILICON_CONFIG" || return 1
  kill -0 "$CILICON_PID" 2>/dev/null || return 1
  local command
  command="$(ps -p "$CILICON_PID" -o command= 2>/dev/null)" || return 1
  [ "$command" = "$CILICON_BINARY -config-path $CILICON_CONFIG" ]
}

contain_owned_cilicon() {
  if ! kill -0 "$CILICON_PID" 2>/dev/null; then
    return
  fi
  if ! owned_cilicon_process; then
    mark_quarantine "refusing to contain non-owned process recorded as Cilicon pid $CILICON_PID"
    return 76
  fi
  kill -KILL "$CILICON_PID" 2>/dev/null || true
}

wait_for_runner_finished() {
  local elapsed=0
  while [ "$elapsed" -lt "$RUNNER_FINISHED_TIMEOUT_SECONDS" ]; do
    if [ -s "$RUNNER_FINISHED" ] && [ ! -L "$RUNNER_FINISHED" ]; then
      /usr/bin/python3 - "$RUNNER_FINISHED" "$STATE" <<'PY'
import json
import sys

with open(sys.argv[1]) as stream:
    marker = json.load(stream)
with open(sys.argv[2]) as stream:
    state = json.load(stream)
if set(marker) != {"version", "cycleId", "runnerName"}:
    raise SystemExit("runner-finished marker has unexpected fields")
if marker != {
    "version": 1,
    "cycleId": state["cycleId"],
    "runnerName": state["runnerName"],
}:
    raise SystemExit("runner-finished marker does not match the owned cycle")
PY
      return
    fi
    if ! kill -0 "$CILICON_PID" 2>/dev/null; then
      return 74
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 75
}

gracefully_stop_owned_cilicon() {
  [[ "$CILICON_PID" =~ ^[1-9][0-9]*$ ]]
  if ! kill -0 "$CILICON_PID" 2>/dev/null; then
    return
  fi
  if ! owned_cilicon_process; then
    mark_quarantine "refusing to terminate non-owned Cilicon process $CILICON_PID"
    return 76
  fi
  if ! "$GRACEFUL_QUIT_HELPER" \
    "$CILICON_PID" \
    "com.traderepublic.cilicon" \
    "$CILICON_BINARY"; then
    contain_owned_cilicon || true
    mark_quarantine "graceful Cilicon quit failed; process was contained without destruction proof"
    return 77
  fi
  local elapsed=0
  while kill -0 "$CILICON_PID" 2>/dev/null && [ "$elapsed" -lt "$STOP_TIMEOUT_SECONDS" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$CILICON_PID" 2>/dev/null; then
    contain_owned_cilicon || true
    for _ in $(seq 1 30); do
      kill -0 "$CILICON_PID" 2>/dev/null || break
      sleep 1
    done
    mark_quarantine "graceful Cilicon quit timed out; process was contained without destruction proof"
    return 77
  fi
}

emit_lifecycle_attestation() {
  local forced_reason="$1"
  "$NODE_BINARY" "$HOST_TOOL" attest \
    --contract "$CONTRACT" \
    --state "$STATE" \
    --request "$REQUEST" \
    --signing-key "$SIGNING_KEY" \
    --inventory-private-key "$INVENTORY_PRIVATE_KEY" \
    --sink-private-key "$SINK_PRIVATE_KEY" \
    --output "$OUTPUT" \
    --quarantine-sentinel "$QUARANTINE_SENTINEL" \
    --forced-quarantine-reason "$forced_reason"
}

self_test() {
  "$NODE_BINARY" "$HOST_TOOL" self-test
  local temp_root
  temp_root="$(mktemp -d)"
  # Capture the local before RETURN leaves scope.
  # shellcheck disable=SC2064
  trap "rm -rf '$temp_root'" RETURN
  QUARANTINE_SENTINEL="$temp_root/quarantined.json"
  mark_quarantine "self-test quarantine"
  /usr/bin/python3 - "$QUARANTINE_SENTINEL" <<'PY'
import json
import sys
with open(sys.argv[1]) as stream:
    value = json.load(stream)
assert value["version"] == 1
assert value["reason"] == "self-test quarantine"
PY
  CILICON_CONFIG="$temp_root/foreign.yml"
  printf '%s\n' "not a Cilicon config" > "$CILICON_CONFIG"
  /bin/sleep 30 &
  CILICON_PID=$!
  if contain_owned_cilicon; then
    echo "foreign process was incorrectly contained as owned Cilicon" >&2
    return 1
  fi
  kill -0 "$CILICON_PID"
  kill "$CILICON_PID"
  wait "$CILICON_PID" 2>/dev/null || true
  echo "Cilicon lifecycle attestor self-test passed."
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return
  fi
  CONTRACT=""
  STATE=""
  REQUEST=""
  RUNNER_FINISHED=""
  CILICON_PID=""
  CILICON_CONFIG=""
  SIGNING_KEY=""
  INVENTORY_PRIVATE_KEY=""
  SINK_PRIVATE_KEY=""
  OUTPUT=""
  QUARANTINE_SENTINEL=""
  parse_args "$@"
  for value in \
    "$CONTRACT" \
    "$STATE" \
    "$REQUEST" \
    "$CILICON_CONFIG" \
    "$SIGNING_KEY" \
    "$INVENTORY_PRIVATE_KEY" \
    "$SINK_PRIVATE_KEY"; do
    test -f "$value" && test ! -L "$value"
  done
  test -n "$OUTPUT"
  test -n "$QUARANTINE_SENTINEL"
  test -n "$RUNNER_FINISHED"
  test -x "$NODE_BINARY"
  test -x "$GRACEFUL_QUIT_HELPER" && test ! -L "$GRACEFUL_QUIT_HELPER"

  local forced_reason="-"
  if ! wait_for_runner_finished; then
    contain_owned_cilicon || true
    forced_reason="runner completion marker was missing, invalid, or timed out"
  elif ! "$NODE_BINARY" "$HOST_TOOL" wait-runner-absent \
    --contract "$CONTRACT" \
    --state "$STATE" \
    --request "$REQUEST" \
    --inventory-private-key "$INVENTORY_PRIVATE_KEY"; then
    contain_owned_cilicon || true
    forced_reason="exact Actions runner deregistration was not proved before VM teardown"
  elif ! gracefully_stop_owned_cilicon; then
    forced_reason="normal Cilicon termination and clone cleanup were not proved"
  fi
  if ! emit_lifecycle_attestation "$forced_reason"; then
    mark_quarantine "lifecycle attestation or protected sink dispatch failed"
    return 78
  fi
  /usr/bin/python3 - "$OUTPUT" <<'PY'
import json
import sys
with open(sys.argv[1]) as stream:
    value = json.load(stream)
if value.get("result") not in {"destroyed", "quarantined"}:
    raise SystemExit("attestor produced an invalid disposition")
PY
}

main "$@"
