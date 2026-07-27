#!/bin/bash
set -euo pipefail

E2E_USER="nixmac_e2e"
E2E_HOME="/Users/$E2E_USER"
APP="/Applications/CuaDriver.app"
EXECUTABLE="$APP/Contents/MacOS/cua-driver"
CLI="/usr/local/bin/cua-driver"
BUNDLE_ID="com.trycua.driver"
TEAM_ID="YCK386LBJ7"
EXECUTABLE_SHA256="eae725a09e0cdbda4bb37058a0393b86f7c97b5dda3769a10b1d79269ba8b334"
APP_TREE_SHA256="9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0"
ARCHIVE_SHA256="c64017d5878d022df34137082fb918ae0d4304e28890569ff14458f1a54fd361"
VERSION="0.12.6"
SIGNING_IDENTITY="Developer ID Application: Cua AI, Inc. (YCK386LBJ7)"
SOCKET="/private/tmp/nixmac-e2e-qualification.sock"
PROBE_OUTPUT=""
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ "${1:-}" = "--emit-probe" ]; then
  test "$#" -eq 2
  PROBE_OUTPUT="$2"
  case "$PROBE_OUTPUT" in
    "/Volumes/My Shared Files/nixmac-e2e/"*) ;;
    *) echo "runtime probe must use the host-owned nixmac-e2e mount" >&2; exit 64 ;;
  esac
elif [ "$#" -ne 0 ]; then
  echo "usage: qualify-nixmac-e2e-runner [--emit-probe /Volumes/My Shared Files/nixmac-e2e/runtime-probe.json]" >&2
  exit 64
fi

test "$(id -un)" = "$E2E_USER"
test "$HOME" = "$E2E_HOME"
test -x "$EXECUTABLE"
test -L "$CLI"
test "$(/usr/bin/stat -f '%Y' "$CLI")" = "$EXECUTABLE"
test "$(/usr/bin/shasum -a 256 "$EXECUTABLE" | /usr/bin/awk '{print $1}')" = "$EXECUTABLE_SHA256"
actual_tree_sha="$(
  /usr/bin/python3 - "$APP" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    relative = path.relative_to(root).as_posix().encode()
    body = path.read_bytes()
    digest.update(relative)
    digest.update(b"\0")
    digest.update(str(len(body)).encode())
    digest.update(b"\0")
    digest.update(body)
    digest.update(b"\0")
print(digest.hexdigest())
PY
)"
test "$actual_tree_sha" = "$APP_TREE_SHA256"
/usr/bin/codesign --verify --deep --strict "$APP"
details="$(/usr/bin/codesign -dvv "$APP" 2>&1)"
/usr/bin/grep -Fq "Identifier=$BUNDLE_ID" <<<"$details"
/usr/bin/grep -Fq "TeamIdentifier=$TEAM_ID" <<<"$details"
authority="$(/usr/bin/codesign -dvvv "$APP" 2>&1 | /usr/bin/sed -n 's/^Authority=//p' | /usr/bin/head -1)"
test "$authority" = "$SIGNING_IDENTITY"

for tool in git jq ffmpeg node python3 xcrun xcodebuild; do
  command -v "$tool" >/dev/null
done
test -d /var/db/nixmac-e2e/evidence
test "$(stat -f '%Su:%Sg:%Lp' /var/db/nixmac-e2e/evidence)" = "$E2E_USER:staff:700"

tcc_db="/Library/Application Support/com.apple.TCC/TCC.db"
test -f "$tcc_db" && test ! -L "$tcc_db"
for service in kTCCServiceAccessibility kTCCServiceScreenCapture; do
  grant_count="$(
    /usr/bin/sqlite3 "$tcc_db" \
      "SELECT count(*) FROM access WHERE service='$service' AND client='$BUNDLE_ID' AND client_type=0 AND auth_value=2;"
  )"
  test "$grant_count" = "1"
done

uid="$(id -u)"
if ! /bin/launchctl print "gui/$uid" >/dev/null 2>&1; then
  echo "no Aqua login session for $E2E_USER" >&2
  exit 1
fi

rm -f "$SOCKET"
previous_pids="$(/usr/bin/pgrep -f "$EXECUTABLE.*serve" || true)"
/bin/launchctl asuser "$uid" /usr/bin/open -n -g "$APP" --args serve --socket "$SOCKET"
daemon_pid=""
for _ in $(seq 1 30); do
  for candidate in $(/usr/bin/pgrep -f "$EXECUTABLE.*serve" || true); do
    if ! /usr/bin/grep -qx "$candidate" <<<"$previous_pids"; then
      daemon_pid="$candidate"
      break
    fi
  done
  if [ -n "$daemon_pid" ] && "$CLI" status --socket "$SOCKET" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if [ -z "$daemon_pid" ]; then
  echo "CuaDriver app-owned daemon did not start" >&2
  exit 1
fi

cleanup() {
  "$CLI" stop --socket "$SOCKET" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$daemon_pid" 2>/dev/null; then
      rm -f "$SOCKET"
      return
    fi
    sleep 1
  done
  kill "$daemon_pid" 2>/dev/null || true
  rm -f "$SOCKET"
}
trap cleanup EXIT

permissions="$("$CLI" call check_permissions '{"prompt":false}' --socket "$SOCKET")"
/usr/bin/python3 - \
  "$permissions" \
  "$BUNDLE_ID" \
  "$EXECUTABLE" \
  "$PROBE_OUTPUT" \
  "$ARCHIVE_SHA256" \
  "$EXECUTABLE_SHA256" \
  "$APP_TREE_SHA256" \
  "$VERSION" \
  "$SIGNING_IDENTITY" \
  "$TEAM_ID" \
  "$APP" \
  "$CLI" <<'PY'
import json
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timezone

payload = json.loads(sys.argv[1])
if "result" in payload and isinstance(payload["result"], dict):
    payload = payload["result"]
if payload.get("accessibility") is not True or payload.get("screen_recording") is not True:
    raise SystemExit("CuaDriver TCC smoke failed")
source = payload.get("source") or {}
if source.get("attribution") != "driver-daemon":
    raise SystemExit("permissions were not attributed to the app-owned daemon")
if source.get("bundle_id") != sys.argv[2]:
    raise SystemExit("permission bundle identity mismatch")
if os.path.realpath(source.get("executable", "")) != os.path.realpath(sys.argv[3]):
    raise SystemExit("permission executable identity mismatch")
if sys.argv[4]:
    probe = {
        "version": 1,
        "observedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        ),
        "cuaDriver": {
            "artifactDigest": "sha256:" + sys.argv[5],
            "executableDigest": "sha256:" + sys.argv[6],
            "appBundleDigest": "sha256:" + sys.argv[7],
            "cliVersion": sys.argv[8],
            "appVersion": sys.argv[8],
            "bundleId": sys.argv[2],
            "signingIdentity": sys.argv[9],
            "teamId": sys.argv[10],
            "appPath": sys.argv[11],
            "appExecutable": sys.argv[3],
            "cliSymlink": sys.argv[12],
        },
        "tcc": {
            "target": {
                "kind": "app-bundle",
                "appPath": sys.argv[11],
                "bundleId": sys.argv[2],
                "signingIdentity": sys.argv[9],
                "teamId": sys.argv[10],
            },
            "services": ["accessibility", "screenRecording"],
            "aquaSession": True,
            "accessibilityGranted": True,
            "screenRecordingGranted": True,
            "smokePassed": True,
        },
    }
    target = pathlib.Path(sys.argv[4])
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise SystemExit("host exchange mount is absent or unsafe")
    fd, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(probe, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
PY

echo "nixmac E2E image qualification passed"
