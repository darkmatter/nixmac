#!/usr/bin/env bash
set -euo pipefail

# Write E2E test results to GitHub Actions step summary.
#
# Required env vars:
#   SCENARIO  - Scenario name that was run
#
# Reads from:
#   artifacts/e2e-test-results.json  (preferred)
#   artifacts/e2e-test.log           (fallback)
#
# Writes to GITHUB_STEP_SUMMARY (or stdout if not set).

SCENARIO="${SCENARIO:-unknown}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

{
	echo "### E2E: ${SCENARIO}"
	echo ""
} >>"$SUMMARY"

if [ -f artifacts/e2e-test-results.json ]; then
	PASSED=$(jq -r '.passed' artifacts/e2e-test-results.json)
	FAILED=$(jq -r '.failed' artifacts/e2e-test-results.json)
	DURATION=$(jq -r '.duration_seconds' artifacts/e2e-test-results.json)

	{
		echo "| Phase | Status | Name |"
		echo "|-------|--------|------|"
		jq -r '.phases[] | "| \(.phase) | \(if .status == "PASS" then "✅" else "❌" end) | \(.message) |"' \
			artifacts/e2e-test-results.json
		echo ""
		echo "**Result:** $PASSED passed, $FAILED failed in ${DURATION}s"
	} >>"$SUMMARY"

elif [ -f artifacts/e2e-test.log ]; then
	grep -E '\[PASS\]|\[FAIL\]' artifacts/e2e-test.log |
		sed 's/\x1b\[[0-9;]*m//g' |
		while read -r line; do
			if echo "$line" | grep -q "PASS"; then
				echo "✅ ${line#*PASS] }" >>"$SUMMARY"
			else
				echo "❌ ${line#*FAIL] }" >>"$SUMMARY"
			fi
		done
else
	echo "⚠️ No test results found." >>"$SUMMARY"
fi

{
	echo ""
	echo "📹 Video and screenshots in workflow artifacts."
} >>"$SUMMARY"
