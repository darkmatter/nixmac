#!/usr/bin/env bash
set -euo pipefail

# Import Apple Developer certificate into a temporary keychain.
#
# Required env vars (typically from sops):
#   APPLE_CERTIFICATE          - Base64-encoded P12 certificate
#   APPLE_CERTIFICATE_PASSWORD - Password for the P12
#   KEYCHAIN_PASSWORD          - Password for the temporary keychain
#   RUNNER_TEMP                - GitHub Actions temp directory

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KEYCHAIN_PATH="${RUNNER_TEMP}/app-signing.keychain-db"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "$APPLE_CERTIFICATE" | base64 --decode >"$RUNNER_TEMP/certificate.p12"
security import "$RUNNER_TEMP/certificate.p12" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
# shellcheck disable=SC2046
security list-keychain -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"' | xargs)

# The scoped validity check below builds the leaf's chain from the system
# trust domain, so the Developer ID G2 intermediate must be in the system
# keychain. Machines that have signed before have it (Xcode installs it);
# freshly imaged runner VMs do not. The checked-in copy is Apple's public
# intermediate from https://www.apple.com/certificateauthority/ — no secret
# material. sudo -n: without passwordless sudo, fail into the diagnostic
# below instead of hanging on a password prompt.
G2_CER="$SCRIPT_DIR/DeveloperIDG2CA.cer"
g2_sha1=$(openssl x509 -inform der -in "$G2_CER" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')
if ! security find-certificate -a -c "Developer ID Certification Authority" -Z /Library/Keychains/System.keychain 2>/dev/null | tr -d ' :' | grep -i "$g2_sha1" >/dev/null; then
	echo "Developer ID G2 intermediate missing from the system keychain on $(hostname); installing it."
	sudo -n security add-certificates -k /Library/Keychains/System.keychain "$G2_CER" ||
		echo "WARNING: could not install the G2 intermediate (passwordless sudo unavailable?)." >&2
fi

echo "=== Available signing identities ==="
security find-identity -v -p codesigning "$KEYCHAIN_PATH"
echo "=== End identities ==="

# find-identity -v only counts identities whose chain verifies, and a scoped
# lookup (explicit keychain path) trusts only system-domain intermediates —
# CA certs inside the temp keychain itself do not count. A runner whose
# system keychain lacks the Developer ID G2 intermediate therefore reports
# 0 valid identities for a perfectly good import (observed on the Macly
# runners), which used to surface two steps later as a normalize failure.
# Tell that apart from a failed import by comparing the temp keychain
# against itself: without -v lists everything imported, with -v only what
# validates, matched by identity hash. Never consult other keychains here —
# an unscoped lookup can match an unrelated Developer ID identity on a
# shared runner and misdiagnose.
devid_identity_hashes() {
	sed -n 's/^[[:space:]]*[0-9][0-9]*) \([0-9A-F]\{40\}\) "Developer ID Application.*/\1/p' | sort -u
}

imported_hashes=$(security find-identity -p codesigning "$KEYCHAIN_PATH" | devid_identity_hashes)
valid_hashes=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | devid_identity_hashes)
usable_hashes=$(comm -12 <(printf '%s\n' "$valid_hashes") <(printf '%s\n' "$imported_hashes") | grep . || true)

if [ -z "$usable_hashes" ]; then
	if [ -n "$imported_hashes" ]; then
		echo "ERROR: identity imported, but scoped chain validation fails on $(hostname)." >&2
		echo "This script installs the Developer ID G2 intermediate when missing — check for a" >&2
		echo "WARNING above; otherwise check the certificate for expiry or other trust failures." >&2
	else
		echo "ERROR: no valid Developer ID Application identity after import on $(hostname)." >&2
		echo "Check whether 'security import' actually imported anything above, and whether" >&2
		echo "the p12 decodes and bundles its CA chain." >&2
	fi
	exit 1
fi
