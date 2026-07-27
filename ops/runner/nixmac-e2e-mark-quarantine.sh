#!/bin/bash
set -euo pipefail
umask 077

if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 0 ]; then
  echo "quarantine marker must run as root with JSON on stdin" >&2
  exit 64
fi

SENTINEL="/var/db/nixmac-e2e-quarantined"
temporary="$(mktemp /var/db/.nixmac-e2e-quarantined.XXXXXX)"
raw="$(mktemp /var/db/.nixmac-e2e-quarantine-input.XXXXXX)"
cleanup() {
  rm -f "$temporary" "$raw"
}
trap cleanup EXIT

/usr/bin/head -c 65537 > "$raw"
if [ "$(wc -c < "$raw" | tr -d ' ')" -gt 65536 ]; then
  echo "quarantine payload exceeds 64 KiB" >&2
  exit 65
fi

/usr/bin/python3 - "$raw" "$temporary" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "rb") as source:
    value = json.load(source)
if not isinstance(value, dict) or value.get("version") != 1:
    raise SystemExit("quarantine payload is invalid")
reason = value.get("reason")
if not isinstance(reason, str) or not reason.strip() or "\0" in reason:
    raise SystemExit("quarantine reason is invalid")
with open(sys.argv[2], "w") as stream:
    json.dump(value, stream, indent=2, sort_keys=True)
    stream.write("\n")
os.chmod(sys.argv[2], 0o600)
PY

chown root:wheel "$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$SENTINEL"
rm -f "$raw"
trap - EXIT
