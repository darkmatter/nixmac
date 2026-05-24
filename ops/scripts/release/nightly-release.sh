#!/usr/bin/env bash
set -euo pipefail

# Nightly release: merge develop → main and tag a minor version bump.
#
# Designed to run from a GitHub Actions cron, but works locally too:
#
#   bash ops/scripts/release/nightly-release.sh              # do it
#   DRY_RUN=1 bash ops/scripts/release/nightly-release.sh    # show what would happen
#
# Behavior:
#   1. Fetch origin
#   2. If no changes between main and develop affect the `native` build graph
#      (equivalent of `turbo run build --affected --filter=native`), log a
#      one-line "nothing to release" message and exit 0 — see should_release()
#   3. Compute next minor version from latest stable v* tag (vMAJ.(MIN+1).0)
#   4. Fast-forward / no-ff merge develop into main locally
#   5. Tag the merge commit with vMAJ.(MIN+1).0
#   6. Push main + tag atomically
#   7. The tag push triggers build.yaml's `tag` mode and ships
#
# Required env (CI sets these; local runs use your git creds):
#   GIT_USER_NAME, GIT_USER_EMAIL  - committer identity for the merge commit

DRY_RUN="${DRY_RUN:-0}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
DEVELOP_BRANCH="${DEVELOP_BRANCH:-develop}"

# Repo root resolved from this script's location so the script works from
# any cwd (CI checkouts may invoke it from arbitrary directories).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

run() {
	if [[ "$DRY_RUN" == "1" ]]; then
		echo "DRY: $*"
	else
		echo "+ $*"
		"$@"
	fi
}

# -----------------------------------------------------------------------------
# should_release: release only if a change between main and develop would
# invalidate the `native` workspace's build — the no-turbo equivalent of
#
#   turbo run build --affected --filter=native
#
# This skips nights where develop only got changes outside the native build
# graph (CI tweaks, docs, unrelated packages, release scripts themselves)
# so we don't burn a minor version on commits that wouldn't ship anything
# different to users.
#
# The path set (native + transitive workspace deps + global build inputs)
# is resolved at runtime by ops/scripts/release/affected-paths.mjs so adding
# new workspaces or workspace:* deps doesn't require updating this script.
#
# Returns 0 to release, 1 to skip (caller logs the skip reason).
should_release() {
	local changed paths file path

	changed=$(git diff --name-only "origin/${MAIN_BRANCH}..origin/${DEVELOP_BRANCH}")
	if [[ -z "$changed" ]]; then
		return 1
	fi

	paths=$(node "${REPO_ROOT}/ops/scripts/release/affected-paths.mjs" --filter=native)

	# Prefix-match each changed file against each affected path. Directory
	# entries from affected-paths.mjs end with "/" so "packages/ui/" won't
	# accidentally match "packages/ui-experimental/...".
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		while IFS= read -r path; do
			[[ -z "$path" ]] && continue
			if [[ "$path" == */ ]]; then
				# Directory prefix
				[[ "$file" == "$path"* ]] && return 0
			else
				# Exact file match (root globals)
				[[ "$file" == "$path" ]] && return 0
			fi
		done <<<"$paths"
	done <<<"$changed"

	return 1
}

# -----------------------------------------------------------------------------
# Everything below this line is mechanical — no judgment calls required.

next_minor_version() {
	local base maj min
	# Use --sort=-version:refname so the *highest* version wins, not the
	# tag closest to main's first-parent history. (Hotfix tags like v0.23.1
	# can live on a release line that's merged-by-merge into main, where
	# `git describe` would walk past them to an older base.)
	#
	# Filter to stable SemVer release tags (vMAJ.MIN.PATCH only): the repo
	# uses `-test.N` suffixed tags for disposable signing/notarization
	# rehearsals (see build.yaml's `-test.` skip in the GitHub Release /
	# R2 upload / Linear sync steps). If a `-test.42` tag sorted highest,
	# we'd bump from an unpublished version.
	base=$(git tag --list 'v[0-9]*' --sort=-version:refname |
		grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' |
		head -n1 | sed 's/^v//')
	if [[ -z "$base" ]]; then
		# Fall back to root package.json if no tags yet
		base=$(node -p "require('./package.json').version")
		echo "No v* tags found — bumping from package.json version $base" >&2
	fi
	IFS='.' read -r maj min _ <<<"$base"
	echo "${maj}.$((min + 1)).0"
}

main() {
	# Configure committer if provided (CI passes these via env)
	if [[ -n "${GIT_USER_NAME:-}" ]]; then
		run git config user.name "$GIT_USER_NAME"
	fi
	if [[ -n "${GIT_USER_EMAIL:-}" ]]; then
		run git config user.email "$GIT_USER_EMAIL"
	fi

	run git fetch origin --tags --prune "${MAIN_BRANCH}" "${DEVELOP_BRANCH}"

	if ! should_release; then
		echo "Nothing to release — no changes between ${MAIN_BRANCH} and ${DEVELOP_BRANCH} affect the native build graph. Exiting cleanly."
		exit 0
	fi

	local version tag
	version=$(next_minor_version)
	tag="v${version}"
	echo "Next minor version: ${tag}"

	# Refuse to overwrite an existing tag (idempotency safety)
	if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
		echo "Tag ${tag} already exists locally — aborting to avoid overwrite." >&2
		exit 1
	fi
	# Use --exit-code with an exact ref pattern (not a fnmatch) so the check
	# can't false-positive on a longer tag — e.g. asking about v1.2.0 would
	# otherwise match v1.2.0-test.1 if we grepped the output.
	if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
		echo "Tag ${tag} already exists on origin — aborting." >&2
		exit 1
	fi

	# Check out main and merge develop. --no-ff keeps a merge commit so the
	# release boundary is visible in `git log --first-parent main`.
	run git checkout "${MAIN_BRANCH}"
	run git reset --hard "origin/${MAIN_BRANCH}"
	run git merge --no-ff --no-edit \
		-m "release: merge develop for ${tag}" \
		"origin/${DEVELOP_BRANCH}"

	run git tag -a "${tag}" -m "Release ${tag}"

	# Push main first so the tag points at a commit reachable from main.
	# atomic ensures both refs update together; partial state is impossible.
	run git push --atomic origin "${MAIN_BRANCH}" "refs/tags/${tag}"

	echo "Released ${tag}"
}

main "$@"
