#!/usr/bin/env bash
set -euo pipefail

CUA_APP=/Applications/CuaDriver.app
CUA_CLI="$CUA_APP/Contents/MacOS/cua-driver"
CUA_VERSION=0.22.0
CUA_BUNDLE_ID=com.trycua.driver
CUA_CACHE_DIR="$HOME/Library/Caches/cua-driver"
CUA_DEFAULT_SOCKET="$CUA_CACHE_DIR/cua-driver.sock"
CUA_PID_FILE="$CUA_CACHE_DIR/cua-driver.pid"
CUA_RECOVERY_DIR="$HOME/.nixmac-e2e"
CUA_RECOVERY_MARKER="$CUA_RECOVERY_DIR/cua-default-recovery.json"
CUA_DEFAULT_COMMAND="$CUA_CLI serve --no-permissions-gate --no-overlay"

count_nonempty_lines() {
  /usr/bin/awk 'NF { count++ } END { print count + 0 }'
}

verify_app() {
  test -x "$CUA_CLI"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$CUA_APP" >/dev/null
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CUA_APP/Contents/Info.plist")" == "$CUA_BUNDLE_ID" ]]
  [[ "$($CUA_CLI --version)" == "cua-driver $CUA_VERSION" ]]
}

socket_owner_pid() {
  local socket_path="$1"
  local owner_pids owner_count
  [[ -S "$socket_path" && ! -L "$socket_path" ]] || return 1
  owner_pids="$(/usr/sbin/lsof -nP -t -a -U "$socket_path" || true)"
  owner_count="$(printf '%s\n' "$owner_pids" | count_nonempty_lines)"
  [[ "$owner_count" -eq 1 ]] || return 1
  printf '%s\n' "$owner_pids" | /usr/bin/awk 'NF { print; exit }'
}

pid_file_pid() {
  local pid
  test -f "$CUA_PID_FILE" || return 1
  pid="$(/usr/bin/tr -d '[:space:]' < "$CUA_PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$pid"
}

probe_default_daemon() {
  local daemon_pids daemon_count daemon_pid file_pid owner_pid daemon_command
  daemon_pids="$(/usr/bin/pgrep -x cua-driver || true)"
  daemon_count="$(printf '%s\n' "$daemon_pids" | count_nonempty_lines)"
  [[ "$daemon_count" -eq 1 ]] || return 1
  daemon_pid="$(printf '%s\n' "$daemon_pids" | /usr/bin/awk 'NF { print; exit }')"
  file_pid="$(pid_file_pid)" || return 1
  [[ "$file_pid" == "$daemon_pid" ]] || return 1
  owner_pid="$(socket_owner_pid "$CUA_DEFAULT_SOCKET")" || return 1
  [[ "$owner_pid" == "$daemon_pid" ]] || return 1
  daemon_command="$(/bin/ps -p "$daemon_pid" -o command=)"
  [[ "$daemon_command" == "$CUA_DEFAULT_COMMAND" ]] || return 1
  "$CUA_CLI" status >/dev/null || return 1
  printf '%s\n' "$daemon_pid"
}

write_recovery_marker() {
  local run_id="$1"
  local daemon_pid="$2"
  local run_socket="/tmp/nixmac-cua-${run_id}.sock"
  /usr/bin/python3 - \
    "$CUA_RECOVERY_MARKER" "$run_id" "$CUA_BUNDLE_ID" "$CUA_VERSION" \
    "$CUA_APP" "$CUA_CLI" "$CUA_DEFAULT_SOCKET" "$run_socket" "$CUA_PID_FILE" \
    "$daemon_pid" "$CUA_DEFAULT_COMMAND" <<'PY'
import json
import os
import stat
import sys

(
    marker_path,
    run_id,
    bundle_id,
    version,
    app_path,
    cli_path,
    default_socket,
    run_socket,
    pid_file,
    daemon_pid,
    daemon_command,
) = sys.argv[1:]
parent = os.path.dirname(marker_path)
os.makedirs(parent, mode=0o700, exist_ok=True)
parent_stat = os.lstat(parent)
if stat.S_ISLNK(parent_stat.st_mode) or parent_stat.st_uid != os.getuid():
    raise SystemExit("unsafe CuaDriver recovery directory")
if os.path.lexists(marker_path):
    raise SystemExit("CuaDriver recovery marker already exists")
payload = {
    "schemaVersion": 1,
    "owner": "nixmac-computer-use-e2e",
    "runId": run_id,
    "bundleId": bundle_id,
    "version": version,
    "appPath": app_path,
    "cliPath": cli_path,
    "defaultSocket": default_socket,
    "runSocket": run_socket,
    "pidFile": pid_file,
    "defaultDaemonPid": int(daemon_pid),
    "defaultDaemonCommand": daemon_command,
    "armedBeforeStop": True,
}
pending = f"{marker_path}.pending-{os.getpid()}"
try:
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(pending, marker_path)
    directory_fd = os.open(parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
finally:
    if os.path.lexists(pending):
        os.unlink(pending)
PY
}

read_recovery_marker() {
  [[ -f "$CUA_RECOVERY_MARKER" && ! -L "$CUA_RECOVERY_MARKER" ]]
  [[ "$(/usr/bin/stat -f '%Su' "$CUA_RECOVERY_MARKER")" == "$(/usr/bin/id -un)" ]]
  [[ "$(/usr/bin/stat -f '%Lp' "$CUA_RECOVERY_MARKER")" == "600" ]]
  /usr/bin/python3 - \
    "$CUA_RECOVERY_MARKER" "$CUA_BUNDLE_ID" "$CUA_VERSION" "$CUA_APP" "$CUA_CLI" \
    "$CUA_DEFAULT_SOCKET" "$CUA_PID_FILE" "$CUA_DEFAULT_COMMAND" <<'PY'
import json
import re
import sys

(
    marker_path,
    bundle_id,
    version,
    app_path,
    cli_path,
    default_socket,
    pid_file,
    daemon_command,
) = sys.argv[1:]
with open(marker_path, encoding="utf-8") as handle:
    marker = json.load(handle)
expected_keys = {
    "schemaVersion", "owner", "runId", "bundleId", "version", "appPath", "cliPath",
    "defaultSocket", "runSocket", "pidFile", "defaultDaemonPid",
    "defaultDaemonCommand", "armedBeforeStop",
}
run_id = marker.get("runId")
if set(marker) != expected_keys or not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", run_id):
    raise SystemExit("invalid CuaDriver recovery marker shape")
if (
    marker["schemaVersion"] != 1
    or marker["owner"] != "nixmac-computer-use-e2e"
    or marker["bundleId"] != bundle_id
    or marker["version"] != version
    or marker["appPath"] != app_path
    or marker["cliPath"] != cli_path
    or marker["defaultSocket"] != default_socket
    or marker["runSocket"] != f"/tmp/nixmac-cua-{run_id}.sock"
    or marker["pidFile"] != pid_file
    or not isinstance(marker["defaultDaemonPid"], int)
    or marker["defaultDaemonPid"] <= 0
    or marker["defaultDaemonCommand"] != daemon_command
    or marker["armedBeforeStop"] is not True
):
    raise SystemExit("invalid CuaDriver recovery marker identity")
print(marker["runSocket"])
print(marker["defaultDaemonPid"])
print(run_id)
PY
}

remove_recovery_marker() {
  /usr/bin/python3 - "$CUA_RECOVERY_MARKER" <<'PY'
import os
import sys

marker_path = sys.argv[1]
os.unlink(marker_path)
directory_fd = os.open(os.path.dirname(marker_path), os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
  [[ ! -e "$CUA_RECOVERY_MARKER" && ! -L "$CUA_RECOVERY_MARKER" ]]
}

stop_run_daemon() {
  local run_socket="$1"
  local owner_pid file_pid owner_command
  if [[ ! -e "$run_socket" && ! -L "$run_socket" ]]; then
    return 0
  fi
  owner_pid="$(socket_owner_pid "$run_socket")"
  file_pid="$(pid_file_pid)"
  [[ "$file_pid" == "$owner_pid" ]]
  owner_command="$(/bin/ps -p "$owner_pid" -o command=)"
  [[ "$owner_command" == "$CUA_CLI serve --socket $run_socket --no-permissions-gate --no-overlay" ]]
  "$CUA_CLI" stop --socket "$run_socket"
  for _ in $(seq 1 40); do
    if ! /bin/kill -0 "$owner_pid" 2>/dev/null && \
      [[ ! -e "$run_socket" && ! -L "$run_socket" && ! -e "$CUA_PID_FILE" ]]; then
      return 0
    fi
    sleep 0.25
  done
  echo "error: marked run-owned CuaDriver daemon did not stop" >&2
  return 1
}

arm_and_stop_default() {
  local run_id="${CUA_RUN_ID_SAFE:-}"
  local run_socket daemon_pid
  [[ "$run_id" =~ ^[A-Za-z0-9._-]+$ ]]
  run_socket="/tmp/nixmac-cua-${run_id}.sock"
  [[ ! -e "$CUA_RECOVERY_MARKER" && ! -L "$CUA_RECOVERY_MARKER" ]]
  [[ ! -e "$run_socket" && ! -L "$run_socket" ]]
  verify_app
  daemon_pid="$(probe_default_daemon)"
  write_recovery_marker "$run_id" "$daemon_pid"
  read_recovery_marker >/dev/null
  "$CUA_CLI" stop >/dev/null
  for _ in $(seq 1 40); do
    if ! /bin/kill -0 "$daemon_pid" 2>/dev/null && \
      [[ ! -e "$CUA_DEFAULT_SOCKET" && ! -L "$CUA_DEFAULT_SOCKET" && ! -e "$CUA_PID_FILE" ]]; then
      printf '{"action":"armed-and-stopped","defaultDaemonPid":%s,"marker":"%s","runSocket":"%s"}\n' \
        "$daemon_pid" "$CUA_RECOVERY_MARKER" "$run_socket"
      return 0
    fi
    sleep 0.25
  done
  echo "error: verified default CuaDriver daemon did not stop; recovery marker remains armed" >&2
  return 1
}

reconcile_recovery() {
  local marker_values run_socket marked_pid marked_run_id daemon_pids daemon_count restored_pid
  if [[ ! -e "$CUA_RECOVERY_MARKER" && ! -L "$CUA_RECOVERY_MARKER" ]]; then
    printf '{"action":"none","marker":"%s"}\n' "$CUA_RECOVERY_MARKER"
    return 0
  fi
  verify_app
  marker_values="$(read_recovery_marker)"
  run_socket="$(printf '%s\n' "$marker_values" | /usr/bin/sed -n '1p')"
  marked_pid="$(printf '%s\n' "$marker_values" | /usr/bin/sed -n '2p')"
  marked_run_id="$(printf '%s\n' "$marker_values" | /usr/bin/sed -n '3p')"
  [[ "$marked_pid" =~ ^[0-9]+$ && -n "$marked_run_id" ]]
  stop_run_daemon "$run_socket"

  daemon_pids="$(/usr/bin/pgrep -x cua-driver || true)"
  daemon_count="$(printf '%s\n' "$daemon_pids" | count_nonempty_lines)"
  if [[ "$daemon_count" -eq 1 ]]; then
    restored_pid="$(probe_default_daemon)"
    remove_recovery_marker
    printf '{"action":"accepted-existing-default","defaultDaemonPid":%s,"recoveredRunId":"%s"}\n' \
      "$restored_pid" "$marked_run_id"
    return 0
  fi
  [[ "$daemon_count" -eq 0 && ! -e "$CUA_PID_FILE" ]]
  [[ ! -e "$run_socket" && ! -L "$run_socket" ]]
  [[ ! -e "$CUA_DEFAULT_SOCKET" && ! -L "$CUA_DEFAULT_SOCKET" ]]
  /usr/bin/open -n -g "$CUA_APP" --args serve --no-permissions-gate --no-overlay
  for _ in $(seq 1 40); do
    if restored_pid="$(probe_default_daemon 2>/dev/null)"; then
      remove_recovery_marker
      printf '{"action":"restored-default","defaultDaemonPid":%s,"recoveredRunId":"%s"}\n' \
        "$restored_pid" "$marked_run_id"
      return 0
    fi
    sleep 0.25
  done
  echo "error: CuaDriver default daemon was not recovered; marker remains armed" >&2
  return 1
}

case "${CUA_RECOVERY_ACTION:-}" in
  arm-stop)
    arm_and_stop_default
    ;;
  reconcile)
    reconcile_recovery
    ;;
  *)
    echo "error: CUA_RECOVERY_ACTION must be arm-stop or reconcile" >&2
    exit 2
    ;;
esac
