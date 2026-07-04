#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/check-portable-macos-app.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/otool" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

mode="$1"
file="$2"

case "$mode" in
	-hv)
		exit 0
		;;
	-L)
		printf '%s:\n' "$file"
		case "$file" in
			*not-macho*)
				printf '%s: is not an object file\n' "$file"
				;;
			*bad-nix*)
				printf '\t/nix/store/example-libiconv/lib/libiconv.2.dylib (compatibility version 7.0.0, current version 7.0.0)\n'
				;;
			*bad-devenv*)
				printf '\t/Users/runner/work/nixmac/.devenv/profile/lib/libcustom.dylib (compatibility version 1.0.0, current version 1.0.0)\n'
				;;
			*bad-absolute*)
				printf '\t/Users/runner/work/nixmac/build/libcustom.dylib (compatibility version 1.0.0, current version 1.0.0)\n'
				;;
			*bad-relative-dependency*)
				printf '\tlibcustom.dylib (compatibility version 1.0.0, current version 1.0.0)\n'
				;;
			*)
				printf '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)\n'
				printf '\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0, current version 2685.0.0)\n'
				printf '\t@rpath/libcustom.dylib (compatibility version 1.0.0, current version 1.0.0)\n'
				;;
		esac
		;;
	-l)
		case "$file" in
			*bad-load-command-inspection*)
				echo "fake otool -l failure" >&2
				exit 3
				;;
		esac

		cat <<EOF
Load command 0
          cmd LC_RPATH
      cmdsize 32
         path @executable_path/../Frameworks (offset 12)
EOF
		case "$file" in
			*bad-rpath-nix*)
				cat <<EOF
Load command 1
          cmd LC_RPATH
      cmdsize 32
         path /nix/store/example-libiconv/lib (offset 12)
EOF
				;;
			*bad-rpath-relative*)
				cat <<EOF
Load command 1
          cmd LC_RPATH
      cmdsize 32
         path ../Frameworks (offset 12)
EOF
				;;
			*system-rpath*)
				cat <<EOF
Load command 1
          cmd LC_RPATH
      cmdsize 32
         path /usr/lib (offset 12)
Load command 2
          cmd LC_RPATH
      cmdsize 32
         path /System/Library/Frameworks (offset 12)
EOF
				;;
		esac
		;;
	*)
		exit 2
		;;
esac
SH
chmod +x "$FAKE_BIN/otool"

make_app() {
	local app="$1"
	local executable_name="$2"
	mkdir -p "$app/Contents/MacOS"
	printf 'fake mach-o\n' >"$app/Contents/MacOS/$executable_name"
	chmod +x "$app/Contents/MacOS/$executable_name"
}

assert_passes() {
	local app="$1"
	PATH="$FAKE_BIN:$PATH" "$SCRIPT" "$app" >"$TMP_DIR/pass.out" 2>&1
}

assert_fails_with() {
	local expected="$1"
	local app="$2"
	if PATH="$FAKE_BIN:$PATH" "$SCRIPT" "$app" >"$TMP_DIR/fail.out" 2>&1; then
		echo "expected failure for $app" >&2
		exit 1
	fi
	if ! grep -F "$expected" "$TMP_DIR/fail.out" >/dev/null; then
		echo "expected output to include: $expected" >&2
		cat "$TMP_DIR/fail.out" >&2
		exit 1
	fi
}

make_app "$TMP_DIR/Clean.app" clean
printf 'plain text\n' >"$TMP_DIR/Clean.app/Contents/MacOS/not-macho"
make_app "$TMP_DIR/NixStore.app" bad-nix
make_app "$TMP_DIR/Devenv.app" bad-devenv
make_app "$TMP_DIR/Absolute.app" bad-absolute
make_app "$TMP_DIR/RelativeDependency.app" bad-relative-dependency
make_app "$TMP_DIR/NixRpath.app" bad-rpath-nix
make_app "$TMP_DIR/RelativeRpath.app" bad-rpath-relative
make_app "$TMP_DIR/SystemRpath.app" system-rpath
make_app "$TMP_DIR/LoadCommandFailure.app" bad-load-command-inspection
make_app "$TMP_DIR/SymlinkEscape.app" clean
mkdir -p "$TMP_DIR/external"
printf 'external dylib\n' >"$TMP_DIR/external/libcustom.dylib"
ln -s "$TMP_DIR/external/libcustom.dylib" "$TMP_DIR/SymlinkEscape.app/Contents/MacOS/libcustom.dylib"

assert_passes "$TMP_DIR/Clean.app"
assert_passes "$TMP_DIR/SystemRpath.app"
tar -czf "$TMP_DIR/Clean.app.tar.gz" -C "$TMP_DIR" Clean.app
assert_passes "$TMP_DIR/Clean.app.tar.gz"
assert_fails_with "/nix/store/example-libiconv" "$TMP_DIR/NixStore.app"
assert_fails_with ".devenv/profile/lib/libcustom.dylib" "$TMP_DIR/Devenv.app"
assert_fails_with "/Users/runner/work/nixmac/build/libcustom.dylib" "$TMP_DIR/Absolute.app"
assert_fails_with "libcustom.dylib" "$TMP_DIR/RelativeDependency.app"
assert_fails_with "/nix/store/example-libiconv/lib" "$TMP_DIR/NixRpath.app"
assert_fails_with "../Frameworks" "$TMP_DIR/RelativeRpath.app"
assert_fails_with "failed to inspect load commands" "$TMP_DIR/LoadCommandFailure.app"
assert_fails_with "symlink points outside app bundle" "$TMP_DIR/SymlinkEscape.app"

if command -v hdiutil >/dev/null 2>&1; then
	DMG_ROOT="$TMP_DIR/dmg-root"
	mkdir -p "$DMG_ROOT/.background"
	cp -R "$TMP_DIR/Clean.app" "$DMG_ROOT/Clean.app"
	cp apps/native/src-tauri/icons/dmg-background.png "$DMG_ROOT/.background/dmg-background.png"
	ln -s /Applications "$DMG_ROOT/Applications"
	hdiutil create -quiet -srcfolder "$DMG_ROOT" -format UDZO "$TMP_DIR/Bare.dmg"
	assert_fails_with "missing root .DS_Store" "$TMP_DIR/Bare.dmg"

	LAYOUT_DMG="$TMP_DIR/Layout.dmg"
	cp "$TMP_DIR/Bare.dmg" "$LAYOUT_DMG"
	NIXMAC_SKIP_DMG_CODESIGN_CHECK=1 bash ops/scripts/release/rebuild-dmg-with-layout.sh "$TMP_DIR/Clean.app" "$LAYOUT_DMG"
	assert_passes "$LAYOUT_DMG"
else
	echo "hdiutil unavailable; skipping DMG path test"
fi

echo "check-portable-macos-app tests passed"
