#!/usr/bin/env bash
set -euo pipefail

# Notarize the DMG via Apple notarytool and staple the ticket.
#
# Required env vars (typically from sops):
#   APPLE_API_KEY_CONTENT  - Contents of the App Store Connect API key (.p8)
#   APPLE_API_KEY_ID       - Key ID
#   APPLE_API_ISSUER       - Issuer ID
#   RUNNER_TEMP            - GitHub Actions temp directory

echo "$APPLE_API_KEY_CONTENT" >"$RUNNER_TEMP/AuthKey.p8"

DMG_PATH=$(find target/release/bundle/dmg -name "*.dmg" -type f | head -1)

if [ -n "$DMG_PATH" ]; then
	echo "Notarizing $DMG_PATH..."
	xcrun notarytool submit "$DMG_PATH" \
		--key "$RUNNER_TEMP/AuthKey.p8" \
		--key-id "$APPLE_API_KEY_ID" \
		--issuer "$APPLE_API_ISSUER" \
		--wait

	xcrun stapler staple "$DMG_PATH"
fi

rm -f "$RUNNER_TEMP/AuthKey.p8"
