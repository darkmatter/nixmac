#!/usr/bin/env bash
set -euo pipefail

# Delete the temporary signing keychain created by import-certificate.sh.
#
# Optional env vars:
#   RUNNER_TEMP  - GitHub Actions temp directory

KEYCHAIN_PATH="${RUNNER_TEMP:-/tmp}/app-signing.keychain-db"
if [ -f "$KEYCHAIN_PATH" ]; then
	security delete-keychain "$KEYCHAIN_PATH" || true
fi
