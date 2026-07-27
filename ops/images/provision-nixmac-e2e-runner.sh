#!/bin/bash
set -euo pipefail

CUADRIVER_URL="https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.12.6/cua-driver-rs-0.12.6-darwin-arm64.tar.gz"
CUADRIVER_ARCHIVE_SHA256="c64017d5878d022df34137082fb918ae0d4304e28890569ff14458f1a54fd361"
CUADRIVER_EXECUTABLE_SHA256="eae725a09e0cdbda4bb37058a0393b86f7c97b5dda3769a10b1d79269ba8b334"
CUADRIVER_APP_TREE_SHA256="9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0"
CUADRIVER_VERSION="0.12.6"
CUADRIVER_BUNDLE_ID="com.trycua.driver"
CUADRIVER_TEAM_ID="YCK386LBJ7"
CUADRIVER_SIGNING_IDENTITY="Developer ID Application: Cua AI, Inc. (YCK386LBJ7)"
CUADRIVER_APP="/Applications/CuaDriver.app"
CUADRIVER_EXECUTABLE="$CUADRIVER_APP/Contents/MacOS/cua-driver"
CUADRIVER_CLI_SYMLINK="/usr/local/bin/cua-driver"
E2E_USER="nixmac_e2e"
E2E_PASSWORD="nixmac-e2e-local-only"
E2E_HOME="/Users/$E2E_USER"
STAGING_ROOT="/private/tmp/nixmac-e2e-image-provision"

if [ "$(id -u)" -ne 0 ]; then
  echo "provisioner must run as root" >&2
  exit 1
fi

cleanup() {
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT
rm -rf "$STAGING_ROOT"
mkdir -p "$STAGING_ROOT"

archive="$STAGING_ROOT/CuaDriver.tar.gz"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$archive" "$CUADRIVER_URL"
actual_archive_sha="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
test "$actual_archive_sha" = "$CUADRIVER_ARCHIVE_SHA256"

/usr/bin/tar -xzf "$archive" -C "$STAGING_ROOT"
staged_app="$(
  /usr/bin/find "$STAGING_ROOT" -type d -name CuaDriver.app -maxdepth 3 -print -quit
)"
test -n "$staged_app"
staged_executable="$staged_app/Contents/MacOS/cua-driver"
test -x "$staged_executable"
actual_executable_sha="$(/usr/bin/shasum -a 256 "$staged_executable" | /usr/bin/awk '{print $1}')"
test "$actual_executable_sha" = "$CUADRIVER_EXECUTABLE_SHA256"

actual_tree_sha="$(
  /usr/bin/python3 - "$staged_app" <<'PY'
import hashlib
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    relative = path.relative_to(root).as_posix().encode()
    body = path.read_bytes()
    digest.update(relative)
    digest.update(b"\0")
    digest.update(str(len(body)).encode())
    digest.update(b"\0")
    digest.update(body)
    digest.update(b"\0")
print(digest.hexdigest())
PY
)"
test "$actual_tree_sha" = "$CUADRIVER_APP_TREE_SHA256"

/usr/bin/codesign --verify --deep --strict --verbose=2 "$staged_app"
codesign_details="$(/usr/bin/codesign -dvv "$staged_app" 2>&1)"
/usr/bin/grep -Fq "Identifier=$CUADRIVER_BUNDLE_ID" <<<"$codesign_details"
/usr/bin/grep -Fq "TeamIdentifier=$CUADRIVER_TEAM_ID" <<<"$codesign_details"
authority="$(/usr/bin/codesign -dvvv "$staged_app" 2>&1 | /usr/bin/sed -n 's/^Authority=//p' | /usr/bin/head -1)"
test "$authority" = "$CUADRIVER_SIGNING_IDENTITY"
short_version="$(/usr/bin/defaults read "$staged_app/Contents/Info" CFBundleShortVersionString)"
build_version="$(/usr/bin/defaults read "$staged_app/Contents/Info" CFBundleVersion)"
test "$short_version" = "$CUADRIVER_VERSION"
test "$build_version" = "$CUADRIVER_VERSION"

rm -rf "$CUADRIVER_APP"
/usr/bin/ditto --rsrc --extattr "$staged_app" "$CUADRIVER_APP"
/usr/sbin/chown -R root:wheel "$CUADRIVER_APP"
/bin/chmod -R go-w "$CUADRIVER_APP"
/bin/mkdir -p /usr/local/bin /usr/local/libexec
/bin/rm -f "$CUADRIVER_CLI_SYMLINK"
/bin/ln -s "$CUADRIVER_EXECUTABLE" "$CUADRIVER_CLI_SYMLINK"
test "$(/usr/bin/stat -f '%Y' "$CUADRIVER_CLI_SYMLINK")" = "$CUADRIVER_EXECUTABLE"

if ! /usr/bin/id "$E2E_USER" >/dev/null 2>&1; then
  /usr/sbin/sysadminctl -addUser "$E2E_USER" \
    -fullName "nixmac E2E" \
    -password "$E2E_PASSWORD" \
    -home "$E2E_HOME"
fi
/usr/bin/dscl . -create "/Users/$E2E_USER" IsHidden 1
/usr/bin/dscl . -create "/Users/$E2E_USER" NFSHomeDirectory "$E2E_HOME"
/usr/sbin/chown -R "$E2E_USER":staff "$E2E_HOME"
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.SetupAssistant DidSeeCloudSetup -bool true
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.SetupAssistant DidSeeAppearanceSetup -bool true
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.SetupAssistant DidSeePrivacy -bool true
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.screensaver idleTime -int 0
/usr/bin/sudo -u "$E2E_USER" /usr/sbin/sysadminctl \
  -screenLock off -password "$E2E_PASSWORD"
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.screensaver askForPassword -int 0
/usr/bin/sudo -u "$E2E_USER" /usr/bin/defaults write \
  com.apple.screensaver askForPasswordDelay -int 2147483647

# The password is a public, VM-local fixture credential, not a production
# credential. Cilicon uses this same non-personal account for SSH and the Aqua
# session so UI permissions cannot leak from a person's account.
/usr/bin/defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "$E2E_USER"
/usr/bin/python3 - "$E2E_PASSWORD" > /etc/kcpassword <<'PY'
import itertools
import sys

password = (sys.argv[1] + "\0").encode()
key = bytes([0x7D, 0x89, 0x52, 0x23, 0xD2, 0xBC, 0xDD, 0xEA, 0xA3, 0xB9, 0x1F])
padding = (-len(password)) % 12
password += b"\0" * padding
sys.stdout.buffer.write(bytes(value ^ key[index % len(key)] for index, value in enumerate(password)))
PY
/usr/sbin/chown root:wheel /etc/kcpassword
/bin/chmod 600 /etc/kcpassword

if ! command -v /opt/homebrew/bin/brew >/dev/null 2>&1; then
  echo "qualified base image is missing Homebrew" >&2
  exit 1
fi
/usr/bin/su - admin -c \
  '/opt/homebrew/bin/brew install ffmpeg jq node python@3.13'
/bin/mkdir -p /etc/paths.d
/usr/bin/printf '%s\n' /opt/homebrew/bin /opt/homebrew/sbin \
  > /etc/paths.d/nixmac-e2e-homebrew
/usr/sbin/chown root:wheel /etc/paths.d/nixmac-e2e-homebrew
/bin/chmod 0644 /etc/paths.d/nixmac-e2e-homebrew
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

tcc_db="/Library/Application Support/com.apple.TCC/TCC.db"
test -f "$tcc_db" && test ! -L "$tcc_db"
for column in \
  service \
  client_type \
  client \
  auth_value \
  auth_reason \
  auth_version \
  csreq \
  indirect_object_identifier_type \
  indirect_object_identifier; do
  /usr/bin/sqlite3 "$tcc_db" 'PRAGMA table_info(access);' |
    /usr/bin/awk -F '|' -v expected="$column" '$2 == expected {found=1} END {exit !found}'
done
designated_requirement="$(
  /usr/bin/codesign -dr - "$CUADRIVER_APP" 2>&1 |
    /usr/bin/sed -n 's/^designated => //p'
)"
test -n "$designated_requirement"
csreq_path="$STAGING_ROOT/CuaDriver.csreq"
/usr/bin/csreq -r "$designated_requirement" -b "$csreq_path"
for service in kTCCServiceAccessibility kTCCServiceScreenCapture; do
  /usr/bin/sqlite3 "$tcc_db" \
    "INSERT OR REPLACE INTO access (service,client_type,client,auth_value,auth_reason,auth_version,csreq,indirect_object_identifier_type,indirect_object_identifier) VALUES ('$service',0,'$CUADRIVER_BUNDLE_ID',2,4,1,readfile('$csreq_path'),NULL,'UNUSED');"
done

/bin/mkdir -p /var/db/nixmac-e2e /var/db/nixmac-e2e/evidence
/usr/sbin/chown -R "$E2E_USER":staff /var/db/nixmac-e2e
/bin/chmod 0700 /var/db/nixmac-e2e /var/db/nixmac-e2e/evidence

for tool in git jq ffmpeg node python3 xcrun xcodebuild; do
  command -v "$tool" >/dev/null
done
test -x "$CUADRIVER_EXECUTABLE"
test -L "$CUADRIVER_CLI_SYMLINK"

rm -rf /Users/admin/Library/Caches/Homebrew || true
