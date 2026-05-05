#!/usr/bin/env bash
set -euo pipefail

# Fetch test artifacts (video, log, results, screenshots) from remote Mac via SCP.
#
# Required env vars:
#   MAC_E2E_USER  - SSH user
#   MAC_E2E_HOST  - SSH host

SCP="scp -o StrictHostKeyChecking=no -i ~/.ssh/e2e_key"
HOST="${MAC_E2E_USER}@${MAC_E2E_HOST}"
mkdir -p artifacts

$SCP "$HOST:/tmp/e2e-recording.mp4" artifacts/ 2>/dev/null || true
$SCP "$HOST:/tmp/e2e-test.log" artifacts/ 2>/dev/null || true
$SCP "$HOST:/tmp/e2e-test-results.json" artifacts/ 2>/dev/null || true
ssh -o StrictHostKeyChecking=no -i ~/.ssh/e2e_key "$HOST" \
	'ls /tmp/e2e-screenshots/*.png 2>/dev/null' | while read -r f; do
	$SCP "$HOST:$f" artifacts/ 2>/dev/null || true
done
