import { readFileSync } from "node:fs";

export class CoverageManifestError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "CoverageManifestError";
    this.errors = errors;
  }
}

export function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

export function sourcePrefixMatches(file, sourcePrefix) {
  const normalizedFile = String(file ?? "").replaceAll("\\", "/");
  const normalizedPrefix = String(sourcePrefix ?? "").replaceAll("\\", "/");
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) return normalizedFile.startsWith(normalizedPrefix);
  return normalizedFile === normalizedPrefix;
}

export function changedFileMatchesSurface(file, surface) {
  return (surface.sourcePrefixes ?? []).some((sourcePrefix) =>
    sourcePrefixMatches(file, sourcePrefix),
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function sourcePrefixesOverlap(left, right) {
  return sourcePrefixMatches(left, right) || sourcePrefixMatches(right, left);
}

function overlapPrefix(left, right) {
  return left.length >= right.length ? left : right;
}

function approvalKey(approval) {
  return [
    approval?.claimSurfaceId,
    approval?.waiverSurfaceId,
    approval?.prefix,
  ].join("\u0000");
}

function overlapApprovalFor(manifest, file, claimSurface, waiverSurface) {
  return (manifest.ownershipOverlapApprovals ?? []).find(
    (approval) =>
      approval.claimSurfaceId === claimSurface.id &&
      approval.waiverSurfaceId === waiverSurface.id &&
      approval.allowScenarioClaim === true &&
      sourcePrefixMatches(file, approval.prefix),
  );
}

export function validateCoverageManifest(manifest, { knownScenarioKey = () => true } = {}) {
  const errors = [];
  if (!isObject(manifest)) return ["manifest must be an object"];
  if (manifest.version !== 1) errors.push("version must equal 1");
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    errors.push("description must be a non-empty string");
  }
  for (const field of ["candidateRoots", "candidateIncludes", "candidateExcludes"]) {
    if (!Array.isArray(manifest[field]) || manifest[field].some((value) => typeof value !== "string")) {
      errors.push(`${field} must be an array of strings`);
    }
  }
  for (const [index, pattern] of (manifest.candidateIncludes ?? []).entries()) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`candidateIncludes[${index}] is not a valid regular expression`);
    }
  }
  for (const [index, pattern] of (manifest.candidateExcludes ?? []).entries()) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`candidateExcludes[${index}] is not a valid regular expression`);
    }
  }
  if (!Array.isArray(manifest.surfaces)) {
    errors.push("surfaces must be an array");
    return errors;
  }

  const surfaceById = new Map();
  for (const [index, surface] of manifest.surfaces.entries()) {
    const context = `surfaces[${index}]`;
    if (!isObject(surface)) {
      errors.push(`${context} must be an object`);
      continue;
    }
    if (typeof surface.id !== "string" || !surface.id.trim()) {
      errors.push(`${context}.id must be a non-empty string`);
    } else if (surfaceById.has(surface.id)) {
      errors.push(`duplicate surface id ${surface.id}`);
    } else {
      surfaceById.set(surface.id, surface);
    }
    if (typeof surface.label !== "string" || !surface.label.trim()) {
      errors.push(`${context}.label must be a non-empty string`);
    }
    if (
      !Array.isArray(surface.scenarioKeys) ||
      surface.scenarioKeys.some((value) => typeof value !== "string" || !value)
    ) {
      errors.push(`${context}.scenarioKeys must be an array of non-empty strings`);
    }
    const scenarioKeys = Array.isArray(surface.scenarioKeys) ? surface.scenarioKeys : [];
    if (new Set(scenarioKeys).size !== scenarioKeys.length) {
      errors.push(`${surface.id || context} has duplicate scenarioKeys`);
    }
    for (const scenarioKey of scenarioKeys) {
      if (!knownScenarioKey(scenarioKey)) {
        errors.push(`${surface.id || context} maps to unknown scenario ${scenarioKey}`);
      }
    }
    if (
      !Array.isArray(surface.sourcePrefixes) ||
      !surface.sourcePrefixes.length ||
      surface.sourcePrefixes.some((value) => typeof value !== "string" || !value)
    ) {
      errors.push(`${context}.sourcePrefixes must be a non-empty array of strings`);
    }
    const sourcePrefixes = Array.isArray(surface.sourcePrefixes) ? surface.sourcePrefixes : [];
    if (new Set(sourcePrefixes).size !== sourcePrefixes.length) {
      errors.push(`${surface.id || context} has duplicate sourcePrefixes`);
    }
    for (const sourcePrefix of sourcePrefixes) {
      if (sourcePrefix.includes("\\")) {
        errors.push(`${surface.id || context} sourcePrefix ${sourcePrefix} must use / separators`);
      }
      const basename = sourcePrefix.split("/").filter(Boolean).at(-1) ?? "";
      if (!sourcePrefix.endsWith("/") && !basename.includes(".")) {
        errors.push(
          `${surface.id || context} directory-like sourcePrefix ${sourcePrefix} must end with /`,
        );
      }
    }
    if (scenarioKeys.length && surface.waiver) {
      errors.push(`${surface.id || context} cannot have both scenarioKeys and a waiver`);
    }
    if (surface.coverageDisposition && surface.coverageDisposition !== "non-claiming") {
      errors.push(`${surface.id || context} has unsupported coverageDisposition`);
    }
    if (!scenarioKeys.length && !surface.waiver && surface.coverageDisposition !== "non-claiming") {
      errors.push(`${surface.id || context} has no scenario mapping, waiver, or non-claiming disposition`);
    }
    if (surface.waiver) {
      if (!isObject(surface.waiver)) {
        errors.push(`${surface.id || context}.waiver must be an object`);
      } else {
        for (const field of ["reason", "owner", "created", "reviewBy", "risk", "exitCriteria"]) {
          if (typeof surface.waiver[field] !== "string" || !surface.waiver[field].trim()) {
            errors.push(`${surface.id || context}.waiver.${field} must be a non-empty string`);
          }
        }
        if (surface.waiver.created && !validDateOnly(surface.waiver.created)) {
          errors.push(`${surface.id || context}.waiver.created must be a valid YYYY-MM-DD date`);
        }
        if (surface.waiver.reviewBy && !validDateOnly(surface.waiver.reviewBy)) {
          errors.push(`${surface.id || context}.waiver.reviewBy must be a valid YYYY-MM-DD date`);
        }
        if (
          surface.waiver.risk &&
          !["low", "medium", "high"].includes(surface.waiver.risk)
        ) {
          errors.push(`${surface.id || context}.waiver.risk must be low, medium, or high`);
        }
      }
    }

    const directoryApprovals = surface.directoryPrefixApprovals ?? [];
    if (!Array.isArray(directoryApprovals)) {
      errors.push(`${surface.id || context}.directoryPrefixApprovals must be an array`);
    }
    const approvedPrefixes = new Set();
    for (const [approvalIndex, approval] of (
      Array.isArray(directoryApprovals) ? directoryApprovals : []
    ).entries()) {
      const approvalContext = `${surface.id || context}.directoryPrefixApprovals[${approvalIndex}]`;
      if (!isObject(approval)) {
        errors.push(`${approvalContext} must be an object`);
        continue;
      }
      for (const field of ["prefix", "owner", "reason"]) {
        if (typeof approval[field] !== "string" || !approval[field].trim()) {
          errors.push(`${approvalContext}.${field} must be a non-empty string`);
        }
      }
      if (approvedPrefixes.has(approval.prefix)) {
        errors.push(`${surface.id || context} has duplicate directory approval ${approval.prefix}`);
      }
      approvedPrefixes.add(approval.prefix);
      if (!sourcePrefixes.includes(approval.prefix) || !approval.prefix?.endsWith("/")) {
        errors.push(`${approvalContext}.prefix must reference a directory sourcePrefix`);
      }
    }
    for (const sourcePrefix of sourcePrefixes.filter((prefix) => prefix.endsWith("/"))) {
      if (!approvedPrefixes.has(sourcePrefix)) {
        errors.push(
          `${surface.id || context} directory prefix ${sourcePrefix} requires an approval`,
        );
      }
    }
  }

  const overlapApprovals = manifest.ownershipOverlapApprovals ?? [];
  if (!Array.isArray(overlapApprovals)) {
    errors.push("ownershipOverlapApprovals must be an array");
  }
  const approvalKeys = new Set();
  for (const [index, approval] of (
    Array.isArray(overlapApprovals) ? overlapApprovals : []
  ).entries()) {
    const context = `ownershipOverlapApprovals[${index}]`;
    if (!isObject(approval)) {
      errors.push(`${context} must be an object`);
      continue;
    }
    for (const field of ["claimSurfaceId", "waiverSurfaceId", "prefix", "owner", "reason"]) {
      if (typeof approval[field] !== "string" || !approval[field].trim()) {
        errors.push(`${context}.${field} must be a non-empty string`);
      }
    }
    if (approval.allowScenarioClaim !== true) {
      errors.push(`${context}.allowScenarioClaim must be true`);
    }
    const key = approvalKey(approval);
    if (approvalKeys.has(key)) errors.push(`${context} duplicates another overlap approval`);
    approvalKeys.add(key);
    const claimSurface = surfaceById.get(approval.claimSurfaceId);
    const waiverSurface = surfaceById.get(approval.waiverSurfaceId);
    if (!claimSurface?.scenarioKeys?.length) {
      errors.push(`${context}.claimSurfaceId must reference a claiming surface`);
    }
    if (!waiverSurface?.waiver) {
      errors.push(`${context}.waiverSurfaceId must reference a waived surface`);
    }
    if (
      claimSurface &&
      waiverSurface &&
      !(claimSurface.sourcePrefixes ?? []).some((claimPrefix) =>
        (waiverSurface.sourcePrefixes ?? []).some(
          (waiverPrefix) =>
            sourcePrefixesOverlap(claimPrefix, waiverPrefix) &&
            approval.prefix === overlapPrefix(claimPrefix, waiverPrefix),
        ),
      )
    ) {
      errors.push(`${context}.prefix must identify the exact overlapping ownership region`);
    }
  }

  const claimingSurfaces = manifest.surfaces.filter((surface) => surface?.scenarioKeys?.length);
  const waivedSurfaces = manifest.surfaces.filter((surface) => surface?.waiver);
  const reportedOverlaps = new Set();
  for (const claimSurface of claimingSurfaces) {
    for (const waiverSurface of waivedSurfaces) {
      for (const claimPrefix of claimSurface.sourcePrefixes ?? []) {
        for (const waiverPrefix of waiverSurface.sourcePrefixes ?? []) {
          if (!sourcePrefixesOverlap(claimPrefix, waiverPrefix)) continue;
          const prefix = overlapPrefix(claimPrefix, waiverPrefix);
          const key = approvalKey({
            claimSurfaceId: claimSurface.id,
            waiverSurfaceId: waiverSurface.id,
            prefix,
          });
          if (reportedOverlaps.has(key)) continue;
          reportedOverlaps.add(key);
          if (!approvalKeys.has(key)) {
            errors.push(
              `unapproved claim/waiver overlap: ${claimSurface.id} and ${waiverSurface.id} at ${prefix}`,
            );
          }
        }
      }
    }
  }
  return errors;
}

export function assertValidCoverageManifest(manifest, options = {}) {
  const errors = validateCoverageManifest(manifest, options);
  if (errors.length) {
    throw new CoverageManifestError(
      `Coverage manifest validation failed: ${errors.join(" | ")}`,
      errors,
    );
  }
  return manifest;
}

export function parseCoverageManifest(raw, { source = "coverage manifest", ...options } = {}) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new CoverageManifestError(
      `Coverage manifest ${source} has invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return assertValidCoverageManifest(manifest, options);
}

export function loadCoverageManifestFile(
  manifestPath,
  { readFile = readFileSync, knownScenarioKey } = {},
) {
  let raw;
  try {
    raw = readFile(manifestPath, "utf8");
  } catch (error) {
    throw new CoverageManifestError(
      `Coverage manifest could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseCoverageManifest(raw, {
    source: manifestPath,
    knownScenarioKey,
  });
}

export function classifyCoverageFile(manifest, file) {
  const surfaces = (manifest.surfaces ?? []).filter((surface) =>
    changedFileMatchesSurface(file, surface),
  );
  const claimingSurfaces = surfaces.filter((surface) => surface.scenarioKeys?.length);
  const waiverSurfaces = surfaces.filter((surface) => surface.waiver);
  const unapprovedWaiverSurfaces = waiverSurfaces.filter(
    (waiverSurface) =>
      !claimingSurfaces.length ||
      claimingSurfaces.some(
        (claimSurface) => !overlapApprovalFor(manifest, file, claimSurface, waiverSurface),
      ),
  );
  const waiverDebt = waiverSurfaces.length > 0 && unapprovedWaiverSurfaces.length > 0;
  const scenarioKeys = waiverDebt
    ? []
    : [...new Set(claimingSurfaces.flatMap((surface) => surface.scenarioKeys ?? []))];
  return {
    file,
    surfaces,
    claimingSurfaces,
    waiverSurfaces,
    unapprovedWaiverSurfaces,
    waiverDebt,
    scenarioKeys,
  };
}
