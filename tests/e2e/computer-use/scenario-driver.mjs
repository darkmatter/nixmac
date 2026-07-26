import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEvidenceTreeMutable } from "./evidence-guard.mjs";

const REQUIRED_DEPENDENCIES = [
  "addEvent",
  "saveState",
  "addNarrative",
  "redact",
  "containsUnmaskedSecret",
  "pngDimensions",
  "findElement",
];

function requireDependencies(dependencies) {
  const missing = REQUIRED_DEPENDENCIES.filter(
    (name) => typeof dependencies?.[name] !== "function",
  );
  if (missing.length > 0) {
    throw new TypeError(`Scenario driver dependencies missing: ${missing.join(", ")}`);
  }
  return dependencies;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function safeArtifactLabel(label) {
  return label.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

class ScenarioObservation extends String {}

function elementAddressForVisibleState(elementIndex, visibleState) {
  const target = visibleState?.target;
  if (!target) {
    return {
      kind: "codex-index",
      index: elementIndex,
    };
  }
  const normalizedElementIndex =
    typeof elementIndex === "number" ? elementIndex : Number(elementIndex);
  if (
    !Number.isInteger(normalizedElementIndex) ||
    !Number.isInteger(target.pid) ||
    !Number.isInteger(target.windowId) ||
    typeof target.snapshotId !== "string" ||
    target.snapshotId.trim() === ""
  ) {
    throw new TypeError("Scenario driver cannot resolve an element address from visible state");
  }
  return {
    kind: "cua-element-index",
    elementIndex: normalizedElementIndex,
    pid: target.pid,
    windowId: target.windowId,
    snapshotId: target.snapshotId,
  };
}

export function createScenarioDriverHelpers(dependencies) {
  const {
    addEvent,
    saveState,
    addNarrative,
    redact,
    containsUnmaskedSecret,
    pngDimensions,
    findElement,
    screenshotSource = "Computer Use visibleState image",
    sleep: wait = sleep,
  } = requireDependencies(dependencies);
  if (typeof wait !== "function") {
    throw new TypeError("Scenario driver sleep dependency must be a function");
  }
  const visibleStateByObservation = new WeakMap();

  function observationFor(text, visibleState) {
    const observation = new ScenarioObservation(text);
    visibleStateByObservation.set(observation, visibleState);
    return Object.freeze(observation);
  }

  function visibleStateFor(observation) {
    const visibleState = visibleStateByObservation.get(observation);
    if (!visibleState) {
      throw new TypeError(
        "Scenario driver actions require the observation that produced the element lookup",
      );
    }
    return visibleState;
  }

  async function captureState(driver, state, label, note = "") {
    await assertEvidenceTreeMutable(state.runDir);
    let visible = await driver.visibleState({ app: state.app });
    let rawText = visible.text;
    let text = redact(rawText);
    for (
      let attempt = 0;
      attempt < 8 && /procNotFound|no eligible process|not running|timed out/i.test(text);
      attempt += 1
    ) {
      await wait(1500);
      visible = await driver.visibleState({ app: state.app });
      rawText = visible.text;
      text = redact(rawText);
    }

    const image = visible.imageBase64;
    const safeLabel = safeArtifactLabel(label);
    const ordinal = String(state.textSnapshots.length + 1).padStart(2, "0");
    const textPath = path.join(state.runDir, "texts", `${ordinal}-${safeLabel}.txt`);
    await mkdir(path.dirname(textPath), { recursive: true });
    await writeFile(textPath, `${text}\n`, "utf8");
    state.textSnapshots.push({
      label,
      path: path.relative(state.runDir, textPath),
      capturedAt: new Date().toISOString(),
      note: redact(note),
    });

    const apiKeysHasUnmaskedSecret = /api-keys/i.test(label) && containsUnmaskedSecret(rawText);
    if (apiKeysHasUnmaskedSecret) {
      state.secretMaskingViolations.push(
        `${label} raw accessibility text contained an unmasked key-like secret; screenshot omitted.`,
      );
    }
    const sensitiveImage = /console/i.test(label) || apiKeysHasUnmaskedSecret;
    if (image && !sensitiveImage) {
      const pngPath = path.join(state.runDir, "screenshots", `${ordinal}-${safeLabel}.png`);
      await mkdir(path.dirname(pngPath), { recursive: true });
      await writeFile(pngPath, Buffer.from(image, "base64"));
      const dimensions = pngDimensions(pngPath);
      state.screenshots.push({
        label,
        path: path.relative(state.runDir, pngPath),
        capturedAt: new Date().toISOString(),
        note: redact(note),
        source: screenshotSource,
        ...(dimensions ? { imageSize: dimensions } : {}),
      });
    } else if (image && sensitiveImage) {
      await addEvent(state, "computer-use.screenshot-omitted", {
        label,
        reason: /api-keys/i.test(label)
          ? "API Keys image omitted because raw accessibility text contained an unmasked key-like secret; redacted text snapshot retained."
          : "Sensitive view image omitted from screenshot artifacts; redacted accessibility text snapshot retained.",
      });
    }
    if (note) await addNarrative(state, note);
    await addEvent(state, "computer-use.capture", { label, note: redact(note) });
    await saveState(state);
    return observationFor(text, visible);
  }

  async function clickElementIndex(driver, state, observation, elementIndex, label, note = "") {
    let result;
    try {
      const elementAddress = elementAddressForVisibleState(
        elementIndex,
        visibleStateFor(observation),
      );
      result = await driver.click({
        app: state.app,
        elementIndex,
        elementAddress,
      });
    } catch (error) {
      await addEvent(state, "computer-use.click.failed", {
        label,
        elementIndex,
        error: redact(error instanceof Error ? error.message : String(error)).slice(0, 800),
        note,
      });
      return false;
    }
    const responseText = redact(result?.text ?? "");
    if (result?.ok !== true) {
      await addEvent(state, "computer-use.click.failed", {
        label,
        elementIndex,
        response: responseText.slice(0, 800),
        isError: result?.isError === true,
        note,
      });
      return false;
    }
    await addEvent(state, "computer-use.click", {
      label,
      elementIndex,
      response: responseText.slice(0, 800),
      note,
    });
    return true;
  }

  async function clickByPattern(driver, state, text, label, patterns, note = "") {
    const elementIndex = findElement(text, patterns);
    if (!elementIndex) {
      await addEvent(state, "computer-use.click.skipped", {
        label,
        note: `No element found for ${label}`,
      });
      return false;
    }
    return clickElementIndex(driver, state, text, elementIndex, label, note);
  }

  async function setValueElementIndex(driver, state, observation, elementIndex, label, value) {
    let result;
    try {
      const elementAddress = elementAddressForVisibleState(
        elementIndex,
        visibleStateFor(observation),
      );
      result = await driver.setValue({
        app: state.app,
        elementIndex,
        elementAddress,
        value,
      });
    } catch (error) {
      await addEvent(state, "computer-use.set_value.failed", {
        label,
        elementIndex,
        error: redact(error instanceof Error ? error.message : String(error)).slice(0, 800),
      });
      return false;
    }
    const responseText = redact(result?.text ?? "");
    if (result?.ok !== true) {
      await addEvent(state, "computer-use.set_value.failed", {
        label,
        elementIndex,
        response: responseText.slice(0, 800),
        isError: result?.isError === true,
      });
      return false;
    }
    await addEvent(state, "computer-use.set_value", {
      label,
      elementIndex,
      response: responseText.slice(0, 800),
    });
    return true;
  }

  async function setValueByPattern(driver, state, text, label, patterns, value) {
    const elementIndex = findElement(text, patterns);
    if (!elementIndex) {
      await addEvent(state, "computer-use.set_value.skipped", {
        label,
        note: `No element found for ${label}`,
      });
      return false;
    }
    return setValueElementIndex(driver, state, text, elementIndex, label, value);
  }

  async function waitFor(driver, state, label, predicate, { attempts = 10, delayMs = 1500 } = {}) {
    let lastText = "";
    for (let index = 0; index < attempts; index += 1) {
      await wait(delayMs);
      lastText = await captureState(
        driver,
        state,
        `${label}-${String(index + 1).padStart(2, "0")}`,
        `Polling ${label}.`,
      );
      const result = predicate(lastText);
      if (result) return { ok: true, text: lastText, result };
    }
    return { ok: false, text: lastText };
  }

  return Object.freeze({
    captureState,
    clickByPattern,
    clickElementIndex,
    setValueByPattern,
    setValueElementIndex,
    waitFor,
  });
}
