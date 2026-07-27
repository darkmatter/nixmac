#!/bin/bash
set -euo pipefail
umask 077

CILICON_VERSION="2.4.2"
CILICON_BUILD="25"
CILICON_URL="https://github.com/traderepublic/Cilicon/releases/download/v2.4.2/Cilicon_2.4.2_25_adhoc.zip"
CILICON_ARCHIVE_SHA256="b4886bc74d6c4a802b24ef3bc40afa894d8cc13e9c25a912fdc6940a1a79a17c"
CILICON_EXECUTABLE_SHA256="abe75f36668d6aa1198bb0f8f7757015d0bd9cd1bfb8306cfce0095940280a0c"
CILICON_APP_TREE_SHA256="0a85932dba08f046667a218683f714d1fdd1c799f7815c0ee917e52f7447d895"
CILICON_BUNDLE_ID="com.traderepublic.cilicon"
TARGET="/Applications/Cilicon.app"

if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 0 ]; then
  echo "usage: sudo install-cilicon-v2.4.2.sh" >&2
  exit 64
fi

staging="$(mktemp -d /private/tmp/nixmac-cilicon-install.XXXXXX)"
cleanup() {
  find "$staging" -depth -mindepth 1 -delete 2>/dev/null || true
  rmdir "$staging" 2>/dev/null || true
}
trap cleanup EXIT

archive="$staging/Cilicon.zip"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$archive" "$CILICON_URL"
test "$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')" = \
  "$CILICON_ARCHIVE_SHA256"
/usr/bin/ditto -x -k "$archive" "$staging/extracted"
app="$staging/extracted/Cilicon.app"
executable="$app/Contents/MacOS/Cilicon"
test -x "$executable"
test "$(/usr/bin/shasum -a 256 "$executable" | /usr/bin/awk '{print $1}')" = \
  "$CILICON_EXECUTABLE_SHA256"

tree_sha="$(
  /usr/bin/python3 - "$app" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    body = path.read_bytes()
    digest.update(path.relative_to(root).as_posix().encode())
    digest.update(b"\0")
    digest.update(str(len(body)).encode())
    digest.update(b"\0")
    digest.update(body)
    digest.update(b"\0")
print(digest.hexdigest())
PY
)"
test "$tree_sha" = "$CILICON_APP_TREE_SHA256"
/usr/bin/codesign --verify --deep --strict "$app"
details="$(/usr/bin/codesign -dvv "$app" 2>&1)"
/usr/bin/grep -Fq "Identifier=$CILICON_BUNDLE_ID" <<<"$details"
/usr/bin/grep -Fq "Signature=adhoc" <<<"$details"
test "$(/usr/bin/defaults read "$app/Contents/Info" CFBundleShortVersionString)" = \
  "$CILICON_VERSION"
test "$(/usr/bin/defaults read "$app/Contents/Info" CFBundleVersion)" = "$CILICON_BUILD"

if [ -e "$TARGET" ]; then
  existing_version="$(/usr/bin/defaults read "$TARGET/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  existing_sha="$(/usr/bin/shasum -a 256 "$TARGET/Contents/MacOS/Cilicon" 2>/dev/null | /usr/bin/awk '{print $1}')"
  if [ "$existing_version" = "$CILICON_VERSION" ] &&
    [ "$existing_sha" = "$CILICON_EXECUTABLE_SHA256" ]; then
    echo "Cilicon $CILICON_VERSION is already installed with the pinned executable."
    exit 0
  fi
  echo "refusing to overwrite a different Cilicon.app" >&2
  exit 73
fi

/usr/bin/ditto --rsrc --extattr "$app" "$TARGET"
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
/usr/sbin/chown -R root:wheel "$TARGET"
/bin/chmod -R go-w "$TARGET"
/usr/bin/codesign --verify --deep --strict "$TARGET"
test "$(/usr/bin/shasum -a 256 "$TARGET/Contents/MacOS/Cilicon" | /usr/bin/awk '{print $1}')" = \
  "$CILICON_EXECUTABLE_SHA256"
echo "Installed checksum-pinned Cilicon $CILICON_VERSION."
