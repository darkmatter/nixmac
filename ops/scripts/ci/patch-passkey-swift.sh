#!/usr/bin/env bash
# Lower tauri-plugin-macos-passkey's bundled Swift package from
# swift-tools-version 6.1 to 6.0.
#
# Why: tauri-plugin-macos-passkey 0.1.0 ships a Swift package (swift-lib /
# PasskeyBridge) declaring `swift-tools-version: 6.1`, but the self-hosted
# macOS runners have Swift 6.0.2 (Xcode 16.1). The package source uses no
# 6.1-only language or manifest features, so lowering the declared tools
# version builds cleanly on 6.0 with no behavioral change. swift-rs compiles
# this package during the Rust build (build.rs), so every workflow that
# compiles the native crate must apply this patch before building.
#
# The crate source must already be present under the cargo registry — run
# `cargo fetch` for apps/native/src-tauri before calling this. Idempotent:
# re-running after the patch (or on an already-6.0 tree) is a no-op.
set -euo pipefail

cargo_home="${CARGO_HOME:-$HOME/.cargo}"

found=0
while IFS= read -r pkg; do
  found=1
  if grep -q 'swift-tools-version: 6.1' "$pkg"; then
    # Portable in-place edit: `sed -i` flag syntax differs between GNU and BSD
    # sed (and both are reachable on the runners — system BSD sed vs. devenv's
    # GNU sed), so edit via a temp file instead.
    tmp="$(mktemp)"
    sed 's/swift-tools-version: 6.1/swift-tools-version: 6.0/' "$pkg" > "$tmp"
    mv -f "$tmp" "$pkg"
    echo "Patched $pkg (6.1 -> 6.0)"
  else
    echo "Already 6.0 (or not 6.1), skipping: $pkg"
  fi
done < <(find "$cargo_home/registry/src" \
  -path '*tauri-plugin-macos-passkey*/swift-lib/Package.swift' 2>/dev/null)

if [ "$found" -eq 0 ]; then
  echo "ERROR: PasskeyBridge Package.swift not found under $cargo_home/registry/src." >&2
  echo "       Run 'cargo fetch' for apps/native/src-tauri before this script." >&2
  exit 1
fi
