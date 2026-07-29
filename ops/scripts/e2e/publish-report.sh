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
#   UPDATE_LATEST      - Whether to replace the latest alias (default: true)
#   STORYBOOK_DIR      - Storybook static site to publish beneath the report

update_latest="${UPDATE_LATEST:-true}"
retention_keep_runs="${RETENTION_KEEP_RUNS:-20}"
case "$update_latest" in
true | false) ;;
*)
	echo "UPDATE_LATEST must be true or false" >&2
	exit 1
	;;
esac
if [[ ! "$retention_keep_runs" =~ ^[1-9][0-9]*$ ]]; then
	echo "RETENTION_KEEP_RUNS must be a positive integer" >&2
	exit 1
fi

storybook_published=false

publish_attempt() {
	local site_dir
	site_dir="$(mktemp -d)" || return
	git -C "$site_dir" init -q || return
	git -C "$site_dir" config user.name "github-actions[bot]" || return
	git -C "$site_dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com" || return
	git -C "$site_dir" remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" || return

	if git -C "$site_dir" fetch --depth=1 origin gh-pages; then
		git -C "$site_dir" checkout -q -B gh-pages FETCH_HEAD || return
	else
		git -C "$site_dir" checkout -q --orphan gh-pages || return
	fi

	rm -rf "$site_dir/${PUBLISH_PATH:?}" || return
	mkdir -p "$site_dir/${PUBLISH_PATH:?}" || return
	cp -a "$REPORT_DIR"/. "$site_dir/${PUBLISH_PATH:?}"/ || return

	RUN_ASSET_BASE_URL="$RUN_ASSET_BASE_URL" perl -0pi -e 's#<head>#<head>\n<base href="$ENV{RUN_ASSET_BASE_URL}">#' "$site_dir/${PUBLISH_PATH:?}/index.html" || return
	if [[ "$update_latest" == "true" ]]; then
		rm -rf "$site_dir/${LATEST_PATH:?}" || return
		mkdir -p "$site_dir/${LATEST_PATH:?}" || return
		cp -a "$REPORT_DIR"/. "$site_dir/${LATEST_PATH:?}"/ || return
		RUN_ASSET_BASE_URL="$RUN_ASSET_BASE_URL" perl -0pi -e 's#<head>#<head>\n<base href="$ENV{RUN_ASSET_BASE_URL}">#' "$site_dir/${LATEST_PATH:?}/index.html" || return
	fi

	if [[ -n "${STORYBOOK_DIR:-}" && -d "$STORYBOOK_DIR" ]]; then
		rm -rf "$site_dir/${PUBLISH_PATH:?}/storybook" || return
		cp -a "$STORYBOOK_DIR" "$site_dir/${PUBLISH_PATH:?}/storybook" || return
		if [[ "$update_latest" == "true" ]]; then
			rm -rf "$site_dir/${LATEST_PATH:?}/storybook" || return
			cp -a "$STORYBOOK_DIR" "$site_dir/${LATEST_PATH:?}/storybook" || return
		fi
		storybook_published=true
	fi

	if [[ -n "${REPORT_PREFIX:-}" && -d "$site_dir/$REPORT_PREFIX" ]]; then
		find "$site_dir/$REPORT_PREFIX" -mindepth 1 -maxdepth 1 -type d -name 'run-*' |
			sort -r |
			tail -n +"$((retention_keep_runs + 1))" |
			while IFS= read -r old_report; do
				rm -rf "$old_report" || exit
			done || return
	fi

	touch "$site_dir/.nojekyll" || return
	git -C "$site_dir" add -A .nojekyll "$REPORT_PREFIX" || return
	if git -C "$site_dir" diff --cached --quiet; then
		echo "No GitHub Pages report changes to publish."
		return 0
	fi

	git -C "$site_dir" commit -q -m "Publish Computer Use E2E report for PR #${PR_NUMBER:-0} run ${GITHUB_RUN_ID:-0}" || return
	git -C "$site_dir" push -q origin gh-pages
}

published=false
for attempt in {1..8}; do
	if publish_attempt; then
		published=true
		break
	fi
	echo "Report publication attempt failed; retrying from the latest gh-pages branch (attempt $attempt of 8)." >&2
	sleep "$attempt"
done
if [[ "$published" != "true" ]]; then
	echo "Unable to publish the report after 8 attempts." >&2
	exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "index_url=${INDEX_URL:-}"
		if [[ "$update_latest" == "true" ]]; then
			echo "latest_index_url=${LATEST_INDEX_URL:-}"
		else
			echo "latest_index_url="
		fi
		echo "latest_updated=$update_latest"
		if [[ "$storybook_published" == "true" ]]; then
			echo "storybook_index_url=${RUN_ASSET_BASE_URL}storybook/index.html"
		fi
	} >>"$GITHUB_OUTPUT"
fi
