#!/usr/bin/env bash
set -euo pipefail

# Collect Computer Use E2E report metadata into GitHub Actions outputs.
#
# Optional env vars:
#   REPORT_ROOT    - Root directory for report artifacts
#   GITHUB_OUTPUT  - If set, write outputs
#   GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY - For URL generation
#   GITHUB_EVENT_NAME, PR_NUMBER - For path prefix

REPORT_ROOT="${REPORT_ROOT:-artifacts/computer-use-remote}"
latest_report="$(find "$REPORT_ROOT" -mindepth 2 -maxdepth 2 -name state.json -type f -exec dirname {} \; 2>/dev/null | sort | tail -1 || true)"

OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
echo "has_report=false" >>"$OUTPUT"
if [[ -z "$latest_report" || ! -f "$latest_report/state.json" ]]; then
	exit 0
fi

verdict="$(jq -r '.verdict // "unknown"' "$latest_report/state.json")"
pass_count="$(jq -r '[.scenarios[]? | select(.status == "pass")] | length' "$latest_report/state.json")"
fail_count="$(jq -r '[.scenarios[]? | select(.status == "fail")] | length' "$latest_report/state.json")"
inconclusive_count="$(jq -r '[.scenarios[]? | select(.status == "inconclusive")] | length' "$latest_report/state.json")"
report_slug="$(basename "$latest_report")"

if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
	report_prefix="computer-use-e2e/pr-${PR_NUMBER:-0}"
else
	report_prefix="computer-use-e2e/manual"
fi
publish_path="${report_prefix}/run-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
latest_path="${report_prefix}/latest"
html_preview_base="https://htmlpreview.github.io/?https://github.com/${GITHUB_REPOSITORY:-repo}/blob/gh-pages"

{
	echo "has_report=true"
	echo "report_dir=$latest_report"
	echo "report_slug=$report_slug"
	echo "verdict=$verdict"
	echo "pass=$pass_count"
	echo "fail=$fail_count"
	echo "inconclusive=$inconclusive_count"
	echo "report_prefix=$report_prefix"
	echo "publish_path=$publish_path"
	echo "latest_path=$latest_path"
	echo "index_url=${html_preview_base}/${publish_path}/index.html"
	echo "latest_index_url=${html_preview_base}/${latest_path}/index.html"
} >>"$OUTPUT"
