import {
  assertValidCoverageManifest,
  changedFileMatchesSurface,
  classifyCoverageFile,
  matchesAnyPattern,
} from "./coverage-manifest.mjs";

export function isLikelyUserVisiblePrFile(file, manifest) {
  if (matchesAnyPattern(file, manifest.candidateExcludes ?? [])) return false;
  if (matchesAnyPattern(file, manifest.candidateIncludes ?? [])) return true;
  if (manifest.surfaces?.some((surface) => changedFileMatchesSurface(file, surface))) return true;
  return /^(apps\/native\/src\/[^/]+\.(?:css|ts|tsx)|apps\/native\/src\/components\/|apps\/native\/src\/hooks\/|apps\/native\/src-tauri\/src\/|apps\/native\/templates\/|tests\/e2e\/|\.github\/workflows\/(?:peekaboo-e2e|computer-use-e2e)\.yml)/.test(
    file,
  );
}

function matchedSurfaceRow(file, surface) {
  return {
    file,
    id: surface.id,
    label: surface.label,
    scenarioKeys: surface.scenarioKeys ?? [],
    waiver: surface.waiver ?? null,
    coverageDisposition: surface.coverageDisposition ?? null,
    coverageNote: surface.coverageNote ?? null,
  };
}

export function buildManifestPrFocus({
  changedFiles,
  manifest,
  knownScenarioKey,
  specialScenarioKeysForFile = () => [],
  scenarioSuggestionForFile = () => null,
}) {
  assertValidCoverageManifest(manifest, { knownScenarioKey });
  const scenarioKeys = new Set();
  const userVisibleFiles = [];
  const unmappedUserVisibleFiles = [];
  const scenarioSuggestions = [];
  const matchedSurfaces = [];

  for (const file of changedFiles) {
    const classification = classifyCoverageFile(manifest, file);
    const fileSurfaces = classification.surfaces;
    const mappedKeys = classification.scenarioKeys;
    const specialScenarioKeys = fileSurfaces.length
      ? []
      : specialScenarioKeysForFile(file).filter(Boolean);
    for (const key of [...mappedKeys, ...specialScenarioKeys]) scenarioKeys.add(key);
    if (!isLikelyUserVisiblePrFile(file, manifest)) continue;

    userVisibleFiles.push(file);
    matchedSurfaces.push(...fileSurfaces.map((surface) => matchedSurfaceRow(file, surface)));
    const nonClaimingOnly =
      fileSurfaces.length > 0 &&
      fileSurfaces.every((surface) => surface.coverageDisposition === "non-claiming");
    if (
      (classification.waiverDebt ||
        (!mappedKeys.length && !specialScenarioKeys.length && !nonClaimingOnly))
    ) {
      unmappedUserVisibleFiles.push(file);
      const suggestion = scenarioSuggestionForFile(file, fileSurfaces);
      if (suggestion) scenarioSuggestions.push(suggestion);
    }
  }

  return {
    changedFiles,
    userVisibleFiles,
    scenarioKeys: [...scenarioKeys],
    matchedSurfaces,
    unmappedUserVisibleFiles,
    scenarioSuggestions: [...new Set(scenarioSuggestions)],
  };
}
