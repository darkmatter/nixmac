function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function stringOrNull(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a string or null`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

export function validateCleanupEvidence(value, { expectedRunId = "" } = {}) {
  const evidence = plainObject(value, "cleanup evidence");
  if (evidence.version !== 1) throw new Error("cleanup evidence version must be 1");
  if (!["pass", "fail"].includes(evidence.status)) {
    throw new Error("cleanup evidence status must be pass or fail");
  }
  if (evidence.planOnly !== false)
    throw new Error("cleanup evidence must come from a real restore");
  const runId = stringOrNull(evidence.runId, "cleanup evidence runId");
  if (expectedRunId && runId !== expectedRunId) {
    throw new Error(`cleanup evidence runId ${runId || "missing"} does not match ${expectedRunId}`);
  }

  const marker = plainObject(evidence.marker, "cleanup evidence marker");
  const system = plainObject(evidence.system, "cleanup evidence system");
  const formula = plainObject(evidence.formula, "cleanup evidence formula");
  if (!Array.isArray(evidence.errors) || evidence.errors.some((item) => typeof item !== "string")) {
    throw new TypeError("cleanup evidence errors must be an array of strings");
  }

  const originalSystem = stringOrNull(system.original, "cleanup evidence original system");
  const activeAfter = stringOrNull(system.activeAfter, "cleanup evidence active system");
  const profileAfter = stringOrNull(system.profileAfter, "cleanup evidence profile system");
  const verified =
    evidence.status === "pass" &&
    evidence.errors.length === 0 &&
    boolean(marker.loaded, "cleanup evidence marker.loaded") &&
    !boolean(marker.retained, "cleanup evidence marker.retained") &&
    boolean(system.restored, "cleanup evidence system.restored") &&
    originalSystem !== null &&
    activeAfter === originalSystem &&
    profileAfter === originalSystem &&
    formula.name === "hello" &&
    formula.installedBefore === false &&
    boolean(formula.restored, "cleanup evidence formula.restored") &&
    formula.installedAfter === false &&
    formula.executableAfter === false;

  return {
    ...evidence,
    runId,
    verified,
    marker: { ...marker },
    system: { ...system, original: originalSystem, activeAfter, profileAfter },
    formula: { ...formula },
    errors: [...evidence.errors],
  };
}

export function cleanupScenarioResult(value, options = {}) {
  try {
    const evidence = validateCleanupEvidence(value, options);
    if (evidence.verified) {
      return {
        status: "pass",
        note: `Always-run teardown restored ${evidence.system.original}, removed the known-absent ${evidence.formula.name} fixture formula, restored app/auth state, and cleared its recovery marker.`,
        evidence,
      };
    }
    return {
      status: "fail",
      note: `Host restoration evidence failed verification${evidence.errors.length ? `: ${evidence.errors.join("; ")}` : "."}`,
      evidence,
    };
  } catch (error) {
    return {
      status: "fail",
      note: `Host restoration evidence was missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
      evidence: null,
    };
  }
}
