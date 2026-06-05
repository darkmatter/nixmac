#!/usr/bin/env bash
set -euo pipefail

# Import Apple Developer certificate for code signing.
#
# On self-hosted runners with session-less users, the user keychain domain
# is unavailable and `security import` silently drops the certificate while
# keeping the private key. To work around this, we import into the system
# keychain instead, which doesn't require a GUI login session.
#
# Required env vars (typically from sops):
#   APPLE_CERTIFICATE          - Base64-encoded P12 certificate
#   APPLE_CERTIFICATE_PASSWORD - Password for the P12
#   KEYCHAIN_PASSWORD          - Password for the temporary keychain
#   RUNNER_TEMP                - GitHub Actions temp directory

CERT_FILE="${RUNNER_TEMP}/certificate.p12"
echo "$APPLE_CERTIFICATE" | base64 --decode >"$CERT_FILE"

# Try user keychain first (works on GitHub-hosted runners with GUI sessions)
KEYCHAIN_PATH="${RUNNER_TEMP}/app-signing.keychain-db"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" 2>/dev/null || true
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH" 2>/dev/null || true
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" 2>/dev/null || true
security import "$CERT_FILE" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH" 2>/dev/null || true
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" 2>/dev/null || true

# Check if the user keychain approach worked
IDENTITY_COUNT=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" 2>/dev/null | grep -c "Developer ID Application" || echo "0")

if [ "$IDENTITY_COUNT" -gt 0 ]; then
    echo "User keychain import succeeded"
    # shellcheck disable=SC2046
    security list-keychain -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"' | xargs) 2>/dev/null || true
else
    echo "User keychain import found no identities — falling back to system keychain"
    # Import into system keychain (works for session-less users)
    sudo security import "$CERT_FILE" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k /Library/Keychains/System.keychain

    # Verify
    SYSTEM_COUNT=$(sudo security find-identity -v -p codesigning /Library/Keychains/System.keychain 2>/dev/null | grep -c "Developer ID Application" || echo "0")
    if [ "$SYSTEM_COUNT" -eq 0 ]; then
        echo "ERROR: No Developer ID Application identity found in either user or system keychain"
        exit 1
    fi
    echo "System keychain import succeeded"
    KEYCHAIN_PATH="/Library/Keychains/System.keychain"
fi

echo "=== Available signing identities ==="
security find-identity -v -p codesigning "$KEYCHAIN_PATH" 2>/dev/null || sudo security find-identity -v -p codesigning "$KEYCHAIN_PATH"
echo "=== End identities ==="
