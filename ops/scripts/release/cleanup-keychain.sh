#!/usr/bin/env bash
set -euo pipefail

# Delete the temporary signing keychain created by import-certificate.sh and
# restore the user keychain search list saved at import time.
#
# Optional env vars:
#   RUNNER_TEMP  - GitHub Actions temp directory

KEYCHAIN_PATH="${RUNNER_TEMP:-/tmp}/app-signing.keychain-db"
KEYCHAINS_BEFORE_PATH="${RUNNER_TEMP:-/tmp}/app-signing-keychains-before.txt"

if [ -f "$KEYCHAIN_PATH" ]; then
	security delete-keychain "$KEYCHAIN_PATH" || true
fi

if [ -f "$KEYCHAINS_BEFORE_PATH" ]; then
	# shellcheck disable=SC2046
	security list-keychains -d user -s $(tr '\n' ' ' <"$KEYCHAINS_BEFORE_PATH") || true
	rm -f "$KEYCHAINS_BEFORE_PATH"
fi

rm -f "${RUNNER_TEMP:-/tmp}/certificate.p12"
rm -rf "${RUNNER_TEMP:-/tmp}/apple-intermediates"
