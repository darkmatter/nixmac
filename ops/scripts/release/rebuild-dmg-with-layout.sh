#!/usr/bin/env bash
set -euo pipefail

# Install deterministic Finder layout metadata into Tauri's generated DMG.
# Tauri already copies .background/dmg-background.png and the Applications
# link, but our CI hosts have not reliably emitted root .DS_Store, and Finder
# needs it (with a picture-background icvp record) to render the background.
# The metadata is generated Finder-free by write-dmg-ds-store.py against the
# mounted volume, because the icvp backgroundImageAlias must reference the
# actual volume for Finder to resolve it on end-user machines.

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

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRITE_DS_STORE="$SCRIPT_DIR/write-dmg-ds-store.py"
if [ ! -f "$WRITE_DS_STORE" ]; then
	echo "ERROR: missing generator script: $WRITE_DS_STORE" >&2
	exit 2
fi

TMP_DIR=$(mktemp -d)
RW_DMG="$TMP_DIR/$(basename "$DMG_PATH" .dmg).rw.dmg"
FINAL_DMG="$TMP_DIR/$(basename "$DMG_PATH")"
MOUNT_POINT=""
cleanup() {
	if [ -n "$MOUNT_POINT" ]; then
		hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
	fi
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Converting DMG to read-write to install Finder layout metadata..."
hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" >/dev/null

# Attach without -mountpoint so the volume lands under /Volumes/<volname>,
# exactly like an end-user mount: the icvp backgroundImageAlias embeds the
# volume root path where it is generated, and Finder resolves it most
# reliably when that matches real-world mounts (this is what dmgbuild does).
echo "Mounting RW DMG under /Volumes..."
attach_plist="$TMP_DIR/attach.plist"
hdiutil attach -readwrite -nobrowse -noautoopen -plist "$RW_DMG" >"$attach_plist"
MOUNT_POINT=$(/usr/libexec/PlistBuddy -c 'Print :system-entities' "$attach_plist" 2>/dev/null | sed -n 's/^ *mount-point = \(.*\)$/\1/p' | head -n1)
if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
	echo "ERROR: could not determine RW DMG mount point" >&2
	cat "$attach_plist" >&2
	exit 2
fi
echo "Mounted at $MOUNT_POINT"

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

echo "Writing Finder layout metadata (.DS_Store) onto mounted volume..."
# Pure flake refs (no <nixpkgs>/NIX_PATH dependency): build the two pure-python
# deps and compose PYTHONPATH by hand — `nix shell` does not wire python
# site-packages together.
DS_STORE_PKG=$(nix build --no-link --print-out-paths nixpkgs#python313Packages.ds-store)
MAC_ALIAS_PKG=$(nix build --no-link --print-out-paths nixpkgs#python313Packages.mac-alias)
PYTHON3_PKG=$(nix build --no-link --print-out-paths nixpkgs#python313)
PYTHONPATH="$DS_STORE_PKG/lib/python3.13/site-packages:$MAC_ALIAS_PKG/lib/python3.13/site-packages" \
	"$PYTHON3_PKG/bin/python3" "$WRITE_DS_STORE" "$MOUNT_POINT" "$app_name"

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
