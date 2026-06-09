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
	echo "ERROR: otool is required to check macOS app portability" >&2
	exit 2
fi

TMP_DIR=$(mktemp -d)
MOUNTS_FILE="$TMP_DIR/mounts"
VIOLATIONS_FILE="$TMP_DIR/violations"
MACHO_FILES="$TMP_DIR/macho-files"
touch "$MOUNTS_FILE" "$VIOLATIONS_FILE" "$MACHO_FILES"

cleanup() {
	while IFS= read -r mount_point; do
		[ -n "$mount_point" ] || continue
		hdiutil detach "$mount_point" >/dev/null 2>&1 || hdiutil detach "$mount_point" -force >/dev/null 2>&1 || true
	done <"$MOUNTS_FILE"
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

trim_dependency() {
	local line="$1"
	line="${line#"${line%%[![:space:]]*}"}"
	printf '%s\n' "${line%% (*}"
}

trim_line() {
	local line="$1"
	line="${line#"${line%%[![:space:]]*}"}"
	printf '%s\n' "$line"
}

record_violation() {
	local file="$1"
	local dependency="$2"
	local reason="$3"
	printf '%s\t%s\t%s\n' "$file" "$dependency" "$reason" >>"$VIOLATIONS_FILE"
}

check_dependency() {
	local file="$1"
	local dependency="$2"

	case "$dependency" in
		"")
			return
			;;
		@rpath/* | @loader_path/* | @executable_path/*)
			return
			;;
		/usr/lib/* | /System/Library/*)
			return
			;;
		/nix/store/*)
			record_violation "$file" "$dependency" "nix store dependency"
			return
			;;
		*.devenv*)
			record_violation "$file" "$dependency" "devenv dependency"
			return
			;;
		/*)
			record_violation "$file" "$dependency" "non-portable absolute dependency"
			return
			;;
		*)
			record_violation "$file" "$dependency" "non-portable relative dependency"
			return
			;;
	esac
}

check_rpath() {
	local file="$1"
	local rpath="$2"

	case "$rpath" in
		"")
			return
			;;
		@rpath/* | @loader_path/* | @executable_path/*)
			return
			;;
		/usr/lib | /usr/lib/* | /System/Library | /System/Library/*)
			return
			;;
		/nix/store/*)
			record_violation "$file" "$rpath" "nix store rpath"
			return
			;;
		*.devenv*)
			record_violation "$file" "$rpath" "devenv rpath"
			return
			;;
		/*)
			record_violation "$file" "$rpath" "non-portable absolute rpath"
			return
			;;
		*)
			record_violation "$file" "$rpath" "non-portable relative rpath"
			return
			;;
	esac
}

check_rpaths() {
	local file="$1"
	local output="$2"
	local in_rpath=0
	local line
	local trimmed
	local rpath

	while IFS= read -r line; do
		trimmed=$(trim_line "$line")
		case "$trimmed" in
			"cmd LC_RPATH")
				in_rpath=1
				;;
			path\ *" (offset "*)
				if [ "$in_rpath" -eq 1 ]; then
					rpath="${trimmed#path }"
					rpath="${rpath%% (offset *}"
					check_rpath "$file" "$rpath"
					in_rpath=0
				fi
				;;
			"Load command "*)
				in_rpath=0
				;;
		esac
	done <"$output"
}

check_macho_file() {
	local file="$1"
	local dependencies_output="$TMP_DIR/otool-dependencies"
	local load_commands_output="$TMP_DIR/otool-load-commands"

	if ! otool -hv "$file" >/dev/null 2>&1; then
		return
	fi

	if ! otool -L "$file" >"$dependencies_output" 2>&1; then
		return
	fi

	if grep -F "is not an object file" "$dependencies_output" >/dev/null; then
		return
	fi

	if ! otool -l "$file" >"$load_commands_output" 2>&1; then
		echo "ERROR: failed to inspect load commands for Mach-O file: $file" >&2
		cat "$load_commands_output" >&2
		exit 2
	fi

	printf '%s\n' "$file" >>"$MACHO_FILES"

	while IFS= read -r line; do
		case "$line" in
			"$file:" | *":")
				continue
				;;
		esac
		check_dependency "$file" "$(trim_dependency "$line")"
	done <"$dependencies_output"

	check_rpaths "$file" "$load_commands_output"
}

check_app() {
	local app_path="$1"

	if [ ! -d "$app_path" ]; then
		echo "ERROR: app path does not exist: $app_path" >&2
		exit 2
	fi

	echo "Checking portable Mach-O dependencies in $app_path"
	while IFS= read -r -d '' file; do
		check_macho_file "$file"
	done < <(find "$app_path" -type f -print0)
}

check_dmg() {
	local dmg_path="$1"
	local mount_point
	local app_count

	if ! command -v hdiutil >/dev/null 2>&1; then
		echo "ERROR: hdiutil is required to check DMG portability" >&2
		exit 2
	fi

	if [ ! -f "$dmg_path" ]; then
		echo "ERROR: DMG path does not exist: $dmg_path" >&2
		exit 2
	fi

	mount_point="$TMP_DIR/mnt-$(basename "$dmg_path" .dmg)"
	mkdir -p "$mount_point"
	hdiutil attach "$dmg_path" -readonly -nobrowse -noautoopen -mountpoint "$mount_point" >/dev/null
	printf '%s\n' "$mount_point" >>"$MOUNTS_FILE"

	app_count=$(find "$mount_point" -maxdepth 2 -name "*.app" -type d | wc -l | tr -d '[:space:]')
	if [ "$app_count" -eq 0 ]; then
		echo "ERROR: no .app bundle found in $dmg_path" >&2
		exit 2
	fi

	while IFS= read -r app_path; do
		check_app "$app_path"
	done < <(find "$mount_point" -maxdepth 2 -name "*.app" -type d)
}

check_updater_tarball() {
	local tar_path="$1"
	local extract_dir
	local tar_name
	local app_count

	if [ ! -f "$tar_path" ]; then
		echo "ERROR: updater tarball path does not exist: $tar_path" >&2
		exit 2
	fi

	tar_name=$(basename "$tar_path")
	extract_dir="$TMP_DIR/updater-${tar_name//./-}"
	mkdir -p "$extract_dir"
	tar -xzf "$tar_path" -C "$extract_dir"

	app_count=$(find "$extract_dir" -maxdepth 3 -name "*.app" -type d | wc -l | tr -d '[:space:]')
	if [ "$app_count" -eq 0 ]; then
		echo "ERROR: no .app bundle found in $tar_path" >&2
		exit 2
	fi

	while IFS= read -r app_path; do
		check_app "$app_path"
	done < <(find "$extract_dir" -maxdepth 3 -name "*.app" -type d)
}

for target in "$@"; do
	case "$target" in
		*.app.tar.gz)
			check_updater_tarball "$target"
			;;
		*.app)
			check_app "$target"
			;;
		*.dmg)
			check_dmg "$target"
			;;
		*)
			echo "ERROR: unsupported target type: $target" >&2
			usage
			exit 2
			;;
	esac
done

if [ -s "$VIOLATIONS_FILE" ]; then
	echo "ERROR: non-portable macOS dependencies found:" >&2
	while IFS=$'\t' read -r file dependency reason; do
		printf '  %s\n    %s (%s)\n' "$file" "$dependency" "$reason" >&2
	done <"$VIOLATIONS_FILE"
	exit 1
fi

checked_count=$(wc -l <"$MACHO_FILES" | tr -d '[:space:]')
echo "Portable dependency check passed for $checked_count Mach-O file(s)."
