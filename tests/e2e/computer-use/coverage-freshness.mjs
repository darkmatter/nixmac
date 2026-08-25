// Pure coverage-manifest classification and validation helpers.
// Callers own filesystem reads and clock access, then inject those values here.

const COVERAGE_DISPOSITIONS = new Set(["mapped", "waived", "non-claiming"]);
const WAIVER_RISKS = new Set(["low", "medium", "high"]);

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value).replaceAll("\\", "/")))].sort();
}

export function isIsoDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  });
}

export function sourcePrefixMatches(file, sourcePrefix) {
  const normalizedFile = String(file ?? "").replaceAll("\\", "/");
  const normalizedPrefix = String(sourcePrefix ?? "").replaceAll("\\", "/");
  if (!normalizedFile || !normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) return normalizedFile.startsWith(normalizedPrefix);
  return normalizedFile === normalizedPrefix;
}

export function classifyCandidateFiles(manifest, repositoryFiles = []) {
  const files = uniqueSorted(repositoryFiles);
  const excludes = manifest.candidateExcludes ?? [];
  const included = (patterns) =>
    files.filter(
      (file) => matchesAnyPattern(file, patterns ?? []) && !matchesAnyPattern(file, excludes),
    );

  return {
    blockingCandidateFiles: included(manifest.candidateIncludes),
    diagnosticInventoryFiles: included(manifest.diagnosticInventoryIncludes),
  };
}

export function validateManagedWaiver(raw, { today }) {
  const waiver = {
    reason: raw?.reason ?? "",
    owner: raw?.owner ?? "",
    created: raw?.created ?? "",
    reviewedAt: raw?.reviewedAt ?? "",
    reviewBy: raw?.reviewBy ?? "",
    risk: raw?.risk ?? "",
    exitCriteria: raw?.exitCriteria ?? "",
    validationErrors: [],
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    waiver.validationErrors.push("waiver must be a managed waiver object");
    return waiver;
  }

  for (const field of [
    "reason",
    "owner",
    "created",
    "reviewedAt",
    "reviewBy",
    "risk",
    "exitCriteria",
  ]) {
    if (!waiver[field]) waiver.validationErrors.push(`waiver is missing required field ${field}`);
  }

  for (const field of ["created", "reviewedAt", "reviewBy"]) {
    if (waiver[field] && !isIsoDateOnly(waiver[field])) {
      waiver.validationErrors.push(
        `waiver ${field} date ${waiver[field]} must be a valid YYYY-MM-DD date`,
      );
    }
  }

  if (waiver.created && waiver.reviewedAt && waiver.created > waiver.reviewedAt) {
    waiver.validationErrors.push("waiver reviewedAt date must not precede created date");
  }
  if (waiver.reviewedAt && waiver.reviewedAt > today) {
    waiver.validationErrors.push(`waiver reviewedAt date ${waiver.reviewedAt} is in the future`);
  }
  if (waiver.reviewedAt && waiver.reviewBy && waiver.reviewedAt > waiver.reviewBy) {
    waiver.validationErrors.push("waiver reviewBy date must not precede reviewedAt date");
  }
  if (waiver.reviewBy && waiver.reviewBy < today) {
    waiver.validationErrors.push(`waiver review date ${waiver.reviewBy} is expired`);
  }
  if (waiver.risk && !WAIVER_RISKS.has(waiver.risk)) {
    waiver.validationErrors.push(`waiver risk ${waiver.risk} must be low, medium, or high`);
  }

  return waiver;
}

function validatePatterns(manifest) {
  const errors = [];
  for (const field of ["candidateIncludes", "candidateExcludes", "diagnosticInventoryIncludes"]) {
    for (const pattern of manifest[field] ?? []) {
      try {
        new RegExp(pattern);
      } catch (error) {
        errors.push(
          `${field} contains invalid regular expression ${pattern}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  return errors;
}

export function buildCoverageFreshness({
  manifest,
  repositoryFiles = [],
  scenarios = {},
  knownScenarioKeys = Object.keys(scenarios),
  sourceExists,
  today,
}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("manifest must be an object");
  }
  if (typeof sourceExists !== "function") {
    throw new TypeError("sourceExists must be an injected function");
  }
  if (!isIsoDateOnly(today)) {
    throw new TypeError("today must be an injected YYYY-MM-DD date");
  }

  const drift = validatePatterns(manifest);
  const { blockingCandidateFiles, diagnosticInventoryFiles } = classifyCandidateFiles(
    manifest,
    repositoryFiles,
  );
  const knownScenarios = new Set(knownScenarioKeys);
  const surfaceResults = [];
  const waivers = [];
  const nonClaiming = [];
  const seenIds = new Set();

  for (const surface of manifest.surfaces ?? []) {
    const id = String(surface.id ?? "").trim();
    const label = String(surface.label ?? "").trim();
    const disposition = surface.coverageDisposition;
    const scenarioKeys = uniqueSorted(surface.scenarioKeys ?? []);
    const sourcePrefixes = uniqueSorted(surface.sourcePrefixes ?? []);
    const errors = [];

    if (!id) errors.push("surface is missing id");
    else if (seenIds.has(id)) errors.push(`duplicate surface id ${id}`);
    else seenIds.add(id);
    if (!label) errors.push("surface is missing label");
    if (!COVERAGE_DISPOSITIONS.has(disposition)) {
      errors.push(
        `coverageDisposition must be mapped, waived, or non-claiming; received ${String(
          disposition,
        )}`,
      );
    }
    if (!sourcePrefixes.length) errors.push("surface must declare at least one sourcePrefix");

    const missingSources = sourcePrefixes.filter((sourcePath) => !sourceExists(sourcePath));
    if (missingSources.length) {
      errors.push(`references missing source paths: ${missingSources.join(", ")}`);
    }

    let waiver = null;
    if (disposition === "mapped") {
      if (!scenarioKeys.length) errors.push("mapped surface must declare scenarioKeys");
      if (surface.waiver) errors.push("mapped surface must not declare a waiver");
      for (const key of scenarioKeys) {
        if (!knownScenarios.has(key)) errors.push(`maps to unknown scenario ${key}`);
        if (!Object.hasOwn(scenarios, key)) {
          errors.push(`maps to scenario ${key} that is not present in this run`);
        }
      }
    } else if (disposition === "waived") {
      if (scenarioKeys.length) errors.push("waived surface must not declare scenarioKeys");
      waiver = validateManagedWaiver(surface.waiver, { today });
      errors.push(...waiver.validationErrors);
      waivers.push({ id, label, ...waiver });
    } else if (disposition === "non-claiming") {
      if (scenarioKeys.length) errors.push("non-claiming surface must not declare scenarioKeys");
      if (surface.waiver) errors.push("non-claiming surface must not declare a waiver");
      if (!String(surface.coverageNote ?? "").trim()) {
        errors.push("non-claiming surface must declare coverageNote");
      }
      const maskedUiFiles = blockingCandidateFiles.filter((file) =>
        sourcePrefixes.some((prefix) => sourcePrefixMatches(file, prefix)),
      );
      if (maskedUiFiles.length) {
        errors.push(
          `non-claiming surface must not mask blocking UI candidates: ${maskedUiFiles.join(", ")}`,
        );
      }
      nonClaiming.push({ id, label, coverageNote: surface.coverageNote ?? "", sourcePrefixes });
    }

    for (const error of errors) drift.push(`${id || "<missing-id>"} ${error}`);
    surfaceResults.push({
      id,
      label,
      disposition,
      scenarioKeys,
      sourcePrefixes,
      valid: errors.length === 0,
      errors,
    });
  }

  const validPrefixes = surfaceResults
    .filter((surface) => surface.valid)
    .flatMap((surface) => surface.sourcePrefixes);
  const unmappedCandidateFiles = blockingCandidateFiles.filter(
    (file) => !validPrefixes.some((prefix) => sourcePrefixMatches(file, prefix)),
  );
  if (unmappedCandidateFiles.length) {
    drift.push(`Unmapped user-visible candidate files: ${unmappedCandidateFiles.join(", ")}`);
  }

  const classifiedDiagnosticFiles = diagnosticInventoryFiles.filter((file) =>
    validPrefixes.some((prefix) => sourcePrefixMatches(file, prefix)),
  );
  const unclassifiedDiagnosticFiles = diagnosticInventoryFiles.filter(
    (file) => !classifiedDiagnosticFiles.includes(file),
  );

  return {
    manifestVersion: manifest.version,
    checkedOn: today,
    totalSurfaces: surfaceResults.length,
    mappedSurfaces: surfaceResults.filter(
      (surface) => surface.valid && surface.disposition === "mapped",
    ).length,
    waivedSurfaces: surfaceResults.filter(
      (surface) => surface.valid && surface.disposition === "waived",
    ).length,
    nonClaimingSurfaces: surfaceResults.filter(
      (surface) => surface.valid && surface.disposition === "non-claiming",
    ).length,
    blockingCandidateFiles,
    diagnosticInventoryFiles,
    classifiedDiagnosticFiles,
    unclassifiedDiagnosticFiles,
    unmappedCandidateFiles,
    waivers,
    nonClaiming,
    surfaceResults,
    drift,
  };
}
