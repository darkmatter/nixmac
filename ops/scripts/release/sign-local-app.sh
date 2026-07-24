#!/usr/bin/env bash
set -euo pipefail

# Sign a locally-built nixmac.app with the team Developer ID certificate stored
# in SOPS, so the privileged sync helper (SMAppService) can register in local
# builds. SMAppService refuses to register a daemon whose signature has no Team
# Identifier, so an ad-hoc (`codesign --sign -`) bundle fails with -67028
# ("Codesigning failure loading plist").
#
# Run via sops so the cert material is in the environment:
#   sops exec-env ops/secrets/secrets.sops.json "bash ops/scripts/release/sign-local-app.sh [APP_PATH]"
#
# Required env (provided by sops exec-env):
#   APPLE_CERTIFICATE          - base64-encoded P12 (Developer ID Application)
#   APPLE_CERTIFICATE_PASSWORD - P12 password
#
# Unlike the CI path (import-certificate.sh + sign-app.sh), this imports into a
# throwaway keychain and restores the user's original keychain search list on
# exit, so the developer's default keychains are left untouched. The temporary
# keychain is deleted on exit.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=ops/scripts/release/codesign-app-lib.sh disable=SC1091
. "$REPO_ROOT/ops/scripts/release/codesign-app-lib.sh"
APP_PATH="${1:-$REPO_ROOT/target/release/bundle/macos/nixmac.app}"

if [ ! -d "$APP_PATH" ]; then
	echo "ERROR: app bundle not found: $APP_PATH" >&2
	exit 1
fi

if [ -z "${APPLE_CERTIFICATE:-}" ] || [ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]; then
	echo "ERROR: APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD not set." >&2
	echo "Run under: sops exec-env ops/secrets/secrets.sops.json \"bash $0\"" >&2
	exit 1
fi

WORK_DIR="$(mktemp -d)"
KEYCHAIN_PATH="$WORK_DIR/nixmac-local-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
CERT_PATH="$WORK_DIR/certificate.p12"

ORIG_KEYCHAINS=()
while IFS= read -r kc; do
	kc="${kc//\"/}"
	kc="${kc#"${kc%%[![:space:]]*}"}"
	[ -n "$kc" ] && ORIG_KEYCHAINS+=("$kc")
done < <(security list-keychains -d user)

cleanup() {
	if [ "${#ORIG_KEYCHAINS[@]}" -gt 0 ]; then
		security list-keychains -d user -s "${ORIG_KEYCHAINS[@]}" >/dev/null 2>&1 || true
	fi
	security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 3600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode >"$CERT_PATH"
security import "$CERT_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH" >/dev/null
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

# codesign resolves the signing identity by name through the user keychain
# search list, not via --keychain, so temporarily prepend our throwaway
# keychain; the original list is restored on exit by cleanup().
security list-keychains -d user -s "$KEYCHAIN_PATH" "${ORIG_KEYCHAINS[@]}"

IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
if [ -z "$IDENTITY" ]; then
	echo "ERROR: no Developer ID Application identity in the SOPS certificate" >&2
	security find-identity -v -p codesigning "$KEYCHAIN_PATH" >&2
	exit 1
fi

echo "Signing $APP_PATH with SOPS identity: $IDENTITY"

nixmac_sign_app_inside_out "$APP_PATH" "$IDENTITY"

echo "Verifying signature..."
codesign --verify --deep --strict --verbose=4 "$APP_PATH"

echo "[sign-local-app] signed and verified $APP_PATH with the SOPS Developer ID certificate"
