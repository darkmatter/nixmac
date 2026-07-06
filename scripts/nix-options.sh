#!/usr/bin/env bash

# Refresh the bundled search_docs indexes (nix-darwin-docs.json and
# home-manager-docs.json) committed under apps/native/src-tauri/resources.
#
# This is a thin wrapper around the app's own docs generation pipeline
# (`gen-docs-index`, see apps/native/src-tauri/src/docs/generated_docs.rs), so
# the committed static fallback is produced by the exact code that generates
# docs at runtime and the two cannot drift apart.

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
RESOURCES_DIR="$ROOT_DIR/apps/native/src-tauri/resources"

cargo run --manifest-path "$ROOT_DIR/apps/native/src-tauri/Cargo.toml" \
  --bin nixmac -- gen-docs-index "$RESOURCES_DIR"
