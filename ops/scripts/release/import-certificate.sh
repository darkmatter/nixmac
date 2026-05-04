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

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "$APPLE_CERTIFICATE" | base64 --decode >"$RUNNER_TEMP/certificate.p12"
security import "$RUNNER_TEMP/certificate.p12" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
# shellcheck disable=SC2046
security list-keychain -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"' | xargs)

echo "=== Available signing identities ==="
security find-identity -v -p codesigning "$KEYCHAIN_PATH"
echo "=== End identities ==="
