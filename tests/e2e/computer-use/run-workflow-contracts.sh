#!/usr/bin/env bash
set -euo pipefail

node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs
node tests/e2e/computer-use/workflow-contract-self-test.mjs
node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs
node tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs
node tests/e2e/computer-use/private-evidence-storage-self-test.mjs
node tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/verification-contract-self-test.mjs
node tests/e2e/computer-use/evidence-manifest-self-test.mjs
node tests/e2e/computer-use/run-cua-driver.mjs self-test
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/coverage-manifest.test.mjs
node tests/e2e/computer-use/report.test.mjs
