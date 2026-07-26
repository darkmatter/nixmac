import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const contractUrl = new URL("./fixtures/suite-contract.v1.json", import.meta.url);
const contractBytes = readFileSync(contractUrl);
const parsedContract = JSON.parse(contractBytes);

function assertUniqueStrings(values, label) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} must contain unique non-empty strings`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

if (
  parsedContract?.version !== 1 ||
  parsedContract?.suiteVersion !== "computer-use-v1" ||
  parsedContract?.scenarioContractVersion !== 2
) {
  throw new Error("suite contract version metadata is invalid");
}
assertUniqueStrings(parsedContract.requiredScenarioKeys, "required scenario keys");
assertUniqueStrings(parsedContract.optionalScenarioKeys, "optional scenario keys");
assertUniqueStrings(parsedContract.scenarioFields, "scenario fields");
if (
  parsedContract.optionalScenarioKeys.some((key) =>
    parsedContract.requiredScenarioKeys.includes(key),
  )
) {
  throw new Error("required and optional scenario keys must not overlap");
}

export const suiteContract = deepFreeze(parsedContract);
export const scenarioCatalogDigest = `sha256:${createHash("sha256")
  .update(contractBytes)
  .digest("hex")}`;

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

export function validateScenarioCatalogKeys(labels) {
  const actual = new Set(Object.keys(labels || {}));
  const required = new Set(suiteContract.requiredScenarioKeys);
  if (!sameSet(actual, required)) {
    throw new Error("runner scenario catalog does not match the immutable suite contract");
  }
  return true;
}

export function validateScenarioContract(scenarios) {
  if (!scenarios || typeof scenarios !== "object" || Array.isArray(scenarios)) {
    throw new Error("state scenarios must be an object");
  }
  const actual = new Set(Object.keys(scenarios));
  const required = new Set(suiteContract.requiredScenarioKeys);
  const allowed = new Set([
    ...suiteContract.requiredScenarioKeys,
    ...suiteContract.optionalScenarioKeys,
  ]);
  if (
    [...required].some((key) => !actual.has(key)) ||
    [...actual].some((key) => !allowed.has(key))
  ) {
    throw new Error("state scenarios do not match the immutable suite contract");
  }

  const expectedFields = new Set(suiteContract.scenarioFields);
  const statuses = new Set(["pass", "fail", "inconclusive", "not_required"]);
  const nonemptyFields = [
    "label",
    "evidenceStrength",
    "evidenceStrengthReason",
    "failureClass",
    "failureClassReason",
    "accessibilityRisk",
    "accessibilityRiskReason",
  ];
  for (const [key, scenario] of Object.entries(scenarios)) {
    if (
      !scenario ||
      typeof scenario !== "object" ||
      Array.isArray(scenario) ||
      !sameSet(new Set(Object.keys(scenario)), expectedFields)
    ) {
      throw new Error(`scenario ${key} does not match the exact scenario schema`);
    }
    if (!statuses.has(scenario.status)) {
      throw new Error(`scenario ${key} has an invalid status`);
    }
    if (
      nonemptyFields.some(
        (field) => typeof scenario[field] !== "string" || scenario[field].length === 0,
      )
    ) {
      throw new Error(`scenario ${key} has an invalid required string field`);
    }
    for (const field of ["notes", "assertionTypes"]) {
      if (
        !Array.isArray(scenario[field]) ||
        scenario[field].some((value) => typeof value !== "string")
      ) {
        throw new Error(`scenario ${key} ${field} must contain only strings`);
      }
    }
  }
  return true;
}
