#!/bin/bash
set -euo pipefail
umask 077

MOUNT_PATH="${1:-}"
case "$MOUNT_PATH" in
  "/Volumes/My Shared Files/nixmac-e2e") ;;
  *) echo "usage: refresh-nixmac-e2e-runner '/Volumes/My Shared Files/nixmac-e2e'" >&2; exit 64 ;;
esac

QUALIFIER="/usr/local/libexec/qualify-nixmac-e2e-runner"
PROBE="$MOUNT_PATH/runtime-probe.json"
REFRESH_PROBE="$MOUNT_PATH/runtime-probe.refresh.json"
OBSERVATION="$MOUNT_PATH/runtime-observation.json"
INSTALLED_OBSERVATION="/var/db/nixmac-e2e/runtime-observation.json"
FAILURE="/var/db/nixmac-e2e/runtime-refresh-failed"
FINISHED="$MOUNT_PATH/runner-finished.json"
BUSY="$MOUNT_PATH/runner-busy.json"

mark_failure() {
  /usr/bin/printf '%s\n' "$1" > "$FAILURE"
  exit 1
}

last_refresh_epoch="$(/bin/date +%s)"
while /bin/sleep 5; do
  if [ -s "$FINISHED" ]; then
    /bin/rm -f "$BUSY"
    exit 0
  fi
  if /usr/bin/pgrep -f '/actions-runner/bin/Runner.Worker' >/dev/null 2>&1; then
    busy_timestamp="$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    /usr/bin/printf '{"version":1,"observedAt":"%s"}\n' "$busy_timestamp" > "$BUSY.tmp"
    /bin/chmod 0600 "$BUSY.tmp"
    /bin/mv "$BUSY.tmp" "$BUSY"
    continue
  fi
  /bin/rm -f "$BUSY" "$BUSY.tmp"
  current_epoch="$(/bin/date +%s)"
  if [ $((current_epoch - last_refresh_epoch)) -lt 900 ]; then
    continue
  fi
  /bin/rm -f "$REFRESH_PROBE"
  if ! "$QUALIFIER" --emit-probe "$REFRESH_PROBE"; then
    mark_failure "live runtime qualification refresh failed"
  fi
  expected="$(
    /opt/homebrew/bin/jq -er '.observedAt' "$REFRESH_PROBE"
  )" || mark_failure "refreshed runtime probe is invalid"
  /bin/mv "$REFRESH_PROBE" "$PROBE"

  matched=false
  for _ in $(/usr/bin/seq 1 120); do
    if [ -s "$OBSERVATION" ] &&
      /opt/homebrew/bin/jq -e --arg expected "$expected" \
        '.observedAt == $expected' "$OBSERVATION" >/dev/null 2>&1; then
      /usr/bin/install -m 0600 "$OBSERVATION" "$INSTALLED_OBSERVATION"
      matched=true
      break
    fi
    /bin/sleep 1
  done
  if [ "$matched" != "true" ]; then
    mark_failure "host did not sign the refreshed runtime probe"
  fi
  last_refresh_epoch="$current_epoch"
done
