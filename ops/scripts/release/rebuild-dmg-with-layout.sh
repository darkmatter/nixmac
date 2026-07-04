#!/usr/bin/env bash
set -euo pipefail

# Rebuild the final distribution DMG from the signed .app with deterministic
# Finder layout metadata. Tauri places the background image in the DMG but, on
# our CI hosts, does not reliably produce the root .DS_Store that tells Finder
# to use it. We use pinned create-dmg v1.2.3 and then mount-verify the result
# before notarization/upload.

APP_PATH=${1:-}
DMG_PATH=${2:-}

if [ -z "$APP_PATH" ] || [ -z "$DMG_PATH" ]; then
	echo "usage: $0 <path-to-signed-app> <path-to-dmg>" >&2
	exit 2
fi
if [ ! -d "$APP_PATH" ]; then
	echo "ERROR: app path does not exist: $APP_PATH" >&2
	exit 2
fi

CREATE_DMG="ops/vendor/create-dmg-v1.2.3/create-dmg"
BACKGROUND="apps/native/src-tauri/icons/dmg-background.png"
if [ ! -f "$CREATE_DMG" ]; then
	echo "ERROR: pinned create-dmg not found: $CREATE_DMG" >&2
	exit 2
fi
if [ ! -f "$BACKGROUND" ]; then
	echo "ERROR: DMG background image missing: $BACKGROUND" >&2
	exit 2
fi

TMP_DIR=$(mktemp -d)
MOUNTS_FILE="$TMP_DIR/mounts"
touch "$MOUNTS_FILE"
cleanup() {
	# Only one mount is active at a time in this script; iterate normally to stay
	# portable on macOS (which does not ship GNU tac).
	if [ -f "$MOUNTS_FILE" ]; then
		while IFS= read -r mount; do
			[ -n "$mount" ] && hdiutil detach "$mount" >/dev/null 2>&1 || true
		done <"$MOUNTS_FILE"
	fi
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SOURCE_DIR="$TMP_DIR/source"
mkdir -p "$SOURCE_DIR"
cp -R "$APP_PATH" "$SOURCE_DIR/"

FINAL_DMG="$TMP_DIR/$(basename "$DMG_PATH")"
rm -f "$DMG_PATH"

bash "$CREATE_DMG" \
	--volname "nixmac" \
	--background "$BACKGROUND" \
	--window-size 660 400 \
	--icon-size 128 \
	--icon "$(basename "$APP_PATH")" 180 170 \
	--app-drop-link 480 170 \
	--hdiutil-quiet \
	"$FINAL_DMG" \
	"$SOURCE_DIR"

MOUNT_POINT="$TMP_DIR/mnt"
mkdir -p "$MOUNT_POINT"
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$FINAL_DMG" >/dev/null
printf '%s\n' "$MOUNT_POINT" >>"$MOUNTS_FILE"

app_count=$(find "$MOUNT_POINT" -maxdepth 2 -name "*.app" -type d | wc -l | tr -d '[:space:]')
if [ "$app_count" -eq 0 ]; then
	echo "ERROR: rebuilt DMG has no .app bundle" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -f "$MOUNT_POINT/.DS_Store" ]; then
	echo "ERROR: rebuilt DMG is missing root .DS_Store (Finder layout metadata)" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -s "$MOUNT_POINT/.DS_Store" ]; then
	echo "ERROR: rebuilt DMG root .DS_Store is empty" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -f "$MOUNT_POINT/.background/dmg-background.png" ]; then
	echo "ERROR: rebuilt DMG is missing .background/dmg-background.png" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -e "$MOUNT_POINT/Applications" ]; then
	echo "ERROR: rebuilt DMG is missing Applications drop link" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi

# Validate the signed app survived the copy into the rebuilt image. Tests use
# synthetic unsigned fixtures and must opt out explicitly.
if [ "${NIXMAC_SKIP_DMG_CODESIGN_CHECK:-}" != "1" ]; then
	codesign --verify --deep --strict --verbose=4 "$MOUNT_POINT/$(basename "$APP_PATH")"
fi

hdiutil detach "$MOUNT_POINT" >/dev/null
: >"$MOUNTS_FILE"

mv "$FINAL_DMG" "$DMG_PATH"
echo "Rebuilt final DMG with Finder layout metadata: $DMG_PATH"
