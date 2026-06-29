#!/usr/bin/env bash
set -euo pipefail

# Sign the .app bundle with hardened runtime for notarization.
#
# Required env vars:
#   RUNNER_TEMP  - GitHub Actions temp directory (contains keychain)

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

MACOS_DIR="$APP_PATH/Contents/MacOS"
for helper in nixmac-helper nixmac-sync-agent; do
	helper_path="$MACOS_DIR/$helper"
	if [ -f "$helper_path" ]; then
		echo "Signing nested helper: $helper_path"
		codesign --force --options runtime \
			--sign "$IDENTITY" \
			"$helper_path"
	fi
done

codesign --force --deep --options runtime \
	--entitlements apps/native/src-tauri/entitlements.plist \
	--sign "$IDENTITY" \
	"$APP_PATH"

echo "Verifying signature..."
codesign --verify --deep --strict --verbose=4 "$APP_PATH"
