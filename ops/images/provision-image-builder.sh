#!/bin/bash
set -euo pipefail

readonly TART_VERSION="2.32.1"
readonly TART_SHA256="8554ab4f7fc12afe52f9b7e3093a935673cbac737a83973d2db7a0683c814529"
readonly PACKER_VERSION="1.15.4"
readonly PACKER_SHA256="d95ba177dd2ebb84d7d155493b4188ec2a519d2c3b041528db5b63a6aff9da80"
readonly ORAS_VERSION="1.3.3"
readonly ORAS_SHA256="f33fc12753c54172b0d0d19eaa0318d3f90fe9b094d96e8b259c881713c92e1c"

if [ "$(uname -m)" != "arm64" ]; then
  echo "::error::Tart image builds require an Apple Silicon image builder"
  exit 1
fi
if [ "$(sysctl -n kern.hv_support 2>/dev/null || true)" != "1" ]; then
  echo "::error::Apple virtualization support is unavailable on the dedicated image builder"
  exit 1
fi

tools_base="${RUNNER_TOOL_CACHE:-${HOME:?HOME is required}/.local/share}"
tools_root="$tools_base/nixmac-image-builder"
bin_dir="$tools_root/bin"
downloads_dir="$tools_root/downloads"
artifacts_dir="/Users/Shared/nixmac-image-builder"
mkdir -p "$bin_dir" "$downloads_dir" "$artifacts_dir"
if [ ! -w "$artifacts_dir" ]; then
  echo "::error::Canonical Xcode staging directory is not writable: $artifacts_dir"
  exit 1
fi

download_verified() {
  local name="$1"
  local url="$2"
  local expected_sha256="$3"
  local archive="$downloads_dir/$name"

  if [ -f "$archive" ]; then
    local cached_sha256
    cached_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
    if [ "$cached_sha256" = "$expected_sha256" ]; then
      printf '%s\n' "$archive"
      return
    fi
  fi

  local stale_partial
  for stale_partial in "$downloads_dir/.${name}."*; do
    if [ -f "$stale_partial" ]; then
      rm -f "$stale_partial"
    fi
  done

  local partial
  partial="$(mktemp "$downloads_dir/.${name}.XXXXXX")"
  if ! curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-delay 2 \
    "$url" --output "$partial"; then
    rm -f "$partial"
    return 1
  fi
  local actual_sha256
  actual_sha256="$(shasum -a 256 "$partial" | awk '{print $1}')"
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    rm -f "$partial"
    echo "::error::Pinned $name SHA-256 mismatch" >&2
    return 1
  fi
  mv "$partial" "$archive"
  printf '%s\n' "$archive"
}

extract_tgz_atomically() {
  local archive="$1"
  local target="$2"
  local label="$3"
  local partial_dir
  partial_dir="$(mktemp -d "$tools_root/.${label}.XXXXXX")"
  if ! tar -xzf "$archive" -C "$partial_dir"; then
    rm -rf "$partial_dir"
    return 1
  fi
  rm -rf "$target"
  mkdir -p "$(dirname "$target")"
  mv "$partial_dir" "$target"
}

extract_zip_atomically() {
  local archive="$1"
  local target="$2"
  local label="$3"
  local partial_dir
  partial_dir="$(mktemp -d "$tools_root/.${label}.XXXXXX")"
  if ! unzip -oq "$archive" -d "$partial_dir"; then
    rm -rf "$partial_dir"
    return 1
  fi
  rm -rf "$target"
  mkdir -p "$(dirname "$target")"
  mv "$partial_dir" "$target"
}

for stale_dir in \
  "$tools_root"/.tart-* \
  "$tools_root"/.packer-* \
  "$tools_root"/.oras-*; do
  if [ -d "$stale_dir" ]; then
    rm -rf "$stale_dir"
  fi
done

tart_archive="$(
  download_verified \
    "tart-${TART_VERSION}.tar.gz" \
    "https://github.com/openai/tart/releases/download/${TART_VERSION}/tart.tar.gz" \
    "$TART_SHA256"
)"
tart_dir="$tools_root/tart/$TART_VERSION"
extract_tgz_atomically "$tart_archive" "$tart_dir" "tart-${TART_VERSION}"
xattr -dr com.apple.quarantine "$tart_dir/tart.app" 2>/dev/null || true
ln -sfn "$tart_dir/tart.app/Contents/MacOS/tart" "$bin_dir/tart"

packer_archive="$(
  download_verified \
    "packer-${PACKER_VERSION}.zip" \
    "https://releases.hashicorp.com/packer/${PACKER_VERSION}/packer_${PACKER_VERSION}_darwin_arm64.zip" \
    "$PACKER_SHA256"
)"
packer_dir="$tools_root/packer/$PACKER_VERSION"
extract_zip_atomically "$packer_archive" "$packer_dir" "packer-${PACKER_VERSION}"
ln -sfn "$packer_dir/packer" "$bin_dir/packer"

oras_archive="$(
  download_verified \
    "oras-${ORAS_VERSION}.tar.gz" \
    "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_darwin_arm64.tar.gz" \
    "$ORAS_SHA256"
)"
oras_dir="$tools_root/oras/$ORAS_VERSION"
extract_tgz_atomically "$oras_archive" "$oras_dir" "oras-${ORAS_VERSION}"
ln -sfn "$oras_dir/oras" "$bin_dir/oras"

export PATH="$bin_dir:$PATH"
if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
fi

actual_tart_version="$(tart --version)"
actual_packer_version="$(packer version | sed -n '1s/^Packer v//p')"
actual_oras_version="$(
  oras version |
    sed -n 's/^Version:[[:space:]]*//p'
)"
if [ "$actual_tart_version" != "$TART_VERSION" ]; then
  echo "::error::Expected Tart $TART_VERSION, found $actual_tart_version"
  exit 1
fi
if [ "$actual_packer_version" != "$PACKER_VERSION" ]; then
  echo "::error::Expected Packer $PACKER_VERSION, found $actual_packer_version"
  exit 1
fi
if [ "$actual_oras_version" != "$ORAS_VERSION" ]; then
  echo "::error::Expected ORAS $ORAS_VERSION, found $actual_oras_version"
  exit 1
fi

{
  echo "## macOS image builder provisioned"
  echo ""
  echo '```text'
  echo "Tool root: $tools_root"
  echo "Xcode artifact staging: $artifacts_dir"
  echo "Tart $actual_tart_version"
  echo "Packer $actual_packer_version"
  echo "ORAS $actual_oras_version"
  df -h /
  echo '```'
} | tee -a "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
