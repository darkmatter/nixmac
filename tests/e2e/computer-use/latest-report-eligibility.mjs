#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

const GIT_SHA_RE = /^[a-f0-9]{40}$/;

function fail(message) {
  throw new Error(message);
}

function requireSha(value, name) {
  if (typeof value !== "string" || !GIT_SHA_RE.test(value)) {
    fail(`${name} must be a full lowercase git SHA`);
  }
  return value;
}

export function latestReportEligibility(pullRequest, expectedSha) {
  requireSha(expectedSha, "expected_sha");
  if (!pullRequest || typeof pullRequest !== "object") {
    fail("pull request response must be an object");
  }
  if (typeof pullRequest.merged !== "boolean") {
    fail("pull request response must include merged");
  }

  const reference = pullRequest.merged ? "merge_commit_sha" : "head.sha";
  const currentSha = pullRequest.merged ? pullRequest.merge_commit_sha : pullRequest.head?.sha;
  requireSha(currentSha, `pull request ${reference}`);

  return {
    updateLatest: currentSha === expectedSha,
    currentSha,
    reference,
  };
}

function selfTest() {
  const firstSha = "a".repeat(40);
  const secondSha = "b".repeat(40);
  assert.deepEqual(latestReportEligibility({ merged: false, head: { sha: firstSha } }, firstSha), {
    updateLatest: true,
    currentSha: firstSha,
    reference: "head.sha",
  });
  assert.equal(
    latestReportEligibility({ merged: false, head: { sha: secondSha } }, firstSha).updateLatest,
    false,
  );
  assert.deepEqual(
    latestReportEligibility({ merged: true, merge_commit_sha: firstSha }, firstSha),
    { updateLatest: true, currentSha: firstSha, reference: "merge_commit_sha" },
  );
  assert.equal(
    latestReportEligibility({ merged: true, merge_commit_sha: secondSha }, firstSha).updateLatest,
    false,
  );
  assert.throws(
    () => latestReportEligibility({ merged: false, head: { sha: "short" } }, firstSha),
    /pull request head\.sha must be a full lowercase git SHA/,
  );
  process.stdout.write("latest-report-eligibility self-test passed\n");
}

function value(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) fail(`${flag} is required`);
  return args[index + 1];
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "self-test") return selfTest();
  if (command !== "check") {
    process.stderr.write(
      "Usage:\n" +
        "  node tests/e2e/computer-use/latest-report-eligibility.mjs check --input <pull-request.json> --expected-sha <sha>\n" +
        "  node tests/e2e/computer-use/latest-report-eligibility.mjs self-test\n",
    );
    process.exitCode = 2;
    return;
  }

  const inputPath = value(args, "--input");
  const expectedSha = value(args, "--expected-sha");
  const pullRequest = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = latestReportEligibility(pullRequest, expectedSha);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `update_latest=${result.updateLatest}`,
        `current_sha=${result.currentSha}`,
        `reference=${result.reference}`,
        "",
      ].join("\n"),
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
