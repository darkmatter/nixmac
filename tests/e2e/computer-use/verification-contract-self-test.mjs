#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  scenarioCatalogDigest,
  suiteContract,
  validateScenarioCatalogKeys,
  validateScenarioContract,
} from "./suite-contract.mjs";
import { scenarioLabels } from "./scenario-catalog.mjs";
import { containsUnmaskedSecret, redact } from "./redaction.mjs";
import { finalResultAttestationHtml } from "./report.mjs";

assert.equal(
  scenarioCatalogDigest,
  "sha256:8c4d246973eb22f49f2baf776b3c29f8c762bae23519115fbb97be402a0ac177",
  "the suite contract digest must remain immutable until its version changes",
);
assert.equal(validateScenarioCatalogKeys(scenarioLabels), true);
assert.throws(
  () => suiteContract.requiredScenarioKeys.push("attacker-controlled"),
  TypeError,
  "the loaded suite contract must be deeply immutable",
);
const sharedCasesBytes = await readFile(new URL("./fixtures/cases.json", import.meta.url));
assert.equal(
  createHash("sha256").update(sharedCasesBytes).digest("hex"),
  "ea493777018c7ff31cafc5f6834a4d172db04d0a2c07f72ae9977eda33e45293",
);
const sharedCases = JSON.parse(sharedCasesBytes);
assert.equal(sharedCases.schema_version, 1);
assert.deepEqual(
  sharedCases.cases
    .filter((item) => item.node_compatible)
    .map(({ name, expected }) => ({ name, expected })),
  [
    { name: "valid-ephemeral-safe-frame", expected: "accept" },
    { name: "valid-static-released-owner-lease", expected: "accept" },
    { name: "digest-mismatch", expected: "reject" },
    { name: "missing-safe-frame", expected: "reject" },
    { name: "static-owner-hash-mismatch", expected: "reject" },
  ],
);

const scenario = (label, status = "pass") => ({
  label,
  status,
  notes: [],
  evidenceStrength: "operational",
  evidenceStrengthReason: "self-test",
  assertionTypes: [],
  failureClass: "none",
  failureClassReason: "self-test",
  accessibilityRisk: "low",
  accessibilityRiskReason: "self-test",
});
const validScenarios = Object.fromEntries(
  suiteContract.requiredScenarioKeys.map((key) => [key, scenario(key)]),
);
assert.equal(validateScenarioContract(validScenarios), true);
assert.throws(
  () => validateScenarioContract({ fakeSmoke: scenario("fake") }),
  /immutable suite contract/,
);
assert.throws(
  () =>
    validateScenarioContract({
      ...validScenarios,
      launch: { ...validScenarios.launch, attackerControlled: true },
    }),
  /exact scenario schema/,
);

for (const secret of [
  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
  '"Proxy-Authorization":"Bearer abcdefghijklmnopqrstuvwxyz"',
  "X-Webhook-Secret=abcdefghijklmnopqrstuvwxyz",
  "ghp_abcdefghijklmnopqrstuvwxyz123456",
  "github_pat_abcdefghijklmnopqrstuvwxyz123456",
]) {
  assert.equal(containsUnmaskedSecret(secret), true, `must detect ${secret}`);
  assert.equal(containsUnmaskedSecret(redact(secret)), false, `must redact ${secret}`);
}

const attestation = finalResultAttestationHtml({
  identity: {
    jobId: `darkmatter/nixmac:${"a".repeat(40)}:computer-use-v1`,
    scenarioCatalogDigest,
  },
  attempt: { actionsRunId: "56", number: 1 },
  counts: { passed: 26, failed: 0, inconclusive: 0, not_required: 1 },
  verdict: "pass",
});
assert.equal(
  attestation,
  `<section id="final-result-attestation" class="panel" data-job-id="darkmatter/nixmac:${"a".repeat(40)}:computer-use-v1" data-actions-run-id="56" data-attempt="1" data-verdict="pass" data-scenario-catalog-digest="${scenarioCatalogDigest}"><h2>Verified result attestation</h2><p><strong>Verdict: pass</strong></p><p>Scenarios: 26 passed, 0 failed, 0 inconclusive, 1 not required.</p></section>`,
);

console.log("verification contract self-test passed");
