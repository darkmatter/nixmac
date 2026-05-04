#!/usr/bin/env bash
set -euo pipefail

# Replace the unsigned app inside a Tauri-built DMG with the signed one,
# preserving Finder layout (background, /Applications alias, icon positions).
#
# Required env vars:
#   RUNNER_TEMP  - GitHub Actions temp directory

APP_PATH=$(find target/release/bundle/macos -name "*.app" -type d | head -1)
DMG_PATH=$(find target/release/bundle/dmg -name "*.dmg" -type f | head -1)

if [ -z "$APP_PATH" ] || [ -z "$DMG_PATH" ]; then
	echo "ERROR: missing APP_PATH or DMG_PATH (APP_PATH=$APP_PATH DMG_PATH=$DMG_PATH)"
	exit 1
fi

APP_NAME=$(basename "$APP_PATH")
RW_DMG="${DMG_PATH%.dmg}.rw.dmg"
MOUNT_POINT="${RUNNER_TEMP}/dmg-mount"
mkdir -p "$MOUNT_POINT"

detach_with_retry() {
	local mount="$1"
	for i in 1 2 3 4 5; do
		if hdiutil detach "$mount"; then
			return 0
		fi
		if [ "$i" -lt 5 ]; then
			echo "detach of $mount failed, retry $i/5 in 2s..."
			sleep 2
		fi
	done
	echo "WARNING: all 5 detach attempts failed for $mount, forcing..."
	hdiutil detach "$mount" -force
}

echo "Converting DMG to read-write so we can swap in the signed app..."
hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG"

APP_SIZE_KB=$(du -sk "$APP_PATH" | awk '{print $1}')
REQUIRED_KB=$((APP_SIZE_KB + 51200))
CURRENT_KB=$(du -k "$RW_DMG" | awk '{print $1}')
if [ "$REQUIRED_KB" -gt "$CURRENT_KB" ]; then
	echo "Growing RW DMG from ${CURRENT_KB}KB to ${REQUIRED_KB}KB (app ${APP_SIZE_KB}KB + 50MB headroom)..."
	hdiutil resize -size "${REQUIRED_KB}k" "$RW_DMG"
else
	echo "RW DMG already has enough headroom (${CURRENT_KB}KB >= ${REQUIRED_KB}KB required), skipping resize."
fi

echo "Mounting RW DMG at $MOUNT_POINT..."
hdiutil attach -readwrite -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$RW_DMG"

if [ ! -d "$MOUNT_POINT/$APP_NAME" ]; then
	echo "ERROR: expected $APP_NAME inside the DMG, found:"
	ls -la "$MOUNT_POINT"
	detach_with_retry "$MOUNT_POINT" || true
	exit 1
fi

echo "Replacing $APP_NAME inside the DMG with the signed bundle..."
rsync -a --delete "$APP_PATH/" "$MOUNT_POINT/$APP_NAME/"

echo "Detaching RW DMG..."
detach_with_retry "$MOUNT_POINT"

echo "Re-compressing DMG back to UDZO at $DMG_PATH..."
rm -f "$DMG_PATH"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
rm -f "$RW_DMG"

echo "Verifying signed app inside re-packed DMG..."
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$DMG_PATH"
codesign --verify --verbose "$MOUNT_POINT/$APP_NAME"
detach_with_retry "$MOUNT_POINT"

echo "Done: $DMG_PATH now contains the signed app with the preserved Finder layout."
