#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/compute-version.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/repository"
cd "$TMP_DIR/repository"
git init --quiet
git config user.name 'Release test'
git config user.email 'release-test@example.invalid'
printf '{"version":"1.2.3"}\n' >package.json
git add package.json
git -c commit.gpgsign=false commit --quiet -m fixture
git tag v1.2.3

check_version() {
	local event="$1" ref="$2" expected_mode="$3" expected_version="$4" expected_tag="$5"
	local output="$TMP_DIR/output"
	: >"$output"
	GITHUB_EVENT_NAME="$event" GITHUB_REF="$ref" GITHUB_REF_NAME="${ref##*/}" \
		GITHUB_RUN_NUMBER=42 GITHUB_OUTPUT="$output" bash "$SCRIPT" >/dev/null
	grep -Fx "mode=$expected_mode" "$output" >/dev/null
	grep -Fx "version=$expected_version" "$output" >/dev/null
	grep -Fx "tag=$expected_tag" "$output" >/dev/null
}

# Every manual ref remains build-only, including a stable release tag.
check_version workflow_dispatch refs/tags/v1.2.3 branch '' ''
check_version workflow_dispatch refs/heads/main branch '' ''
check_version workflow_dispatch refs/heads/feature branch '' ''
check_version pull_request refs/pull/123/merge branch '' ''
check_version merge_group refs/heads/gh-readonly-queue/main/test branch '' ''
# Automatic publication keeps its existing version/channel behavior.
check_version push refs/tags/v1.2.3 tag 1.2.3 v1.2.3
check_version push refs/heads/main develop 1.2.4-develop.42 ''

echo 'compute-version event and publication tests passed'
