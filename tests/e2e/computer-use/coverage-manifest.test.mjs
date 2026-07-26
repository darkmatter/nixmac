#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCoverageFile,
  isCoverageCandidateFile,
  loadCoverageManifestFile,
  parseCoverageManifest,
  sourcePrefixMatches,
  validateCoverageManifest,
} from "./coverage-manifest.mjs";
import { buildManifestPrFocus } from "./coverage-focus.mjs";
import { isLikelyUserVisiblePrFile } from "./coverage-focus.mjs";
import { isStableCoverageScenarioKey } from "./scenario-catalog.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const REAL_MANIFEST = JSON.parse(
  readFileSync(path.join(TEST_DIR, "coverage-manifest.json"), "utf8"),
);

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
      {
        id: "non-claiming",
        label: "Non-claiming plumbing",
        scenarioKeys: [],
        sourcePrefixes: ["app/internal.ts"],
        coverageDisposition: "non-claiming",
        coverageNote: "Synthetic internal plumbing.",
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
  const repoFiles = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const prVisibleRepoFiles = repoFiles.filter((file) =>
    isLikelyUserVisiblePrFile(file, REAL_MANIFEST),
  );
  const freshnessCandidateRepoFiles = repoFiles.filter(
    (file) => isCoverageCandidateFile(REAL_MANIFEST, file),
  );
  assert.deepEqual(
    prVisibleRepoFiles,
    freshnessCandidateRepoFiles,
    "PR-visible repo files and main freshness candidates should be the same universe",
  );
  for (const file of [
    "apps/native/src/new-visible-feature.tsx",
    "apps/native/src/components/new-visible-subdir/new-visible-feature.tsx",
    "apps/native/src/hooks/use-new-visible-feature.ts",
    "apps/native/src-tauri/src/new_visible_feature.rs",
    "apps/native/src-tauri/src/new_subsystem/new_visible_feature.rs",
    "apps/native/src-tauri/src/evolve/new_visible_feature.rs",
    "apps/native/src-tauri/capabilities/new-visible-capability.json",
    "apps/native/templates/new-visible-template/flake.nix",
    "tests/e2e/new-visible-flow.sh",
    "tests/e2e/computer-use/new-proof-signal.mjs",
    "tests/e2e/computer-use/new-proof.test.ts",
    "tests/e2e/computer-use/new-proof.test.tsx",
    "tests/e2e/computer-use/__snapshots__/new-proof.json",
    "apps/native/templates/new-template/components/ui/module.nix",
    ".github/workflows/new-visible-e2e.yml",
  ]) {
    assert.equal(
      isCoverageCandidateFile(REAL_MANIFEST, file),
      true,
      `${file} should enter the shared PR/freshness candidate universe`,
    );
    const focus = buildManifestPrFocus({
      changedFiles: [file],
      manifest: REAL_MANIFEST,
      knownScenarioKey: isStableCoverageScenarioKey,
    });
    assert.deepEqual(
      focus.unmatchedUserVisibleFiles,
      [file],
      `${file} should fail closed as unmapped until it receives explicit ownership`,
    );
  }
  for (const file of [
    "apps/native/src/components/widget/new-proof.test.ts",
    "apps/native/src/components/widget/new-proof.test.tsx",
    "apps/native/src/components/widget/__snapshots__/new-proof.json",
    "apps/native/src/components/ui/new-proof.tsx",
  ]) {
    assert.equal(
      isCoverageCandidateFile(REAL_MANIFEST, file),
      false,
      `${file} should retain the intentional app-source exclusion`,
    );
    const focus = buildManifestPrFocus({
      changedFiles: [file],
      manifest: REAL_MANIFEST,
      knownScenarioKey: isStableCoverageScenarioKey,
    });
    assert.deepEqual(
      focus.userVisibleFiles,
      [],
      `${file} should remain outside PR/freshness behavior coverage`,
    );
  }
  assert.equal(
    isStableCoverageScenarioKey("launch"),
    true,
    "stable shared scenarios should be valid coverage-manifest keys",
  );
  assert.equal(
    isStableCoverageScenarioKey("inlineQuestionAnswer"),
    false,
    "optional evolved-only scenarios should not be valid coverage-manifest keys",
  );
  const evolvedOnlyScenario = baseManifest();
  evolvedOnlyScenario.surfaces[0].scenarioKeys = ["inlineQuestionAnswer"];
  assert(
    validateCoverageManifest(evolvedOnlyScenario, {
      knownScenarioKey: isStableCoverageScenarioKey,
    }).some((error) => error.includes("maps to unknown scenario inlineQuestionAnswer")),
    "coverage-manifest validation should consistently reject evolved-only scenario keys",
  );
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
  assert.deepEqual(
    waivedSpecialFocus.waivedUserVisibleFiles,
    ["app/preview.tsx"],
    "PR focus should carry waived user-visible files as an explicit classification",
  );

  const classificationFocus = buildManifestPrFocus({
    changedFiles: [
      "app/main.tsx",
      "app/preview.tsx",
      "app/new-visible.tsx",
      "app/internal.ts",
    ],
    manifest: baseManifest(),
    knownScenarioKey: (key) => key === "launch",
  });
  assert.deepEqual(
    classificationFocus.claimedUserVisibleFiles,
    ["app/main.tsx"],
    "PR focus should carry claimed user-visible files",
  );
  assert.deepEqual(
    classificationFocus.waivedUserVisibleFiles,
    ["app/preview.tsx"],
    "PR focus should carry waived user-visible files",
  );
  assert.deepEqual(
    classificationFocus.unmatchedUserVisibleFiles,
    ["app/new-visible.tsx"],
    "PR focus should distinguish unmatched user-visible files from managed waivers",
  );
  assert.deepEqual(
    classificationFocus.nonClaimingUserVisibleFiles,
    ["app/internal.ts"],
    "PR focus should carry explicitly non-claiming user-visible files without debt",
  );
  assert.deepEqual(
    classificationFocus.unmappedUserVisibleFiles,
    ["app/preview.tsx", "app/new-visible.tsx"],
    "only waived and unmatched user-visible files should create PR coverage debt",
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
  unapprovedWaivedDirectory.surfaces[1].directoryPrefixApprovals = [
    {
      prefix: "app/waived/",
      owner: "self-test",
      reason: "Synthetic managed waiver directory.",
    },
  ];
  const newWaivedFileFocus = buildManifestPrFocus({
    changedFiles: ["app/waived/new-visible-flow.tsx"],
    manifest: unapprovedWaivedDirectory,
    knownScenarioKey: (key) => key === "launch",
  });
  assert.deepEqual(
    newWaivedFileFocus.waivedUserVisibleFiles,
    ["app/waived/new-visible-flow.tsx"],
    "a new file under an approved waiver directory should remain visible as waiver debt",
  );
  assert.deepEqual(
    newWaivedFileFocus.unmappedUserVisibleFiles,
    ["app/waived/new-visible-flow.tsx"],
    "approved waiver directories must not silently turn new files into claimed coverage",
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
