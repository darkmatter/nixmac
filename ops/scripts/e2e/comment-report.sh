#!/usr/bin/env bash
set -euo pipefail

# Post or update an evidence report comment on a pull request.
#
# Required env vars:
#   GH_TOKEN             - GitHub token
#   PR_NUMBER            - PR number to comment on
#   VERDICT              - Test verdict
#   PASS_COUNT           - Number of passing scenarios
#   FAIL_COUNT           - Number of failing scenarios
#   INCONCLUSIVE_COUNT   - Number of inconclusive scenarios
#   INDEX_URL            - URL to the hosted HTML report
#   LATEST_INDEX_URL     - URL to the latest report alias
#   ARTIFACT_URL         - URL to the Actions artifact backup
#   RUN_URL              - URL to the Actions run

marker="<!-- nixmac-computer-use-e2e-report -->"
status_label="$(tr '[:lower:]' '[:upper:]' <<<"$VERDICT")"
body_file="$(mktemp)"
cat >"$body_file" <<EOF
$marker
### nixmac Computer Use E2E: \`$status_label\`

- Result: \`$PASS_COUNT pass / $FAIL_COUNT fail / $INCONCLUSIVE_COUNT inconclusive\`
- Hosted HTML report: $INDEX_URL
- Latest report alias: $LATEST_INDEX_URL
- Actions run: $RUN_URL
- Artifact backup: $ARTIFACT_URL

The hosted report contains pass/fail state, screenshots, a screenshot-compilation video, annotations, text evidence, and remote Mac/app metadata. V1 report links use the htmlpreview.github.io shim over the public gh-pages report branch; the Actions artifact backup is retained for 14 days.
EOF

body_json="$(mktemp)"
jq -Rs '{body: .}' "$body_file" >"$body_json"

comment_id="$(
	gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate \
		--jq ".[] | select(.body | contains(\"$marker\")) | .id" | tail -1
)"

if [[ -n "$comment_id" ]]; then
	gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${comment_id}" --input "$body_json" >/dev/null
else
	gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --input "$body_json" >/dev/null
fi
