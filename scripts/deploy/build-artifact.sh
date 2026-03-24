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
BUILDER="$(artifact_builder)"
BUCKET="$(artifact_bucket "$REGION")"
KEY="$(artifact_key "$STAGE" "$VERSION")"
ARTIFACT_PATH="$(artifact_local_path "$ROOTDIR" "$STAGE" "$VERSION")"
METADATA_PATH="$(artifact_metadata_path "$ROOTDIR" "$STAGE" "$VERSION")"
REMOTE_ID="$(printf '%s' "$VERSION" | tr -cs '[:alnum:]._-' '-')"
REMOTE_WORKSPACE="/tmp/nixmac-server-build-${REMOTE_ID}"

ensure_artifact_dir "$ROOTDIR" "$STAGE" "$VERSION"

echo "==> Building artifact on ${BUILDER}"
echo "    Stage:   ${STAGE}"
echo "    Version: ${VERSION}"
echo "    Bucket:  ${BUCKET}"
echo "    Key:     ${KEY}"

export COPYFILE_DISABLE=1
tar \
  --exclude=".git" \
  --exclude=".alchemy" \
  --exclude=".cargo" \
  --exclude=".devenv" \
  --exclude=".direnv" \
  --exclude=".turbo" \
  --exclude="node_modules" \
  --exclude="target" \
  --exclude="apps/server/dist" \
  --exclude="apps/server/index.js.map" \
  --exclude="apps/server/server" \
  --exclude="apps/web/.output" \
  -czf - \
  -C "$ROOTDIR" \
  . \
| ssh -o BatchMode=yes "$BUILDER" \
    "rm -rf $(printf '%q' "$REMOTE_WORKSPACE") \
      && mkdir -p $(printf '%q' "$REMOTE_WORKSPACE") \
      && tar -xzf - -C $(printf '%q' "$REMOTE_WORKSPACE")"

ssh -o BatchMode=yes "$BUILDER" \
  "ARTIFACT_VERSION=$(printf '%q' "$VERSION") \
   WORKSPACE_DIR=$(printf '%q' "$REMOTE_WORKSPACE") \
   bash $(printf '%q' "$REMOTE_WORKSPACE/scripts/deploy/remote-build-artifact.sh")"

scp -o BatchMode=yes \
  "${BUILDER}:$(printf '%q' "$REMOTE_WORKSPACE/release.tar.gz")" \
  "$ARTIFACT_PATH"

ssh -o BatchMode=yes "$BUILDER" "rm -rf $(printf '%q' "$REMOTE_WORKSPACE")"

write_artifact_metadata \
  "$METADATA_PATH" \
  "$ARTIFACT_PATH" \
  "$BUCKET" \
  "$KEY" \
  "$REGION" \
  "$STAGE" \
  "$VERSION"

echo "Artifact: ${ARTIFACT_PATH}"
