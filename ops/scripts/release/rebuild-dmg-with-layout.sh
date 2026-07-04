#!/usr/bin/env bash
set -euo pipefail

# Install deterministic Finder layout metadata into Tauri's generated DMG.
# Tauri already copies .background/dmg-background.png and the Applications link,
# but our CI hosts have not reliably emitted root .DS_Store. The static file was
# generated from the configured layout (volume nixmac, nixmac.app at 180,170,
# Applications at 480,170, background .background/dmg-background.png). Keep this
# step Finder-free: CI only copies/validates the metadata.

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
if [ ! -f "$DMG_PATH" ]; then
	echo "ERROR: DMG path does not exist: $DMG_PATH" >&2
	exit 2
fi

DS_STORE="apps/native/src-tauri/icons/dmg.DS_Store"
if [ ! -s "$DS_STORE" ]; then
	echo "ERROR: deterministic DMG .DS_Store missing/empty: $DS_STORE" >&2
	exit 2
fi

TMP_DIR=$(mktemp -d)
MOUNT_POINT="$TMP_DIR/mnt"
RW_DMG="$TMP_DIR/$(basename "$DMG_PATH" .dmg).rw.dmg"
FINAL_DMG="$TMP_DIR/$(basename "$DMG_PATH")"
mkdir -p "$MOUNT_POINT"
cleanup() {
	hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Converting DMG to read-write to install Finder layout metadata..."
hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" >/dev/null

echo "Mounting RW DMG at $MOUNT_POINT..."
hdiutil attach -readwrite -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$RW_DMG" >/dev/null

app_name=$(basename "$APP_PATH")
if [ ! -d "$MOUNT_POINT/$app_name" ]; then
	echo "ERROR: expected $app_name inside DMG" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -f "$MOUNT_POINT/.background/dmg-background.png" ]; then
	echo "ERROR: DMG is missing .background/dmg-background.png" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi
if [ ! -e "$MOUNT_POINT/Applications" ]; then
	echo "ERROR: DMG is missing Applications drop link" >&2
	find "$MOUNT_POINT" -maxdepth 3 -print >&2
	exit 2
fi

cp "$DS_STORE" "$MOUNT_POINT/.DS_Store"

if [ ! -s "$MOUNT_POINT/.DS_Store" ]; then
	echo "ERROR: DMG root .DS_Store was not installed" >&2
	exit 2
fi

if [ "${NIXMAC_SKIP_DMG_CODESIGN_CHECK:-}" != "1" ]; then
	codesign --verify --deep --strict --verbose=4 "$MOUNT_POINT/$app_name"
fi

hdiutil detach "$MOUNT_POINT" >/dev/null

echo "Re-compressing DMG back to UDZO at $DMG_PATH..."
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$FINAL_DMG" >/dev/null
mv "$FINAL_DMG" "$DMG_PATH"

trap - EXIT
rm -rf "$TMP_DIR"

echo "Installed deterministic Finder layout metadata into DMG: $DMG_PATH"
