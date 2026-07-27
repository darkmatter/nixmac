import {
  assertValidCoverageManifest,
  classifyCoverageFile,
  isCoverageCandidateFile,
} from "./coverage-manifest.mjs";

export function isLikelyUserVisiblePrFile(file, manifest) {
  return isCoverageCandidateFile(manifest, file);
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
  const claimedUserVisibleFiles = [];
  const waivedUserVisibleFiles = [];
  const unmatchedUserVisibleFiles = [];
  const nonClaimingUserVisibleFiles = [];
  const unmappedUserVisibleFiles = [];
  const scenarioSuggestions = [];
  const matchedSurfaces = [];
  const coverageClassifications = [];

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
    const disposition = classification.waiverDebt
      ? "waived"
      : mappedKeys.length || specialScenarioKeys.length
        ? "claimed"
        : nonClaimingOnly
          ? "non-claiming"
          : "unmatched";
    coverageClassifications.push({
      file,
      disposition,
      scenarioKeys: [...new Set([...mappedKeys, ...specialScenarioKeys])],
      surfaceIds: fileSurfaces.map((surface) => surface.id),
    });
    if (disposition === "claimed") claimedUserVisibleFiles.push(file);
    else if (disposition === "non-claiming") nonClaimingUserVisibleFiles.push(file);
    else {
      if (disposition === "waived") waivedUserVisibleFiles.push(file);
      else unmatchedUserVisibleFiles.push(file);
      unmappedUserVisibleFiles.push(file);
      const suggestion = scenarioSuggestionForFile(file, fileSurfaces);
      if (suggestion) scenarioSuggestions.push(suggestion);
    }
  }

  return {
    changedFiles,
    userVisibleFiles,
    claimedUserVisibleFiles,
    waivedUserVisibleFiles,
    unmatchedUserVisibleFiles,
    nonClaimingUserVisibleFiles,
    scenarioKeys: [...scenarioKeys],
    matchedSurfaces,
    coverageClassifications,
    unmappedUserVisibleFiles,
    scenarioSuggestions: [...new Set(scenarioSuggestions)],
  };
}
