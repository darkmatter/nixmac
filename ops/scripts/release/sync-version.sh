#!/usr/bin/env bash
set -euo pipefail

# Sync versions across native app files, with stale-package.json guard for branch builds.
#
# Required env vars:
#   RELEASE_MODE          - "tag" | "release" | "branch" (from compute-version.sh)
#   RELEASE_VERSION       - computed version (from compute-version.sh, for tag/release)
#   GITHUB_SHA           - commit SHA (for branch build suffix)
#
# Optional env vars:
#   GITHUB_OUTPUT        - if set, write build_version output
#   GITHUB_ENV           - if set, export VERSION env var
#
# Outputs:
#   VERSION env var       - build version (may include -SHORT_SHA suffix for branch)
#   build_version output  - same, via GITHUB_OUTPUT

if [[ "$RELEASE_MODE" == "tag" || "$RELEASE_MODE" == "release" ]]; then
	VERSION="$RELEASE_VERSION"
	echo "$RELEASE_MODE build — syncing to version: $VERSION"
	node scripts/sync-versions.mjs "$VERSION"
	node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=process.argv[1];fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');" "$VERSION"
	BUILD_VERSION="$VERSION"
else
	PKG_VERSION=$(node -p "require('./package.json').version")
	LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "")

	_tag_is_newer() {
		node -e "
            const a = '$PKG_VERSION'.split('.').map(s => parseInt(s, 10));
            const b = '$LATEST_TAG'.split('.').map(s => parseInt(s, 10));
            for (let i = 0; i < 3; i++) {
                if ((b[i]||0) > (a[i]||0)) process.exit(0);
                if ((a[i]||0) > (b[i]||0)) process.exit(1);
            }
            process.exit(1);
        "
	}

	if [[ -n "$LATEST_TAG" ]] && _tag_is_newer; then
		echo "⚠️  package.json version ($PKG_VERSION) lags behind latest tag ($LATEST_TAG) — using tag version to prevent false-positive update banner"
		VERSION="$LATEST_TAG"
	else
		VERSION="$PKG_VERSION"
	fi
	echo "Branch/PR build — syncing to version: $VERSION"
	node scripts/sync-versions.mjs "$VERSION"
	SHORT_SHA=${GITHUB_SHA::8}
	BUILD_VERSION="${VERSION}-${SHORT_SHA}"
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
	echo "VERSION=$BUILD_VERSION" >>"$GITHUB_ENV"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	echo "build_version=$BUILD_VERSION" >>"$GITHUB_OUTPUT"
fi
