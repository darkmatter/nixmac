#!/usr/bin/env bash
set -euo pipefail

# Upload release artifacts to R2 and generate latest.json for auto-updater.
#
# Required env vars (typically from sops):
#   R2_ACCESS_KEY_ID       - R2 access key
#   R2_SECRET_ACCESS_KEY   - R2 secret key
#   R2_ENDPOINT            - R2 endpoint URL
# Required env vars:
#   RELEASE_VERSION        - Version being released
# Optional env vars:
#   UPDATE_CHANNEL         - "stable" (default) or "develop"
#   RELEASE_TAG            - Tag being released
# Optional env vars:
#   GITHUB_TOKEN           - For fetching release notes via gh CLI
#   AWS_DEFAULT_REGION     - Default "auto"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

VERSION="$RELEASE_VERSION"
UPDATE_CHANNEL="${UPDATE_CHANNEL:-stable}"

case "$UPDATE_CHANNEL" in
	stable)
		ARTIFACT_PREFIX="${VERSION}"
		MANIFEST_KEY="latest.json"
		BUNDLE_URL="https://releases.nixmac.com/${VERSION}/nixmac.app.tar.gz"
		DMG_URL="https://releases.nixmac.com/${VERSION}/nixmac.dmg"
		;;
	develop)
		ARTIFACT_PREFIX="channels/develop/${VERSION}"
		MANIFEST_KEY="channels/develop/latest.json"
		BUNDLE_URL="https://releases.nixmac.com/channels/develop/${VERSION}/nixmac.app.tar.gz"
		DMG_URL="https://releases.nixmac.com/channels/develop/${VERSION}/nixmac.dmg"
		;;
	*)
		echo "ERROR: unsupported UPDATE_CHANNEL: $UPDATE_CHANNEL"
		exit 1
		;;
esac

TAR_GZ=$(find target/release/bundle -name "*.app.tar.gz" -not -name "*.sig" | head -1)
SIG_FILE=$(find target/release/bundle -name "*.app.tar.gz.sig" | head -1)
DMG_FILE=$(find target/release/bundle/dmg -name "*.dmg" -type f 2>/dev/null | sed -n '1p' || true)

if [ -z "$TAR_GZ" ] || [ -z "$SIG_FILE" ]; then
	echo "ERROR: Could not find .app.tar.gz or .sig file"
	echo "Contents of target/release/bundle:"
	find target/release/bundle -type f -name "*.tar.gz*" 2>/dev/null || true
	exit 1
fi

echo "Found tar.gz: $TAR_GZ"
echo "Found sig: $SIG_FILE"
echo "Found dmg: $DMG_FILE"

SIGNATURE=$(cat "$SIG_FILE" | jq -Rs .)

DMG_SIGNATURE=$(cat "$DMG_FILE" | jq -Rs .)

aws s3 cp "$TAR_GZ" "s3://nixmac-releases/${ARTIFACT_PREFIX}/nixmac.app.tar.gz" \
	--endpoint-url "$R2_ENDPOINT" \
	--cache-control "max-age=31536000"

aws s3 cp "$SIG_FILE" "s3://nixmac-releases/${ARTIFACT_PREFIX}/nixmac.app.tar.gz.sig" \
	--endpoint-url "$R2_ENDPOINT" \
	--cache-control "max-age=31536000"

aws s3 cp "$DMG_FILE" "s3://nixmac-releases/${ARTIFACT_PREFIX}/nixmac.dmg" \
	--endpoint-url "$R2_ENDPOINT" \
	--cache-control "max-age=31536000"

PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

NOTES=""
if [[ "$UPDATE_CHANNEL" == "develop" ]]; then
	NOTES="Develop build ${GITHUB_SHA:-unknown}"
elif command -v gh &>/dev/null && [[ -n "${RELEASE_TAG:-}" ]]; then
	NOTES=$(gh release view "$RELEASE_TAG" --json body -q .body 2>/dev/null || echo "")
fi

cat >/tmp/latest.json <<EOF
{
  "version": "${VERSION}",
  "notes": $(echo "$NOTES" | jq -Rs .),
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": ${SIGNATURE},
      "url": "${BUNDLE_URL}",
      "dmg_signature": ${DMG_SIGNATURE},
      "dmg_url": "${DMG_URL}"
    }
  }
}
EOF

cat /tmp/latest.json | jq . >/tmp/latest-formatted.json

aws s3 cp /tmp/latest-formatted.json "s3://nixmac-releases/${MANIFEST_KEY}" \
	--endpoint-url "$R2_ENDPOINT" \
	--cache-control "max-age=300" \
	--content-type "application/json"

echo "✅ Uploaded to R2 (${UPDATE_CHANNEL}): v${VERSION}"
