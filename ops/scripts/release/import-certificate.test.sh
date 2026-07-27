#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/import-certificate.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN" "$TMP_DIR/runner"

# The real committed intermediate feeds the script's fingerprint derivation.
G2_SHA1="$(openssl x509 -inform der -in "$SCRIPT_DIR/DeveloperIDG2CA.cer" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"

# FAKE_IDENTITY_STATE drives what the temp-keychain lookups report:
#   valid    - identity imported and its chain validates (healthy runner)
#   invalid  - identity imported but only the non -v listing shows it: the
#              scoped -v lookup cannot build the chain (runner is missing
#              the Developer ID G2 intermediate in its system keychain)
#   absent   - nothing usable was imported
# FAKE_G2_STATE (present|missing) drives whether the system keychain already
# holds the G2 intermediate; add-certificates invocations are logged.
cat >"$FAKE_BIN/security" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
	find-certificate)
		if [ "$FAKE_G2_STATE" = "present" ]; then
			printf 'SHA-1 hash: %s\n' "$FAKE_G2_SHA1"
			printf '    "Developer ID Certification Authority"\n'
		fi
		;;
	add-certificates)
		printf 'add-certificates %s\n' "$*" >>"$SECURITY_LOG"
		;;
	find-identity)
		verbose=0
		for arg in "$@"; do
			if [ "$arg" = "-v" ]; then
				verbose=1
			fi
		done
		case "$FAKE_IDENTITY_STATE" in
			valid)
				printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Test Signing (TEAMID)"\n'
				printf '     1 valid identities found\n'
				;;
			invalid)
				if [ "$verbose" -eq 1 ]; then
					printf '     0 valid identities found\n'
				else
					printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Test Signing (TEAMID)"\n'
					printf '     1 identities found\n'
				fi
				;;
			absent)
				printf '     0 valid identities found\n'
				;;
		esac
		;;
	list-keychains)
		printf '    "%s"\n' "$FAKE_LOGIN_KEYCHAIN"
		;;
	*)
		exit 0
		;;
esac
SH
chmod +x "$FAKE_BIN/security"

# The script reaches add-certificates through `sudo -n`; strip the flag and
# run the command so the fake security above records the invocation.
cat >"$FAKE_BIN/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-n" ]; then
	shift
fi
exec "$@"
SH
chmod +x "$FAKE_BIN/sudo"

SECURITY_LOG="$TMP_DIR/security.log"

run_import() {
	FAKE_IDENTITY_STATE="$1" \
		FAKE_G2_STATE="${2:-present}" \
		FAKE_G2_SHA1="$G2_SHA1" \
		FAKE_LOGIN_KEYCHAIN="$TMP_DIR/login.keychain-db" \
		SECURITY_LOG="$SECURITY_LOG" \
		RUNNER_TEMP="$TMP_DIR/runner" \
		KEYCHAIN_PASSWORD=test-keychain \
		APPLE_CERTIFICATE="$(printf 'fake p12' | base64)" \
		APPLE_CERTIFICATE_PASSWORD=test-p12 \
		PATH="$FAKE_BIN:$PATH" \
		bash "$SCRIPT" >"$TMP_DIR/import.out" 2>"$TMP_DIR/import.err"
}

# --- imported identity with a validating chain passes -----------------------

if ! run_import valid; then
	echo "expected import to succeed when the scoped lookup validates the identity" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

if [ -s "$SECURITY_LOG" ]; then
	echo "expected no G2 install when the intermediate is already present" >&2
	cat "$SECURITY_LOG" >&2
	exit 1
fi

# --- missing G2 intermediate is installed into the system keychain ----------

: >"$SECURITY_LOG"
if ! run_import valid missing; then
	echo "expected import to succeed after installing the missing G2 intermediate" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

if ! grep -F -- "add-certificates -k /Library/Keychains/System.keychain" "$SECURITY_LOG" | grep -F "DeveloperIDG2CA.cer" >/dev/null; then
	echo "expected the missing G2 intermediate to be installed from the checked-in cert" >&2
	cat "$SECURITY_LOG" >&2
	exit 1
fi

# --- imported identity whose chain does not validate names the G2 fix -------

if run_import invalid; then
	echo "expected import to fail when the identity is imported but does not validate" >&2
	exit 1
fi

if ! grep -F "scoped chain validation fails" "$TMP_DIR/import.err" >/dev/null ||
	! grep -F "Developer ID G2 intermediate" "$TMP_DIR/import.err" >/dev/null; then
	echo "expected the imported-but-invalid case to name the missing G2 intermediate" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

if grep -F "no valid Developer ID Application identity after import" "$TMP_DIR/import.err" >/dev/null; then
	echo "expected the imported-but-invalid case not to be reported as a failed import" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

# --- nothing imported is reported as a failed import ------------------------

if run_import absent; then
	echo "expected import to fail when no identity was imported" >&2
	exit 1
fi

if ! grep -F "no valid Developer ID Application identity after import" "$TMP_DIR/import.err" >/dev/null; then
	echo "expected the absent case to be reported as a failed import" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

if grep -F "Developer ID G2 intermediate" "$TMP_DIR/import.err" >/dev/null; then
	echo "expected the absent case not to prescribe the G2 remediation" >&2
	cat "$TMP_DIR/import.err" >&2
	exit 1
fi

echo "import-certificate tests passed"
