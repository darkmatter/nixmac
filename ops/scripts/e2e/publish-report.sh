#!/usr/bin/env bash
set -euo pipefail

# Publish Computer Use E2E HTML report to gh-pages branch.
#
# Required env vars:
#   GH_TOKEN           - GitHub token for pushing
#   REPORT_DIR         - Local directory containing the report
#   REPORT_PREFIX      - Path prefix (e.g. computer-use-e2e/pr-123)
#   PUBLISH_PATH       - Full path for this run's report
#   LATEST_PATH        - Path for the "latest" symlink
#   RUN_ASSET_BASE_URL - Base URL for CDN assets
#   RETENTION_KEEP_RUNS - Number of run reports to keep (default: 20)
# Optional env vars:
#   GITHUB_OUTPUT      - If set, write index_url and latest_index_url
#   GITHUB_REPOSITORY  - For remote URL
#   GITHUB_RUN_ID      - For commit message
#   INDEX_URL, LATEST_INDEX_URL - Pre-computed URLs
#   PR_NUMBER          - For commit message

site_dir="$(mktemp -d)"
git -C "$site_dir" init -q
git -C "$site_dir" config user.name "github-actions[bot]"
git -C "$site_dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$site_dir" remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

if git -C "$site_dir" fetch --depth=1 origin gh-pages; then
	git -C "$site_dir" checkout -q -B gh-pages FETCH_HEAD
else
	git -C "$site_dir" checkout -q --orphan gh-pages
fi

mkdir -p "$site_dir/${PUBLISH_PATH:?}" "$site_dir/${LATEST_PATH:?}"
rm -rf "$site_dir/${PUBLISH_PATH:?}" "$site_dir/${LATEST_PATH:?}"
mkdir -p "$site_dir/${PUBLISH_PATH:?}" "$site_dir/${LATEST_PATH:?}"
cp -a "$REPORT_DIR"/. "$site_dir/${PUBLISH_PATH:?}"/
cp -a "$REPORT_DIR"/. "$site_dir/${LATEST_PATH:?}"/

RUN_ASSET_BASE_URL="$RUN_ASSET_BASE_URL" perl -0pi -e 's#<head>#<head>\n<base href="$ENV{RUN_ASSET_BASE_URL}">#' "$site_dir/${PUBLISH_PATH:?}/index.html"
RUN_ASSET_BASE_URL="$RUN_ASSET_BASE_URL" perl -0pi -e 's#<head>#<head>\n<base href="$ENV{RUN_ASSET_BASE_URL}">#' "$site_dir/${LATEST_PATH:?}/index.html"

if [[ -n "${REPORT_PREFIX:-}" && -d "$site_dir/$REPORT_PREFIX" ]]; then
	find "$site_dir/$REPORT_PREFIX" -mindepth 1 -maxdepth 1 -type d -name 'run-*' |
		sort -r |
		tail -n +"$((RETENTION_KEEP_RUNS + 1))" |
		while IFS= read -r old_report; do
			rm -rf "$old_report"
		done
fi

touch "$site_dir/.nojekyll"
git -C "$site_dir" add -A .nojekyll "$REPORT_PREFIX"
if git -C "$site_dir" diff --cached --quiet; then
	echo "No GitHub Pages report changes to publish."
else
	git -C "$site_dir" commit -q -m "Publish Computer Use E2E report for PR #${PR_NUMBER:-0} run ${GITHUB_RUN_ID:-0}"
	git -C "$site_dir" push -q origin gh-pages
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "index_url=${INDEX_URL:-}"
		echo "latest_index_url=${LATEST_INDEX_URL:-}"
	} >>"$GITHUB_OUTPUT"
fi
