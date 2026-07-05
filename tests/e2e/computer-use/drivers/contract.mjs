export const driverContractVersion = "nixmac-computer-use-driver.v1";

export const driverCapabilityKeys = Object.freeze([
  "connect",
  "visibleState",
  "findElement",
  "click",
  "setValue",
  "screenshotFromState",
  "textFromState",
  "close",
  "metadata",
  "wait",
]);

const requiredDriverCapabilities = Object.freeze([
  "connect",
  "visibleState",
  "findElement",
  "click",
  "setValue",
  "screenshotFromState",
  "textFromState",
  "close",
]);

export const currentRunnerDriverCapabilityUse = Object.freeze([...requiredDriverCapabilities]);

export const builtInElementAddressKinds = Object.freeze(["codex-index", "text-pattern"]);

function issue(code, path, message) {
  return { code, path, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateCodexIndexAddress(address) {
  const issues = [];
  const value = address.index;
  const normalized = typeof value === "number" ? String(value) : value;
  if (!/^\d+$/.test(normalized || "")) {
    issues.push(
      issue(
        "invalid_codex_index",
        "index",
        "codex-index addresses require a numeric index string or number.",
      ),
    );
  }
  return {
    ok: issues.length === 0,
    issues,
    normalized: issues.length ? null : { kind: "codex-index", index: normalized },
  };
}

function validateTextPatternAddress(address) {
  const issues = [];
  const patterns = Array.isArray(address.patterns)
    ? address.patterns
    : [{ source: address.source, flags: address.flags }];
  if (patterns.length === 0) {
    issues.push(
      issue(
        "missing_text_pattern",
        "patterns",
        "text-pattern addresses require at least one pattern.",
      ),
    );
  }
  for (const [index, pattern] of patterns.entries()) {
    if (
      !isPlainObject(pattern) ||
      typeof pattern.source !== "string" ||
      pattern.source.trim() === ""
    ) {
      issues.push(
        issue(
          "invalid_text_pattern_source",
          `patterns[${index}].source`,
          "text-pattern entries require a non-empty regex source.",
        ),
      );
    }
    if (pattern?.flags !== undefined && !/^[dgimsuvy]*$/.test(pattern.flags)) {
      issues.push(
        issue(
          "invalid_text_pattern_flags",
          `patterns[${index}].flags`,
          "text-pattern flags must be JavaScript RegExp flags.",
        ),
      );
    }
    if (typeof pattern?.source === "string" && pattern.source.trim() !== "") {
      try {
        new RegExp(pattern.source, pattern.flags || "");
      } catch (error) {
        issues.push(
          issue(
            "invalid_text_pattern_regex",
            `patterns[${index}].source`,
            `text-pattern source must compile as a RegExp: ${error.message}`,
          ),
        );
      }
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    normalized: issues.length
      ? null
      : {
          kind: "text-pattern",
          patterns: patterns.map((pattern) => ({
            source: pattern.source,
            flags: pattern.flags || "",
          })),
        },
  };
}

const builtInAddressValidators = Object.freeze({
  "codex-index": validateCodexIndexAddress,
  "text-pattern": validateTextPatternAddress,
});

export function validateElementAddress(address, { additionalAddressValidators = {} } = {}) {
  if (!isPlainObject(address)) {
    return {
      ok: false,
      issues: [issue("invalid_address", "", "Element address must be an object.")],
      normalized: null,
    };
  }
  if (typeof address.kind !== "string" || address.kind.trim() === "") {
    return {
      ok: false,
      issues: [issue("missing_address_kind", "kind", "Element address requires a kind.")],
      normalized: null,
    };
  }
  const validator =
    builtInAddressValidators[address.kind] || additionalAddressValidators[address.kind];
  if (!validator) {
    return {
      ok: false,
      issues: [
        issue("unknown_address_kind", "kind", `Unknown element address kind: ${address.kind}`),
      ],
      normalized: null,
    };
  }
  return validator(address);
}

export function validateDriverCapabilities(capabilities) {
  const issues = [];
  if (!isPlainObject(capabilities)) {
    return {
      ok: false,
      issues: [issue("invalid_capabilities", "capabilities", "Capabilities must be an object.")],
    };
  }
  for (const key of Object.keys(capabilities)) {
    if (!driverCapabilityKeys.includes(key)) {
      issues.push(
        issue("unknown_capability", `capabilities.${key}`, `Unknown driver capability: ${key}`),
      );
    }
    if (typeof capabilities[key] !== "boolean") {
      issues.push(
        issue(
          "invalid_capability_value",
          `capabilities.${key}`,
          "Driver capability values must be booleans.",
        ),
      );
    }
  }
  for (const key of requiredDriverCapabilities) {
    if (capabilities[key] !== true) {
      issues.push(
        issue(
          "missing_required_capability",
          `capabilities.${key}`,
          `Required driver capability is not declared true: ${key}`,
        ),
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateDriverDescriptor(descriptor, { additionalAddressValidators = {} } = {}) {
  const issues = [];
  if (!isPlainObject(descriptor)) {
    return {
      ok: false,
      issues: [issue("invalid_descriptor", "", "Driver descriptor must be an object.")],
    };
  }
  for (const key of ["id", "displayName", "contractVersion", "capabilities", "addressKinds"]) {
    if (!Object.hasOwn(descriptor, key))
      issues.push(issue("missing_descriptor_field", key, `Driver descriptor is missing ${key}.`));
  }
  if (descriptor.contractVersion !== driverContractVersion) {
    issues.push(
      issue(
        "invalid_contract_version",
        "contractVersion",
        `Driver descriptor must use ${driverContractVersion}.`,
      ),
    );
  }
  if (!Array.isArray(descriptor.addressKinds) || descriptor.addressKinds.length === 0) {
    issues.push(
      issue(
        "invalid_address_kinds",
        "addressKinds",
        "Driver descriptor requires at least one address kind.",
      ),
    );
  } else {
    const knownKinds = new Set([
      ...builtInElementAddressKinds,
      ...Object.keys(additionalAddressValidators),
    ]);
    for (const [index, kind] of descriptor.addressKinds.entries()) {
      if (!knownKinds.has(kind))
        issues.push(
          issue(
            "unknown_address_kind",
            `addressKinds[${index}]`,
            `Unknown driver address kind: ${kind}`,
          ),
        );
    }
  }
  issues.push(...validateDriverCapabilities(descriptor.capabilities).issues);
  return { ok: issues.length === 0, issues };
}

export function createDriverDescriptor(descriptor, options = {}) {
  const result = validateDriverDescriptor(descriptor, options);
  if (!result.ok) {
    throw new Error(
      `Invalid Computer Use driver descriptor: ${result.issues.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`,
    );
  }
  return Object.freeze({
    ...descriptor,
    addressKinds: Object.freeze([...descriptor.addressKinds]),
    capabilities: Object.freeze({ ...descriptor.capabilities }),
  });
}
