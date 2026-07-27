#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HOST_TOOL="${NIXMAC_E2E_HOST_TOOL:-$SCRIPT_DIR/cilicon-e2e-host.mjs}"
ATTESTOR="${NIXMAC_E2E_ATTESTOR:-$SCRIPT_DIR/cilicon-e2e-lifecycle-attestor.sh}"
CILICON_BINARY="${NIXMAC_E2E_CILICON_BINARY:-/Applications/Cilicon.app/Contents/MacOS/Cilicon}"
CONTRACT="${NIXMAC_E2E_CONTRACT_PATH:-/Library/Application Support/darkmatter/nixmac-e2e-runner.contract.json}"
ATTESTOR_SIGNING_KEY="${NIXMAC_E2E_ATTESTOR_SIGNING_KEY:-/Library/Application Support/darkmatter/credentials/e2e-attestor-ed25519.pem}"
RUNNER_PRIVATE_KEY="${NIXMAC_E2E_RUNNER_PRIVATE_KEY:-/Library/Application Support/darkmatter/credentials/e2e-runner-app.pem}"
INVENTORY_PRIVATE_KEY="${NIXMAC_E2E_INVENTORY_PRIVATE_KEY:-/Library/Application Support/darkmatter/credentials/e2e-inventory-app.pem}"
SINK_PRIVATE_KEY="${NIXMAC_E2E_SINK_PRIVATE_KEY:-/Library/Application Support/darkmatter/credentials/e2e-sink-app.pem}"
RUNNER_APP_ID="${NIXMAC_E2E_RUNNER_APP_ID:-}"
SSH_USERNAME="${NIXMAC_E2E_SSH_USERNAME:-nixmac_e2e}"
SSH_PASSWORD="${NIXMAC_E2E_SSH_PASSWORD:-nixmac-e2e-local-only}"
HOST_ROOT="${NIXMAC_E2E_HOST_ROOT:-/private/var/db/nixmac-e2e-host}"
CYCLES_ROOT="$HOST_ROOT/cycles"
HISTORY_ROOT="$HOST_ROOT/history"
CLONES_ROOT="${NIXMAC_E2E_CLONES_ROOT:-/Users/Shared/Cilicon/vms}"
LOCK_DIR="${NIXMAC_E2E_LOCK_DIR:-$HOST_ROOT/cycle.lock}"
QUARANTINE_SENTINEL="${NIXMAC_E2E_QUARANTINE_SENTINEL:-/var/db/nixmac-e2e-quarantined}"
QUARANTINE_HELPER="${NIXMAC_E2E_QUARANTINE_HELPER:-}"
DRAIN_SENTINEL="${NIXMAC_E2E_DRAIN_SENTINEL:-/var/db/nixmac-e2e-drain}"
PENDING_DRAIN_CLEANUP="${NIXMAC_E2E_PENDING_DRAIN_CLEANUP:-$HOST_ROOT/pending-drain-cleanup.json}"
GRACEFUL_QUIT_HELPER="${NIXMAC_E2E_GRACEFUL_QUIT_HELPER:-/usr/local/libexec/cilicon-e2e-graceful-quit}"
HOST_ID="${NIXMAC_E2E_HOST_ID:-}"
RUNTIME_PROBE_TIMEOUT_SECONDS="${NIXMAC_E2E_RUNTIME_PROBE_TIMEOUT_SECONDS:-1800}"
FINISHED_WITHOUT_REQUEST_GRACE_SECONDS="${NIXMAC_E2E_FINISHED_WITHOUT_REQUEST_GRACE_SECONDS:-900}"
CILICON_STOP_TIMEOUT_SECONDS="${NIXMAC_E2E_CILICON_STOP_TIMEOUT_SECONDS:-300}"
NODE_BINARY="${NIXMAC_E2E_NODE_BINARY:-/opt/homebrew/bin/node}"
HISTORY_RETENTION="${NIXMAC_E2E_HISTORY_RETENTION:-200}"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

mark_quarantine() {
  local reason="$1"
  local cycle_id="${2:-unknown}"
  mkdir -p "$(dirname "$QUARANTINE_SENTINEL")"
  if [ -n "$QUARANTINE_HELPER" ]; then
    /usr/bin/python3 - "$HOST_ID" "$cycle_id" "$reason" <<'PY' |
import json
import sys
from datetime import datetime, timezone

print(json.dumps({
    "version": 1,
    "hostId": sys.argv[1] or "unknown",
    "cycleId": sys.argv[2],
    "reason": sys.argv[3],
    "markedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}))
PY
      /usr/bin/sudo -n "$QUARANTINE_HELPER"
    return
  fi
  /usr/bin/python3 - "$QUARANTINE_SENTINEL" "$HOST_ID" "$cycle_id" "$reason" <<'PY'
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
    "hostId": sys.argv[2] or "unknown",
    "cycleId": sys.argv[3],
    "reason": sys.argv[4],
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

owned_wrapper_process() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ "$pid" = "$$" ]; then
    return
  fi
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case " $command " in
    *" ${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}") "*) return ;;
    *) return 1 ;;
  esac
}

acquire_lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local recorded_pid=""
    local stale_lock="${LOCK_DIR}.stale.$$"
    if [ -f "$LOCK_DIR/pid" ] && [ ! -L "$LOCK_DIR/pid" ]; then
      recorded_pid="$(tr -d '[:space:]' < "$LOCK_DIR/pid")"
    fi
    if [ -z "$recorded_pid" ] &&
      /usr/bin/python3 - "$LOCK_DIR" <<'PY'
import os
import sys
import time

age = time.time() - os.stat(sys.argv[1], follow_symlinks=False).st_mtime
raise SystemExit(0 if -1 <= age <= 5 else 1)
PY
    then
      echo "capacity-one cycle lock is still being initialized: $LOCK_DIR" >&2
      return 75
    fi
    if owned_wrapper_process "$recorded_pid"; then
      echo "capacity-one cycle lock is held by live pid $recorded_pid: $LOCK_DIR" >&2
      return 75
    fi
    if ! mv "$LOCK_DIR" "$stale_lock" 2>/dev/null; then
      echo "capacity-one cycle lock changed while checking staleness: $LOCK_DIR" >&2
      return 75
    fi
    rm -f "$stale_lock/pid"
    rmdir "$stale_lock"
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "capacity-one cycle lock could not be reclaimed: $LOCK_DIR" >&2
      return 75
    fi
    log "reclaimed stale capacity-one cycle lock"
  fi
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
}

release_lock() {
  if [ -d "$LOCK_DIR" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

active_cycle_dirs() {
  find "$CYCLES_ROOT" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort
}

load_active_cycles() {
  active=()
  shopt -s nullglob
  local candidate
  for candidate in "$CYCLES_ROOT"/*; do
    if [ -d "$candidate" ] && [ ! -L "$candidate" ]; then
      active+=("$candidate")
    fi
  done
  shopt -u nullglob
}

claim_request() {
  local cycle_dir="$1"
  local request="$cycle_dir/exchange/attestation-request.json"
  local claimed="$cycle_dir/claimed-attestation-request.json"
  if [ -e "$claimed" ]; then
    test -f "$claimed" && test ! -L "$claimed"
    return
  fi
  test -f "$request" && test ! -L "$request"
  mv "$request" "$claimed"
  test -f "$claimed" && test ! -L "$claimed"
}

wait_for_file_or_exit() {
  local file="$1"
  local pid="$2"
  local config="$3"
  local timeout_seconds="$4"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if [ -s "$file" ] && [ ! -L "$file" ]; then
      return 0
    fi
    if ! owned_cilicon_process "$pid" "$config"; then
      return 74
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 75
}

owned_cilicon_process() {
  local pid="${1:-}"
  local config="${2:-}"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [ -f "$config" ] && [ ! -L "$config" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  [ "$command" = "$CILICON_BINARY -config-path $config" ]
}

runtime_probe_is_signed() {
  local probe="$1"
  local observation="$2"
  [ -s "$probe" ] && [ ! -L "$probe" ] &&
    [ -s "$observation" ] && [ ! -L "$observation" ] &&
    /usr/bin/python3 - "$probe" "$observation" <<'PY'
import json
import sys

with open(sys.argv[1]) as stream:
    probe = json.load(stream)
with open(sys.argv[2]) as stream:
    observation = json.load(stream)
raise SystemExit(0 if probe.get("observedAt") == observation.get("observedAt") else 1)
PY
}

vm_generation_is_unique() {
  local cycle_dir="$1"
  local files=()
  shopt -s nullglob
  files=("$cycle_dir"/exchange/vm-generation-*)
  shopt -u nullglob
  [ "${#files[@]}" -eq 1 ] || return 1
  [[ "$(basename "${files[0]}")" =~ ^vm-generation-[0-9a-f]{32}$ ]]
  [ -f "${files[0]}" ] && [ ! -L "${files[0]}" ]
}

cycle_is_busy() {
  local cycle_dir="$1"
  local busy="$cycle_dir/exchange/runner-busy.json"
  [ -s "$busy" ] && [ ! -L "$busy" ] &&
    /usr/bin/python3 - "$busy" <<'PY'
import datetime
import json
import sys

with open(sys.argv[1]) as stream:
    marker = json.load(stream)
if set(marker) != {"version", "observedAt"} or marker["version"] != 1:
    raise SystemExit(1)
observed = datetime.datetime.fromisoformat(marker["observedAt"].replace("Z", "+00:00"))
age = (datetime.datetime.now(datetime.timezone.utc) - observed).total_seconds()
raise SystemExit(0 if -5 <= age <= 30 else 1)
PY
}

cycle_requires_drain() {
  local cycle_dir="$1"
  [ -e "$DRAIN_SENTINEL" ] ||
    ! "$NODE_BINARY" "$HOST_TOOL" check-cycle-admission \
      --contract "$CONTRACT" \
      --state "$cycle_dir/host-state.json"
}

drain_idle_cycle() {
  local cycle_dir="$1"
  local pid="$2"
  local config="$3"
  if cycle_is_busy "$cycle_dir"; then
    return 75
  fi
  if ! owned_cilicon_process "$pid" "$config"; then
    return 76
  fi
  local retirement
  if ! retirement="$(
    "$NODE_BINARY" "$HOST_TOOL" retire-idle-runner \
      --contract "$CONTRACT" \
      --state "$cycle_dir/host-state.json" \
      --runner-app-id "$RUNNER_APP_ID" \
      --runner-private-key "$RUNNER_PRIVATE_KEY"
  )"; then
    log "runner retirement is temporarily unavailable; drain will retry"
    return 75
  fi
  if [ "$(/opt/homebrew/bin/jq -r '.retired' <<<"$retirement")" != "true" ]; then
    if /opt/homebrew/bin/jq -e '.busy == true' <<<"$retirement" >/dev/null; then
      return 75
    fi
    return 76
  fi
  if ! "$GRACEFUL_QUIT_HELPER" \
    "$pid" \
    "com.traderepublic.cilicon" \
    "$CILICON_BINARY"; then
    return 76
  fi
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$CILICON_STOP_TIMEOUT_SECONDS" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    return 76
  fi
  "$NODE_BINARY" "$HOST_TOOL" wait-clone-absent \
    --state "$cycle_dir/host-state.json" ||
    return 76
  if ! /usr/bin/python3 - \
    "$cycle_dir/drained-cycle.json" \
    "$PENDING_DRAIN_CLEANUP" \
    "$cycle_dir/host-state.json" <<'PY'
import json
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timezone

with open(sys.argv[3]) as stream:
    state = json.load(stream)
record = {
    "version": 1,
    "cycleId": state["cycleId"],
    "runnerName": state["runnerName"],
    "imageReference": state["imageReference"],
    "reason": "idle cycle retired for image age, contract rotation, or explicit drain",
    "drainedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}
for target_name in sys.argv[1:3]:
    target = pathlib.Path(target_name)
    fd, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(record, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
PY
  then
    return 76
  fi
  log "drained idle cycle $(basename "$cycle_dir") without quarantining the host"
}

wait_for_request_with_runtime_refresh() {
  local cycle_dir="$1"
  local pid="$2"
  local config="$3"
  local request="$cycle_dir/exchange/attestation-request.json"
  local probe="$cycle_dir/exchange/runtime-probe.json"
  local observation="$cycle_dir/exchange/runtime-observation.json"
  local runner_finished="$cycle_dir/exchange/runner-finished.json"
  local finished_elapsed=0
  while true; do
    if [ -s "$request" ] && [ ! -L "$request" ]; then
      return
    fi
    if ! owned_cilicon_process "$pid" "$config"; then
      return 74
    fi
    if ! cycle_is_busy "$cycle_dir" && cycle_requires_drain "$cycle_dir"; then
      local drain_status=0
      drain_idle_cycle "$cycle_dir" "$pid" "$config" || drain_status=$?
      if [ "$drain_status" -eq 0 ]; then
        return 81
      fi
      if [ "$drain_status" -ne 75 ]; then
        return 82
      fi
    fi
    if ! vm_generation_is_unique "$cycle_dir"; then
      return 80
    fi
    if [ -s "$runner_finished" ] && [ ! -L "$runner_finished" ]; then
      if ! /usr/bin/python3 - "$runner_finished" "$cycle_dir/host-state.json" <<'PY'
import json
import sys

with open(sys.argv[1]) as stream:
    marker = json.load(stream)
with open(sys.argv[2]) as stream:
    state = json.load(stream)
expected = {
    "version": 1,
    "cycleId": state["cycleId"],
    "runnerName": state["runnerName"],
}
raise SystemExit(0 if marker == expected and set(marker) == set(expected) else 1)
PY
      then
        return 79
      fi
      finished_elapsed=$((finished_elapsed + 2))
      if [ "$finished_elapsed" -ge "$FINISHED_WITHOUT_REQUEST_GRACE_SECONDS" ]; then
        return 78
      fi
    else
      finished_elapsed=0
    fi
    if ! runtime_probe_is_signed "$probe" "$observation"; then
      "$NODE_BINARY" "$HOST_TOOL" sign-runtime \
        --contract "$CONTRACT" \
        --state "$cycle_dir/host-state.json" \
        --probe "$probe" \
        --signing-key "$ATTESTOR_SIGNING_KEY" \
        --output "$observation" ||
        return 76
    fi
    sleep 2
  done
}

run_attestor() {
  local cycle_dir="$1"
  local pid="$2"
  "$ATTESTOR" \
    --contract "$CONTRACT" \
    --state "$cycle_dir/host-state.json" \
    --request "$cycle_dir/claimed-attestation-request.json" \
    --runner-finished "$cycle_dir/exchange/runner-finished.json" \
    --cilicon-pid "$pid" \
    --cilicon-config "$cycle_dir/cilicon.yml" \
    --signing-key "$ATTESTOR_SIGNING_KEY" \
    --inventory-private-key "$INVENTORY_PRIVATE_KEY" \
    --sink-private-key "$SINK_PRIVATE_KEY" \
    --output "$cycle_dir/lifecycle-attestation.json" \
    --quarantine-sentinel "$QUARANTINE_SENTINEL"
}

contain_cycle_process() {
  local pid="${1:-}"
  local config="${2:-}"
  if owned_cilicon_process "$pid" "$config"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

prune_history() {
  [[ "$HISTORY_RETENTION" =~ ^[1-9][0-9]*$ ]]
  /usr/bin/python3 - "$HISTORY_ROOT" "$HISTORY_RETENTION" <<'PY'
import pathlib
import re
import shutil
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
retain = int(sys.argv[2])
entries = []
for candidate in root.iterdir():
    if candidate.is_symlink() or not candidate.is_dir():
        continue
    if not re.fullmatch(r"cycle-[A-Za-z0-9._-]+", candidate.name):
        continue
    if candidate.resolve().parent != root:
        raise SystemExit("history candidate escaped the canonical history root")
    entries.append(candidate)
for candidate in sorted(entries, key=lambda item: item.name)[:-retain]:
    shutil.rmtree(candidate)
PY
}

resume_cycle() {
  local cycle_dir="$1"
  local cycle_id
  cycle_id="$(basename "$cycle_dir")"
  local pid_file="$cycle_dir/cilicon.pid"
  local config="$cycle_dir/cilicon.yml"
  local claimed="$cycle_dir/claimed-attestation-request.json"
  local request="$cycle_dir/exchange/attestation-request.json"
  if [ -e "$claimed" ]; then
    if [ ! -f "$claimed" ] || [ -L "$claimed" ] || [ ! -s "$pid_file" ] ||
      ! run_attestor "$cycle_dir" "$(cat "$pid_file")"; then
      mark_quarantine "claimed lifecycle request could not be resumed safely" "$cycle_id"
      return 76
    fi
    return
  fi
  if [ -e "$request" ]; then
    if ! claim_request "$cycle_dir" || [ ! -s "$pid_file" ] ||
      ! run_attestor "$cycle_dir" "$(cat "$pid_file")"; then
      mark_quarantine "pending lifecycle request could not be resumed safely" "$cycle_id"
      return 76
    fi
    return
  fi
  if [ ! -s "$pid_file" ] || ! owned_cilicon_process "$(cat "$pid_file")" "$config"; then
    mark_quarantine "incomplete cycle has no live Cilicon process or lifecycle request" "$cycle_id"
    return 76
  fi
  local pid
  pid="$(cat "$pid_file")"
  local probe="$cycle_dir/exchange/runtime-probe.json"
  local observation="$cycle_dir/exchange/runtime-observation.json"
  if [ ! -s "$observation" ]; then
    if ! wait_for_file_or_exit "$probe" "$pid" "$config" "$RUNTIME_PROBE_TIMEOUT_SECONDS" ||
      ! vm_generation_is_unique "$cycle_dir" ||
      ! "$NODE_BINARY" "$HOST_TOOL" sign-runtime \
      --contract "$CONTRACT" \
      --state "$cycle_dir/host-state.json" \
      --probe "$probe" \
      --signing-key "$ATTESTOR_SIGNING_KEY" \
      --output "$observation"; then
      contain_cycle_process "$pid" "$config"
      mark_quarantine "runtime probe recovery failed or was stale" "$cycle_id"
      return 76
    fi
  fi
  local wait_status=0
  wait_for_request_with_runtime_refresh "$cycle_dir" "$pid" "$config" || wait_status=$?
  if [ "$wait_status" -eq 81 ]; then
    return
  fi
  if [ "$wait_status" -ne 0 ] ||
    ! claim_request "$cycle_dir" ||
    ! run_attestor "$cycle_dir" "$pid"; then
    contain_cycle_process "$pid" "$config"
    mark_quarantine "lifecycle request recovery or runtime refresh failed" "$cycle_id"
    return 76
  fi
}

new_cycle() {
  local timestamp random cycle_id cycle_dir clone_path runner_name config state pid
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  random="$(/usr/bin/uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | cut -c1-12)"
  cycle_id="cycle-${timestamp}-${random}"
  cycle_dir="$CYCLES_ROOT/$cycle_id"
  clone_path="$CLONES_ROOT/$cycle_id"
  runner_name="${HOST_ID}-${cycle_id}"
  config="$cycle_dir/cilicon.yml"
  state="$cycle_dir/host-state.json"
  mkdir "$cycle_dir"
  mkdir "$cycle_dir/exchange"

  "$NODE_BINARY" "$HOST_TOOL" prepare-cycle \
    --contract "$CONTRACT" \
    --state "$state" \
    --config "$config" \
    --cycle-dir "$cycle_dir" \
    --host-id "$HOST_ID" \
    --cycle-id "$cycle_id" \
    --clone-path "$clone_path" \
    --runner-name "$runner_name" \
    --runner-app-id "$RUNNER_APP_ID" \
    --runner-private-key-path "$RUNNER_PRIVATE_KEY" \
    --ssh-username "$SSH_USERNAME" \
    --ssh-password "$SSH_PASSWORD"

  "$CILICON_BINARY" -config-path "$config" >"$cycle_dir/cilicon.log" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" > "$cycle_dir/cilicon.pid"
  log "started one Cilicon cycle $cycle_id as pid $pid"

  if ! wait_for_file_or_exit "$cycle_dir/exchange/runtime-probe.json" "$pid" "$config" \
    "$RUNTIME_PROBE_TIMEOUT_SECONDS"; then
    mark_quarantine "Cilicon exited or runtime probe timed out before qualification" "$cycle_id"
    contain_cycle_process "$pid" "$config"
    return 76
  fi
  if ! vm_generation_is_unique "$cycle_dir" ||
    ! "$NODE_BINARY" "$HOST_TOOL" sign-runtime \
    --contract "$CONTRACT" \
    --state "$state" \
    --probe "$cycle_dir/exchange/runtime-probe.json" \
    --signing-key "$ATTESTOR_SIGNING_KEY" \
    --output "$cycle_dir/exchange/runtime-observation.json"; then
    contain_cycle_process "$pid" "$config"
    mark_quarantine "runtime probe could not be signed or validated" "$cycle_id"
    return 76
  fi

  local wait_status=0
  wait_for_request_with_runtime_refresh "$cycle_dir" "$pid" "$config" || wait_status=$?
  if [ "$wait_status" -eq 81 ]; then
    return
  fi
  if [ "$wait_status" -ne 0 ]; then
    mark_quarantine "Cilicon exited or runtime refresh failed before lifecycle request" "$cycle_id"
    contain_cycle_process "$pid" "$config"
    return 76
  fi
  if ! claim_request "$cycle_dir" || ! run_attestor "$cycle_dir" "$pid"; then
    contain_cycle_process "$pid" "$config"
    mark_quarantine "lifecycle attestation failed after request claim" "$cycle_id"
    return 76
  fi
}

self_test() {
  "$NODE_BINARY" "$HOST_TOOL" self-test
  local temp_root first_status=0
  temp_root="$(mktemp -d)"
  # Capture the local before RETURN leaves scope.
  # shellcheck disable=SC2064
  trap "rm -rf '$temp_root'" RETURN
  NIXMAC_E2E_LOCK_DIR="$temp_root/lock"
  LOCK_DIR="$NIXMAC_E2E_LOCK_DIR"
  acquire_lock
  acquire_lock >/dev/null 2>&1 || first_status=$?
  test "$first_status" -eq 75
  release_lock
  mkdir "$temp_root/stale-lock"
  printf '%s\n' "99999999" > "$temp_root/stale-lock/pid"
  LOCK_DIR="$temp_root/stale-lock"
  acquire_lock
  test "$(cat "$LOCK_DIR/pid")" = "$$"
  release_lock
  mkdir -p "$temp_root/cycles/a" "$temp_root/cycles/b"
  CYCLES_ROOT="$temp_root/cycles"
  test "$(active_cycle_dirs | wc -l | tr -d ' ')" -eq 2
  local foreign_pid foreign_config
  foreign_config="$temp_root/foreign.yml"
  printf '%s\n' "not a Cilicon config" > "$foreign_config"
  /bin/sleep 30 &
  foreign_pid=$!
  if owned_cilicon_process "$foreign_pid" "$foreign_config"; then
    echo "foreign process was incorrectly accepted as owned Cilicon" >&2
    return 1
  fi
  contain_cycle_process "$foreign_pid" "$foreign_config"
  kill -0 "$foreign_pid"
  kill "$foreign_pid"
  wait "$foreign_pid" 2>/dev/null || true
  echo "Cilicon cycle wrapper self-test passed."
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return
  fi
  for file in \
    "$HOST_TOOL" \
    "$ATTESTOR" \
    "$CILICON_BINARY" \
    "$CONTRACT" \
    "$ATTESTOR_SIGNING_KEY" \
    "$RUNNER_PRIVATE_KEY" \
    "$INVENTORY_PRIVATE_KEY" \
    "$SINK_PRIVATE_KEY"; do
    test -f "$file" && test ! -L "$file"
  done
  test -x "$GRACEFUL_QUIT_HELPER" && test ! -L "$GRACEFUL_QUIT_HELPER"
  if [ -n "$QUARANTINE_HELPER" ]; then
    test -x "$QUARANTINE_HELPER" && test ! -L "$QUARANTINE_HELPER"
  fi
  [[ "$RUNNER_APP_ID" =~ ^[1-9][0-9]*$ ]]
  test -x "$NODE_BINARY"
  if [ -z "$HOST_ID" ]; then
    HOST_ID="$(/usr/sbin/scutil --get LocalHostName | tr '[:upper:]' '[:lower:]')"
  fi
  [[ "$HOST_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]
  if [ -e "$QUARANTINE_SENTINEL" ]; then
    echo "host is quarantined: $QUARANTINE_SENTINEL" >&2
    return 77
  fi
  mkdir -p "$CYCLES_ROOT" "$HISTORY_ROOT" "$CLONES_ROOT" "$(dirname "$LOCK_DIR")"
  acquire_lock
  trap release_lock EXIT INT TERM
  load_active_cycles
  if [ "${#active[@]}" -gt 1 ]; then
    mark_quarantine "ambiguous recovery: multiple active cycle directories" "ambiguous"
    return 78
  fi
  if [ "${#active[@]}" -eq 0 ] &&
    { [ -e "$DRAIN_SENTINEL" ] || [ -e "$PENDING_DRAIN_CLEANUP" ]; }; then
    log "host drain or runner cleanup is active; no new Cilicon cycle will start"
    return
  fi
  if [ "${#active[@]}" -eq 1 ]; then
    resume_cycle "${active[0]}"
  else
    if ! "$NODE_BINARY" "$HOST_TOOL" check-image-admission --contract "$CONTRACT"; then
      log "qualified image is not currently admissible; leaving host healthy and retrying later"
      return 75
    fi
    new_cycle
  fi
  local completed="${active[0]:-}"
  if [ -z "$completed" ]; then
    load_active_cycles
    test "${#active[@]}" -eq 1
    completed="${active[0]}"
  fi
  if [ ! -e "$QUARANTINE_SENTINEL" ]; then
    mv "$completed" "$HISTORY_ROOT/$(basename "$completed")"
    prune_history
  fi
}

main "$@"
