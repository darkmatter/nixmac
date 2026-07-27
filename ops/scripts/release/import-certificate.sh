#!/usr/bin/env bash
set -euo pipefail

# Import Apple Developer certificate into a temporary keychain.
#
# Required env vars (typically from sops):
#   APPLE_CERTIFICATE          - Base64-encoded P12 certificate
#   APPLE_CERTIFICATE_PASSWORD - Password for the P12
#   KEYCHAIN_PASSWORD          - Password for the temporary keychain
#   RUNNER_TEMP                - GitHub Actions temp directory

KEYCHAIN_PATH="${RUNNER_TEMP}/app-signing.keychain-db"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEVELOPER_ID_G2_CERT="$SCRIPT_DIR/../../certificates/apple-developer-id-g2.pem"
DEVELOPER_ID_G2_SHA256="f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a"

if [ ! -f "$DEVELOPER_ID_G2_CERT" ]; then
	echo "ERROR: Apple Developer ID G2 intermediate certificate is missing" >&2
	exit 1
fi
actual_intermediate_sha256=$(
	openssl x509 -in "$DEVELOPER_ID_G2_CERT" -outform DER |
		shasum -a 256 |
		awk '{print $1}'
)
if [ "$actual_intermediate_sha256" != "$DEVELOPER_ID_G2_SHA256" ]; then
	echo "ERROR: Apple Developer ID G2 intermediate certificate digest mismatch" >&2
	exit 1
fi

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "$APPLE_CERTIFICATE" | base64 --decode >"$RUNNER_TEMP/certificate.p12"
security import "$DEVELOPER_ID_G2_CERT" -t cert -k "$KEYCHAIN_PATH"
security import "$RUNNER_TEMP/certificate.p12" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
# shellcheck disable=SC2046
security list-keychain -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"' | xargs)

echo "=== Available signing identities ==="
identity_output=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH")
printf '%s\n' "$identity_output"
echo "=== End identities ==="
if ! grep -F "Developer ID Application" <<<"$identity_output" >/dev/null; then
	echo "ERROR: No valid Developer ID Application identity found after importing the certificate chain" >&2
	exit 1
fi
