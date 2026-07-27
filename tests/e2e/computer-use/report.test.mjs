#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderReportHtml } from "./report.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(TEST_DIR, "fixtures", "preservation");
const seed = JSON.parse(await readFile(path.join(FIXTURE_DIR, "state.seed.json"), "utf8"));

function proofForScenario() {
  return {
    screenshotArtifacts: [],
    textArtifacts: [],
    grade: "self-test",
    proof: "Synthetic report regression proof.",
    untested: "Synthetic report regression limit.",
  };
}

async function renderPrCase({
  configured = true,
  userVisibleFiles = [],
  claimedUserVisibleFiles = [],
  waivedUserVisibleFiles = [],
  unmatchedUserVisibleFiles = [],
  nonClaimingUserVisibleFiles = [],
  scenarioKeys = [],
  prStatus = "pass",
  mappedStatus = "pass",
}) {
  const state = structuredClone(seed);
  state.runDir = FIXTURE_DIR;
  state.verdict = prStatus === "pass" && mappedStatus === "pass" ? "pass" : prStatus;
  for (const scenario of Object.values(state.scenarios)) {
    scenario.status = "pass";
    scenario.notes = ["Synthetic report regression pass."];
  }
  for (const key of scenarioKeys) {
    state.scenarios[key].status = mappedStatus;
    state.scenarios[key].notes = [`Synthetic ${mappedStatus} mapped scenario.`];
  }
  state.scenarios.prSpecificCoverage.status = prStatus;
  state.scenarios.prSpecificCoverage.notes = [`Synthetic ${prStatus} PR coverage result.`];
  state.prFocus = {
    configured,
    number: "999",
    title: "Report regression",
    baseRef: "main",
    headRef: "feature/report-regression",
    changedFiles: userVisibleFiles,
    userVisibleFiles,
    claimedUserVisibleFiles,
    waivedUserVisibleFiles,
    unmatchedUserVisibleFiles,
    nonClaimingUserVisibleFiles,
    unmappedUserVisibleFiles: [...waivedUserVisibleFiles, ...unmatchedUserVisibleFiles],
    scenarioKeys,
    coverageClassifications: [],
  };
  return renderReportHtml(state, { proofForScenario });
}

export async function reportSelfTest() {
  const claimedPass = await renderPrCase({
    userVisibleFiles: ["app/claimed.tsx"],
    claimedUserVisibleFiles: ["app/claimed.tsx"],
    scenarioKeys: ["review"],
  });
  assert.match(claimedPass, /Mapped user-visible PR/);
  assert.match(claimedPass, /PR-specific user-visible behavior is covered when applicable/);
  assert.match(claimedPass, /Acceptable for E2E gate/);

  const claimedFail = await renderPrCase({
    userVisibleFiles: ["app/claimed.tsx"],
    claimedUserVisibleFiles: ["app/claimed.tsx"],
    scenarioKeys: ["review"],
    prStatus: "fail",
    mappedStatus: "fail",
  });
  assert.match(claimedFail, /Mapped user-visible PR/);
  assert.match(claimedFail, /PR-specific user-visible behavior is covered when applicable/);
  assert.match(claimedFail, /Not acceptable for E2E gate/);

  const waivedOnly = await renderPrCase({
    userVisibleFiles: ["app/waived.tsx"],
    waivedUserVisibleFiles: ["app/waived.tsx"],
    prStatus: "inconclusive",
  });
  assert.match(waivedOnly, /User-visible coverage debt/);
  assert.match(waivedOnly, /app\/waived\.tsx/);
  assert.match(waivedOnly, /PR-specific user-visible behavior is covered when applicable/);

  const claimedAndWaived = await renderPrCase({
    userVisibleFiles: ["app/claimed.tsx", "app/waived.tsx"],
    claimedUserVisibleFiles: ["app/claimed.tsx"],
    waivedUserVisibleFiles: ["app/waived.tsx"],
    scenarioKeys: ["review"],
    prStatus: "inconclusive",
  });
  assert.match(claimedAndWaived, /Mapped PR with coverage debt/);
  assert.match(claimedAndWaived, /app\/waived\.tsx/);
  assert.match(claimedAndWaived, /PR-specific user-visible behavior is covered when applicable/);

  const nonClaimingOnly = await renderPrCase({
    userVisibleFiles: ["app/internal.ts"],
    nonClaimingUserVisibleFiles: ["app/internal.ts"],
  });
  assert.match(nonClaimingOnly, /Explicitly non-claiming PR/);
  assert.match(nonClaimingOnly, /app\/internal\.ts/);
  assert.doesNotMatch(nonClaimingOnly, /User-visible, unmapped/);
  assert.doesNotMatch(nonClaimingOnly, /Baseline pass; PR focus needs review/);
  assert.match(nonClaimingOnly, /PR-specific user-visible behavior is covered when applicable/);

  const claimedAndNonClaiming = await renderPrCase({
    userVisibleFiles: ["app/claimed.tsx", "app/internal.ts"],
    claimedUserVisibleFiles: ["app/claimed.tsx"],
    nonClaimingUserVisibleFiles: ["app/internal.ts"],
    scenarioKeys: ["review"],
  });
  assert.match(claimedAndNonClaiming, /Mapped user-visible PR/);
  assert.match(claimedAndNonClaiming, /Explicitly non-claiming files/);
  assert.match(claimedAndNonClaiming, /app\/internal\.ts/);
  assert.match(claimedAndNonClaiming, /Acceptable for E2E gate/);

  const noUserVisible = await renderPrCase({});
  assert.match(noUserVisible, /No user-visible PR changes/);
  assert.match(noUserVisible, /PR-specific user-visible behavior is covered when applicable/);
  assert.match(noUserVisible, /Acceptable for E2E gate/);

  const noPrContext = await renderPrCase({ configured: false });
  assert.match(noPrContext, /No PR context/);
  assert.match(noPrContext, /PR-specific user-visible behavior is covered when applicable/);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await reportSelfTest();
  console.log("Computer Use report self-test passed.");
}
