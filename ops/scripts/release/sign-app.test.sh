#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/sign-app.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEAM_ID="$(tr -d '[:space:]' <"$REPO_ROOT/apps/native/src-tauri/signing-team-id")"
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

# FAKE_TEAM_ID controls the team in the reported identity name, so tests can
# exercise the signing-team-id match against arbitrary certificates.
cat >"$FAKE_BIN/security" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" != "find-identity" ]; then
	echo "unexpected security invocation: $*" >&2
	exit 2
fi

printf '  1) ABCDEF1234567890 "Developer ID Application: Test Signing (%s)"\n' "$FAKE_TEAM_ID"
SH
chmod +x "$FAKE_BIN/security"

CODESIGN_LOG="$TMP_DIR/codesign.log"
cat >"$FAKE_BIN/codesign" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CODESIGN_LOG"
SH
chmod +x "$FAKE_BIN/codesign"

run_sign_app() {
	(
		cd "$TMP_DIR"
		RUNNER_TEMP="$TMP_DIR/runner" CODESIGN_LOG="$CODESIGN_LOG" \
			FAKE_TEAM_ID="$1" PATH="$FAKE_BIN:$PATH" "$SCRIPT"
	)
}

# --- certificate team matching the checked-in signing-team-id signs the app -

: >"$CODESIGN_LOG"
run_sign_app "$TEAM_ID"

if ! grep -F -- "--identifier com.darkmatter.nixmac.helper --entitlements $REPO_ROOT/apps/native/src-tauri/entitlements-helper.plist" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to sign the helper with its identifier and entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--identifier com.darkmatter.nixmac.sync-agent --entitlements $REPO_ROOT/apps/native/src-tauri/entitlements-helper-client.plist" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to sign the sync agent with its identifier and client entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

if ! grep -F -- "--entitlements $REPO_ROOT/apps/native/src-tauri/entitlements.plist" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to sign app with entitlements" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

# Inside-out: --deep on the bundle sign would re-sign the nested binaries and
# clobber their explicit identifiers and entitlements.
if grep -- "--sign" "$CODESIGN_LOG" | grep -- "--deep" >/dev/null; then
	echo "expected sign-app to sign without --deep" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

app_line=$(grep -n -F -- "--entitlements $REPO_ROOT/apps/native/src-tauri/entitlements.plist" "$CODESIGN_LOG" | cut -d: -f1 | head -1)
for nested in nixmac-helper nixmac-sync-agent; do
	nested_line=$(grep -n -F "Contents/MacOS/$nested" "$CODESIGN_LOG" | cut -d: -f1 | head -1)
	if [ -z "$nested_line" ] || [ "$nested_line" -ge "$app_line" ]; then
		echo "expected sign-app to sign $nested before the app bundle" >&2
		cat "$CODESIGN_LOG" >&2
		exit 1
	fi
done

if ! grep -F -- "--deep --strict --verbose=4" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app to strict-verify the sealed app bundle" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

# --- certificate from another team is refused before anything is signed -----

: >"$CODESIGN_LOG"
if run_sign_app "OTHERTEAM1" >/dev/null 2>&1; then
	echo "expected sign-app to reject a certificate from another team" >&2
	exit 1
fi

if grep -- "--sign" "$CODESIGN_LOG" >/dev/null; then
	echo "expected sign-app not to sign anything with a wrong-team certificate" >&2
	cat "$CODESIGN_LOG" >&2
	exit 1
fi

echo "sign-app signing tests passed"
