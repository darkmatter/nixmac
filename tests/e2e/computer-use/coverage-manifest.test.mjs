#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  classifyCoverageFile,
  loadCoverageManifestFile,
  parseCoverageManifest,
  sourcePrefixMatches,
  validateCoverageManifest,
} from "./coverage-manifest.mjs";
import { buildManifestPrFocus } from "./coverage-focus.mjs";

function waiver() {
  return {
    reason: "Synthetic unexercised behavior.",
    owner: "self-test",
    created: "2026-07-26",
    reviewBy: "2026-08-15",
    risk: "high",
    exitCriteria: "Add deterministic exercised coverage.",
  };
}

function baseManifest() {
  return {
    version: 1,
    description: "Synthetic manifest",
    candidateRoots: ["app"],
    candidateIncludes: ["^app/"],
    candidateExcludes: [],
    surfaces: [
      {
        id: "claimed",
        label: "Claimed surface",
        scenarioKeys: ["launch"],
        sourcePrefixes: ["app/main.tsx"],
      },
      {
        id: "waived",
        label: "Waived surface",
        scenarioKeys: [],
        sourcePrefixes: ["app/preview.tsx"],
        waiver: waiver(),
      },
    ],
  };
}

function validationErrors(manifest) {
  return validateCoverageManifest(manifest, {
    knownScenarioKey: (key) => key === "launch",
  });
}

export function coverageManifestSelfTest() {
  assert.deepEqual(validationErrors(baseManifest()), []);
  const ambiguousDirectoryPrefix = baseManifest();
  ambiguousDirectoryPrefix.surfaces = [ambiguousDirectoryPrefix.surfaces[0]];
  ambiguousDirectoryPrefix.surfaces[0].sourcePrefixes = ["app"];
  assert(
    validationErrors(ambiguousDirectoryPrefix).some((error) =>
      error.includes("directory-like sourcePrefix app must end with /"),
    ),
    "extensionless directory-like source prefixes should be rejected as non-canonical",
  );
  assert.equal(
    sourcePrefixMatches("app/new-unreviewed-feature.tsx", "app"),
    false,
    "a non-trailing source prefix should match only the exact file",
  );
  assert.deepEqual(
    classifyCoverageFile(ambiguousDirectoryPrefix, "app/new-unreviewed-feature.tsx").scenarioKeys,
    [],
    "an ambiguous non-trailing prefix must not classify descendants as covered",
  );
  assert.throws(
    () =>
      buildManifestPrFocus({
        changedFiles: ["app/new-unreviewed-feature.tsx"],
        manifest: ambiguousDirectoryPrefix,
        knownScenarioKey: (key) => key === "launch",
      }),
    /directory-like sourcePrefix app must end with \//,
    "PR focus should fail closed on a non-canonical directory prefix",
  );
  assert.equal(
    sourcePrefixMatches("app\\main.tsx", "app/main.tsx"),
    true,
    "exact file matching should retain Windows separator normalization",
  );
  assert.equal(
    sourcePrefixMatches("app\\feature\\new.tsx", "app/feature/"),
    true,
    "canonical directory matching should retain Windows separator normalization",
  );
  const waivedSpecialFocus = buildManifestPrFocus({
    changedFiles: ["app/preview.tsx"],
    manifest: baseManifest(),
    knownScenarioKey: (key) => key === "launch",
    specialScenarioKeysForFile: () => ["launch"],
  });
  assert.deepEqual(
    waivedSpecialFocus.scenarioKeys,
    [],
    "explicit manifest waiver ownership should override generic special mappings",
  );
  assert.deepEqual(
    waivedSpecialFocus.unmappedUserVisibleFiles,
    ["app/preview.tsx"],
    "an explicitly waived file should remain visible as debt",
  );

  const duplicateIds = baseManifest();
  duplicateIds.surfaces[1].id = "claimed";
  assert(
    validationErrors(duplicateIds).some((error) => error.includes("duplicate surface id claimed")),
    "duplicate manifest surface IDs should fail validation",
  );

  const scenarioAndWaiver = baseManifest();
  scenarioAndWaiver.surfaces[0].waiver = waiver();
  assert(
    validationErrors(scenarioAndWaiver).some((error) =>
      error.includes("cannot have both scenarioKeys and a waiver"),
    ),
    "a surface cannot simultaneously claim a scenario and carry a waiver",
  );

  const unapprovedClaimingDirectory = baseManifest();
  unapprovedClaimingDirectory.surfaces[0].sourcePrefixes = ["app/"];
  assert(
    validationErrors(unapprovedClaimingDirectory).some((error) =>
      error.includes("directory prefix app/ requires an approval"),
    ),
    "directory prefixes should require auditable approval metadata",
  );
  const unapprovedWaivedDirectory = baseManifest();
  unapprovedWaivedDirectory.surfaces[1].sourcePrefixes = ["app/waived/"];
  assert(
    validationErrors(unapprovedWaivedDirectory).some((error) =>
      error.includes("directory prefix app/waived/ requires an approval"),
    ),
    "waived directory prefixes should also require auditable approval metadata",
  );

  const broadClaimOverExactWaiver = baseManifest();
  broadClaimOverExactWaiver.surfaces[0].sourcePrefixes = ["app/"];
  broadClaimOverExactWaiver.surfaces[0].directoryPrefixApprovals = [
    {
      prefix: "app/",
      owner: "self-test",
      reason: "Synthetic single-surface namespace.",
    },
  ];
  const overlapErrors = validationErrors(broadClaimOverExactWaiver);
  assert(
    overlapErrors.some((error) => error.includes("unapproved claim/waiver overlap")),
    "a broad claim must not override an exact waiver",
  );
  assert.throws(
    () =>
      buildManifestPrFocus({
        changedFiles: ["app/preview.tsx"],
        manifest: broadClaimOverExactWaiver,
        knownScenarioKey: (key) => key === "launch",
      }),
    /unapproved claim\/waiver overlap/,
    "PR focus should fail closed instead of routing an invalid overlapping manifest",
  );

  broadClaimOverExactWaiver.ownershipOverlapApprovals = [
    {
      claimSurfaceId: "claimed",
      waiverSurfaceId: "waived",
      prefix: "app/preview.tsx",
      allowScenarioClaim: true,
      owner: "self-test",
      reason: "Synthetic proof that the overlap exception is explicit and auditable.",
    },
  ];
  assert.deepEqual(validationErrors(broadClaimOverExactWaiver), []);
  const approvedClassification = classifyCoverageFile(
    broadClaimOverExactWaiver,
    "app/preview.tsx",
  );
  assert.deepEqual(
    approvedClassification.scenarioKeys,
    ["launch"],
    "an explicitly approved overlap may retain its scenario claim",
  );
  assert.equal(approvedClassification.waiverDebt, false);
  const approvedFocus = buildManifestPrFocus({
    changedFiles: ["app/preview.tsx"],
    manifest: broadClaimOverExactWaiver,
    knownScenarioKey: (key) => key === "launch",
  });
  assert.deepEqual(
    approvedFocus.scenarioKeys,
    ["launch"],
    "PR focus may claim an overlap only after explicit validated approval",
  );
  assert.deepEqual(approvedFocus.unmappedUserVisibleFiles, []);

  assert.throws(
    () =>
      parseCoverageManifest("{", {
        source: "invalid-json",
        knownScenarioKey: (key) => key === "launch",
      }),
    /invalid JSON/,
    "invalid manifest JSON should fail closed",
  );
  assert.throws(
    () =>
      parseCoverageManifest(JSON.stringify({ version: 1, surfaces: "not-an-array" }), {
        source: "invalid-schema",
        knownScenarioKey: (key) => key === "launch",
      }),
    /surfaces must be an array/,
    "schema-invalid manifest data should fail closed",
  );
  assert.throws(
    () =>
      loadCoverageManifestFile("/missing/coverage-manifest.json", {
        readFile: () => {
          const error = new Error("ENOENT");
          error.code = "ENOENT";
          throw error;
        },
        knownScenarioKey: (key) => key === "launch",
      }),
    /could not read/,
    "a missing manifest should fail closed",
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  coverageManifestSelfTest();
  console.log("Coverage manifest self-test passed.");
}
