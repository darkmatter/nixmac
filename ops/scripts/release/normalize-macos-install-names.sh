#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "usage: $0 <path-to-app-dmg-or-updater-tarball> [more paths...]" >&2
}

if [ "$#" -eq 0 ]; then
	usage
	exit 2
fi

if ! command -v otool >/dev/null 2>&1; then
	echo "ERROR: otool is required to normalize macOS install names" >&2
	exit 2
fi

if ! command -v install_name_tool >/dev/null 2>&1; then
	echo "ERROR: install_name_tool is required to normalize macOS install names" >&2
	exit 2
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
ENTITLEMENTS_PATH="$REPO_ROOT/apps/native/src-tauri/entitlements.plist"
TMP_DIR=$(mktemp -d)
MOUNTS_FILE="$TMP_DIR/mounts"
REWRITES_FILE="$TMP_DIR/rewrites"
touch "$MOUNTS_FILE" "$REWRITES_FILE"

detach_with_retry() {
	local mount="$1"

	for i in 1 2 3 4 5; do
		if hdiutil detach "$mount" >/dev/null 2>&1; then
			return 0
		fi
		if [ "$i" -lt 5 ]; then
			sleep 2
		fi
	done

	hdiutil detach "$mount" -force >/dev/null 2>&1
}

cleanup() {
	while IFS= read -r mount_point; do
		[ -n "$mount_point" ] || continue
		detach_with_retry "$mount_point" || true
	done <"$MOUNTS_FILE"
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

trim_dependency() {
	local line="$1"
	line="${line#"${line%%[![:space:]]*}"}"
	printf '%s\n' "${line%% (*}"
}

absolute_path() {
	local path="$1"
	local dir
	local base

	dir=$(cd "$(dirname "$path")" && pwd -P)
	base=$(basename "$path")
	printf '%s/%s\n' "$dir" "$base"
}

portable_install_name_for_dependency() {
	local dependency="$1"

	case "$dependency" in
		/nix/store/*-libiconv-*/lib/libiconv.2.dylib)
			printf '%s\n' "/usr/lib/libiconv.2.dylib"
			;;
		*)
			printf '\n'
			;;
	esac
}

normalize_macho_file() {
	local file="$1"
	local dependencies_output="$TMP_DIR/otool-dependencies"
	local dependency
	local portable_dependency
	local line

	if ! otool -hv "$file" >/dev/null 2>&1; then
		return
	fi

	if ! otool -L "$file" >"$dependencies_output" 2>&1; then
		return
	fi

	if grep -F "is not an object file" "$dependencies_output" >/dev/null; then
		return
	fi

	while IFS= read -r line; do
		case "$line" in
			"$file:" | *":")
				continue
				;;
		esac

		dependency=$(trim_dependency "$line")
		portable_dependency=$(portable_install_name_for_dependency "$dependency")

		if [ -z "$portable_dependency" ] || [ "$dependency" = "$portable_dependency" ]; then
			continue
		fi

		install_name_tool -change "$dependency" "$portable_dependency" "$file"
		printf '%s\t%s\t%s\n' "$file" "$dependency" "$portable_dependency" >>"$REWRITES_FILE"
	done <"$dependencies_output"
}

normalize_app() {
	local app_path="$1"

	if [ ! -d "$app_path" ]; then
		echo "ERROR: app path does not exist: $app_path" >&2
		exit 2
	fi

	echo "Normalizing macOS install names in $app_path"
	while IFS= read -r -d '' file; do
		normalize_macho_file "$file"
	done < <(find "$app_path" -type f -print0)
}

require_codesign() {
	local app_path="$1"

	if ! command -v codesign >/dev/null 2>&1; then
		echo "ERROR: codesign is required to code sign $app_path" >&2
		exit 2
	fi
}

sign_nested_helpers() {
	local app_path="$1"
	local identity="$2"
	local helper_path

	for helper in nixmac-helper nixmac-sync-agent; do
		helper_path="$app_path/Contents/MacOS/$helper"
		if [ -f "$helper_path" ]; then
			echo "Code signing nested helper: $helper_path"
			codesign --force --options runtime \
				--sign "$identity" \
				"$helper_path"
		fi
	done
}

sign_app_if_certificate_available() {
	local app_path="$1"
	local keychain_path
	local identity

	require_codesign "$app_path"

	if [ -z "${RUNNER_TEMP:-}" ]; then
		echo "No GitHub Actions temp directory available; ad-hoc signing normalized app: $app_path"
		sign_nested_helpers "$app_path" "-"
		codesign --force --deep --sign - "$app_path"
		codesign --verify --deep --strict --verbose=4 "$app_path"
		return
	fi

	keychain_path="${RUNNER_TEMP}/app-signing.keychain-db"
	if [ ! -f "$keychain_path" ]; then
		echo "No code-signing keychain found; ad-hoc signing normalized app: $app_path"
		sign_nested_helpers "$app_path" "-"
		codesign --force --deep --sign - "$app_path"
		codesign --verify --deep --strict --verbose=4 "$app_path"
		return
	fi

	if ! command -v security >/dev/null 2>&1; then
		echo "ERROR: security is required to code sign $app_path" >&2
		exit 2
	fi

	identity=$(security find-identity -v -p codesigning "$keychain_path" | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
	if [ -z "$identity" ]; then
		echo "ERROR: No Developer ID Application identity found in keychain" >&2
		security find-identity -v -p codesigning "$keychain_path" >&2
		exit 1
	fi

	echo "Code signing normalized app: $app_path"
	sign_nested_helpers "$app_path" "$identity"
	codesign --force --deep --options runtime \
		--entitlements "$ENTITLEMENTS_PATH" \
		--sign "$identity" \
		"$app_path"

	echo "Verifying normalized app signature: $app_path"
	codesign --verify --deep --strict --verbose=4 "$app_path"
}

normalize_dmg() {
	local dmg_path="$1"
	local mount_point
	local rw_dmg
	local normalized_dmg
	local app_count
	local current_kb
	local resized_kb

	mount_point="$TMP_DIR/mnt-$(basename "$dmg_path" .dmg)"
	rw_dmg="$TMP_DIR/$(basename "$dmg_path" .dmg).rw.dmg"
	normalized_dmg="$TMP_DIR/$(basename "$dmg_path")"

	if ! command -v hdiutil >/dev/null 2>&1; then
		echo "ERROR: hdiutil is required to normalize DMG install names" >&2
		exit 2
	fi

	if [ ! -f "$dmg_path" ]; then
		echo "ERROR: DMG path does not exist: $dmg_path" >&2
		exit 2
	fi

	echo "Converting DMG to read-write for install-name normalization: $dmg_path"
	hdiutil convert "$dmg_path" -format UDRW -o "$rw_dmg" >/dev/null

	# install_name_tool writes a temporary replacement next to each Mach-O file.
	# Tauri's compressed DMG can be exactly full, so grow the RW image before
	# mounting it or the in-place rewrite can fail with "No space left on device".
	current_kb=$(du -k "$rw_dmg" | awk '{print $1}')
	resized_kb=$((current_kb + 102400))
	hdiutil resize -size "${resized_kb}k" "$rw_dmg" >/dev/null

	mkdir -p "$mount_point"
	hdiutil attach -readwrite -nobrowse -noautoopen -mountpoint "$mount_point" "$rw_dmg" >/dev/null
	printf '%s\n' "$mount_point" >>"$MOUNTS_FILE"

	app_count=$(find "$mount_point" -maxdepth 2 -name "*.app" -type d | wc -l | tr -d '[:space:]')
	if [ "$app_count" -eq 0 ]; then
		echo "ERROR: no .app bundle found in $dmg_path" >&2
		exit 2
	fi

	while IFS= read -r app_path; do
		normalize_app "$app_path"
		sign_app_if_certificate_available "$app_path"
	done < <(find "$mount_point" -maxdepth 2 -name "*.app" -type d)

	detach_with_retry "$mount_point"

	echo "Re-compressing normalized DMG: $dmg_path"
	hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$normalized_dmg" >/dev/null
	mv "$normalized_dmg" "$dmg_path"
}

refresh_updater_signature() {
	local tar_path="$1"
	local sig_path="${tar_path}.sig"
	local absolute_tar_path
	local before_hash
	local after_hash

	if [ ! -f "$sig_path" ]; then
		echo "No updater signature found for $tar_path; skipping signature refresh."
		return
	fi

	if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
		echo "ERROR: $sig_path exists but no Tauri signing key is available to refresh it after repacking $tar_path" >&2
		exit 2
	fi

	absolute_tar_path=$(absolute_path "$tar_path")
	before_hash=$(shasum -a 256 "$sig_path" | awk '{print $1}')

	echo "Refreshing updater signature: $sig_path"
	if command -v bun >/dev/null 2>&1 && [ -x "$REPO_ROOT/apps/native/node_modules/.bin/tauri" ]; then
		bun --cwd "$REPO_ROOT/apps/native" tauri signer sign "$absolute_tar_path"
	elif command -v tauri >/dev/null 2>&1; then
		tauri signer sign "$absolute_tar_path"
	else
		echo "ERROR: Tauri CLI is required to refresh updater signature for $tar_path" >&2
		exit 2
	fi

	if [ ! -s "$sig_path" ]; then
		echo "ERROR: Tauri signer did not produce a non-empty signature for $tar_path" >&2
		exit 2
	fi

	after_hash=$(shasum -a 256 "$sig_path" | awk '{print $1}')
	if [ "$before_hash" = "$after_hash" ]; then
		echo "ERROR: Tauri signer left $sig_path unchanged after repacking $tar_path" >&2
		exit 2
	fi
}

normalize_updater_tarball() {
	local tar_path="$1"
	local extract_dir
	local tar_name
	local app_count
	local app_dir
	local app_name

	if [ ! -f "$tar_path" ]; then
		echo "ERROR: updater tarball path does not exist: $tar_path" >&2
		exit 2
	fi

	tar_name=$(basename "$tar_path")
	extract_dir="$TMP_DIR/updater-${tar_name//./-}"
	mkdir -p "$extract_dir"

	echo "Extracting updater archive for install-name normalization: $tar_path"
	tar -xzf "$tar_path" -C "$extract_dir"

	# tauri-plugin-updater strips exactly one leading path component from every
	# archive entry (entry.path().iter().skip(1)) before renaming the extraction
	# dir over the installed bundle. Entries therefore MUST be rooted at
	# `AppName.app/`; a `./`-rooted archive installs a nested
	# `nixmac.app/nixmac.app/...` and corrupts the app. Enforce exactly one
	# top-level .app and repack by its basename.
	app_count=$(find "$extract_dir" -maxdepth 1 -name "*.app" -type d | wc -l | tr -d '[:space:]')
	if [ "$app_count" -ne 1 ]; then
		echo "ERROR: expected exactly one top-level .app bundle in $tar_path, found $app_count" >&2
		exit 2
	fi
	app_dir=$(find "$extract_dir" -maxdepth 1 -name "*.app" -type d)
	app_name=$(basename "$app_dir")

	while IFS= read -r app_path; do
		normalize_app "$app_path"
		sign_app_if_certificate_available "$app_path"
	done < <(find "$extract_dir" -maxdepth 3 -name "*.app" -type d)

	echo "Repacking normalized updater archive: $tar_path"
	tar -czf "$tar_path" -C "$extract_dir" "$app_name"
	refresh_updater_signature "$tar_path"
}

for target in "$@"; do
	case "$target" in
		*.app.tar.gz)
			normalize_updater_tarball "$target"
			;;
		*.app)
			normalize_app "$target"
			sign_app_if_certificate_available "$target"
			;;
		*.dmg)
			normalize_dmg "$target"
			;;
		*)
			echo "ERROR: unsupported target type: $target" >&2
			usage
			exit 2
			;;
	esac
done

rewrite_count=$(wc -l <"$REWRITES_FILE" | tr -d '[:space:]')
if [ "$rewrite_count" -eq 0 ]; then
	echo "No macOS install names required normalization."
else
	echo "Normalized $rewrite_count macOS install name(s):"
	while IFS=$'\t' read -r file old_dependency new_dependency; do
		printf '  %s\n    %s -> %s\n' "$file" "$old_dependency" "$new_dependency"
	done <"$REWRITES_FILE"
fi
