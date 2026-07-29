#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
	echo "Usage: $0 <output.json> <nixmac.app path> <report-tool SHA>" >&2
	exit 2
fi

output_path="$1"
app_path="$2"
report_tool_sha="$3"

[[ "$output_path" == /* ]] || {
	echo "Runtime attestation output path must be absolute" >&2
	exit 2
}
[[ "$app_path" == /* && -d "$app_path" ]] || {
	echo "nixmac app path must be an existing absolute directory" >&2
	exit 2
}
[[ "$report_tool_sha" =~ ^[a-f0-9]{40}$ ]] || {
	echo "report-tool SHA must be a full lowercase git SHA" >&2
	exit 2
}

/usr/bin/python3 - "$output_path" "$app_path" "$report_tool_sha" <<'PY'
import ctypes
import datetime
import hashlib
import json
import os
import plistlib
import subprocess
import sys

output_path, app_path, report_tool_sha = sys.argv[1:]
plist_path = os.path.join(app_path, "Contents", "Info.plist")
with open(plist_path, "rb") as handle:
    info = plistlib.load(handle)

bundle_id = info.get("CFBundleIdentifier")
app_version = info.get("CFBundleShortVersionString")
executable_name = info.get("CFBundleExecutable")
if bundle_id != "com.darkmatter.nixmac":
    raise SystemExit("Staged app has the wrong bundle identifier")
if not isinstance(app_version, str) or not app_version.strip():
    raise SystemExit("Staged app has no CFBundleShortVersionString")
if not isinstance(executable_name, str) or not executable_name.strip():
    raise SystemExit("Staged app has no CFBundleExecutable")

pid_result = subprocess.run(
    ["pgrep", "-x", executable_name],
    check=True,
    capture_output=True,
    text=True,
)
pids = sorted({int(line) for line in pid_result.stdout.splitlines() if line.strip()})
if len(pids) != 1:
    raise SystemExit(f"Expected exactly one running {executable_name} process, found {len(pids)}")
pid = pids[0]

libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
buffer = ctypes.create_string_buffer(4096)
length = libproc.proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
if length <= 0:
    raise SystemExit("Unable to resolve the running nixmac executable")
process_executable = buffer.value.decode("utf-8")
expected_executable = os.path.join(app_path, "Contents", "MacOS", executable_name)
if os.path.realpath(process_executable) != os.path.realpath(expected_executable):
    raise SystemExit("Running nixmac process does not use the staged app executable")

digest = hashlib.sha256()
with open(process_executable, "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)

payload = {
    "schemaVersion": "nixmac.e2e.runtime-attestation.v1",
    "capturedAt": datetime.datetime.now(datetime.timezone.utc)
    .isoformat(timespec="seconds")
    .replace("+00:00", "Z"),
    "processId": pid,
    "bundleIdentifier": bundle_id,
    "appVersion": app_version,
    "bundlePath": os.path.realpath(app_path),
    "processExecutable": os.path.realpath(process_executable),
    "executableSha256": digest.hexdigest(),
    "captureToolSha": report_tool_sha,
}

os.makedirs(os.path.dirname(output_path), exist_ok=True)
temporary_path = f"{output_path}.tmp.{os.getpid()}"
descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(temporary_path, output_path)
PY
