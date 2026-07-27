#!/bin/bash
set -euo pipefail

summary_path="${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
hashes_file="$(mktemp)"
trap 'rm -f "$hashes_file"' EXIT

tools_base="${RUNNER_TOOL_CACHE:-${HOME:?HOME is required}/.local/share}"
tools_root="$tools_base/nixmac-image-builder"
bin_dir="$tools_root/bin"
artifacts_dir="/Users/Shared/nixmac-image-builder"
export PATH="$bin_dir:$PATH"

{
  echo "## macOS image builder preflight"
  echo ""
  echo '```text'
  sw_vers
  uname -m
  /usr/bin/xcodebuild -version 2>/dev/null || true
  command -v tart || true
  tart --version 2>/dev/null || true
  command -v packer || true
  command -v oras || true
  echo "Tool root: $tools_root"
  echo "Xcode artifact staging: $artifacts_dir"
  sysctl -n kern.hv_support 2>/dev/null || true
  df -h /
  echo '```'
} | tee -a "$summary_path"

if [ "$(sysctl -n kern.hv_support 2>/dev/null || true)" != "1" ]; then
  echo "::error::Apple virtualization support is unavailable on the dedicated image builder"
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "::error::Tart image builds require an Apple Silicon image builder"
  exit 1
fi
for tool in tart packer oras; do
  if ! command -v "$tool" >/dev/null; then
    echo "::error::$tool is not provisioned on the dedicated image builder"
    exit 1
  fi
done

echo "Checking deterministic Xcode staging locations..."
candidates="$(
  for candidate in \
    "$artifacts_dir"/Xcode*.xip \
    "$artifacts_dir"/Xcode*.pkg \
    /Users/Shared/Xcode*.xip \
    /Users/Shared/Xcode*.pkg \
    /Users/*/Xcode*.xip \
    /Users/*/Xcode*.pkg \
    /private/var/tmp/Xcode*.xip \
    /private/var/tmp/Xcode*.pkg; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
    fi
  done | sort -u
)"

if [ -z "$candidates" ]; then
  {
    echo ""
    echo "## Approved artifact candidates"
    echo ""
    echo "(none found)"
  } >> "$summary_path"
  echo "::error::No Xcode .xip or .pkg found in $artifacts_dir, /Users/Shared, a home root, or /private/var/tmp"
  exit 1
fi

while IFS= read -r candidate; do
  echo "Hashing $candidate"
  shasum -a 256 "$candidate" | tee -a "$hashes_file"
done <<< "$candidates"

{
  echo ""
  echo "## Approved artifact candidates"
  echo ""
  echo '```text'
  cat "$hashes_file"
  echo '```'
} >> "$summary_path"
