export function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

export function sourcePrefixMatches(file, sourcePrefix) {
  const normalizedFile = String(file ?? "").replaceAll("\\", "/");
  const normalizedPrefix = String(sourcePrefix ?? "").replaceAll("\\", "/");
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) return normalizedFile.startsWith(normalizedPrefix);
  return (
    normalizedFile === normalizedPrefix || normalizedFile.startsWith(`${normalizedPrefix}/`)
  );
}

export function changedFileMatchesSurface(file, surface) {
  return (surface.sourcePrefixes ?? []).some((sourcePrefix) =>
    sourcePrefixMatches(file, sourcePrefix),
  );
}

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
  specialScenarioKeysForFile = () => [],
  scenarioSuggestionForFile = () => null,
}) {
  const scenarioKeys = new Set();
  const userVisibleFiles = [];
  const unmappedUserVisibleFiles = [];
  const scenarioSuggestions = [];
  const matchedSurfaces = [];

  for (const file of changedFiles) {
    const fileSurfaces = (manifest.surfaces ?? []).filter((surface) =>
      changedFileMatchesSurface(file, surface),
    );
    const mappedKeys = fileSurfaces
      .flatMap((surface) => surface.scenarioKeys ?? [])
      .filter(Boolean);
    const specialScenarioKeys = specialScenarioKeysForFile(file).filter(Boolean);
    for (const key of [...mappedKeys, ...specialScenarioKeys]) scenarioKeys.add(key);
    if (!isLikelyUserVisiblePrFile(file, manifest)) continue;

    userVisibleFiles.push(file);
    matchedSurfaces.push(...fileSurfaces.map((surface) => matchedSurfaceRow(file, surface)));
    const nonClaimingOnly =
      fileSurfaces.length > 0 &&
      fileSurfaces.every((surface) => surface.coverageDisposition === "non-claiming");
    if (!mappedKeys.length && !specialScenarioKeys.length && !nonClaimingOnly) {
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
