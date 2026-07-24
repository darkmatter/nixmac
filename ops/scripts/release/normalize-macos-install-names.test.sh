#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/normalize-macos-install-names.sh"
TMP_DIR=$(mktemp -d)
cleanup() {
	if [ "${CREATED_TAURI_SHIM:-0}" -eq 1 ]; then
		rm -f "$TAURI_SHIM"
	fi
	if [ "${CREATED_TAURI_BIN_DIR:-0}" -eq 1 ]; then
		rmdir "$TAURI_BIN_DIR" 2>/dev/null || true
	fi
	if [ "${CREATED_NODE_MODULES_DIR:-0}" -eq 1 ]; then
		rmdir "$TAURI_NODE_MODULES_DIR" 2>/dev/null || true
	fi
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FAKE_BIN="$TMP_DIR/bin"
INSTALL_NAME_TOOL_LOG="$TMP_DIR/install-name-tool.log"
TAURI_SIGNER_LOG="$TMP_DIR/tauri-signer.log"
CODESIGN_LOG="$TMP_DIR/codesign.log"
TAURI_SHIM="$SCRIPT_DIR/../../../apps/native/node_modules/.bin/tauri"
TAURI_BIN_DIR=$(dirname "$TAURI_SHIM")
TAURI_NODE_MODULES_DIR=$(dirname "$TAURI_BIN_DIR")
CREATED_TAURI_SHIM=0
CREATED_TAURI_BIN_DIR=0
CREATED_NODE_MODULES_DIR=0
mkdir -p "$FAKE_BIN"
touch "$INSTALL_NAME_TOOL_LOG"
export INSTALL_NAME_TOOL_LOG
export TAURI_SIGNER_LOG
export CODESIGN_LOG

if [ ! -x "$TAURI_SHIM" ]; then
	if [ ! -d "$TAURI_NODE_MODULES_DIR" ]; then
		CREATED_NODE_MODULES_DIR=1
	fi
	if [ ! -d "$TAURI_BIN_DIR" ]; then
		CREATED_TAURI_BIN_DIR=1
	fi
	mkdir -p "$TAURI_BIN_DIR"
	touch "$TAURI_SHIM"
	chmod +x "$TAURI_SHIM"
	CREATED_TAURI_SHIM=1
fi

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
			*nix-iconv*)
				printf '\t/nix/store/example-libiconv-109.100.2/lib/libiconv.2.dylib (compatibility version 7.0.0, current version 7.0.0)\n'
				;;
			*unsupported-nix*)
				printf '\t/nix/store/example-libcustom-1.0.0/lib/libcustom.dylib (compatibility version 1.0.0, current version 1.0.0)\n'
				;;
			*)
				printf '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)\n'
				;;
		esac
		;;
	*)
		exit 2
		;;
esac
SH
chmod +x "$FAKE_BIN/otool"

cat >"$FAKE_BIN/install_name_tool" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$INSTALL_NAME_TOOL_LOG"
SH
chmod +x "$FAKE_BIN/install_name_tool"

cat >"$FAKE_BIN/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" != "--cwd" ] || [ "$3" != "tauri" ] || [ "$4" != "signer" ] || [ "$5" != "sign" ]; then
	echo "unexpected bun invocation: $*" >&2
	exit 2
fi

target="${!#}"
printf '%s\n' "signed $target" >>"$TAURI_SIGNER_LOG"
printf '%s\n' "fresh signature" >"${target}.sig"
SH
chmod +x "$FAKE_BIN/bun"

# The signing routine refuses certificates from any team other than the
# checked-in signing-team-id, so the fake identity must carry the real team.
TEAM_ID="$(tr -d '[:space:]' <"$SCRIPT_DIR/../../../apps/native/src-tauri/signing-team-id")"
export TEAM_ID

cat >"$FAKE_BIN/security" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" != "find-identity" ]; then
	echo "unexpected security invocation: $*" >&2
	exit 2
fi

printf '  1) ABCDEF1234567890 "Developer ID Application: Test Signing (%s)"\n' "$TEAM_ID"
SH
chmod +x "$FAKE_BIN/security"

cat >"$FAKE_BIN/codesign" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CODESIGN_LOG"
SH
chmod +x "$FAKE_BIN/codesign"

# Every app gets the helper sidecars: the shared signing routine hard-fails
# when they are missing from a bundle.
make_app() {
	local app="$1"
	local executable_name="$2"
	mkdir -p "$app/Contents/MacOS"
	for bin in "$executable_name" nixmac-helper nixmac-sync-agent; do
		printf 'fake mach-o\n' >"$app/Contents/MacOS/$bin"
		chmod +x "$app/Contents/MacOS/$bin"
	done
}

run_normalizer() {
	local target="$1"
	PATH="$FAKE_BIN:$PATH" "$SCRIPT" "$target" >"$TMP_DIR/normalizer.out" 2>&1
}

make_app "$TMP_DIR/Clean.app" clean
printf 'plain text\n' >"$TMP_DIR/Clean.app/Contents/MacOS/not-macho"
run_normalizer "$TMP_DIR/Clean.app"

if [ -s "$INSTALL_NAME_TOOL_LOG" ]; then
	echo "expected clean app to need no install-name rewrites" >&2
	cat "$INSTALL_NAME_TOOL_LOG" >&2
	exit 1
fi

make_app "$TMP_DIR/NixIconv.app" nix-iconv
run_normalizer "$TMP_DIR/NixIconv.app"

if ! grep -F -- "-change /nix/store/example-libiconv-109.100.2/lib/libiconv.2.dylib /usr/lib/libiconv.2.dylib $TMP_DIR/NixIconv.app/Contents/MacOS/nix-iconv" "$INSTALL_NAME_TOOL_LOG" >/dev/null; then
	echo "expected Nix libiconv to be normalized to /usr/lib/libiconv.2.dylib" >&2
	cat "$INSTALL_NAME_TOOL_LOG" >&2
	exit 1
fi

: >"$INSTALL_NAME_TOOL_LOG"
make_app "$TMP_DIR/UnsupportedNix.app" unsupported-nix
run_normalizer "$TMP_DIR/UnsupportedNix.app"

if [ -s "$INSTALL_NAME_TOOL_LOG" ]; then
	echo "expected unsupported Nix dylibs to remain for the portability checker" >&2
	cat "$INSTALL_NAME_TOOL_LOG" >&2
	exit 1
fi

: >"$INSTALL_NAME_TOOL_LOG"
: >"$CODESIGN_LOG"
make_app "$TMP_DIR/NixIconvUpdater.app" nix-iconv-updater
tar -czf "$TMP_DIR/nixmac.app.tar.gz" -C "$TMP_DIR" NixIconvUpdater.app
printf '%s\n' "stale signature" >"$TMP_DIR/nixmac.app.tar.gz.sig"
ABS_TAR_PATH="$(cd "$TMP_DIR" && pwd -P)/nixmac.app.tar.gz"
RUNNER_TEMP="$TMP_DIR/runner"
mkdir -p "$RUNNER_TEMP"
touch "$RUNNER_TEMP/app-signing.keychain-db"
(
	cd "$TMP_DIR"
	RUNNER_TEMP="$RUNNER_TEMP" TAURI_SIGNING_PRIVATE_KEY=test PATH="$FAKE_BIN:$PATH" "$SCRIPT" "nixmac.app.tar.gz" >"$TMP_DIR/tarball-normalizer.out" 2>&1
)

if ! grep -F -- "-change /nix/store/example-libiconv-109.100.2/lib/libiconv.2.dylib /usr/lib/libiconv.2.dylib" "$INSTALL_NAME_TOOL_LOG" >/dev/null; then
	echo "expected updater tarball app to be normalized" >&2
	cat "$INSTALL_NAME_TOOL_LOG" >&2
	exit 1
fi

if ! grep -F "NixIconvUpdater.app" "$CODESIGN_LOG" >/dev/null; then
	echo "expected updater tarball app to be code signed after normalization" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--identifier com.darkmatter.nixmac.helper" "$CODESIGN_LOG" | grep -F "NixIconvUpdater.app/Contents/MacOS/nixmac-helper" >/dev/null ||
	! grep -F -- "--identifier com.darkmatter.nixmac.sync-agent" "$CODESIGN_LOG" | grep -F "NixIconvUpdater.app/Contents/MacOS/nixmac-sync-agent" >/dev/null; then
	echo "expected nested helper binaries to be signed with pinned identifiers before sealing the app" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--entitlements" "$CODESIGN_LOG" | grep -F "entitlements-helper.plist" >/dev/null ||
	! grep -F -- "--entitlements" "$CODESIGN_LOG" | grep -F "entitlements-helper-client.plist" >/dev/null; then
	echo "expected nested helper binaries to be signed with per-binary entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

# Inside-out: --deep on a bundle sign would re-sign the nested binaries and
# clobber their pinned identifiers and entitlements.
if grep -- "--sign" "$CODESIGN_LOG" | grep -- "--deep" >/dev/null; then
	echo "expected the updater tarball app to be signed without --deep" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F "apps/native/src-tauri/entitlements.plist" "$CODESIGN_LOG" >/dev/null; then
	echo "expected updater tarball app signing to use the app entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--options runtime" "$CODESIGN_LOG" >/dev/null; then
	echo "expected updater tarball app signing to use Developer ID options when a signing keychain exists" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F "signed $ABS_TAR_PATH" "$TAURI_SIGNER_LOG" >/dev/null; then
	echo "expected updater tarball signature to be refreshed" >&2
	cat "$TAURI_SIGNER_LOG" >&2
	exit 1
fi

if ! grep -F "fresh signature" "$TMP_DIR/nixmac.app.tar.gz.sig" >/dev/null; then
	echo "expected updater tarball signature file to be replaced" >&2
	cat "$TMP_DIR/nixmac.app.tar.gz.sig" >&2
	exit 1
fi

TAR_ROOTS=$(tar -tzf "$TMP_DIR/nixmac.app.tar.gz" | sed -E 's|/.*$|/|' | sort -u)
if [ "$TAR_ROOTS" != "NixIconvUpdater.app/" ]; then
	echo "expected repacked updater archive rooted at NixIconvUpdater.app/ (tauri updater strips one leading path component); got:" >&2
	echo "$TAR_ROOTS" >&2
	exit 1
fi

: >"$CODESIGN_LOG"
make_app "$TMP_DIR/AdhocFallback.app" nix-iconv-adhoc
(
	export RUNNER_TEMP="$TMP_DIR/runner-without-keychain"
	run_normalizer "$TMP_DIR/AdhocFallback.app"
)

if ! grep -F "AdhocFallback.app" "$CODESIGN_LOG" >/dev/null; then
	echo "expected normalized app to be ad-hoc signed when no signing keychain exists" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--sign -" "$CODESIGN_LOG" >/dev/null; then
	echo "expected fallback signing to use an ad-hoc identity" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--identifier com.darkmatter.nixmac.helper" "$CODESIGN_LOG" >/dev/null ||
	! grep -F -- "--identifier com.darkmatter.nixmac.sync-agent" "$CODESIGN_LOG" >/dev/null; then
	echo "expected ad-hoc fallback to keep the pinned nested identifiers" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if grep -- "--sign" "$CODESIGN_LOG" | grep -- "--deep" >/dev/null; then
	echo "expected ad-hoc fallback to sign without --deep" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

echo "normalize-macos-install-names tests passed"
