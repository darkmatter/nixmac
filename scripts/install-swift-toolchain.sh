#!/bin/sh
#
# install-swift-toolchain.sh
#
# Installs the Swift toolchain required to build nixmac's Rust backend.
#
# Why this exists: the `tauri-plugin-macos-passkey` dependency builds a Swift
# package that declares swift-tools 6.1.0. Xcode 16.2 and earlier ship Swift
# 6.0.3, so `cargo build` fails with:
#
#   error: 'swift-lib': package 'swift-lib' is using Swift tools version 6.1.0
#          but the installed version is 6.0.3
#
# Upgrading Xcode is one fix, but Xcode 16.3+ requires macOS 15, which would
# force an OS upgrade on macOS 14 hosts. Installing the official swift.org
# release toolchain avoids that: it lives alongside Xcode and is exposed via
# ~/bin wrappers, leaving the system and any package-manager Swift untouched.
#
#   Installs: swift-6.1.2-RELEASE  (pkg id org.swift.612202505261a)
#   Verified on: arm64, macOS 14.x
#
# Usage:
#   sh scripts/install-swift-toolchain.sh
#
# Idempotent: re-running re-points the symlink/wrappers and skips the download
# if the exact toolchain is already present.

set -eu

# --- What to install -------------------------------------------------------
# Pinned deliberately so every machine builds against the same toolchain. To
# move versions, bump these three together (URLs at
# https://www.swift.org/install/macos/).
SWIFT_VERSION="6.1.2"
SWIFT_TAG="swift-6.1.2-RELEASE"
PKG_URL="https://download.swift.org/swift-6.1.2-release/xcode/swift-6.1.2-RELEASE/swift-6.1.2-RELEASE-osx.pkg"

TOOLCHAINS_DIR="/Library/Developer/Toolchains"
XCTOOLCHAIN="${TOOLCHAINS_DIR}/${SWIFT_TAG}.xctoolchain"
LATEST_LINK="${TOOLCHAINS_DIR}/swift-latest.xctoolchain"
BIN_DIR="${HOME}/bin"

# --- Preconditions ---------------------------------------------------------
if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: this script is macOS-only (uname -s = $(uname -s))" >&2
  exit 1
fi

# The swift.org toolchain needs the Xcode Command Line Tools present (linker,
# SDKs). Install them if missing (opens the Apple GUI installer; rerun after).
if ! xcode-select -p >/dev/null 2>&1; then
  echo "==> Command Line Tools not found; launching installer."
  echo "    Complete the GUI install, then re-run this script."
  xcode-select --install || true
  exit 1
fi

echo "==> Target: Swift ${SWIFT_VERSION} (${SWIFT_TAG})"
echo "    Arch:   $(uname -m)   macOS: $(sw_vers -productVersion 2>/dev/null || echo '?')"

# --- 1. Install the toolchain .pkg (skip if already present) ---------------
if [ -d "${XCTOOLCHAIN}" ]; then
  echo "==> ${SWIFT_TAG} already installed at ${XCTOOLCHAIN}; skipping download."
else
  TMP_PKG="$(mktemp -t swift-toolchain).pkg"
  # -f: fail on HTTP errors, -L: follow redirects.
  echo "==> Downloading ${PKG_URL}"
  curl -fL --progress-bar -o "${TMP_PKG}" "${PKG_URL}"

  echo "==> Installing (requires sudo; installs to ${TOOLCHAINS_DIR})"
  sudo installer -pkg "${TMP_PKG}" -target /
  rm -f "${TMP_PKG}"

  if [ ! -d "${XCTOOLCHAIN}" ]; then
    echo "error: expected ${XCTOOLCHAIN} after install but it is missing." >&2
    echo "       (A newer .pkg may use a different tag; check ${TOOLCHAINS_DIR}.)" >&2
    exit 1
  fi
fi

# --- 2. Point swift-latest at it -------------------------------------------
echo "==> Linking swift-latest.xctoolchain -> ${SWIFT_TAG}.xctoolchain"
sudo ln -sfn "${XCTOOLCHAIN}" "${LATEST_LINK}"

# --- 3. ~/bin wrappers so it wins on PATH ----------------------------------
# Thin wrappers exec the toolchain binaries directly, so no shell-profile edit
# is needed for interactive use.
mkdir -p "${BIN_DIR}"
for tool in swift swiftc; do
  wrapper="${BIN_DIR}/${tool}"
  printf '#!/bin/sh\nexec %s/usr/bin/%s "$@"\n' "${LATEST_LINK}" "${tool}" > "${wrapper}"
  chmod 755 "${wrapper}"
  echo "==> Wrote ${wrapper}"
done

# --- 4. Verify -------------------------------------------------------------
echo "==> Verifying via ${LATEST_LINK}"
"${LATEST_LINK}/usr/bin/swift" --version

cat <<EOF

Done. Swift ${SWIFT_VERSION} is installed and wrapped in ${BIN_DIR}.

For interactive use, ensure ${BIN_DIR} precedes any other Swift on PATH:

  swift --version     # expect ${SWIFT_VERSION}

For builds that do NOT inherit an interactive PATH (CI, launchd, sanitized
environments), select the toolchain explicitly instead. This is
PATH-independent, and pins an exact version rather than following the
swift-latest symlink:

  TOOLCHAINS=org.swift.612202505261a cargo build
EOF
