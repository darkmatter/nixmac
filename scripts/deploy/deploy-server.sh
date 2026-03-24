#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

APP="${1:-server}"
REGION="$(deploy_region "${2:-}")"

require_server_app "$APP"

ROOTDIR="$(deploy_rootdir)"
STAGE="$(deploy_stage)"
VERSION="$(artifact_version "$ROOTDIR")"
BUCKET="$(artifact_bucket "$REGION")"
KEY="$(artifact_key "$STAGE" "$VERSION")"
SECRETS_FILE="${ROOTDIR}/.secrets.enc.yaml"
ALCHEMY_ENTRY="${ROOTDIR}/apps/server/alchemy.run.ts"

echo "==> Deploying ${APP}"
echo "    Region:  ${REGION}"
echo "    Stage:   ${STAGE}"
echo "    Version: ${VERSION}"

EC2_ARTIFACT_VERSION="$VERSION" \
EC2_ARTIFACT_BUCKET="$BUCKET" \
EC2_ARTIFACT_KEY="$KEY" \
bash "${SCRIPT_DIR}/build-artifact.sh" "$APP" "$REGION"

EC2_ARTIFACT_VERSION="$VERSION" \
EC2_ARTIFACT_BUCKET="$BUCKET" \
EC2_ARTIFACT_KEY="$KEY" \
bash "${SCRIPT_DIR}/publish-artifact.sh" "$APP" "$REGION"

sops exec-env "$SECRETS_FILE" \
  "env \
    ALCHEMY_CI_STATE_STORE_CHECK=false \
    AWS_REGION=$(printf '%q' "$REGION") \
    EC2_ARTIFACT_BUCKET=$(printf '%q' "$BUCKET") \
    EC2_ARTIFACT_KEY=$(printf '%q' "$KEY") \
    EC2_ARTIFACT_VERSION=$(printf '%q' "$VERSION") \
    bun $(printf '%q' "$ALCHEMY_ENTRY")"
