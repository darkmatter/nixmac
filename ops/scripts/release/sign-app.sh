#!/usr/bin/env bash
set -euo pipefail

# Sign the .app bundle with hardened runtime for notarization.
#
# Required env vars:
#   RUNNER_TEMP  - GitHub Actions temp directory (contains keychain)

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/scripts/release/codesign-app-lib.sh disable=SC1091
. "$SCRIPT_DIR/codesign-app-lib.sh"

APP_PATH=$(find target/release/bundle/macos -name "*.app" -type d | head -1)
if [ -z "$APP_PATH" ]; then
	echo "ERROR: No .app found to sign"
	exit 1
fi

echo "Signing $APP_PATH..."

KEYCHAIN_PATH="${RUNNER_TEMP}/app-signing.keychain-db"
IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')

if [ -z "$IDENTITY" ]; then
	echo "ERROR: No Developer ID Application identity found in keychain"
	security find-identity -v -p codesigning "$KEYCHAIN_PATH"
	exit 1
fi

echo "Using identity: $IDENTITY"

nixmac_sign_app_inside_out "$APP_PATH" "$IDENTITY"

echo "Verifying signature..."
codesign --verify --deep --strict --verbose=4 "$APP_PATH"
