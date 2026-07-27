#!/usr/bin/env bash
set -euo pipefail

# Import Apple Developer certificate into a temporary keychain.
#
# Required env vars (typically from sops):
#   APPLE_CERTIFICATE          - Base64-encoded P12 certificate
#   APPLE_CERTIFICATE_PASSWORD - Password for the P12
#   KEYCHAIN_PASSWORD          - Password for the temporary keychain
#   RUNNER_TEMP                - GitHub Actions temp directory
#
# Custom Macly Tahoe images omit Apple's Developer ID intermediate CAs from
# System.keychain. Importing the P12 alone yields a private key but
# "0 valid identities". Even with the intermediate in the temp keychain,
# `find-identity` scoped to that path still returns 0 — the temp keychain must
# sit on the user search list and identity lookup must be unscoped (see
# sign-app.sh / normalize-macos-install-names.sh).

KEYCHAIN_PATH="${RUNNER_TEMP}/app-signing.keychain-db"
KEYCHAINS_BEFORE_PATH="${RUNNER_TEMP}/app-signing-keychains-before.txt"
P12_PATH="${RUNNER_TEMP}/certificate.p12"
INTERMEDIATE_DIR="${RUNNER_TEMP}/apple-intermediates"

# Preserve the prior search list for cleanup-keychain.sh.
security list-keychains -d user | tr -d '"' >"$KEYCHAINS_BEFORE_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "$APPLE_CERTIFICATE" | base64 --decode >"$P12_PATH"
security import "$P12_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

# Install Apple Developer ID intermediates. Our leaf is G2-issued; import G1 too
# for completeness. Minimal CI images do not ship these in System.keychain.
mkdir -p "$INTERMEDIATE_DIR"
for url in \
	"https://www.apple.com/certificateauthority/DeveloperIDCA.cer" \
	"https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"; do
	name=$(basename "$url")
	curl -fsSL "$url" -o "$INTERMEDIATE_DIR/$name"
	if ! security import "$INTERMEDIATE_DIR/$name" -k "$KEYCHAIN_PATH" \
		-T /usr/bin/codesign -T /usr/bin/security >/dev/null 2>&1; then
		openssl x509 -inform DER -in "$INTERMEDIATE_DIR/$name" -out "$INTERMEDIATE_DIR/${name}.pem"
		security import "$INTERMEDIATE_DIR/${name}.pem" -k "$KEYCHAIN_PATH" \
			-T /usr/bin/codesign -T /usr/bin/security >/dev/null
	fi
	echo "Imported intermediate: $name"
done

# Put the temp keychain first so unscoped find-identity can complete the chain.
# shellcheck disable=SC2046
security list-keychains -d user -s "$KEYCHAIN_PATH" $(tr '\n' ' ' <"$KEYCHAINS_BEFORE_PATH")

echo "=== Available signing identities (unscoped search list) ==="
# Unscoped on purpose: scoped find-identity to $KEYCHAIN_PATH returns 0 on Macly
# even when the intermediate lives in that same keychain.
IDENTITIES_OUT=$(security find-identity -v -p codesigning)
printf '%s\n' "$IDENTITIES_OUT"
echo "=== End identities ==="

if ! printf '%s\n' "$IDENTITIES_OUT" | grep -q "Developer ID Application"; then
	echo "ERROR: No Developer ID Application identity found after import" >&2
	echo "Scoped temp keychain identities:" >&2
	security find-identity -v -p codesigning "$KEYCHAIN_PATH" >&2 || true
	exit 1
fi
