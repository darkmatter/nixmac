#!/usr/bin/env bash
set -euo pipefail

# Compute release mode, version, and tag from git/github state.
#
# Required env vars:
#   GITHUB_REF         - e.g. refs/tags/v1.2.3 or refs/heads/main
#   GITHUB_REF_NAME    - short ref name
#   GITHUB_EVENT_NAME  - push, pull_request, workflow_dispatch
#
# Outputs (via GITHUB_OUTPUT if set):
#   mode     - "tag" | "develop" | "branch"
#   version  - computed version string (empty for branch mode)
#   tag      - computed tag string (empty for branch mode)
#
# Channel mapping:
#   - tag push (refs/tags/v*) → stable channel (manual release)
#   - push to main            → develop channel (continuous builds)
#   - PR / other              → build-only

MODE="branch"
VERSION=""
TAG=""

# Match only stable vMAJ.MIN.PAT tags when deriving the next bump. Disposable
# prerelease tags like `v0.22.0-test.1` would otherwise poison the arithmetic
# bump below.
STABLE_TAG_MATCH='v[0-9]*.[0-9]*.[0-9]*'
STABLE_TAG_REGEX='^v[0-9]+\.[0-9]+\.[0-9]+$'

latest_stable_tag() {
	# `git describe --abbrev=0` returns the nearest tag in commit topology, not
	# the highest SemVer tag. If two tags point at the same commit (`v0.27.0` and
	# a mistaken `v0.24.10`), `git describe` can choose the lower one and every
	# main push will keep bumping the wrong line. Sort all reachable stable tags
	# semantically and take the highest one instead.
	git tag --merged "${1:-HEAD}" --list "$STABLE_TAG_MATCH" --sort=-v:refname 2>/dev/null | grep -E "$STABLE_TAG_REGEX" | head -n1 || true
}

version_gt() {
	node - "$1" "$2" <<'NODE'
const [a, b] = process.argv.slice(2).map((version) => version.split(".").map((part) => Number.parseInt(part, 10)));
for (let index = 0; index < 3; index += 1) {
  if ((a[index] || 0) > (b[index] || 0)) process.exit(0);
  if ((a[index] || 0) < (b[index] || 0)) process.exit(1);
}
process.exit(1);
NODE
}

base_version() {
	local latest package_version base
	latest="$(latest_stable_tag HEAD | sed 's/^v//')"
	package_version="$(node -p "require('./package.json').version" 2>/dev/null || echo "")"
	base="$latest"
	if [[ -n "$package_version" && "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && { [[ -z "$base" ]] || version_gt "$package_version" "$base"; }; then
		base="$package_version"
		echo "Using package.json version $package_version as release floor" >&2
	fi
	echo "$base"
}

if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
	MODE="tag"
	VERSION="${GITHUB_REF_NAME#v}"
	TAG="$GITHUB_REF_NAME"
elif [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" == "refs/heads/main" ]]; then
	# Push to main → develop channel. The stable channel only updates from a
	# manually-created tag release, so every commit on main (including
	# multiple commits between releases) lands on the develop channel and is
	# picked up by users on the develop update track.
	MODE="develop"
	BASE=$(base_version)
	if [[ -z "$BASE" ]]; then
		BASE=$(node -p "require('./package.json').version")
		echo "No tags found — using package.json version $BASE as develop base"
	fi
	IFS='.' read -r MAJ MIN PAT <<<"$BASE"
	PAT=$((PAT + 1))
	VERSION="${MAJ}.${MIN}.${PAT}-develop.${GITHUB_RUN_NUMBER:-0}"
fi

echo "Computed: mode=$MODE version=$VERSION tag=$TAG"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "mode=$MODE"
		echo "version=$VERSION"
		echo "tag=$TAG"
	} >>"$GITHUB_OUTPUT"
fi
