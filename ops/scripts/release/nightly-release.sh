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
#   2. If develop has no new commits vs main → exit 0 silently
#   3. Compute next minor version from latest v* tag (vMAJ.(MIN+1).0)
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

run() {
	if [[ "$DRY_RUN" == "1" ]]; then
		echo "DRY: $*"
	else
		echo "+ $*"
		"$@"
	fi
}

# -----------------------------------------------------------------------------
# should_release: decide whether there is enough new work on develop to release.
#
# Returns 0 if a release should happen, 1 if it should be skipped silently.
#
# The naive answer is "any commit on develop that isn't on main". But that
# counts auto-generated merges, docs-only fixups, dependency bumps, version
# sync commits, etc. — things that don't justify shipping a new build to users
# and burning a minor version number.
#
# Policy: any commit on develop ahead of main triggers a release. Simple,
# predictable, no commit-message conventions or path heuristics to maintain.
# If junk releases pile up, tighten this to filter chore/docs commits or
# require a minimum threshold.
should_release() {
	local ahead
	ahead=$(git rev-list --count "origin/${MAIN_BRANCH}..origin/${DEVELOP_BRANCH}")
	[[ "$ahead" -gt 0 ]]
}

# -----------------------------------------------------------------------------
# Everything below this line is mechanical — no judgment calls required.

next_minor_version() {
	local base maj min
	# Use --sort=-version:refname so the *highest* version wins, not the
	# tag closest to main's first-parent history. (Hotfix tags like v0.23.1
	# can live on a release line that's merged-by-merge into main, where
	# `git describe` would walk past them to an older base.)
	base=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -n1 | sed 's/^v//')
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
		echo "Nothing to release — develop has no new work vs ${MAIN_BRANCH}. Exiting cleanly."
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
	if git ls-remote --tags origin "refs/tags/${tag}" | grep -q "${tag}"; then
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
