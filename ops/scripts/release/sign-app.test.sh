#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/sign-app.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN" "$TMP_DIR/runner" "$TMP_DIR/target/release/bundle/macos/nixmac.app/Contents/MacOS"

APP_PATH="$TMP_DIR/target/release/bundle/macos/nixmac.app"
for binary in nixmac nixmac-helper nixmac-sync-agent; do
	printf 'fake mach-o\n' >"$APP_PATH/Contents/MacOS/$binary"
	chmod +x "$APP_PATH/Contents/MacOS/$binary"
done

touch "$TMP_DIR/runner/app-signing.keychain-db"

cat >"$FAKE_BIN/security" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" != "find-identity" ]; then
	echo "unexpected security invocation: $*" >&2
	exit 2
fi

printf '%s\n' '  1) ABCDEF1234567890 "Developer ID Application: Test Signing (TEAMID)"'
SH
chmod +x "$FAKE_BIN/security"

CODESIGN_LOG="$TMP_DIR/codesign.log"
cat >"$FAKE_BIN/codesign" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CODESIGN_LOG"
SH
chmod +x "$FAKE_BIN/codesign"

(
	cd "$TMP_DIR"
	RUNNER_TEMP="$TMP_DIR/runner" CODESIGN_LOG="$CODESIGN_LOG" PATH="$FAKE_BIN:$PATH" "$SCRIPT"
)

if ! grep -F "nixmac.app/Contents/MacOS/nixmac-helper" "$CODESIGN_LOG" >/dev/null ||
	! grep -F "nixmac.app/Contents/MacOS/nixmac-sync-agent" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to sign nested helper binaries" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--entitlements apps/native/src-tauri/entitlements.plist" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to sign app with entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--deep --strict --verbose=4" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to strict-verify the sealed app bundle" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

echo "sign-app nested helper signing test passed"
