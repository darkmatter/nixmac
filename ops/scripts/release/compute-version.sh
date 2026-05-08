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
#   mode     - "tag" | "release" | "develop" | "branch"
#   version  - computed version string (empty for branch mode)
#   tag      - computed tag string (empty for branch mode)

MODE="branch"
VERSION=""
TAG=""

if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
	MODE="tag"
	VERSION="${GITHUB_REF_NAME#v}"
	TAG="$GITHUB_REF_NAME"
elif [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" == "refs/heads/main" ]]; then
	MODE="release"
	BASE=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "")
	if [[ -z "$BASE" ]]; then
		BASE=$(node -p "require('./package.json').version")
		echo "No tags found — bumping from package.json version $BASE"
	fi
	IFS='.' read -r MAJ MIN PAT <<<"$BASE"
	PAT=$((PAT + 1))
	VERSION="${MAJ}.${MIN}.${PAT}"
	TAG="v${VERSION}"
elif [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" == "refs/heads/develop" ]]; then
	MODE="develop"
	BASE=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "")
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
