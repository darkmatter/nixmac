import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoverageFreshness,
  classifyCandidateFiles,
  validateManagedWaiver,
} from "./coverage-freshness.mjs";
import { scenarioLabels } from "./scenario-catalog.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, "tests/e2e/computer-use/coverage-manifest.json");
const TODAY = "2026-08-24";

function walkFiles(relativeRoot) {
  const fullRoot = path.join(REPO_ROOT, relativeRoot);
  if (!existsSync(fullRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        files.push(path.relative(REPO_ROOT, fullPath).replaceAll(path.sep, "/"));
      }
    }
  };
  visit(fullRoot);
  return files;
}

function sourceExists(sourcePath) {
  const fullPath = path.join(REPO_ROOT, sourcePath);
  if (!existsSync(fullPath)) return false;
  if (!sourcePath.endsWith("/")) return true;
  return statSync(fullPath).isDirectory();
}

function currentWaiver(overrides = {}) {
  return {
    reason: "Accepted gap under focused test.",
    owner: "nixmac-product-proof",
    created: "2026-08-24",
    reviewedAt: "2026-08-24",
    reviewBy: "2026-09-30",
    risk: "medium",
    exitCriteria: "Add a dedicated scenario and remove this waiver.",
    ...overrides,
  };
}

function oneSurfaceManifest(surface, overrides = {}) {
  return {
    version: 2,
    candidateIncludes: ["apps/native/src/components/widget/.+\\.tsx$"],
    diagnosticInventoryIncludes: ["apps/native/src-tauri/src/.+\\.rs$"],
    candidateExcludes: [],
    surfaces: [surface],
    ...overrides,
  };
}

function buildSynthetic(manifest, options = {}) {
  return buildCoverageFreshness({
    manifest,
    repositoryFiles: options.repositoryFiles ?? [],
    scenarios: options.scenarios ?? {},
    knownScenarioKeys: options.knownScenarioKeys ?? Object.keys(options.scenarios ?? {}),
    sourceExists: options.sourceExists ?? (() => true),
    today: options.today ?? TODAY,
  });
}

function run() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const repositoryFiles = [
    ...new Set((manifest.candidateRoots ?? []).flatMap((root) => walkFiles(root))),
  ];
  const live = buildCoverageFreshness({
    manifest,
    repositoryFiles,
    scenarios: scenarioLabels,
    knownScenarioKeys: Object.keys(scenarioLabels),
    sourceExists,
    today: TODAY,
  });

  assert.deepEqual(live.drift, [], "live coverage manifest should be current and valid");
  assert.deepEqual(
    live.unmappedCandidateFiles,
    [],
    "every blocking UI candidate should be mapped or explicitly waived",
  );
  assert.equal(live.mappedSurfaces, 12, "live manifest should retain twelve mapped surfaces");
  assert.equal(live.waivedSurfaces, 11, "live manifest should expose eleven reviewed gaps");
  assert.equal(
    live.nonClaimingSurfaces,
    1,
    "live manifest should expose the harness runtime as non-claiming",
  );
  assert(
    live.diagnosticInventoryFiles.includes("apps/native/src-tauri/src/state/mod.rs"),
    "Rust implementation files should remain visible in diagnostic inventory",
  );
  assert(
    !live.blockingCandidateFiles.includes("apps/native/src-tauri/src/state/mod.rs"),
    "Rust implementation inventory must not inflate blocking UI coverage",
  );

  const adversarialUiPath = "apps/native/src/components/widget/adversarial-new-visible-surface.tsx";
  const adversarialUi = buildCoverageFreshness({
    manifest,
    repositoryFiles: [...repositoryFiles, adversarialUiPath],
    scenarios: scenarioLabels,
    knownScenarioKeys: Object.keys(scenarioLabels),
    sourceExists,
    today: TODAY,
  });
  assert(
    adversarialUi.unmappedCandidateFiles.includes(adversarialUiPath),
    "a new user-visible component must fail closed until classified",
  );
  assert(
    adversarialUi.drift.some((item) => item.includes(adversarialUiPath)),
    "the unmapped UI path must be reviewer-visible in drift",
  );

  const nonClaimingUiPath = "apps/native/src/components/widget/non-claiming-ui.tsx";
  const nonClaimingMisuse = buildSynthetic(
    oneSurfaceManifest({
      id: "bad-non-claiming",
      label: "Bad non-claiming surface",
      coverageDisposition: "non-claiming",
      scenarioKeys: ["launch"],
      sourcePrefixes: [nonClaimingUiPath],
      waiver: currentWaiver(),
    }),
    {
      repositoryFiles: [nonClaimingUiPath],
      scenarios: { launch: { status: "pass" } },
      knownScenarioKeys: ["launch"],
    },
  );
  assert(
    nonClaimingMisuse.drift.some((item) =>
      item.includes("non-claiming surface must not declare scenarioKeys"),
    ),
    "non-claiming surfaces must not borrow scenario claims",
  );
  assert(
    nonClaimingMisuse.drift.some((item) =>
      item.includes("non-claiming surface must not declare a waiver"),
    ),
    "non-claiming and waived must remain mutually exclusive",
  );
  assert(
    nonClaimingMisuse.drift.some((item) =>
      item.includes("non-claiming surface must declare coverageNote"),
    ),
    "non-claiming surfaces must explain their exclusion",
  );
  assert(
    nonClaimingMisuse.drift.some((item) =>
      item.includes("non-claiming surface must not mask blocking UI candidates"),
    ),
    "non-claiming must never suppress a direct UI candidate",
  );

  const expired = validateManagedWaiver(currentWaiver({ reviewBy: "2026-08-23" }), {
    today: TODAY,
  });
  assert(
    expired.validationErrors.includes("waiver review date 2026-08-23 is expired"),
    "expired waivers must fail deterministically against the injected date",
  );
  const current = validateManagedWaiver(currentWaiver(), { today: TODAY });
  assert.deepEqual(current.validationErrors, [], "a fully reviewed current waiver should pass");

  const missingScenarioPath = "apps/native/src/components/widget/missing-scenario.tsx";
  const missingScenario = buildSynthetic(
    oneSurfaceManifest({
      id: "missing-scenario",
      label: "Missing scenario",
      coverageDisposition: "mapped",
      scenarioKeys: ["launch"],
      sourcePrefixes: [missingScenarioPath],
    }),
    {
      repositoryFiles: [missingScenarioPath],
      scenarios: {},
      knownScenarioKeys: ["launch"],
    },
  );
  assert(
    missingScenario.drift.some((item) =>
      item.includes("maps to scenario launch that is not present in this run"),
    ),
    "a known but unexecuted scenario must not satisfy baseline coverage",
  );

  const diagnosticPath = "apps/native/src-tauri/src/state/internal.rs";
  const uiPath = "apps/native/src/components/widget/mapped-ui.tsx";
  const diagnostic = classifyCandidateFiles(
    oneSurfaceManifest({
      id: "mapped-ui",
      label: "Mapped UI",
      coverageDisposition: "mapped",
      scenarioKeys: ["launch"],
      sourcePrefixes: [uiPath],
    }),
    [uiPath, diagnosticPath],
  );
  assert.deepEqual(diagnostic.blockingCandidateFiles, [uiPath]);
  assert.deepEqual(diagnostic.diagnosticInventoryFiles, [diagnosticPath]);

  process.stdout.write(
    `coverage freshness self-test passed (${live.blockingCandidateFiles.length} blocking UI candidates, ${live.diagnosticInventoryFiles.length} diagnostic Rust files)\n`,
  );
}

run();
