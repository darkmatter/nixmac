#!/usr/bin/env bash
set -euo pipefail

: "${WORKSPACE_DIR:?WORKSPACE_DIR is required}"
: "${ARTIFACT_VERSION:?ARTIFACT_VERSION is required}"

cd "$WORKSPACE_DIR"

export NIX_CONFIG="${NIX_CONFIG:-experimental-features = nix-command flakes}"

nix shell \
  nixpkgs#bash \
  nixpkgs#bun \
  nixpkgs#patchelf \
  -c bash -lc "
    set -euo pipefail
    bun install --frozen-lockfile
    (cd apps/web && bun run build)
    (cd apps/server && bun run compile)
    patchelf --set-interpreter /lib64/ld-linux-x86-64.so.2 apps/server/server
  "

nix build \
  --file infra/nix/apps.server.nix \
  --argstr releaseVersion "$ARTIFACT_VERSION" \
  --out-link "$WORKSPACE_DIR/result"

cp "$WORKSPACE_DIR/result/artifact.tar.gz" "$WORKSPACE_DIR/release.tar.gz"
