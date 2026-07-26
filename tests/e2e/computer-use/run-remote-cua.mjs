#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { artifactFileIssue, artifactForLabel, pngDimensions } from "./artifact-utils.mjs";
import { assertEvidenceTreeMutable } from "./evidence-guard.mjs";
import { dispatchRemoteCuaCommand, remoteCuaUsage } from "./cli.mjs";
import { buildManifestPrFocus, isLikelyUserVisiblePrFile } from "./coverage-focus.mjs";
import {
  changedFileMatchesSurface,
  coverageCandidateFiles,
  loadCoverageManifestFile,
  unmappedCoverageCandidateFiles,
  walkCoverageFiles,
} from "./coverage-manifest.mjs";
import {
  builtInElementAddressKinds,
  createDriverDescriptor,
  currentRunnerDriverCapabilityUse,
  driverCapabilityKeys,
  driverContractVersion,
  validateCuaElementIndexAddress,
  validateDriverCapabilities,
  validateDriverDescriptor,
  validateElementAddress,
} from "./drivers/contract.mjs";
import { CodexAppServerDriver } from "./drivers/codex-app-server.mjs";
import { validateRuntimeDriver } from "./drivers/runtime-contract.mjs";
import { tryRun } from "./process-utils.mjs";
import {
  DEFAULT_PROMPT,
  EVOLVED_CASE_CATALOG,
  curatedProofKeys,
  isStableCoverageScenarioKey,
  scenarioVisualContracts,
  scenarioAssertionTypeHints,
  scenarioGroups,
  scenarioLabels,
  scenarioProofCatalog,
  screenshotAnnotations,
  supportedHomebrewSourcePaths,
} from "./scenario-catalog.mjs";
import { failureTaxonomy, scenarioContractVersion, v1GradeToEvidenceStrength } from "./schemas.mjs";
import {
  evaluateScreenshotVisualContract,
  imageArtifactIssue,
  parseSignalStats,
  probeCropForImage,
} from "./visual-proof.mjs";
import { renderReportHtml, safeFrameVideoPath } from "./report.mjs";
import {
  assertRunPreflight,
  finalizeLocalEvidence,
  recordRunPermissions,
  resolveRunPreflightIdentity,
  stageControllerEvidence,
  transitionRunAttempt,
  writeRunCleanup,
  writeRunPreflight,
  writeRunProvisioning,
} from "./run-metadata.mjs";
import { createScenarioDriverHelpers } from "./scenario-driver.mjs";
import { codexAppServerDriverDescriptor, elementEntries, findElement } from "./transport.mjs";
import { containsUnmaskedSecret, redact } from "./redaction.mjs";
import {
  addEvent,
  addTimingPhase,
  addNarrative,
  applyHistoricalRenderMigration,
  createBaseState,
  ensureCurrentSchema as ensureStateCurrentSchema,
  saveState,
  shouldFailProcessForVerdict,
  updateScenario,
  verdictFor,
} from "./state.mjs";
import { mergeTimingMetadata, nowIso } from "./timing.mjs";
import {
  captureRemoteMetadata as readRemoteMetadata,
  meaningfulBaselineDiff,
  remoteActivationPamSymlinkHang,
  remoteAppPathFromEnv,
  remoteConfigDirFromSettings,
  remoteGitSnapshot,
  scpArgs,
  scpToRemote,
  shellQuote,
  ssh,
  sshArgs,
} from "./remote-stage.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, "../../..");

const DEFAULT_APP = "com.darkmatter.nixmac";
const DEFAULT_WS = "ws://127.0.0.1:18790";
const DEFAULT_BUILD_ATTEMPTS = 180;
const ARTIFACT_ROOT = path.join(REPO_ROOT, "artifacts", "computer-use-remote");
const COVERAGE_MANIFEST_PATH = path.join(TOOL_DIR, "coverage-manifest.json");

let activeRunDir = "";
let activeRunFinalization = null;

const {
  captureState,
  clickByPattern,
  clickElementIndex,
  setValueByPattern,
  setValueElementIndex,
  waitFor,
} = createScenarioDriverHelpers({
  addEvent,
  saveState,
  addNarrative,
  redact,
  containsUnmaskedSecret,
  pngDimensions,
  findElement,
  screenshotSource: "Codex Computer Use get_app_state image",
});

function usage() {
  console.log(remoteCuaUsage({ defaultWs: DEFAULT_WS, defaultApp: DEFAULT_APP }));
}

function argValue(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function mergeWorkflowTimingsFromArgs(state, args) {
  const workflowTimingsPath = argValue(
    args,
    "--workflow-timings",
    process.env.NIXMAC_E2E_WORKFLOW_TIMINGS || "",
  );
  if (!workflowTimingsPath) return false;
  if (!existsSync(workflowTimingsPath)) {
    addTimingPhase(state, {
      id: "workflow-timing-metadata",
      label: "Workflow timing metadata",
      category: "reporting",
      source: "runner",
      status: "unavailable",
      observable: false,
      note: `Workflow timing metadata file was not found at ${workflowTimingsPath}.`,
    });
    return false;
  }
  const metadata = JSON.parse(await readFile(workflowTimingsPath, "utf8"));
  mergeTimingMetadata(state, metadata, { source: "github-actions" });
  return true;
}

function withRunDirArg(args, runDir) {
  if (!runDir || args.includes("--run-dir")) return args;
  return [...args, "--run-dir", runDir];
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "").replace("T", "T").replace("Z", "Z");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function readLocalAppBundleIdentity(appPath) {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const bundleId = run("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    infoPlist,
  ]);
  const { hashCuaBundleTree } = await import("./drivers/cua-driver.mjs");
  return {
    bundleId,
    digestSha256: await hashCuaBundleTree(appPath),
  };
}

export async function validateLocalCuaPreflight(
  { appBundleId, runDir },
  {
    env = process.env,
    canonicalPath = realpath,
    readBundleIdentity = readLocalAppBundleIdentity,
  } = {},
) {
  if (!path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("local CuaDriver runDir must be an absolute normalized path");
  }
  if (env.NIXMAC_E2E_DISPOSABLE_CONFIG !== "true") {
    throw new Error("local CuaDriver requires NIXMAC_E2E_DISPOSABLE_CONFIG=true");
  }
  const remoteTransportKeys = [
    "NIXMAC_COMPUTER_USE_WS",
    "NIXMAC_E2E_REMOTE_SSH_DEST",
    "NIXMAC_E2E_SSH_KEY",
    "NIXMAC_E2E_SSH_KNOWN_HOSTS",
    "NIXMAC_E2E_REMOTE_REPORT_DIR",
    "NIXMAC_E2E_REMOTE_CONFIG_DIR",
    "NIXMAC_E2E_REMOTE_APP_PATH",
  ].filter((key) => String(env[key] || "") !== "");
  if (remoteTransportKeys.length > 0) {
    throw new Error(
      `local CuaDriver forbids remote transport environment: ${remoteTransportKeys.join(", ")}`,
    );
  }
  const appArtifactSha = String(env.NIXMAC_E2E_APP_ARTIFACT_SHA || "");
  if (!/^[0-9a-f]{40}$/.test(appArtifactSha)) {
    throw new Error("NIXMAC_E2E_APP_ARTIFACT_SHA must be a full lowercase 40-character SHA");
  }
  const inputAppPath = String(env.NIXMAC_E2E_APP_PATH || "");
  if (
    !inputAppPath ||
    !path.isAbsolute(inputAppPath) ||
    path.normalize(inputAppPath) !== inputAppPath ||
    !inputAppPath.endsWith(".app")
  ) {
    throw new Error("NIXMAC_E2E_APP_PATH must be an absolute normalized .app path");
  }
  const appPath = await canonicalPath(inputAppPath);
  if (appPath !== inputAppPath) {
    throw new Error(`NIXMAC_E2E_APP_PATH must be canonical: expected ${appPath}`);
  }
  if (appPath.startsWith("/Applications/") || appPath.startsWith("/System/Applications/")) {
    throw new Error("NIXMAC_E2E_APP_PATH must not use a shared Applications path");
  }
  if (path.basename(path.dirname(appPath)) !== path.basename(runDir)) {
    throw new Error(
      "NIXMAC_E2E_APP_PATH must be staged in a run-specific directory named for the run directory",
    );
  }
  const inputStagingParent = String(env.NIXMAC_E2E_STAGING_PARENT || "");
  if (
    !inputStagingParent ||
    !path.isAbsolute(inputStagingParent) ||
    path.normalize(inputStagingParent) !== inputStagingParent
  ) {
    throw new Error("NIXMAC_E2E_STAGING_PARENT must be an absolute normalized path");
  }
  const stagingParent = await canonicalPath(inputStagingParent);
  if (stagingParent !== inputStagingParent || stagingParent !== path.dirname(appPath)) {
    throw new Error("NIXMAC_E2E_STAGING_PARENT must be canonical and directly own the app");
  }
  const inputDisposableConfigPath = String(env.NIXMAC_E2E_DISPOSABLE_CONFIG_PATH || "");
  if (
    !inputDisposableConfigPath ||
    !path.isAbsolute(inputDisposableConfigPath) ||
    path.normalize(inputDisposableConfigPath) !== inputDisposableConfigPath
  ) {
    throw new Error("NIXMAC_E2E_DISPOSABLE_CONFIG_PATH must be an absolute normalized path");
  }
  const disposableConfigPath = await canonicalPath(inputDisposableConfigPath);
  const configRelative = path.relative(stagingParent, disposableConfigPath);
  if (
    disposableConfigPath !== inputDisposableConfigPath ||
    configRelative === "" ||
    configRelative.startsWith("..") ||
    path.isAbsolute(configRelative)
  ) {
    throw new Error(
      "NIXMAC_E2E_DISPOSABLE_CONFIG_PATH must be canonical and owned by staging parent",
    );
  }
  const identity = await readBundleIdentity(appPath);
  if (identity.bundleId !== appBundleId) {
    throw new Error(
      `staged app bundle ID mismatch: expected ${appBundleId}, got ${identity.bundleId || "missing"}`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(identity.digestSha256 || "")) {
    throw new Error("staged app bundle digest must be a lowercase SHA-256");
  }
  return Object.freeze({
    appArtifactSha,
    appBundleDigestSha256: identity.digestSha256,
    appBundleId,
    appPath,
    disposableConfigPath,
    stagingParent,
  });
}

export async function verifyLocalCuaPreflight(
  preflight,
  { readBundleIdentity = readLocalAppBundleIdentity } = {},
) {
  const identity = await readBundleIdentity(preflight.appPath);
  if (identity.bundleId !== preflight.appBundleId) {
    throw new Error("staged app bundle ID changed after target preparation");
  }
  if (identity.digestSha256 !== preflight.appBundleDigestSha256) {
    throw new Error("staged app bundle digest changed after target preparation");
  }
  return preflight;
}

export async function createOwnedCuaSocketEndpoint({
  requestedPath = "",
  temporaryRoot = "",
} = {}) {
  let directory;
  let socketPath;
  if (requestedPath) {
    if (
      !path.isAbsolute(requestedPath) ||
      path.normalize(requestedPath) !== requestedPath ||
      Buffer.byteLength(requestedPath, "utf8") > 103
    ) {
      throw new Error("NIXMAC_CUA_DRIVER_SOCKET must be an absolute short Unix socket path");
    }
    directory = path.dirname(requestedPath);
    if (!path.basename(directory).startsWith("nx-cua-")) {
      throw new Error("explicit CuaDriver socket must use a unique nx-cua-* directory");
    }
    try {
      await lstat(directory);
      throw new Error("explicit CuaDriver socket directory must not already exist");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(directory, { recursive: false, mode: 0o700 });
    socketPath = requestedPath;
  } else {
    const root = temporaryRoot || (await realpath(os.tmpdir()));
    directory = await realpath(await mkdtemp(path.join(root, "nx-cua-")));
    socketPath = path.join(directory, "d.sock");
  }
  if (Buffer.byteLength(socketPath, "utf8") > 103) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("allocated CuaDriver Unix socket path exceeds 103 UTF-8 bytes");
  }
  return Object.freeze({ directory, path: socketPath });
}

export async function prepareSuiteDriver(
  driver,
  { executionTopology, appBundleId, localPreflight = null, beforePrepareTarget = async () => {} },
) {
  await driver.connect();
  await beforePrepareTarget();
  if (executionTopology === "local-cua-driver") {
    if (!localPreflight) throw new Error("local CuaDriver preflight identity is required");
    await driver.prepareTarget({
      appBundleId,
      appPath: localPreflight.appPath,
    });
    return;
  }
  if (executionTopology !== "remote-codex-app-server") {
    throw new Error(`unsupported Computer Use execution topology: ${executionTopology}`);
  }
  await driver.prepareTarget({ appBundleId });
}

function processCleanupSnapshot(role, instance) {
  if (instance == null) {
    return {
      entry: {
        role,
        status: "not_started",
        pid: null,
        birthMarker: null,
        executable: null,
        terminated: true,
      },
      failure: "",
    };
  }
  if (
    Number.isSafeInteger(instance.pid) &&
    instance.pid > 0 &&
    typeof instance.birthMarker === "string" &&
    instance.birthMarker !== "" &&
    typeof instance.executable === "string" &&
    path.isAbsolute(instance.executable) &&
    path.normalize(instance.executable) === instance.executable
  ) {
    return {
      entry: {
        role,
        status: "owned",
        pid: instance.pid,
        birthMarker: instance.birthMarker,
        executable: instance.executable,
        terminated: false,
      },
      failure: "",
    };
  }
  return {
    entry: {
      role,
      status: "not_started",
      pid: null,
      birthMarker: null,
      executable: null,
      terminated: true,
    },
    failure: `${role} process identity was present but could not be attested exactly`,
  };
}

function captureLifecycleForRun({ uiStarted, failure }) {
  if (uiStarted) return { status: "available", uiStarted: true, reason: "" };
  const reason = redact(
    failure instanceof Error
      ? failure.message
      : failure
        ? String(failure)
        : "the runner stopped before UI capture began",
  );
  return {
    status: "not_started",
    uiStarted: false,
    reason: reason || "the runner stopped before UI capture began",
  };
}

export async function writeAndAssertLocalRunPreflight(
  { driver, localPreflight, runDir },
  {
    env = process.env,
    resolvePreflight = resolveRunPreflightIdentity,
    writePreflight = writeRunPreflight,
    assertPreflight = assertRunPreflight,
  } = {},
) {
  if (!driver?.metadata?.cli?.version || !driver?.metadata?.app?.short_version) {
    throw new Error("connected CuaDriver pinned version metadata is required before UI");
  }
  if (driver.connected !== true) {
    throw new Error("CuaDriver live permission probe must succeed before run preflight");
  }
  if (
    typeof driver.socketPath !== "string" ||
    !path.isAbsolute(driver.socketPath) ||
    path.normalize(driver.socketPath) !== driver.socketPath
  ) {
    throw new Error("connected CuaDriver canonical daemon socket path is required before UI");
  }
  const input = await resolvePreflight({
    env: {
      ...env,
      NIXMAC_E2E_STAGING_PARENT: localPreflight.stagingParent,
      NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: localPreflight.disposableConfigPath,
      NIXMAC_E2E_DAEMON_SOCKET_DIRECTORY: path.dirname(driver.socketPath),
      NIXMAC_E2E_DAEMON_SOCKET_PATH: driver.socketPath,
    },
    repoRoot: REPO_ROOT,
    appBundlePath: localPreflight.appPath,
    appBundleDigest: localPreflight.appBundleDigestSha256,
    cuaDriverCliVersion: driver.metadata.cli.version,
    cuaDriverAppVersion: driver.metadata.app.short_version,
    accessibilityGranted: true,
    screenRecordingGranted: true,
  });
  await writePreflight(runDir, input);
  return assertPreflight(runDir);
}

export async function writeLocalRunProvisioning(
  { driver, runDir, socketEndpoint },
  {
    env = process.env,
    resolvePreflight = resolveRunPreflightIdentity,
    writeProvisioning = writeRunProvisioning,
    probeExpectedAppBundleDigest = async (appBundlePath) => {
      const { hashCuaBundleTree } = await import("./drivers/cua-driver.mjs");
      return hashCuaBundleTree(appBundlePath);
    },
  } = {},
) {
  if (!driver?.metadata?.cli?.version || !driver?.metadata?.app?.short_version) {
    throw new Error("pinned CuaDriver version metadata is required before provisioning");
  }
  if (
    !socketEndpoint ||
    typeof socketEndpoint.directory !== "string" ||
    typeof socketEndpoint.path !== "string"
  ) {
    throw new Error("owned CuaDriver socket endpoint is required before provisioning");
  }
  const appBundlePath = env.NIXMAC_E2E_APP_PATH || "";
  const appBundleDigest =
    env.NIXMAC_E2E_APP_BUNDLE_DIGEST || (await probeExpectedAppBundleDigest(appBundlePath));
  const input = await resolvePreflight({
    env: {
      ...env,
      NIXMAC_E2E_STAGING_PARENT: env.NIXMAC_E2E_STAGING_PARENT || path.dirname(appBundlePath),
      NIXMAC_E2E_DISPOSABLE_CONFIG_PATH:
        env.NIXMAC_E2E_DISPOSABLE_CONFIG_PATH || path.join(path.dirname(appBundlePath), "config"),
      NIXMAC_E2E_DAEMON_SOCKET_DIRECTORY: socketEndpoint.directory,
      NIXMAC_E2E_DAEMON_SOCKET_PATH: socketEndpoint.path,
    },
    repoRoot: REPO_ROOT,
    appBundlePath,
    appBundleDigest,
    cuaDriverCliVersion: driver.metadata.cli.version,
    cuaDriverAppVersion: driver.metadata.app.short_version,
    accessibilityGranted: true,
    screenRecordingGranted: true,
  });
  await writeProvisioning(runDir, input);
  return Object.freeze({ input });
}

function findQuestionInputEntry(text) {
  return (
    elementEntries(text).find((entry) =>
      /Type your answer|question-prompt-input/i.test(entry.label),
    ) || null
  );
}

function findQuestionSubmitEntry(text, inputEntry) {
  if (!inputEntry) return null;
  return (
    elementEntries(text).find(
      (entry) =>
        entry.lineNumber > inputEntry.lineNumber &&
        entry.lineNumber <= inputEntry.lineNumber + 12 &&
        /^button\s+Send\b/i.test(entry.label),
    ) || null
  );
}

function findQuestionChoiceEntry(text, patterns = []) {
  const entries = elementEntries(text);
  const marker = entries.find((entry) =>
    /question|clarifying|Choices?:|HelpCircle|asked/i.test(entry.label),
  );
  const isCandidateChoice = (entry) =>
    /^button\b/i.test(entry.label) &&
    !/\b(Stop|Send|Settings|History|Console|Feedback|Report Issue|Build & Test|Discard|Summary|Diff|Close|Cancel)\b/i.test(
      entry.label,
    );
  const configuredChoice = entries.find(
    (entry) => isCandidateChoice(entry) && patterns.some((pattern) => pattern.test(entry.label)),
  );
  if (!marker) return configuredChoice || null;
  const buttonEntries = entries.filter(
    (entry) =>
      entry.lineNumber >= marker.lineNumber &&
      entry.lineNumber <= marker.lineNumber + 24 &&
      isCandidateChoice(entry),
  );
  return (
    buttonEntries.find((entry) => patterns.some((pattern) => pattern.test(entry.label))) ||
    buttonEntries[0] ||
    null
  );
}

function hasAnsweredQuestionEvidence(text, answer) {
  const escaped = String(answer).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`Answered:\\s*${escaped}`, "i").test(text) ||
    (/Answered:/i.test(text) && !findQuestionInputEntry(text))
  );
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function countMatches(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasSettingsFrameEvidence(text) {
  return (
    /button Close settings/i.test(text) &&
    /\btext Settings\b/i.test(text) &&
    countMatches(text, [
      /button General/i,
      /button AI Models/i,
      /button API Keys/i,
      /button Preferences/i,
    ]) >= 3
  );
}

function hasSettingsGeneralEvidence(text) {
  return (
    hasSettingsFrameEvidence(text) &&
    countMatches(text, [
      /heading General/i,
      /Configuration Directory/i,
      /button Browse/i,
      /\bHost\b/i,
      /Send diagnostics/i,
      /Privacy policy/i,
    ]) >= 2
  );
}

function hasSettingsAIModelsEvidence(text) {
  return (
    hasSettingsFrameEvidence(text) &&
    countMatches(text, [
      /heading AI Models/i,
      /Evolution Model/i,
      /Summary Model/i,
      /\bProvider\b/i,
      /Model Name/i,
      /Token Budget/i,
      /Max Build Attempts/i,
    ]) >= 3
  );
}

function hasSettingsAPIKeysEvidence(text) {
  return (
    hasSettingsFrameEvidence(text) &&
    countMatches(text, [
      /heading API Keys/i,
      /heading OpenRouter/i,
      /heading OpenAI/i,
      /\bAPI Key\b/i,
      /secure text field/i,
      /API Base URL/i,
    ]) >= 3
  );
}

function hasSettingsPreferencesEvidence(text) {
  return (
    hasSettingsFrameEvidence(text) &&
    countMatches(text, [
      /heading Preferences/i,
      /Confirmation dialogs/i,
      /\bBuild\b/i,
      /Clear \/ Discard/i,
      /\bRollback\b/i,
      /Summarization/i,
      /switch \(settable/i,
    ]) >= 3
  );
}

function splitEnvList(value = "") {
  return String(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function enabledExtraEvolvedCases() {
  return splitEnvList(process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES || "")
    .map((id) => EVOLVED_CASE_CATALOG[id])
    .filter(Boolean);
}

function evolvedCaseStrategy(extraCases = enabledExtraEvolvedCases()) {
  return {
    selectedAt: new Date().toISOString(),
    defaultCaseIds: ["homebrew-bat"],
    extraCaseIds: extraCases.map((item) => item.id),
    catalog: Object.values(EVOLVED_CASE_CATALOG).map((item) => ({
      id: item.id,
      label: item.label,
      mode: item.mode,
      defaultPrLane: item.defaultPrLane,
      source: item.source,
      note: item.note,
    })),
    reviewDecision:
      "Claude review kept homebrew-bat as the only default full-lifecycle PR case, moved screenshots-defaults to optional calibration, and moved protected-flake-input to an adversarial advisory lane until hard backend enforcement exists.",
  };
}

function buildPrFocus() {
  const changedFiles = splitEnvList(process.env.NIXMAC_E2E_PR_CHANGED_FILES || "");
  const manifest = loadCoverageManifest();
  const focus = buildManifestPrFocus({
    changedFiles,
    manifest,
    knownScenarioKey: isStableCoverageScenarioKey,
    scenarioSuggestionForFile(file, matchedSurfaces) {
      const waiver = matchedSurfaces.find((surface) => surface.waiver)?.waiver;
      if (waiver?.exitCriteria) {
        return `Add a dedicated Computer Use scenario for ${file}: ${waiver.exitCriteria}`;
      }
      return `Add or extend a Computer Use scenario that exercises ${file}, then map it in coverage-manifest.json.`;
    },
  });
  return {
    eventName: process.env.GITHUB_EVENT_NAME || process.env.NIXMAC_E2E_PR_EVENT || "",
    number: process.env.NIXMAC_E2E_PR_NUMBER || process.env.GITHUB_PR_NUMBER || "",
    title: process.env.NIXMAC_E2E_PR_TITLE || "",
    headRef: process.env.NIXMAC_E2E_PR_HEAD_REF || process.env.GITHUB_HEAD_REF || "",
    baseRef: process.env.NIXMAC_E2E_PR_BASE_REF || process.env.GITHUB_BASE_REF || "",
    ...focus,
    configured: Boolean(
      process.env.NIXMAC_E2E_PR_NUMBER ||
      process.env.GITHUB_PR_NUMBER ||
      process.env.GITHUB_EVENT_NAME === "pull_request",
    ),
  };
}

function loadCoverageManifest() {
  return loadCoverageManifestFile(COVERAGE_MANIFEST_PATH, {
    knownScenarioKey: isStableCoverageScenarioKey,
  });
}

function sourcePrefixExists(sourcePath) {
  const fullPath = path.join(REPO_ROOT, sourcePath);
  if (!existsSync(fullPath)) return false;
  if (!sourcePath.endsWith("/")) return true;
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function isIsoDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function managedWaiverFor(surface) {
  const raw = surface.waiver;
  if (!raw) return null;
  if (typeof raw === "string") {
    return {
      id: surface.id,
      label: surface.label,
      reason: raw,
      owner: null,
      created: null,
      reviewBy: null,
      risk: null,
      exitCriteria: null,
      deprecatedShape: true,
      validationErrors: [
        "waiver uses deprecated string shape; use a managed waiver object with owner, created, reviewBy, risk, and exitCriteria",
      ],
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      id: surface.id,
      label: surface.label,
      reason: "",
      owner: null,
      created: null,
      reviewBy: null,
      risk: null,
      exitCriteria: null,
      validationErrors: ["waiver must be either a string or a managed waiver object"],
    };
  }
  const waiver = {
    id: surface.id,
    label: surface.label,
    reason: raw.reason || "",
    owner: raw.owner || "",
    created: raw.created || "",
    reviewBy: raw.reviewBy || "",
    risk: raw.risk || "",
    exitCriteria: raw.exitCriteria || "",
    deprecatedShape: false,
    validationErrors: [],
  };
  for (const field of ["reason", "owner", "created", "reviewBy", "risk", "exitCriteria"]) {
    if (!waiver[field]) waiver.validationErrors.push(`waiver is missing required field ${field}`);
  }
  if (waiver.created && !isIsoDateOnly(waiver.created)) {
    waiver.validationErrors.push(
      `waiver created date ${waiver.created} must be a valid YYYY-MM-DD date`,
    );
  }
  if (waiver.reviewBy && !isIsoDateOnly(waiver.reviewBy)) {
    waiver.validationErrors.push(
      `waiver review date ${waiver.reviewBy} must be a valid YYYY-MM-DD date`,
    );
  }
  if (waiver.reviewBy && waiver.reviewBy < new Date().toISOString().slice(0, 10)) {
    waiver.validationErrors.push(`waiver review date ${waiver.reviewBy} is expired`);
  }
  if (waiver.risk && !["low", "medium", "high"].includes(waiver.risk)) {
    waiver.validationErrors.push(`waiver risk ${waiver.risk} must be low, medium, or high`);
  }
  return waiver;
}

function buildCoverageFreshness() {
  const manifest = loadCoverageManifest();
  const surfaces = manifest.surfaces || [];
  const drift = [];
  const waivers = [];
  let mapped = 0;

  for (const surface of surfaces) {
    const scenarioKeys = surface.scenarioKeys || [];
    const unknown = scenarioKeys.filter((key) => !isStableCoverageScenarioKey(key));
    const missingSources = (surface.sourcePrefixes || []).filter(
      (sourcePath) => !sourcePrefixExists(sourcePath),
    );
    const waiver = managedWaiverFor(surface);
    if (waiver) {
      waivers.push(waiver);
      for (const error of waiver.validationErrors) drift.push(`${surface.id} ${error}`);
    }
    if (unknown.length)
      drift.push(`${surface.id} maps to unknown scenarios: ${unknown.join(", ")}`);
    if (missingSources.length)
      drift.push(`${surface.id} references missing source paths: ${missingSources.join(", ")}`);
    if (!scenarioKeys.length && !surface.waiver && surface.coverageDisposition !== "non-claiming")
      drift.push(`${surface.id} has no scenario mapping and no waiver.`);
    if (scenarioKeys.length) mapped += 1;
  }

  const files = walkCoverageFiles(REPO_ROOT, manifest.candidateRoots || []);
  const candidates = coverageCandidateFiles(manifest, files);
  const unmappedCandidateFiles = unmappedCoverageCandidateFiles(manifest, files);
  if (unmappedCandidateFiles.length)
    drift.push(`Unmapped user-visible candidate files: ${unmappedCandidateFiles.join(", ")}`);

  return {
    manifestVersion: manifest.version,
    checkedAt: new Date().toISOString(),
    totalSurfaces: surfaces.length,
    mappedSurfaces: mapped,
    waivedSurfaces: waivers.length,
    candidateFiles: candidates.length,
    candidateFilePaths: candidates,
    unmappedCandidateFiles,
    waivers,
    drift,
  };
}

function updateMainCoverageFreshness(state) {
  state.coverageFreshness = buildCoverageFreshness();
  const drift = state.coverageFreshness.drift || [];
  const waiverNote = state.coverageFreshness.waivers?.length
    ? ` Explicit waivers: ${state.coverageFreshness.waivers.map((item) => `${item.id} (${item.owner || "unowned"}, review by ${item.reviewBy || "unset"}): ${item.reason}`).join(" | ")}`
    : "";
  if (state.scenarios.mainCoverageFreshness?.notes) {
    state.scenarios.mainCoverageFreshness.notes = [];
  }
  updateScenario(
    state,
    "mainCoverageFreshness",
    drift.length ? "fail" : "pass",
    drift.length
      ? `Coverage drift detected against main: ${drift.join("; ")}${waiverNote}`
      : `Coverage manifest v${state.coverageFreshness.manifestVersion} maps ${state.coverageFreshness.totalSurfaces} user-visible surfaces to scenarios or explicit waivers.${waiverNote}`,
  );
}

function updatePrSpecificCoverage(state) {
  const debtFiles = [
    ...new Set([
      ...(state.prFocus?.waivedUserVisibleFiles ?? []),
      ...(state.prFocus?.unmatchedUserVisibleFiles ?? []),
      ...(state.prFocus?.unmappedUserVisibleFiles ?? []),
    ]),
  ];
  if (!state.prFocus?.configured) {
    updateScenario(
      state,
      "prSpecificCoverage",
      "pass",
      "No PR metadata was provided, so the optional PR-specific focus lane was not applicable for this run.",
    );
  } else if (!state.prFocus.changedFiles?.length) {
    updateScenario(
      state,
      "prSpecificCoverage",
      "inconclusive",
      "PR metadata was provided, but changed-file metadata was not available.",
    );
  } else if (!state.prFocus.userVisibleFiles?.length) {
    updateScenario(
      state,
      "prSpecificCoverage",
      "pass",
      "Changed-file metadata did not infer user-visible app changes requiring a dedicated Computer Use focus pass.",
    );
  } else if (debtFiles.length) {
    updateScenario(
      state,
      "prSpecificCoverage",
      "inconclusive",
      `PR-specific coverage remains incomplete because user-visible changed files are waived or unmatched: ${debtFiles.join(", ")}`,
    );
  } else if (
    state.prFocus.nonClaimingUserVisibleFiles?.length === state.prFocus.userVisibleFiles.length
  ) {
    updateScenario(
      state,
      "prSpecificCoverage",
      "pass",
      `All user-visible changed files are explicitly classified as non-claiming runtime plumbing, so no dedicated Computer Use scenario is required: ${state.prFocus.nonClaimingUserVisibleFiles.join(", ")}`,
    );
  } else if (state.prFocus.scenarioKeys?.length) {
    const mappedScenarios = state.prFocus.scenarioKeys
      .filter((key) => key !== "prSpecificCoverage")
      .map((key) => ({
        key,
        label: state.scenarios[key]?.label || key,
        status: state.scenarios[key]?.status || "inconclusive",
      }));
    const failed = mappedScenarios.filter((scenario) => scenario.status === "fail");
    const incomplete = mappedScenarios.filter(
      (scenario) => scenario.status !== "pass" && scenario.status !== "fail",
    );
    if (!mappedScenarios.length) {
      updateScenario(
        state,
        "prSpecificCoverage",
        "inconclusive",
        `User-visible changed files were inferred, but no dedicated PR-specific Computer Use scenario has been executed yet: ${state.prFocus.userVisibleFiles.join(", ")}`,
      );
    } else if (failed.length) {
      updateScenario(
        state,
        "prSpecificCoverage",
        "fail",
        `User-visible changed files mapped to scenarios, but PR-focused scenarios failed: ${failed.map((scenario) => scenario.label).join(", ")}`,
      );
    } else if (incomplete.length) {
      updateScenario(
        state,
        "prSpecificCoverage",
        "inconclusive",
        `User-visible changed files mapped to scenarios, but PR-focused scenarios did not all complete: ${incomplete.map((scenario) => scenario.label).join(", ")}`,
      );
    } else {
      updateScenario(
        state,
        "prSpecificCoverage",
        "pass",
        `User-visible changed files were mapped to passing Computer Use scenarios and surfaced at the top of the report: ${mappedScenarios.map((scenario) => scenario.label).join(", ")}`,
      );
    }
  } else {
    updateScenario(
      state,
      "prSpecificCoverage",
      "inconclusive",
      `User-visible changed files were inferred, but no dedicated PR-specific Computer Use scenario has been executed yet: ${state.prFocus.userVisibleFiles.join(", ")}`,
    );
  }
}

function updateStorybookPreviewCoverage(state) {
  const preview = state.storybookPreview || {};
  if (state.scenarios.storybookPreview?.notes) state.scenarios.storybookPreview.notes = [];
  if (!preview.uiFiles?.length) {
    updateScenario(
      state,
      "storybookPreview",
      "pass",
      "No changed frontend UI source files were detected, so a Storybook preview was not required.",
    );
    return;
  }
  if (preview.status === "ready" || preview.status === "ready_with_advisories") {
    updateScenario(
      state,
      "storybookPreview",
      "pass",
      `Storybook preview resolved ${preview.affectedStories?.length || 0} changed UI file(s) to direct story URLs.${preview.advisoryStoryFiles?.length ? ` ${preview.advisoryStoryFiles.length} advisory story gap(s) are listed for follow-up.` : ""}${preview.uiOnly ? " Native Computer Use was skipped by UI-only policy." : ""}`,
    );
  } else if (preview.status === "missing_story") {
    updateScenario(
      state,
      "storybookPreview",
      "fail",
      `Changed UI files are missing Storybook story mappings: ${(preview.missingStoryFiles || []).map((item) => item.file).join(", ")}`,
    );
  } else if (preview.status === "build_failed") {
    updateScenario(
      state,
      "storybookPreview",
      "fail",
      "Storybook preview build failed, so affected UI cannot be reviewed through the preview artifact.",
    );
  } else if (preview.status === "index_unavailable" || preview.status === "invalid_metadata") {
    updateScenario(
      state,
      "storybookPreview",
      "fail",
      `Storybook preview metadata was not usable: ${preview.status}.`,
    );
  } else {
    updateScenario(
      state,
      "storybookPreview",
      "inconclusive",
      `Storybook preview metadata was not reviewer-ready: ${preview.status || "unknown"}.`,
    );
  }
}

function ensureCurrentSchema(state) {
  return ensureStateCurrentSchema(state, {
    scenarioLabels,
    evolvedCaseStrategy,
    buildPrFocus,
    pngDimensions,
    env: process.env,
  });
}

function proofForScenario(state, key) {
  const proof = scenarioProofCatalog[key] || {
    grade: "insufficient",
    screenshots: [],
    texts: [],
    proof: "No proof catalog entry has been defined for this scenario.",
    untested: "Assertion quality has not been classified.",
  };
  const screenshotArtifacts = proof.screenshots
    .map((label) => artifactForLabel(state.screenshots, label))
    .filter(Boolean);
  const textArtifacts = proof.texts
    .map((label) => artifactForLabel(state.textSnapshots, label))
    .filter(Boolean);
  return { ...proof, screenshotArtifacts, textArtifacts };
}

function assertionTypesForScenario(key, proof = scenarioProofCatalog[key] || {}) {
  const hints = scenarioAssertionTypeHints[key] || [];
  const derived = [];
  if (proof.texts?.length) derived.push("accessibility_text");
  if (proof.screenshots?.length) derived.push("visual_heuristic");
  if (scenarioVisualContracts[key]) derived.push("visual_signalstats");
  const merged = [...new Set([...hints, ...derived])];
  return merged.length ? merged : ["not_classified"];
}

function evidenceStrengthForScenario(state, key) {
  const scenario = state.scenarios?.[key];
  const proof = proofForScenario(state, key);
  if (!scenario || scenario.status !== "pass") {
    return {
      strength: "not-proved",
      reason: "Scenario did not pass, so no positive evidence strength is assigned.",
    };
  }
  if (
    ["saveFlow", "rollbackCleanup", "customizationSaveRollback", "homebrewSaveRollback"].includes(
      key,
    )
  ) {
    return {
      strength: "strong",
      reason: "Computer Use path is backed by independent disposable git state proof.",
    };
  }
  if (proof.grade === "text-confirmed" && proof.screenshotArtifacts.length === 0) {
    return {
      strength: "weak",
      reason:
        "Pass relies on redacted accessibility text only, usually because screenshots are intentionally suppressed for a sensitive surface.",
    };
  }
  const strength = v1GradeToEvidenceStrength[proof.grade] || "not-proved";
  const reasonByStrength = {
    strong: "User-visible interaction is backed by independent state proof.",
    operational: "Computer Use interacted with the real UI and matched expected state.",
    "visual-supported":
      "Accessibility text is the semantic assertion source and screenshot signal checks provide binding visual corroboration where screenshots are safe to store.",
    weak: "The claim depends on sparse text, calibration, or intentionally limited artifacts.",
    "not-proved": "The scenario is skipped, inconclusive, or lacks sufficient proof artifacts.",
  };
  return { strength, reason: reasonByStrength[strength] || reasonByStrength["not-proved"] };
}

function classifyScenarioResult(key, scenario) {
  if (!scenario || scenario.status === "pass") return { class: "", reason: "" };
  const note = scenario.notes?.join(" ") || "";
  if (/api key|credential|unauthorized|401|missing key|invalid key/i.test(note)) {
    return {
      class: "credential",
      reason: "Provider credential wording was detected in the scenario notes.",
    };
  }
  if (
    /OpenRouter|provider|billing|credits|rate.?limit|timeout|model error|payment required/i.test(
      note,
    )
  ) {
    return {
      class: "provider",
      reason: "Provider-side failure wording was detected in the scenario notes.",
    };
  }
  if (
    /DXU|SSH|remote|launchd|app-server|WebSocket|administrator authentication|authorization|activation|sudo|pam|macOS|MacinCloud/i.test(
      note,
    )
  ) {
    return {
      class: "remote_infra",
      reason: "Remote Mac, launch, authorization, or activation wording was detected.",
    };
  }
  if (
    /Computer Use could not|click|set_value|artifact|screenshot|text snapshot|ffmpeg|report|proof catalog|proof artifact|runner/i.test(
      note,
    )
  ) {
    return {
      class: "harness",
      reason: "Runner, Computer Use action, or artifact wording was detected.",
    };
  }
  if (
    /coverage|manifest|PR metadata|mapped scenario|added after this run|not exercised|no dedicated|waiver/i.test(
      note,
    ) ||
    /Coverage|Freshness|prSpecificCoverage/.test(key)
  ) {
    return { class: "coverage", reason: "Coverage or mapping wording was detected." };
  }
  if (
    /blank WebView|did not visibly|did not show|missing|not visible|no Restore|boundary was missing|wrong content|mismatch/i.test(
      note,
    )
  ) {
    return { class: "app", reason: "App UI/state mismatch wording was detected." };
  }
  return { class: "inconclusive", reason: "No more specific failure class matched." };
}

function accessibilityRiskForScenario(state, key) {
  const scenario = state.scenarios?.[key];
  const proof = proofForScenario(state, key);
  const assertionTypes = assertionTypesForScenario(key, proof);
  if (assertionTypes.includes("remote_state") || assertionTypes.includes("coverage_manifest")) {
    return {
      risk: scenario?.status === "pass" ? "low" : "medium",
      reason: "The claim has non-UI state or manifest proof in addition to UI evidence.",
    };
  }
  if (proof.textArtifacts.length > 0 && proof.screenshotArtifacts.length === 0) {
    return {
      risk: "high",
      reason:
        "The claim depends on accessibility text without a screenshot, usually due sensitive-surface redaction.",
    };
  }
  if (assertionTypes.includes("accessibility_text")) {
    return {
      risk: assertionTypes.includes("visual_signalstats") ? "low" : "medium",
      reason: assertionTypes.includes("visual_signalstats")
        ? "Accessibility text is the semantic assertion source and screenshot signal checks corroborate safe-to-store visual evidence."
        : "Accessibility text is the semantic assertion source without binding screenshot checks.",
    };
  }
  return {
    risk: "low",
    reason: "The scenario is not primarily an accessibility-text assertion.",
  };
}

function buildScenarioContract(state, key) {
  const proof = proofForScenario(state, key);
  const scenario = state.scenarios?.[key] || { status: "inconclusive", notes: [] };
  const failure = classifyScenarioResult(key, scenario);
  const evidence = evidenceStrengthForScenario(state, key);
  const accessibility = accessibilityRiskForScenario(state, key);
  const visualAssertion = state.visualAssertions?.find((item) => item.scenarioKey === key) || null;
  return {
    id: key,
    label: scenario.label || scenarioLabels[key] || key,
    status: scenario.status || "inconclusive",
    legacyEvidenceGrade: proof.grade,
    evidenceStrength: evidence.strength,
    evidenceStrengthReason: evidence.reason,
    assertionTypes: assertionTypesForScenario(key, proof),
    failureClass: failure.class,
    failureClassReason: failure.reason,
    accessibilityRisk: accessibility.risk,
    accessibilityRiskReason: accessibility.reason,
    visualAssertionStatus:
      visualAssertion?.status || (scenarioVisualContracts[key] ? "not-run" : "not-applicable"),
    proof: proof.proof,
    limitation: proof.untested,
  };
}

function updateV2Contracts(state) {
  state.v2 ||= {};
  const scenarioContracts = {};
  for (const key of Object.keys(state.scenarios || {})) {
    scenarioContracts[key] = buildScenarioContract(state, key);
    state.scenarios[key].evidenceStrength = scenarioContracts[key].evidenceStrength;
    state.scenarios[key].evidenceStrengthReason = scenarioContracts[key].evidenceStrengthReason;
    state.scenarios[key].assertionTypes = scenarioContracts[key].assertionTypes;
    state.scenarios[key].failureClass = scenarioContracts[key].failureClass;
    state.scenarios[key].failureClassReason = scenarioContracts[key].failureClassReason;
    state.scenarios[key].accessibilityRisk = scenarioContracts[key].accessibilityRisk;
    state.scenarios[key].accessibilityRiskReason = scenarioContracts[key].accessibilityRiskReason;
  }
  state.v2 = {
    contractVersion: scenarioContractVersion,
    canonicalSource:
      "V2 is derived from the runner-owned scenarioLabels, scenarioGroups, scenarioProofCatalog, evolved case catalog, and coverage manifest until a later implementation consolidates those into a single registry module.",
    evidenceGradeMapping: v1GradeToEvidenceStrength,
    failureTaxonomy,
    scenarioContracts,
  };
}

function buildAppearsActive(text) {
  return /Preparing rebuild|Starting system rebuild|Building the system configuration|Downloading .* from (Nix )?cache|Fetching .* from cache|Activating system changes/i.test(
    text || "",
  );
}

function activationAuthRequired(text) {
  return /administrator privileges.*password|password when needed|administrator authentication required|incorrect administrator user name or password/i.test(
    text || "",
  );
}

function proofQualityIssues(state) {
  const issues = [];
  for (const violation of state.secretMaskingViolations || []) {
    issues.push(`Secret masking violation: ${violation}`);
  }
  const sensitiveScreenshots = state.screenshots.filter((shot) =>
    /console/i.test(shot.label || ""),
  );
  for (const shot of sensitiveScreenshots) {
    issues.push(
      `Sensitive surface ${shot.label} has a screenshot artifact (${shot.path}); use redacted text only.`,
    );
  }
  issues.push(...annotationGeometryIssues(state));
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== "pass") continue;
    if (
      [
        "visualProofQuality",
        "mainCoverageFreshness",
        "prSpecificCoverage",
        "storybookPreview",
      ].includes(key)
    )
      continue;
    const proof = proofForScenario(state, key);
    if (proof.screenshotArtifacts.length === 0 && proof.textArtifacts.length === 0) {
      issues.push(`${scenario.label} has no linked screenshot or text artifact.`);
    }
    for (const artifact of proof.screenshotArtifacts) {
      const issue = imageArtifactIssue(state, artifact.path);
      if (issue) issues.push(`${scenario.label} references ${artifact.path}, but ${issue}.`);
    }
    for (const artifact of proof.textArtifacts) {
      const issue = artifactFileIssue(state, artifact.path);
      if (issue) issues.push(`${scenario.label} references ${artifact.path}, but ${issue}.`);
    }
  }
  for (const assertion of state.visualAssertions || []) {
    if (assertion.status !== "fail") continue;
    const failed = assertion.screenshots
      .flatMap((shot) =>
        shot.checks
          .filter((check) => check.status === "fail")
          .map((check) => `${shot.label} ${check.name}: ${check.detail}`),
      )
      .join("; ");
    issues.push(`${assertion.label} has failing screenshot visual assertions: ${failed}`);
  }
  return issues;
}

function screenshotVideoFrameEntries(state) {
  const runDir = path.resolve(state.runDir);
  return (state.screenshots || [])
    .filter((shot) => shot?.path && !/console/i.test(shot.label || ""))
    .map((shot) => path.join(runDir, shot.path))
    .filter((fullPath) => {
      try {
        const stats = statSync(fullPath);
        return stats.isFile() && stats.size > 0;
      } catch {
        return false;
      }
    });
}

async function maybeGenerateEvidenceVideo(state) {
  const runDir = path.resolve(state.runDir);
  const frames = screenshotVideoFrameEntries(state);
  if (!frames.length) {
    state.video = {
      status: "unavailable",
      note: "No safe-to-store screenshot frames were available for the evidence video.",
    };
    return;
  }

  const videoDir = path.join(runDir, "video");
  const framesPath = path.join(videoDir, "frames.txt");
  const videoPath = path.join(runDir, safeFrameVideoPath);
  await mkdir(videoDir, { recursive: true });
  const frameDuration = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_DURATION_SECONDS || 1.1);
  const frameList = frames
    .flatMap((framePath) => [
      `file '${framePath.replaceAll("'", "'\\''")}'`,
      `duration ${Number.isFinite(frameDuration) && frameDuration > 0 ? frameDuration : 1.1}`,
    ])
    .join("\n");
  await writeFile(
    framesPath,
    `${frameList}\nfile '${frames.at(-1).replaceAll("'", "'\\''")}'\n`,
    "utf8",
  );

  const result = tryRun("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    framesPath,
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
  await unlink(framesPath);

  if (!result.ok) {
    state.video = {
      status: "unavailable",
      note: `ffmpeg could not generate the screenshot evidence video: ${redact(result.stderr || result.error || "unknown error")}`,
      frames: frames.length,
    };
    return;
  }

  const relativePath = path.relative(runDir, videoPath);
  const issue = artifactFileIssue(state, relativePath);
  state.video = issue
    ? {
        status: "unavailable",
        path: relativePath,
        note: `Evidence video was generated but is not usable: ${issue}`,
        frames: frames.length,
      }
    : {
        status: "available",
        path: relativePath,
        source: "curated-safe-frames",
        frames: frames.length,
        note: "Screenshot-compilation video generated from safe-to-store Computer Use frames.",
      };
}

function applyVisualAssertions(state) {
  state.visualAssertions = [];
  for (const [scenarioKey, contract] of Object.entries(scenarioVisualContracts)) {
    const scenario = state.scenarios?.[scenarioKey];
    if (!scenario || scenario.status !== "pass") continue;
    const screenshotResults = (contract.screenshots || []).map((requirement) =>
      evaluateScreenshotVisualContract(state, requirement),
    );
    const failedChecks = screenshotResults.flatMap((result) =>
      result.checks
        .filter((check) => check.status === "fail")
        .map((check) => `${result.label}: ${check.name} - ${check.detail}`),
    );
    const assertion = {
      scenarioKey,
      label: scenario.label || scenarioLabels[scenarioKey] || scenarioKey,
      status: failedChecks.length ? "fail" : "pass",
      screenshots: screenshotResults,
    };
    state.visualAssertions.push(assertion);
    if (failedChecks.length) {
      updateScenario(
        state,
        scenarioKey,
        "fail",
        `Screenshot visual assertion failed: ${failedChecks.join("; ")}`,
      );
      state.failures.push(`${assertion.label} failed screenshot visual assertion.`);
    }
  }
  return state.visualAssertions;
}

function refreshVisualProofQuality(state) {
  applyVisualAssertions(state);
  const proofIssues = proofQualityIssues(state);
  updateScenario(
    state,
    "visualProofQuality",
    proofIssues.length === 0 ? "pass" : "fail",
    proofIssues.length === 0
      ? "Every passing scenario has linked text proof, and required non-sensitive screenshots passed binding visual signal checks."
      : `Missing proof artifacts or failing screenshot visual assertions: ${proofIssues.join("; ")}`,
  );
}

function annotationGeometryIssues(state) {
  const issues = [];
  const screenshotLabels = new Set((state.screenshots || []).map((shot) => shot.label));
  for (const [label, annotations] of Object.entries(screenshotAnnotations)) {
    if (!screenshotLabels.has(label)) continue;
    for (const [index, item] of annotations.entries()) {
      const prefix = `${label} annotation ${index + 1} (${item.label})`;
      if (typeof item.x !== "number" || item.x < 0 || item.x > 100)
        issues.push(`${prefix} has x outside image bounds.`);
      if (typeof item.y !== "number" || item.y < 0 || item.y > 100)
        issues.push(`${prefix} has y outside image bounds.`);
      if (item.tone === "pin") continue;
      if (typeof item.w !== "number" || item.w <= 0 || item.x + item.w > 100)
        issues.push(`${prefix} has width outside image bounds.`);
      if (typeof item.h !== "number" || item.h <= 0 || item.y + item.h > 100)
        issues.push(`${prefix} has height outside image bounds.`);
    }
  }
  return issues;
}

async function baseState(runDir, options, { env = process.env } = {}) {
  return createBaseState(runDir, options, {
    tryRun,
    repoRoot: REPO_ROOT,
    remoteAppPathFromEnv,
    scenarioLabels,
    evolvedCaseStrategy,
    buildPrFocus,
    env,
  });
}

function markLocalReportInspectionNotRequired(state) {
  updateScenario(
    state,
    "reportInspection",
    "not_required",
    "The local CuaDriver lane validates and publishes the generated report as immutable evidence; it does not open a personal browser or copy the report over SSH.",
  );
}

function classifySingleSuiteFailure(error, { executionTopology = "remote-codex-app-server" } = {}) {
  const message = redact(error instanceof Error ? error.message : String(error));
  const local = executionTopology === "local-cua-driver";
  if (local && /competing .* process .* running/i.test(message)) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "target_preparation",
      category: "infrastructure",
      code: "competing_process",
      infrastructureBlocker: true,
      summary: message,
    });
  }
  if (local && /Accessibility|Screen Recording|permission/i.test(message)) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "permissions",
      category: "infrastructure",
      code: "macos_permissions",
      infrastructureBlocker: true,
      summary: message,
    });
  }
  if (
    local &&
    /local CuaDriver|NIXMAC_E2E_|staged app|shared Applications path|run-specific directory/i.test(
      message,
    )
  ) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "preflight",
      category: "infrastructure",
      code: "local_preflight",
      infrastructureBlocker: true,
      summary: message,
    });
  }
  if (
    local &&
    /cleanup|close|terminate|did not exit|listener remains|socket .* cleanup/i.test(message)
  ) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "cleanup",
      category: "infrastructure",
      code: "owned_resource_cleanup",
      infrastructureBlocker: true,
      summary: message,
    });
  }
  if (
    local &&
    /nixmac app|app window|app UI|UI state|did not render|wrong content|not visible|visual mismatch/i.test(
      message,
    )
  ) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "runtime",
      category: "product",
      code: "app_behavior",
      infrastructureBlocker: false,
      summary: message,
    });
  }
  if (
    local &&
    /CuaDriver (?:CLI|app|daemon|socket|launch|connect)|codesign|code signing|bundle identity/i.test(
      message,
    )
  ) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "runtime",
      category: "infrastructure",
      code: "local_runtime",
      infrastructureBlocker: true,
      summary: message,
    });
  }
  if (/report|render|artifact|screenshot|runner/i.test(message)) {
    return Object.freeze({
      schemaVersion: 1,
      executionTopology,
      phase: "reporting",
      category: "harness",
      code: "harness_failure",
      infrastructureBlocker: false,
      summary: message,
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    executionTopology,
    phase: "runtime",
    category: "harness",
    code: "runtime_failure",
    infrastructureBlocker: false,
    summary: message,
  });
}

export function classifySuiteFailure(
  error,
  { executionTopology = "remote-codex-app-server" } = {},
) {
  if (!(error instanceof AggregateError) || error.errors.length === 0) {
    return classifySingleSuiteFailure(error, { executionTopology });
  }
  const issues = error.errors.flatMap((item) => {
    const classified = classifySuiteFailure(item, { executionTopology });
    return classified.issues || [classified];
  });
  const infrastructureBlocker = issues.some((issue) => issue.infrastructureBlocker);
  const category = infrastructureBlocker
    ? "infrastructure"
    : issues.some((issue) => issue.category === "product")
      ? "product"
      : "harness";
  return Object.freeze({
    schemaVersion: 1,
    executionTopology,
    phase: "multiple",
    category,
    code: "multiple_failures",
    infrastructureBlocker,
    summary: redact(error.message || "Multiple Computer Use suite failures"),
    issues: Object.freeze(issues),
  });
}

async function maybeRelaunchRemote(state, { ssh: sshBoundary = ssh } = {}) {
  if (process.env.NIXMAC_E2E_SKIP_RELAUNCH === "true") {
    await addEvent(state, "remote.relaunch.skipped", {
      reason: "NIXMAC_E2E_SKIP_RELAUNCH=true; caller is responsible for launching nixmac.",
    });
    return;
  }
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return;
  const remoteAppPath = remoteAppPathFromEnv();
  const result = sshBoundary(
    `osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true; sleep 1; open -n ${shellQuote(remoteAppPath)} || true; sleep 5`,
  );
  await addEvent(state, "remote.relaunch", {
    ok: result.ok,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  });
}

async function inspectReportWithComputerUse(
  driver,
  state,
  { scpToRemote: scpBoundary = scpToRemote, ssh: sshBoundary = ssh } = {},
) {
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  const remoteParent =
    process.env.NIXMAC_E2E_REMOTE_REPORT_DIR || "/tmp/nixmac-computer-use-reports";
  const remoteDir = `${remoteParent}/${path.basename(state.runDir)}`;
  if (!dest) {
    updateScenario(
      state,
      "reportInspection",
      "inconclusive",
      "No remote SSH destination was set, so the report could not be copied to the Computer Use Mac for browser inspection.",
    );
    return;
  }

  const mkdirResult = sshBoundary(
    `rm -rf ${shellQuote(remoteDir)} && mkdir -p ${shellQuote(remoteParent)}`,
  );
  if (!mkdirResult.ok) {
    updateScenario(
      state,
      "reportInspection",
      "inconclusive",
      `Could not create remote report directory: ${mkdirResult.stderr}`,
    );
    return;
  }
  const copyResult = scpBoundary(state.runDir, remoteParent);
  if (!copyResult.ok) {
    updateScenario(
      state,
      "reportInspection",
      "inconclusive",
      `Could not copy report to remote Mac: ${copyResult.stderr}`,
    );
    return;
  }
  const remoteIndex = `${remoteDir}/index.html`;
  const openResult = sshBoundary(
    `open -a "Google Chrome" ${shellQuote(`file://${remoteIndex}`)} || open ${shellQuote(`file://${remoteIndex}`)}; sleep 2`,
  );
  await addEvent(state, "report.remote-open", {
    ok: openResult.ok,
    stdout: redact(openResult.stdout),
    stderr: redact(openResult.stderr),
    remoteIndex,
  });
  const browserApps = ["com.google.Chrome", "Safari", "com.apple.Safari"];
  for (const app of browserApps) {
    try {
      const visible = await driver.visibleState({ app });
      const text = redact(visible.text);
      if (
        /nixmac Computer Use|Scenario Checklist|Claims vs Evidence|Failures \/ Open Issues/i.test(
          text,
        )
      ) {
        const label = `report-inspection-${app.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
        const image = visible.imageBase64;
        const textOrdinal = String(state.textSnapshots.length + 1).padStart(2, "0");
        const textPath = path.join(state.runDir, "texts", `${textOrdinal}-${label}.txt`);
        await writeFile(textPath, `${text}\n`, "utf8");
        if (image) {
          const screenshotOrdinal = String(state.screenshots.length + 1).padStart(2, "0");
          const pngPath = path.join(
            state.runDir,
            "screenshots",
            `${screenshotOrdinal}-${label}.png`,
          );
          await writeFile(pngPath, Buffer.from(image, "base64"));
          state.screenshots.push({
            label: "HTML report inspection",
            path: path.relative(state.runDir, pngPath),
            capturedAt: new Date().toISOString(),
            note: `Computer Use inspected the generated report in ${app}.`,
            source: "Codex Computer Use get_app_state image",
          });
        }
        state.textSnapshots.push({
          label: "HTML report inspection",
          path: path.relative(state.runDir, textPath),
          capturedAt: new Date().toISOString(),
          note: `Computer Use inspected the generated report in ${app}.`,
        });
        updateScenario(
          state,
          "reportInspection",
          "pass",
          `Computer Use inspected the generated report in ${app}; report text and evidence sections were visible.`,
        );
        addNarrative(
          state,
          `Computer Use inspected the generated HTML report in ${app} on the remote Mac.`,
        );
        return;
      }
    } catch (error) {
      await addEvent(state, "report.browser-inspection-error", {
        app,
        error: redact(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  updateScenario(
    state,
    "reportInspection",
    "fail",
    "Computer Use could not observe the report in Chrome or Safari after opening it on the remote Mac.",
  );
}

function captureRemoteMetadata(
  state,
  { readRemoteMetadata: metadataBoundary = readRemoteMetadata } = {},
) {
  const { metadata, error } = metadataBoundary();
  if (!metadata) {
    state.remoteMetadataError = redact(error || "Remote metadata command failed.");
    return;
  }
  state.remoteMetadata = metadata;
  state.remoteMachine = metadata.remoteMachine;
  state.remoteApp = metadata.remoteApp;
  state.processEnvVerification = metadata.processEnvVerification;
  if (state.remoteMachine?.macosProductVersion)
    state.remoteMacosVersion = state.remoteMachine.macosProductVersion;
}

function changedHomebrewSourcePaths(snapshot) {
  return meaningfulBaselineDiff(snapshot)
    .split("\n")
    .filter((line) => supportedHomebrewSourcePaths.includes(line));
}

function hasExpectedHomebrewSourceDiff(snapshot) {
  return changedHomebrewSourcePaths(snapshot).length > 0;
}

async function addRemoteGitEvent(state, type, snapshot) {
  await addEvent(state, type, {
    ok: Boolean(snapshot?.ok),
    configDir: snapshot?.configDir || "",
    head: snapshot?.head || "",
    statusShort: redact(snapshot?.statusShort || ""),
    diffNameOnly: redact(snapshot?.diffNameOnly || ""),
    baselineDiffNameOnly: redact(snapshot?.baselineDiffNameOnly || ""),
    containsBat: Boolean(snapshot?.containsBat),
    error: redact(snapshot?.error || ""),
  });
}

async function waitForRemoteGit(state, label, predicate, { attempts = 20, delayMs = 1500 } = {}) {
  let snapshot = null;
  const configDir = state.remoteConfig?.configDir || remoteConfigDirFromSettings();
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    snapshot = remoteGitSnapshot(configDir, state.remoteConfig?.baselineHead || "");
    await addRemoteGitEvent(
      state,
      `remote.git.${label}.${String(i + 1).padStart(2, "0")}`,
      snapshot,
    );
    if (predicate(snapshot)) return { ok: true, snapshot };
  }
  return { ok: false, snapshot };
}

async function restoreRemoteBaseline(state, label) {
  if (
    state.safety?.disposableConfig !== true ||
    !state.remoteConfig?.baselineHead ||
    !state.remoteConfig?.configDir
  ) {
    await addEvent(state, "remote.git.restore-baseline.skipped", {
      label,
      reason:
        "External git reset cleanup requires a proven disposable config and a prepared baseline.",
    });
    return { ok: false, reason: "not-disposable-or-no-baseline" };
  }
  const command = [
    `cd ${shellQuote(state.remoteConfig.configDir)}`,
    `git reset --hard ${shellQuote(state.remoteConfig.baselineHead)} >/dev/null`,
    "git clean -fd >/dev/null",
  ].join("; ");
  const result = ssh(command);
  await addEvent(state, "remote.git.restore-baseline", {
    label,
    ok: result.ok,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  });
  const snapshot = remoteGitSnapshot(state.remoteConfig.configDir, state.remoteConfig.baselineHead);
  await addRemoteGitEvent(state, `remote.git.${label}.restore-baseline`, snapshot);
  return {
    ok: result.ok && snapshot.ok && !snapshot.statusShort && !meaningfulBaselineDiff(snapshot),
    snapshot,
  };
}

function evidenceMatches(text, patterns = []) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

async function cleanupReviewOnlyCase(driver, state, text, caseDef) {
  const discardOpened = await clickByPattern(
    driver,
    state,
    text,
    `Discard ${caseDef.id}`,
    [/Discard/i],
    `Open Discard for ${caseDef.label}.`,
  );
  if (discardOpened) {
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-discard-boundary`,
      `Computer Use opened Discard for ${caseDef.label}.`,
    );
    const canConfirmDiscard =
      state.safety?.disposableConfig === true && state.safety?.discardConfirmEnabled === true;
    if (canConfirmDiscard) {
      await clickByPattern(
        driver,
        state,
        text,
        `Confirm discard ${caseDef.id}`,
        [/button Confirm/i, /^button Discard$/i],
        `Confirm Discard for ${caseDef.label}.`,
      );
      const cleaned = await waitForRemoteGit(
        state,
        `evolved-${caseDef.id}-discard-clean`,
        (snapshot) => snapshot?.ok && !snapshot.statusShort && !meaningfulBaselineDiff(snapshot),
        { attempts: 20, delayMs: 1000 },
      );
      text = await captureState(
        driver,
        state,
        `evolved-${caseDef.id}-after-discard`,
        `Computer Use cleaned up ${caseDef.label}.`,
      );
      return { ok: cleaned.ok, text, method: "discard" };
    }
    await clickByPattern(
      driver,
      state,
      text,
      `Cancel discard ${caseDef.id}`,
      [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
      `Cancel Discard for ${caseDef.label}.`,
    );
  }
  const restored = await restoreRemoteBaseline(state, `evolved-${caseDef.id}`);
  await maybeRelaunchRemote(state);
  text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-after-discard`,
    `Computer Use relaunched after external cleanup for ${caseDef.label}.`,
  );
  return { ok: restored.ok, text, method: "external-restore" };
}

async function restoreManagedEditViaHistory(driver, state, text, labels) {
  if (
    await clickByPattern(
      driver,
      state,
      text,
      `${labels.name} History after commit`,
      [/button History/i],
      `Open History to restore baseline after ${labels.name}.`,
    )
  ) {
    text = await captureState(
      driver,
      state,
      `${labels.prefix}-history-before-restore`,
      `Computer Use opened History after ${labels.name} commit.`,
    );
    if (
      await clickByPattern(
        driver,
        state,
        text,
        `${labels.name} restore previous commit`,
        [/button Restore/i],
        `Restore the pre-test baseline after ${labels.name}.`,
      )
    ) {
      text = await captureState(
        driver,
        state,
        `${labels.prefix}-history-restore-preview`,
        `Computer Use previewed History restore after ${labels.name}.`,
      );
      if (
        await clickByPattern(
          driver,
          state,
          text,
          `${labels.name} confirm restore`,
          [/Confirm Restore/i],
          `Confirm History restore cleanup after ${labels.name}.`,
        )
      ) {
        const restored = await waitForRemoteGit(
          state,
          `${labels.prefix}-after-history-restore`,
          (snapshot) => snapshot?.ok && !snapshot.statusShort && !meaningfulBaselineDiff(snapshot),
          {
            attempts: Number(process.env.NIXMAC_E2E_RESTORE_ATTEMPTS || 80),
            delayMs: Number(process.env.NIXMAC_E2E_RESTORE_DELAY_MS || 5000),
          },
        );
        text = await captureState(
          driver,
          state,
          `${labels.prefix}-after-history-restore`,
          `Computer Use completed History restore cleanup after ${labels.name}.`,
        );
        return { ok: restored.ok, text, method: "history-restore", snapshot: restored.snapshot };
      }
      return { ok: false, text, method: "history-restore", reason: "confirm-restore-unreachable" };
    }
    return { ok: false, text, method: "history-restore", reason: "restore-control-unreachable" };
  }
  return { ok: false, text, method: "history-restore", reason: "history-unreachable" };
}

async function externallyRestoreManagedEdit(driver, state, labels) {
  const restored = await restoreRemoteBaseline(state, labels.prefix);
  await maybeRelaunchRemote(state);
  const text = await captureState(
    driver,
    state,
    `${labels.prefix}-external-restore`,
    `Computer Use relaunched after external cleanup for ${labels.name}.`,
  );
  return { ok: restored.ok, text, method: "external-restore", snapshot: restored.snapshot };
}

async function buildCommitAndRestoreManagedEdit(driver, state, text, labels) {
  const canConfirmBuild =
    state.safety?.disposableConfig === true &&
    state.safety?.buildConfirmEnabled === true &&
    state.remoteConfig?.baselinePrepared === true;
  const buildClicked = await clickByPattern(
    driver,
    state,
    text,
    `${labels.name} Build & Test`,
    [/Build & Test/i, /Build/i],
    `Click Build & Test for ${labels.name}.`,
  );
  if (!buildClicked) {
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    return {
      ok: false,
      text: cleanup.text,
      note: `Build & Test was not reachable after ${labels.name} Add to config; cleanup ${cleanup.ok ? "restored" : "did not prove"} the disposable baseline via ${cleanup.method}.`,
    };
  }

  text = await captureState(
    driver,
    state,
    `${labels.prefix}-build-boundary`,
    `Computer Use clicked Build & Test for ${labels.name}.`,
  );
  const boundary = /Confirm|Are you sure|Cancel/i.test(text);
  if (!boundary || !canConfirmBuild) {
    await clickByPattern(
      driver,
      state,
      text,
      `${labels.name} cancel build boundary`,
      [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
      `Cancel Build & Test boundary for ${labels.name}.`,
    );
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    return {
      ok: false,
      text: cleanup.text,
      note: boundary
        ? `Build & Test boundary appeared for ${labels.name}, but disposable build confirmation was not proven; cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`
        : `Build & Test did not present a confirmation boundary for ${labels.name}; cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`,
    };
  }

  const buildConfirmed = await clickByPattern(
    driver,
    state,
    text,
    `${labels.name} confirm build boundary`,
    [/button Confirm/i],
    `Confirm Build & Test for ${labels.name} in proven disposable state.`,
  );
  if (!buildConfirmed) {
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    return {
      ok: false,
      text: cleanup.text,
      note: `Build & Test confirmation was not reachable for ${labels.name}; cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`,
    };
  }

  let pamSymlinkHangSeen = 0;
  const step3 = await waitFor(
    driver,
    state,
    `${labels.prefix}-build-to-step-3`,
    (candidate) => {
      if (
        /All changes active|Commit Changes|button Commit|Progress: step 3 of 3|Save Keep changes/i.test(
          candidate,
        ) &&
        !/button \(disabled\) Commit/i.test(candidate)
      )
        return "step-3";
      if (activationAuthRequired(candidate)) return "activation-auth-required";
      if (buildAppearsActive(candidate) && remoteActivationPamSymlinkHang()) {
        pamSymlinkHangSeen += 1;
        if (pamSymlinkHangSeen >= 2) return "activation-pam-symlink-hang";
      } else {
        pamSymlinkHangSeen = 0;
      }
      if (
        /Build Failed|Nix Evaluation Error|Package build failed|Full Disk Access|Permission denied|failed with|❌/i.test(
          candidate,
        )
      )
        return "build-error";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_BUILD_ATTEMPTS || DEFAULT_BUILD_ATTEMPTS),
      delayMs: Number(process.env.NIXMAC_E2E_BUILD_DELAY_MS || 5000),
    },
  );
  text = step3.text;
  if (step3.result !== "step-3") {
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    const reason =
      step3.result || (buildAppearsActive(text) ? "build-still-active" : "step-3-timeout");
    return {
      ok: false,
      text: cleanup.text,
      note: `${labels.name} Build & Test was confirmed but did not reach Step 3 (${reason}); cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`,
    };
  }

  text = await captureState(
    driver,
    state,
    `${labels.prefix}-step-3-ready`,
    `Computer Use reached Step 3 after ${labels.name} Build & Test.`,
  );
  if (/button \(disabled\) Commit/i.test(text)) {
    const commitReady = await waitFor(
      driver,
      state,
      `${labels.prefix}-commit-ready`,
      (candidate) =>
        /button Commit/i.test(candidate) && !/button \(disabled\) Commit/i.test(candidate)
          ? "ready"
          : null,
      {
        attempts: Number(process.env.NIXMAC_E2E_COMMIT_READY_ATTEMPTS || 20),
        delayMs: Number(process.env.NIXMAC_E2E_COMMIT_READY_DELAY_MS || 1000),
      },
    );
    text = commitReady.text;
  }

  if (
    !(await clickByPattern(
      driver,
      state,
      text,
      `${labels.name} commit changes`,
      [/button Commit/i],
      `Commit Step 3 changes for ${labels.name}.`,
    ))
  ) {
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    return {
      ok: false,
      text: cleanup.text,
      note: `Step 3 appeared for ${labels.name}, but Commit was not reachable; cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`,
    };
  }

  const committed = await waitForRemoteGit(
    state,
    `${labels.prefix}-after-commit`,
    (snapshot) =>
      snapshot?.ok &&
      snapshot.head &&
      snapshot.head !== state.remoteConfig?.baselineHead &&
      !snapshot.statusShort &&
      (labels.prefix === "homebrew"
        ? hasExpectedHomebrewSourceDiff(snapshot)
        : Boolean(snapshot.baselineDiffNameOnly)),
    {
      attempts: Number(process.env.NIXMAC_E2E_COMMIT_ATTEMPTS || 30),
      delayMs: Number(process.env.NIXMAC_E2E_COMMIT_DELAY_MS || 1000),
    },
  );
  text = await captureState(
    driver,
    state,
    `${labels.prefix}-after-commit`,
    `Computer Use committed ${labels.name} changes.`,
  );
  if (!committed.ok) {
    const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
    return {
      ok: false,
      text: cleanup.text,
      note: `${labels.name} Commit was clicked, but the disposable repo did not show a clean committed ${labels.prefix === "homebrew" ? `Homebrew source change (${supportedHomebrewSourcePaths.join(" or ")})` : "change"}; cleanup ${cleanup.ok ? "restored" : "did not prove"} the baseline via ${cleanup.method}.`,
    };
  }

  const rollback = await restoreManagedEditViaHistory(driver, state, text, labels);
  if (rollback.ok) {
    await maybeRelaunchRemote(state);
    text = await captureState(
      driver,
      state,
      `${labels.prefix}-after-rollback-home`,
      `Computer Use returned to the prompt surface after ${labels.name} rollback cleanup.`,
    );
    return {
      ok: true,
      text,
      note: `${labels.name} Add to config was built, committed, and rolled back to the disposable baseline with a clean git tree via ${rollback.method}.`,
    };
  }

  const cleanup = await externallyRestoreManagedEdit(driver, state, labels);
  return {
    ok: cleanup.ok,
    text: cleanup.text,
    note: cleanup.ok
      ? `${labels.name} Add to config was built and committed; app History restore did not prove a clean baseline (${rollback.reason || "unknown"}), so the runner restored the disposable baseline externally and verified a clean git tree.`
      : `${labels.name} committed successfully, but History restore did not prove cleanup (${rollback.reason || "unknown"}); external cleanup did not prove the baseline.`,
  };
}

async function runConditionalBadgeSaveScenario(driver, state, text, scenarioKey, config) {
  if (!hasAny(text, config.badgePatterns)) {
    text = await captureState(
      driver,
      state,
      `${config.prefix}-absent`,
      `Computer Use checked for ${config.name}; no matching chip was visible.`,
    );
    updateScenario(
      state,
      scenarioKey,
      "pass",
      `${config.name} chip was not visible, so there were no ${config.absentNoun} to save in this run.`,
    );
    return text;
  }

  if (
    !(await clickByPattern(
      driver,
      state,
      text,
      `${config.name} chip`,
      config.badgePatterns,
      `Open ${config.name} Add to config popover.`,
    ))
  ) {
    updateScenario(
      state,
      scenarioKey,
      "fail",
      `${config.name} chip was visible, but Computer Use could not open it.`,
    );
    return text;
  }

  text = await captureState(
    driver,
    state,
    `${config.prefix}-popover`,
    `Computer Use opened ${config.name} Add to config popover.`,
  );
  if (
    !(await clickByPattern(
      driver,
      state,
      text,
      `${config.name} Add to config`,
      [/Add to config/i],
      `Apply ${config.name} to config.`,
    ))
  ) {
    updateScenario(
      state,
      scenarioKey,
      "fail",
      `${config.name} popover opened, but Add to config was not reachable.`,
    );
    return text;
  }

  const applyWait = await waitFor(
    driver,
    state,
    `${config.prefix}-apply`,
    (candidate) => {
      if (
        /Ready to test-drive|heading Review|button Build & Test|button Discard|Summary|Diff/i.test(
          candidate,
        )
      )
        return "review";
      if (/failed|error|could not|Could not|Failed/i.test(candidate)) return "error";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_MANAGED_EDIT_ATTEMPTS || 30),
      delayMs: Number(process.env.NIXMAC_E2E_MANAGED_EDIT_DELAY_MS || 1000),
    },
  );
  text = applyWait.text;
  if (applyWait.result !== "review") {
    const cleanup = await externallyRestoreManagedEdit(driver, state, {
      name: config.name,
      prefix: config.prefix,
    });
    updateScenario(
      state,
      scenarioKey,
      "fail",
      `${config.name} Add to config did not reach the review/build step${applyWait.result ? ` (${applyWait.result})` : ""}; cleanup ${cleanup.ok ? "restored" : "did not prove"} the disposable baseline.`,
    );
    return cleanup.text;
  }

  text = await captureState(
    driver,
    state,
    `${config.prefix}-apply`,
    `Computer Use reached review/build state after applying ${config.name} to config.`,
  );
  const result = await buildCommitAndRestoreManagedEdit(driver, state, text, {
    name: config.name,
    prefix: config.prefix,
  });
  updateScenario(state, scenarioKey, result.ok ? "pass" : "fail", result.note);
  if (!result.ok) state.failures.push(result.note);
  return result.text;
}

async function runReviewOnlyEvolvedCase(driver, state, caseDef) {
  state.scenarios[caseDef.scenarioKey] ||= {
    label: `Optional evolved case: ${caseDef.label}`,
    status: "inconclusive",
    notes: [],
  };
  const run = {
    id: caseDef.id,
    label: caseDef.label,
    mode: caseDef.mode,
    status: "inconclusive",
    notes: [],
    startedAt: new Date().toISOString(),
  };
  state.evolvedCaseRuns.push(run);
  await addEvent(state, "evolved-case.started", {
    id: caseDef.id,
    mode: caseDef.mode,
    prompt: redact(caseDef.prompt),
  });
  await maybeRelaunchRemote(state);
  let text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-home`,
    `Computer Use started optional evolved case: ${caseDef.label}.`,
  );
  const inputSet = await setValueByPattern(
    driver,
    state,
    text,
    `Prompt input ${caseDef.id}`,
    [/text entry area/i],
    caseDef.prompt,
  );
  text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-typed`,
    `Computer Use entered optional evolved prompt: ${caseDef.label}.`,
  );
  if (!inputSet || !text.includes(caseDef.prompt)) {
    run.status = "fail";
    run.notes.push("Could not enter the optional evolved prompt.");
    updateScenario(state, caseDef.scenarioKey, "fail", run.notes.at(-1));
    return text;
  }
  const submitted = await clickByPattern(
    driver,
    state,
    text,
    `Send ${caseDef.id}`,
    [/button Send/i],
    `Submit optional evolved prompt: ${caseDef.label}.`,
  );
  if (!submitted) {
    run.status = "fail";
    run.notes.push("Could not submit the optional evolved prompt.");
    updateScenario(state, caseDef.scenarioKey, "fail", run.notes.at(-1));
    return text;
  }
  const wait = await waitFor(
    driver,
    state,
    `evolved-${caseDef.id}-provider-progress`,
    (candidate) => {
      if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate))
        return "review";
      if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate))
        return "billing-error";
      if (
        /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(
          candidate,
        )
      )
        return "credential-error";
      if (
        /Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(
          candidate,
        )
      )
        return "provider-error";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_EXTRA_PROVIDER_ATTEMPTS || 60),
      delayMs: Number(process.env.NIXMAC_E2E_PROVIDER_DELAY_MS || 5000),
    },
  );
  text = wait.text;
  if (wait.result !== "review") {
    run.status = wait.result ? "fail" : "inconclusive";
    run.notes.push(
      wait.result
        ? `Provider reached ${wait.result} before Review.`
        : "Review did not appear before the optional-case polling window ended.",
    );
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.at(-1));
    return text;
  }
  let evidenceText = text;
  if (
    await clickByPattern(
      driver,
      state,
      text,
      `Summary ${caseDef.id}`,
      [/Summary/i],
      `Open Summary for ${caseDef.label}.`,
    )
  ) {
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-summary`,
      `Computer Use opened Summary for ${caseDef.label}.`,
    );
    evidenceText += `\n${text}`;
  }
  if (
    await clickByPattern(
      driver,
      state,
      text,
      `Diff ${caseDef.id}`,
      [/Diff/i],
      `Open Diff for ${caseDef.label}.`,
    )
  ) {
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-diff`,
      `Computer Use opened Diff for ${caseDef.label}.`,
    );
    evidenceText += `\n${text}`;
  }
  const matches = evidenceMatches(evidenceText, caseDef.expectedEvidence);
  const cleanup = await cleanupReviewOnlyCase(driver, state, text, caseDef);
  run.status = matches >= 2 && cleanup.ok ? "pass" : matches >= 2 ? "inconclusive" : "fail";
  run.notes.push(
    matches >= 2
      ? `Review evidence matched ${matches}/${caseDef.expectedEvidence.length} screenshot-defaults tokens.`
      : `Review evidence matched only ${matches}/${caseDef.expectedEvidence.length} screenshot-defaults tokens.`,
  );
  run.notes.push(
    cleanup.ok
      ? `Cleanup succeeded via ${cleanup.method}.`
      : `Cleanup did not prove a clean baseline via ${cleanup.method}.`,
  );
  run.completedAt = new Date().toISOString();
  updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(" "));
  return cleanup.text;
}

async function stopGeneratingIfVisible(driver, state, text, label) {
  if (!/button Stop/i.test(text)) return { clicked: false, text };
  const clicked = await clickByPattern(
    driver,
    state,
    text,
    `Stop ${label}`,
    [/button Stop/i],
    `Stop stalled optional evolved case: ${label}.`,
  );
  if (!clicked) return { clicked: false, text };
  const nextText = await captureState(
    driver,
    state,
    `evolved-${label}-after-stop`,
    `Computer Use clicked Stop for stalled optional evolved case: ${label}.`,
  );
  return { clicked: true, text: nextText };
}

async function cleanupQuestionAnswerCase(driver, state, text, caseDef) {
  const stopped = await stopGeneratingIfVisible(driver, state, text, caseDef.id);
  const restored = await restoreRemoteBaseline(state, `evolved-${caseDef.id}`);
  await maybeRelaunchRemote(state);
  const reason = restored.ok ? "" : ` Restore reason: ${restored.reason || "unknown"}.`;
  const nextText = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-after-discard`,
    `Computer Use relaunched after cleanup for ${caseDef.label}.${reason}`,
  );
  return {
    ok: restored.ok,
    method: stopped.clicked ? "stop-plus-external-restore" : "external-restore",
    reason: restored.reason || null,
    text: nextText,
  };
}

async function runQuestionAnswerEvolvedCase(driver, state, caseDef) {
  state.scenarios[caseDef.scenarioKey] ||= {
    label: `Optional evolved case: ${caseDef.label}`,
    status: "inconclusive",
    notes: [],
  };
  const run = {
    id: caseDef.id,
    label: caseDef.label,
    mode: caseDef.mode,
    status: "inconclusive",
    notes: [],
    startedAt: new Date().toISOString(),
  };
  state.evolvedCaseRuns.push(run);
  await addEvent(state, "evolved-case.started", {
    id: caseDef.id,
    mode: caseDef.mode,
    prompt: redact(caseDef.prompt),
  });
  await maybeRelaunchRemote(state);
  let text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-home`,
    `Computer Use started optional evolved case: ${caseDef.label}.`,
  );
  const inputSet = await setValueByPattern(
    driver,
    state,
    text,
    `Prompt input ${caseDef.id}`,
    [/text entry area/i],
    caseDef.prompt,
  );
  text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-typed`,
    `Computer Use entered optional evolved prompt: ${caseDef.label}.`,
  );
  if (!inputSet || !text.includes(caseDef.prompt)) {
    run.status = "fail";
    run.notes.push("Could not enter the optional evolved prompt.");
    updateScenario(state, caseDef.scenarioKey, "fail", run.notes.at(-1));
    return text;
  }
  const submitted = await clickByPattern(
    driver,
    state,
    text,
    `Send ${caseDef.id}`,
    [/button Send/i],
    `Submit optional evolved prompt: ${caseDef.label}.`,
  );
  if (!submitted) {
    run.status = "fail";
    run.notes.push("Could not submit the optional evolved prompt.");
    updateScenario(state, caseDef.scenarioKey, "fail", run.notes.at(-1));
    return text;
  }

  const questionWait = await waitFor(
    driver,
    state,
    `evolved-${caseDef.id}-question`,
    (candidate) => {
      if (findQuestionInputEntry(candidate)) return "text-input";
      if (findQuestionChoiceEntry(candidate, caseDef.questionChoicePatterns || [])) return "choice";
      if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate))
        return "review-without-question";
      if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate))
        return "billing-error";
      if (
        /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(
          candidate,
        )
      )
        return "credential-error";
      if (
        /Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(
          candidate,
        )
      )
        return "provider-error";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_QUESTION_ATTEMPTS || 60),
      delayMs: Number(process.env.NIXMAC_E2E_QUESTION_DELAY_MS || 3000),
    },
  );
  text = questionWait.text;
  if (questionWait.result === "review-without-question" || !questionWait.result) {
    run.status = "inconclusive";
    run.notes.push(
      questionWait.result === "review-without-question"
        ? "Provider reached Review without showing the inline question UI, so this run did not exercise ask_user."
        : "Question UI did not appear before the question polling window ended.",
    );
    const cleanup = await cleanupQuestionAnswerCase(driver, state, text, caseDef);
    run.notes.push(
      cleanup.ok
        ? `Cleanup succeeded via ${cleanup.method}.`
        : `Cleanup did not prove a clean baseline via ${cleanup.method}.`,
    );
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(" "));
    return cleanup.text;
  }
  if (questionWait.result.endsWith("error")) {
    run.status = "fail";
    run.notes.push(
      `Provider reached ${questionWait.result} before inline question could be answered.`,
    );
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.at(-1));
    return text;
  }

  text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-question`,
    `Computer Use observed inline question UI for ${caseDef.label}.`,
  );
  let answered = false;
  if (questionWait.result === "choice") {
    const choice = findQuestionChoiceEntry(text, caseDef.questionChoicePatterns || []);
    answered = choice
      ? await clickElementIndex(
          driver,
          state,
          text,
          choice.index,
          `Question choice ${caseDef.id}`,
          `Answer inline question for ${caseDef.label} via choice: ${choice.label}.`,
        )
      : false;
  } else {
    const input = findQuestionInputEntry(text);
    answered = input
      ? await setValueElementIndex(
          driver,
          state,
          text,
          input.index,
          `Question answer ${caseDef.id}`,
          caseDef.answer,
        )
      : false;
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-answer-typed`,
      `Computer Use typed inline question answer for ${caseDef.label}.`,
    );
    const submit = findQuestionSubmitEntry(text, findQuestionInputEntry(text));
    answered =
      answered && submit
        ? await clickElementIndex(
            driver,
            state,
            text,
            submit.index,
            `Submit question answer ${caseDef.id}`,
            `Submit inline question answer for ${caseDef.label}.`,
          )
        : false;
  }
  if (!answered) {
    run.status = "fail";
    run.notes.push(
      "Inline question UI appeared, but Computer Use could not answer it through a question-scoped control.",
    );
    const cleanup = await cleanupQuestionAnswerCase(driver, state, text, caseDef);
    run.notes.push(
      cleanup.ok
        ? `Cleanup succeeded via ${cleanup.method}.`
        : `Cleanup did not prove a clean baseline via ${cleanup.method}: ${cleanup.reason || "unknown reason"}.`,
    );
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(" "));
    return cleanup.text;
  }

  const answerWait = await waitFor(
    driver,
    state,
    `evolved-${caseDef.id}-answered`,
    (candidate) => {
      if (
        hasAnsweredQuestionEvidence(candidate, caseDef.answer) ||
        (!findQuestionInputEntry(candidate) &&
          !findQuestionChoiceEntry(candidate, caseDef.questionChoicePatterns || []))
      )
        return "answered";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_QUESTION_ANSWERED_ATTEMPTS || 12),
      delayMs: Number(process.env.NIXMAC_E2E_QUESTION_ANSWERED_DELAY_MS || 1000),
    },
  );
  text = await captureState(
    driver,
    state,
    `evolved-${caseDef.id}-answered`,
    `Computer Use submitted inline question answer for ${caseDef.label}.`,
  );

  const reviewWait = await waitFor(
    driver,
    state,
    `evolved-${caseDef.id}-provider-progress`,
    (candidate) => {
      if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate))
        return "review";
      if (/Waiting for next event/i.test(candidate) && !answerWait.ok) return null;
      if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate))
        return "billing-error";
      if (
        /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(
          candidate,
        )
      )
        return "credential-error";
      if (
        /Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(
          candidate,
        )
      )
        return "provider-error";
      return null;
    },
    {
      attempts: Number(process.env.NIXMAC_E2E_POST_QUESTION_PROVIDER_ATTEMPTS || 60),
      delayMs: Number(process.env.NIXMAC_E2E_PROVIDER_DELAY_MS || 5000),
    },
  );
  text = reviewWait.text;
  if (reviewWait.result !== "review") {
    run.status = reviewWait.result ? "fail" : "inconclusive";
    run.notes.push(
      reviewWait.result
        ? `Provider reached ${reviewWait.result} after answer.`
        : "Review did not appear after inline question answer before the polling window ended.",
    );
    const cleanup = await cleanupQuestionAnswerCase(driver, state, text, caseDef);
    run.notes.push(
      cleanup.ok
        ? `Cleanup succeeded via ${cleanup.method}.`
        : `Cleanup did not prove a clean baseline via ${cleanup.method}: ${cleanup.reason || "unknown reason"}.`,
    );
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(" "));
    return cleanup.text;
  }

  let evidenceText = text;
  if (
    await clickByPattern(
      driver,
      state,
      text,
      `Summary ${caseDef.id}`,
      [/Summary/i],
      `Open Summary for ${caseDef.label}.`,
    )
  ) {
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-summary`,
      `Computer Use opened Summary for ${caseDef.label}.`,
    );
    evidenceText += `\n${text}`;
  }
  if (
    await clickByPattern(
      driver,
      state,
      text,
      `Diff ${caseDef.id}`,
      [/Diff/i],
      `Open Diff for ${caseDef.label}.`,
    )
  ) {
    text = await captureState(
      driver,
      state,
      `evolved-${caseDef.id}-diff`,
      `Computer Use opened Diff for ${caseDef.label}.`,
    );
    evidenceText += `\n${text}`;
  }
  const matches = evidenceMatches(evidenceText, caseDef.expectedEvidence);
  const cleanup = await cleanupReviewOnlyCase(driver, state, text, caseDef);
  run.status = matches >= 2 && cleanup.ok ? "pass" : matches >= 2 ? "inconclusive" : "fail";
  run.notes.push(
    matches >= 2
      ? `Inline question answer reached Review and evidence matched ${matches}/${caseDef.expectedEvidence.length} font tokens.`
      : `Inline question answer reached Review, but evidence matched only ${matches}/${caseDef.expectedEvidence.length} font tokens.`,
  );
  run.notes.push(
    cleanup.ok
      ? `Cleanup succeeded via ${cleanup.method}.`
      : `Cleanup did not prove a clean baseline via ${cleanup.method}.`,
  );
  run.completedAt = new Date().toISOString();
  updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(" "));
  return cleanup.text;
}

function evolvedCaseExecutorForMode(mode) {
  if (mode === "review-only-calibration") return runReviewOnlyEvolvedCase;
  if (mode === "question-answer-calibration") return runQuestionAnswerEvolvedCase;
  return null;
}

async function prepareDisposableRemoteBaseline(state, { ssh: sshBoundary = ssh } = {}) {
  const canConfirmBuild =
    state.safety?.disposableConfig === true && state.safety?.buildConfirmEnabled === true;
  if (!canConfirmBuild) {
    await addEvent(state, "remote.git.baseline.skipped", {
      reason: "Build confirmation is not enabled for a proven disposable config.",
      disposableConfig: Boolean(state.safety?.disposableConfig),
      buildConfirmEnabled: Boolean(state.safety?.buildConfirmEnabled),
    });
    return null;
  }
  const configDir = remoteConfigDirFromSettings();
  if (!configDir) {
    await addEvent(state, "remote.git.baseline.skipped", {
      reason: "No remote configDir could be resolved from env/settings.",
    });
    return null;
  }
  const initial = remoteGitSnapshot(configDir);
  await addRemoteGitEvent(state, "remote.git.initial", initial);
  if (!initial.ok) return null;

  const markerResult = sshBoundary(
    [
      `cd ${shellQuote(configDir)}`,
      'git config user.name "nixmac E2E"',
      'git config user.email "nixmac-e2e@example.invalid"',
      "git add -A",
      'git commit --allow-empty -m "nixmac e2e restore baseline" >/dev/null',
    ].join("; "),
  );
  await addEvent(state, "remote.git.baseline-commit", {
    ok: markerResult.ok,
    stdout: redact(markerResult.stdout),
    stderr: redact(markerResult.stderr),
  });
  if (!markerResult.ok) return null;

  const baseline = remoteGitSnapshot(configDir);
  await addRemoteGitEvent(state, "remote.git.baseline", baseline);
  if (baseline.ok && !baseline.statusShort) {
    state.remoteConfig = {
      configDir,
      initialHead: initial.head,
      baselineHead: baseline.head,
      baselinePrepared: true,
    };
    await saveState(state);
  } else if (baseline.ok) {
    await addEvent(state, "remote.git.baseline.dirty", {
      reason: "Disposable baseline was created but the worktree was not clean.",
      statusShort: redact(baseline.statusShort || ""),
    });
  }
  return baseline;
}

async function render(
  state,
  {
    generateVideo = true,
    recordEvent = true,
    stateFileName = "state.json",
    updateStorybook = true,
  } = {},
) {
  await assertEvidenceTreeMutable(state.runDir);
  const renderStartedAt = nowIso();
  ensureCurrentSchema(state);
  if (updateStorybook) updateStorybookPreviewCoverage(state);
  const verdict = verdictFor(state);
  state.verdict = verdict;
  updateV2Contracts(state);
  state.claims = Object.values(state.scenarios).map((scenario) => ({
    claim: scenario.label,
    status: scenario.status,
    evidence: scenario.notes.join(" ") || "See proof artifacts and coverage gaps.",
  }));
  if (generateVideo) {
    await maybeGenerateEvidenceVideo(state);
  } else {
    state.video = {
      status: "not_required",
      note: "The bounded smoke command retains screenshots and text evidence without generating video.",
    };
  }
  const html = await renderReportHtml(state, { proofForScenario });
  await writeFile(path.join(state.runDir, "index.html"), html, "utf8");
  addTimingPhase(state, {
    id:
      stateFileName === "state.json"
        ? "report-render"
        : `report-render-${stateFileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`,
    label: stateFileName === "state.json" ? "Report render" : `Report render (${stateFileName})`,
    category: "reporting",
    source: "runner",
    status: "success",
    startedAt: renderStartedAt,
    endedAt: nowIso(),
    note: `Rendered ${stateFileName} and index.html.`,
  });
  if (stateFileName === "state.json") await saveState(state);
  else
    await writeFile(
      path.join(state.runDir, stateFileName),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  if (recordEvent) await addEvent(state, "report.rendered", { path: "index.html", verdict });
}

export async function runSuiteWithDriver(
  args,
  {
    createDriver,
    env = process.env,
    executionTopology,
    localPreflightDependencies = {},
    runPreflightDependencies = {},
    transportBoundaries = {},
  } = {},
) {
  if (args.includes("--prompt") || env.NIXMAC_E2E_PROMPT) {
    throw new Error(
      "Custom prompts are not supported by this E2E runner; assertions are calibrated to the fixed bat/Homebrew prompt.",
    );
  }
  const options = {
    app: env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
    ...(executionTopology === "remote-codex-app-server"
      ? { ws: env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS }
      : {}),
  };
  let runDir = argValue(args, "--run-dir", path.join(ARTIFACT_ROOT, timestampSlug()));
  if (typeof createDriver !== "function") {
    throw new TypeError("runSuiteWithDriver requires createDriver");
  }
  if (executionTopology !== "remote-codex-app-server" && executionTopology !== "local-cua-driver") {
    throw new Error(`unsupported Computer Use execution topology: ${executionTopology}`);
  }
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  if (executionTopology === "local-cua-driver") runDir = await realpath(runDir);
  activeRunDir = runDir;
  const state = await baseState(runDir, options, { env });
  state.executionTopology = executionTopology;
  if (executionTopology === "local-cua-driver") markLocalReportInspectionNotRequired(state);
  await saveState(state);
  const computerUseStartedAt = nowIso();

  let socketEndpoint = null;
  let localPreflight = null;
  let driver = null;
  let runProvisioning = null;
  let suiteCompleted = false;
  let suiteFailure = null;
  let closeFailure = null;
  let trustedRunPreflight = null;
  let uiStarted = false;
  let ownedProcessSnapshots = [];
  let processSnapshotFailure = "";
  try {
    if (executionTopology === "local-cua-driver") {
      socketEndpoint = await createOwnedCuaSocketEndpoint({
        requestedPath: env.NIXMAC_CUA_DRIVER_SOCKET || "",
      });
    }
    driver = validateRuntimeDriver(
      createDriver({
        ...options,
        runDir,
        ...(socketEndpoint ? { socketPath: socketEndpoint.path } : {}),
      }),
    );
    if (executionTopology === "local-cua-driver") {
      runProvisioning = await writeLocalRunProvisioning(
        { driver, runDir, socketEndpoint },
        {
          env,
          ...runPreflightDependencies,
        },
      );
      localPreflight = await validateLocalCuaPreflight(
        {
          appBundleId: options.app,
          runDir,
        },
        {
          env,
          ...localPreflightDependencies,
        },
      );
      state.localApp = {
        artifactSha: localPreflight.appArtifactSha,
        bundleDigestSha256: localPreflight.appBundleDigestSha256,
        bundleId: localPreflight.appBundleId,
        path: localPreflight.appPath,
      };
      await saveState(state);
      await driver.connect();
      await recordRunPermissions(runDir, {
        accessibilityGranted: true,
        screenRecordingGranted: true,
      });
      trustedRunPreflight = await assertRunPreflight(runDir);
      await driver.prepareTarget({
        appBundleId: options.app,
        appPath: localPreflight.appPath,
      });
      await transitionRunAttempt(runDir, "RUNNING");
    } else {
      await prepareSuiteDriver(driver, {
        executionTopology,
        appBundleId: options.app,
        localPreflight,
      });
    }
    if (localPreflight) {
      await verifyLocalCuaPreflight(localPreflight, localPreflightDependencies);
    }
    if (executionTopology === "remote-codex-app-server") {
      await prepareDisposableRemoteBaseline(state, transportBoundaries);
      await maybeRelaunchRemote(state, transportBoundaries);
      captureRemoteMetadata(state, transportBoundaries);
    }

    uiStarted = true;
    let text = await captureState(
      driver,
      state,
      "launch",
      "Computer Use observed the nixmac window at launch.",
    );
    if (
      /nixmac/i.test(text) &&
      hasAny(text, [
        /button Settings/i,
        /text entry area/i,
        /Get started/i,
        /Progress: step 1 of 3/i,
      ])
    ) {
      updateScenario(
        state,
        "launch",
        "pass",
        "Computer Use saw the nixmac app window, prompt surface, progress stepper, and top-level controls.",
      );
    } else {
      updateScenario(
        state,
        "launch",
        "fail",
        "Computer Use did not see a usable nixmac app window.",
      );
    }

    const updateDismissButtonPresent = Boolean(findElement(text, [/button Dismiss/i]));
    const updateDismissed = await clickByPattern(
      driver,
      state,
      text,
      "Dismiss update banner",
      [/button Dismiss/i],
      "Dismiss update/error banner if present.",
    );
    if (updateDismissed) {
      text = await captureState(
        driver,
        state,
        "after-dismiss",
        "Computer Use clicked a visible Dismiss button.",
      );
      updateScenario(
        state,
        "updateBanner",
        "pass",
        "A visible Dismiss button was clicked and the UI remained usable.",
      );
    } else if (updateDismissButtonPresent) {
      updateScenario(
        state,
        "updateBanner",
        "fail",
        "A visible Dismiss button was present, but Computer Use could not click it.",
      );
    } else {
      updateScenario(
        state,
        "updateBanner",
        "pass",
        "No dismissible update banner was visible; no banner blocked the main workflow.",
      );
    }

    const settingsOpened = await clickByPattern(
      driver,
      state,
      text,
      "Settings",
      [/button Settings/i],
      "Open Settings.",
    );
    text = await captureState(driver, state, "settings-general", "Computer Use opened Settings.");
    if (settingsOpened && hasSettingsGeneralEvidence(text)) {
      updateScenario(
        state,
        "settingsGeneral",
        "pass",
        "Settings opened and General-related content was visible.",
      );
    } else {
      updateScenario(
        state,
        "settingsGeneral",
        "fail",
        "Computer Use could not open Settings General.",
      );
    }

    if (
      await clickByPattern(
        driver,
        state,
        text,
        "AI Models tab",
        [/AI Models/i],
        "Open AI Models settings.",
      )
    ) {
      text = await captureState(
        driver,
        state,
        "settings-ai-models",
        "Computer Use opened AI Models settings.",
      );
      const aiModelsVisible = hasSettingsAIModelsEvidence(text);
      updateScenario(
        state,
        "settingsAIModels",
        aiModelsVisible ? "pass" : "fail",
        aiModelsVisible
          ? "AI Models settings content was visible with provider/model controls."
          : "AI Models tab did not visibly render expected content.",
      );
    } else {
      updateScenario(
        state,
        "settingsAIModels",
        "fail",
        "Computer Use could not click the AI Models settings tab.",
      );
    }

    if (
      await clickByPattern(
        driver,
        state,
        text,
        "API Keys tab",
        [/API Keys/i],
        "Open API Keys settings.",
      )
    ) {
      const apiWait = await waitFor(
        driver,
        state,
        "settings-api-keys",
        (candidate) => (hasSettingsAPIKeysEvidence(candidate) ? "rendered" : null),
        { attempts: 5, delayMs: 1000 },
      );
      text = apiWait.text;
      updateScenario(
        state,
        "settingsAPIKeys",
        apiWait.ok ? "pass" : "fail",
        apiWait.ok
          ? "API Keys content was visible after Computer Use polling, including OpenRouter/API key controls."
          : "API Keys stayed blank or exposed only an empty WebView accessibility tree after polling.",
      );
    } else {
      updateScenario(
        state,
        "settingsAPIKeys",
        "fail",
        "Computer Use could not click the API Keys settings tab.",
      );
    }

    if (state.scenarios.settingsAPIKeys.status === "fail") {
      await maybeRelaunchRemote(state);
      text = await captureState(
        driver,
        state,
        "recover-after-api-keys",
        "Relaunched after API Keys blank-screen reproduction so the rest of the suite could continue.",
      );
      await clickByPattern(
        driver,
        state,
        text,
        "Settings after recovery",
        [/button Settings/i],
        "Reopen Settings after recovery.",
      );
      text = await captureState(
        driver,
        state,
        "settings-after-recovery",
        "Computer Use reopened Settings after recovery.",
      );
    }

    if (
      await clickByPattern(
        driver,
        state,
        text,
        "Preferences tab",
        [/Preferences/i],
        "Open Preferences settings.",
      )
    ) {
      text = await captureState(
        driver,
        state,
        "settings-preferences",
        "Computer Use opened Preferences settings.",
      );
      const preferencesVisible = hasSettingsPreferencesEvidence(text);
      updateScenario(
        state,
        "settingsPreferences",
        preferencesVisible ? "pass" : "fail",
        preferencesVisible
          ? "Preferences settings content was visible with confirmation controls."
          : "Preferences tab did not visibly render expected content.",
      );
    } else {
      updateScenario(
        state,
        "settingsPreferences",
        "fail",
        "Computer Use could not click the Preferences settings tab.",
      );
    }

    await clickByPattern(
      driver,
      state,
      text,
      "Close settings",
      [/button Close/i, /^button ×/i, /^button X/i],
      "Close Settings.",
    );
    text = await captureState(
      driver,
      state,
      "home-after-settings",
      "Computer Use returned to the main app surface after Settings coverage.",
    );

    if (
      await clickByPattern(driver, state, text, "History", [/button History/i], "Open My History.")
    ) {
      text = await captureState(driver, state, "history", "Computer Use opened History.");
      updateScenario(
        state,
        "history",
        /History|Empty|No history|changes/i.test(text) ? "pass" : "fail",
        /History|Empty|No history|changes/i.test(text)
          ? "History rendered a visible state."
          : "History did not visibly render expected content.",
      );
      const closedHistory = await clickByPattern(
        driver,
        state,
        text,
        "Close history",
        [/button Close/i, /^button ×/i, /^button X/i],
        "Close History.",
      );
      if (!closedHistory && /heading History/i.test(text)) {
        await clickByPattern(
          driver,
          state,
          text,
          "Toggle history closed",
          [/button History/i],
          "Toggle History closed to return to the prompt surface.",
        );
      }
      text = await captureState(
        driver,
        state,
        "home-after-history",
        "Computer Use returned home after History.",
      );
    }

    if (await clickByPattern(driver, state, text, "Console", [/Console/i], "Open Console.")) {
      text = await captureState(driver, state, "console", "Computer Use opened Console.");
      updateScenario(
        state,
        "console",
        /Console|log|Error|Info|Debug/i.test(text) ? "pass" : "fail",
        /Console|log|Error|Info|Debug/i.test(text)
          ? "Console rendered visible content."
          : "Console did not visibly render expected content.",
      );
      await clickByPattern(
        driver,
        state,
        text,
        "Close console",
        [/button Close/i, /^button ×/i, /^button X/i],
        "Close Console.",
      );
      text = await captureState(
        driver,
        state,
        "home-after-console",
        "Computer Use returned home after Console.",
      );
    } else {
      updateScenario(
        state,
        "console",
        "inconclusive",
        "Console button was not visible in the current state.",
      );
    }

    if (
      await clickByPattern(
        driver,
        state,
        text,
        "Give feedback",
        [/Give feedback/i],
        "Open Give Feedback.",
      )
    ) {
      text = await captureState(driver, state, "feedback", "Computer Use opened Give Feedback.");
      updateScenario(
        state,
        "feedback",
        /Feedback|message|Cancel|Submit/i.test(text) ? "pass" : "fail",
        /Feedback|message|Cancel|Submit/i.test(text)
          ? "Feedback dialog rendered and no submission was made."
          : "Feedback dialog did not visibly render.",
      );
      await clickByPattern(
        driver,
        state,
        text,
        "Cancel feedback",
        [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
        "Cancel Give Feedback.",
      );
      text = await captureState(
        driver,
        state,
        "home-after-feedback",
        "Computer Use returned home after Feedback.",
      );
    }

    if (
      await clickByPattern(
        driver,
        state,
        text,
        "Report Issue",
        [/Report Issue/i, /Report Error/i],
        "Open Report Issue.",
      )
    ) {
      text = await captureState(driver, state, "report-issue", "Computer Use opened Report Issue.");
      updateScenario(
        state,
        "reportIssue",
        /Report|Issue|Error|Cancel|Submit/i.test(text) ? "pass" : "fail",
        /Report|Issue|Error|Cancel|Submit/i.test(text)
          ? "Report Issue dialog rendered and no submission was made."
          : "Report Issue did not visibly render.",
      );
      await clickByPattern(
        driver,
        state,
        text,
        "Cancel report issue",
        [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
        "Cancel Report Issue.",
      );
      text = await captureState(
        driver,
        state,
        "home-after-report-issue",
        "Computer Use returned home after Report Issue.",
      );
    } else {
      updateScenario(
        state,
        "reportIssue",
        "inconclusive",
        "Report Issue button was not visible in the current state.",
      );
    }

    text = await runConditionalBadgeSaveScenario(driver, state, text, "homebrewSaveRollback", {
      name: "Untracked Homebrew items",
      prefix: "homebrew",
      badgePatterns: [/untracked Homebrew/i],
      absentNoun: "Homebrew items",
    });

    text = await runConditionalBadgeSaveScenario(driver, state, text, "customizationSaveRollback", {
      name: "Untracked customizations",
      prefix: "customization",
      badgePatterns: [/untracked settings?/i],
      absentNoun: "macOS customizations",
    });

    const suggestionVisible = hasAny(text, [/Install vim/i, /Add Rectangle/i, /Finder path bar/i]);
    const suggestionClicked = suggestionVisible
      ? await clickByPattern(
          driver,
          state,
          text,
          "Suggestion card",
          [/Install vim/i, /Add Rectangle/i, /Finder path bar/i],
          "Click a home suggestion card.",
        )
      : false;
    text = await captureState(
      driver,
      state,
      "suggestion-card",
      "Computer Use checked home suggestion cards.",
    );
    updateScenario(
      state,
      "suggestionCards",
      suggestionClicked ? "pass" : "fail",
      suggestionClicked
        ? "A suggestion card was clicked and the UI remained usable."
        : suggestionVisible
          ? "Suggestion cards were visible but Computer Use could not click one."
          : "No suggestion cards were visible.",
    );

    const inputSet = await setValueByPattern(
      driver,
      state,
      text,
      "Prompt input",
      [/text entry area/i],
      options.prompt,
    );
    text = await captureState(
      driver,
      state,
      "typed-intent",
      "Computer Use set a real prompt in the app prompt field.",
    );
    if (inputSet && text.includes(options.prompt)) {
      updateScenario(
        state,
        "typedIntent",
        "pass",
        "Computer Use entered the real prompt into the app prompt field.",
      );
    } else {
      updateScenario(
        state,
        "typedIntent",
        "fail",
        "Computer Use could not enter the prompt into the app prompt field.",
      );
    }

    if (
      inputSet &&
      (await clickByPattern(
        driver,
        state,
        text,
        "Send prompt",
        [/button Send/i],
        "Submit the real prompt.",
      ))
    ) {
      const wait = await waitFor(
        driver,
        state,
        "provider-progress",
        (candidate) => {
          if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate))
            return "review";
          if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate))
            return "billing-error";
          if (
            /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(
              candidate,
            )
          )
            return "credential-error";
          if (
            /Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(
              candidate,
            )
          )
            return "provider-error";
          return null;
        },
        {
          attempts: Number(process.env.NIXMAC_E2E_PROVIDER_ATTEMPTS || 72),
          delayMs: Number(process.env.NIXMAC_E2E_PROVIDER_DELAY_MS || 5000),
        },
      );
      text = wait.text;
      if (wait.result === "review") {
        updateScenario(
          state,
          "review",
          "pass",
          "The real provider workflow reached Review or a Review-equivalent state.",
        );
      } else if (
        wait.result === "billing-error" ||
        /Payment Required|Insufficient credits|out of credits|billing limit/i.test(text)
      ) {
        updateScenario(
          state,
          "review",
          "fail",
          "The real provider call failed because the configured OpenRouter account appears out of credits or over its billing limit.",
        );
        state.failures.push("Provider billing/credits prevented prompt-to-review coverage.");
      } else if (
        wait.result === "credential-error" ||
        /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(
          text,
        )
      ) {
        updateScenario(
          state,
          "review",
          "fail",
          "The real provider call failed because nixmac could not access an API key.",
        );
        state.failures.push("Provider credential access prevented prompt-to-review coverage.");
      } else if (wait.result === "provider-error") {
        updateScenario(
          state,
          "review",
          "fail",
          "The provider workflow showed a hard provider/application error before reaching Review.",
        );
        state.failures.push(
          "A hard provider/application error prevented prompt-to-review coverage.",
        );
      } else {
        updateScenario(
          state,
          "review",
          "inconclusive",
          "The prompt was submitted, but Review did not appear before the polling window ended.",
        );
      }
    } else {
      updateScenario(state, "review", "fail", "The prompt could not be submitted.");
    }

    if (state.scenarios.review.status === "pass") {
      const summaryClicked = await clickByPattern(
        driver,
        state,
        text,
        "Summary tab",
        [/Summary/i],
        "Open Summary tab.",
      );
      if (summaryClicked) {
        text = await captureState(
          driver,
          state,
          "review-summary",
          "Computer Use opened Summary after Review.",
        );
        const summaryMatchesIntent =
          /bat/i.test(text) && /Homebrew|brew|package|command line/i.test(text);
        updateScenario(
          state,
          "summary",
          summaryMatchesIntent ? "pass" : "fail",
          summaryMatchesIntent
            ? "Summary described the requested bat/Homebrew package intent."
            : "Summary did not visibly describe the typed bat/Homebrew intent.",
        );
      } else {
        updateScenario(
          state,
          "summary",
          "fail",
          "Review passed, but Computer Use could not open the Summary tab.",
        );
      }
      const diffClicked = await clickByPattern(
        driver,
        state,
        text,
        "Diff tab",
        [/Diff/i],
        "Open Diff tab.",
      );
      if (diffClicked) {
        text = await captureState(
          driver,
          state,
          "review-diff",
          "Computer Use opened Diff after Review.",
        );
        const expectedPackage =
          /"bat"|bat command line|Homebrew formulae|brews = \[|homebrew\.nix|modules\/darwin\s*\/\s*homebrew\.nix/i.test(
            text,
          );
        updateScenario(
          state,
          "diff",
          expectedPackage ? "pass" : "fail",
          expectedPackage
            ? "Diff rendered a candidate Homebrew configuration file for the bat change."
            : "Diff did not visibly show the expected bat/Homebrew change.",
        );
      } else {
        updateScenario(
          state,
          "diff",
          "fail",
          "Review passed, but Computer Use could not open the Diff tab.",
        );
      }
      const buildClicked = await clickByPattern(
        driver,
        state,
        text,
        "Build & Test",
        [/Build & Test/i, /Build/i],
        "Click Build & Test boundary.",
      );
      if (buildClicked) {
        text = await captureState(
          driver,
          state,
          "build-boundary",
          "Computer Use clicked Build & Test to verify the destructive boundary.",
        );
        const boundary = /Confirm|Are you sure|Cancel/i.test(text);
        updateScenario(
          state,
          "buildBoundary",
          boundary ? "pass" : "fail",
          boundary
            ? "Build & Test presented a visible confirmation/boundary before activation."
            : "Build & Test did not present an obvious confirmation boundary.",
        );
        const canConfirmBuild =
          boundary &&
          state.safety?.disposableConfig === true &&
          state.safety?.buildConfirmEnabled === true &&
          state.remoteConfig?.baselinePrepared === true;
        if (boundary && canConfirmBuild) {
          const buildConfirmed = await clickByPattern(
            driver,
            state,
            text,
            "Confirm build boundary",
            [/button Confirm/i],
            "Confirm Build & Test in proven disposable state.",
          );
          if (buildConfirmed) {
            state.confirmationBoundaries.push(
              "Build & Test boundary observed and confirmed in proven disposable state.",
            );
            let pamSymlinkHangSeen = 0;
            const step3 = await waitFor(
              driver,
              state,
              "build-to-step-3",
              (candidate) => {
                if (
                  /All changes active|Commit Changes|button Commit|Progress: step 3 of 3|Save Keep changes/i.test(
                    candidate,
                  ) &&
                  !/button \(disabled\) Commit/i.test(candidate)
                )
                  return "step-3";
                if (activationAuthRequired(candidate)) return "activation-auth-required";
                if (buildAppearsActive(candidate) && remoteActivationPamSymlinkHang()) {
                  pamSymlinkHangSeen += 1;
                  if (pamSymlinkHangSeen >= 2) return "activation-pam-symlink-hang";
                } else {
                  pamSymlinkHangSeen = 0;
                }
                if (
                  /Build Failed|Nix Evaluation Error|Package build failed|Full Disk Access|Permission denied|failed with|❌/i.test(
                    candidate,
                  )
                )
                  return "build-error";
                return null;
              },
              {
                attempts: Number(process.env.NIXMAC_E2E_BUILD_ATTEMPTS || DEFAULT_BUILD_ATTEMPTS),
                delayMs: Number(process.env.NIXMAC_E2E_BUILD_DELAY_MS || 5000),
              },
            );
            text = step3.text;
            if (step3.result === "step-3") {
              text = await captureState(
                driver,
                state,
                "step-3-ready",
                "Computer Use reached Step 3 after Build & Test.",
              );
              if (/button \(disabled\) Commit/i.test(text)) {
                const commitReady = await waitFor(
                  driver,
                  state,
                  "commit-ready",
                  (candidate) =>
                    /button Commit/i.test(candidate) &&
                    !/button \(disabled\) Commit/i.test(candidate)
                      ? "ready"
                      : null,
                  {
                    attempts: Number(process.env.NIXMAC_E2E_COMMIT_READY_ATTEMPTS || 20),
                    delayMs: Number(process.env.NIXMAC_E2E_COMMIT_READY_DELAY_MS || 1000),
                  },
                );
                text = commitReady.text;
              }
              if (
                await clickByPattern(
                  driver,
                  state,
                  text,
                  "Commit changes",
                  [/button Commit/i],
                  "Commit Step 3 changes.",
                )
              ) {
                const committed = await waitForRemoteGit(
                  state,
                  "after-commit",
                  (snapshot) =>
                    snapshot?.ok &&
                    snapshot.head &&
                    snapshot.head !== state.remoteConfig?.baselineHead &&
                    !snapshot.statusShort &&
                    Boolean(snapshot.baselineDiffNameOnly) &&
                    snapshot.containsBat === true,
                  {
                    attempts: Number(process.env.NIXMAC_E2E_COMMIT_ATTEMPTS || 30),
                    delayMs: Number(process.env.NIXMAC_E2E_COMMIT_DELAY_MS || 1000),
                  },
                );
                text = await captureState(
                  driver,
                  state,
                  "after-commit",
                  "Computer Use committed Step 3 changes.",
                );
                if (committed.ok) {
                  state.remoteConfig.savedHead = committed.snapshot.head;
                  updateScenario(
                    state,
                    "saveFlow",
                    "pass",
                    "Step 3 Commit persisted the generated bat/Homebrew change in the disposable config repo and left the worktree clean.",
                  );
                } else {
                  updateScenario(
                    state,
                    "saveFlow",
                    "fail",
                    "Step 3 Commit was clicked, but the disposable repo did not show a clean committed bat/Homebrew change.",
                  );
                  state.failures.push(
                    "Step 3 Commit did not produce the expected clean disposable git state.",
                  );
                }
              } else {
                updateScenario(
                  state,
                  "saveFlow",
                  "fail",
                  "Step 3 appeared, but Computer Use could not click Commit.",
                );
                state.failures.push("Step 3 Commit button was not reachable.");
              }
            } else if (step3.result === "build-error") {
              updateScenario(
                state,
                "saveFlow",
                "fail",
                "Build & Test was confirmed in disposable mode, but the rebuild failed before Step 3.",
              );
              updateScenario(
                state,
                "rollbackCleanup",
                "inconclusive",
                "Rollback cleanup was not attempted because Build & Test did not reach Step 3.",
              );
              state.failures.push("Build & Test failed before Step 3.");
            } else if (step3.result === "activation-auth-required") {
              updateScenario(
                state,
                "saveFlow",
                "fail",
                "Build & Test reached macOS activation, but the remote lane requires an interactive administrator authentication prompt before Step 3 can appear.",
              );
              updateScenario(
                state,
                "rollbackCleanup",
                "inconclusive",
                "Rollback cleanup was not attempted because activation was blocked by macOS administrator authentication.",
              );
              state.failures.push(
                "Remote activation requires interactive macOS administrator authentication before Step 3.",
              );
            } else if (step3.result === "activation-pam-symlink-hang") {
              updateScenario(
                state,
                "saveFlow",
                "fail",
                "Build & Test reached macOS activation, but remote AppleScript activation hung while creating /etc/pam.d/sudo_local for Touch ID sudo.",
              );
              updateScenario(
                state,
                "rollbackCleanup",
                "inconclusive",
                "Rollback cleanup was not attempted because activation hung before Step 3.",
              );
              state.failures.push(
                "Remote activation hung creating /etc/pam.d/sudo_local during Touch ID sudo setup.",
              );
            } else {
              updateScenario(
                state,
                "saveFlow",
                "inconclusive",
                buildAppearsActive(text)
                  ? "Build & Test was confirmed in disposable mode, but the rebuild still appeared active when the polling window ended."
                  : "Build & Test was confirmed in disposable mode, but Step 3 did not appear before the polling window ended.",
              );
              updateScenario(
                state,
                "rollbackCleanup",
                "inconclusive",
                "Rollback cleanup was not attempted because Step 3 was not reached.",
              );
            }
          } else {
            updateScenario(
              state,
              "buildBoundary",
              "fail",
              "Build & Test confirmation appeared, but Computer Use could not click Confirm in proven disposable state.",
            );
            updateScenario(
              state,
              "saveFlow",
              "inconclusive",
              "Step 3 Save / Keep changes was not exercised because Build & Test confirmation could not be clicked.",
            );
            updateScenario(
              state,
              "rollbackCleanup",
              "inconclusive",
              "Rollback cleanup was not attempted because Build & Test confirmation did not run.",
            );
            state.failures.push("Build & Test confirmation was not reachable in disposable mode.");
          }
        } else {
          if (boundary)
            state.confirmationBoundaries.push(
              "Build & Test boundary observed; not confirmed because disposable build-confirm mode was not proven.",
            );
          await addEvent(state, "safety.build-confirm.skipped", {
            reason:
              "Build confirmation requires disposable config, explicit build-confirm enablement, and a prepared baseline commit.",
            disposableConfig: Boolean(state.safety?.disposableConfig),
            buildConfirmEnabled: Boolean(state.safety?.buildConfirmEnabled),
            baselinePrepared: Boolean(state.remoteConfig?.baselinePrepared),
          });
          await clickByPattern(
            driver,
            state,
            text,
            "Cancel build boundary",
            [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
            "Cancel Build & Test boundary.",
          );
          text = await captureState(
            driver,
            state,
            "after-build-cancel",
            "Computer Use cancelled the Build & Test boundary.",
          );
          updateScenario(
            state,
            "saveFlow",
            "inconclusive",
            "Step 3 Save / Keep changes was not exercised because Build & Test confirmation was not enabled for a proven disposable config.",
          );
          updateScenario(
            state,
            "rollbackCleanup",
            "inconclusive",
            "Rollback cleanup was not exercised because Step 3 Save did not run.",
          );
        }
      } else {
        updateScenario(
          state,
          "buildBoundary",
          "fail",
          "Review passed, but Computer Use could not click Build & Test to verify the destructive boundary.",
        );
        updateScenario(
          state,
          "saveFlow",
          "inconclusive",
          "Step 3 Save / Keep changes was not exercised because Build & Test was not available.",
        );
        updateScenario(
          state,
          "rollbackCleanup",
          "inconclusive",
          "Rollback cleanup was not exercised because Build & Test was not available.",
        );
        state.failures.push("Review passed, but Build & Test was not reachable.");
      }
      if (state.scenarios.saveFlow.status === "pass") {
        if (
          await clickByPattern(
            driver,
            state,
            text,
            "History after commit",
            [/button History/i],
            "Open History to restore the disposable baseline.",
          )
        ) {
          text = await captureState(
            driver,
            state,
            "history-before-restore",
            "Computer Use opened History after Step 3 commit.",
          );
          if (
            await clickByPattern(
              driver,
              state,
              text,
              "Restore previous commit",
              [/button Restore/i],
              "Restore the pre-test disposable baseline from History.",
            )
          ) {
            text = await captureState(
              driver,
              state,
              "history-restore-preview",
              "Computer Use previewed History restore.",
            );
            if (
              await clickByPattern(
                driver,
                state,
                text,
                "Confirm restore",
                [/Confirm Restore/i],
                "Confirm History restore cleanup.",
              )
            ) {
              const restored = await waitForRemoteGit(
                state,
                "after-history-restore",
                (snapshot) =>
                  snapshot?.ok &&
                  !snapshot.statusShort &&
                  !meaningfulBaselineDiff(snapshot) &&
                  snapshot.containsBat === false,
                {
                  attempts: Number(process.env.NIXMAC_E2E_RESTORE_ATTEMPTS || 80),
                  delayMs: Number(process.env.NIXMAC_E2E_RESTORE_DELAY_MS || 5000),
                },
              );
              text = await captureState(
                driver,
                state,
                "after-history-restore",
                "Computer Use completed History restore cleanup.",
              );
              updateScenario(
                state,
                "rollbackCleanup",
                restored.ok ? "pass" : "fail",
                restored.ok
                  ? "History restore rollback returned the disposable Homebrew config to pre-test baseline content with a clean worktree; the top-level nix build result symlink and flake.lock refresh were ignored as build artifacts for this fixed Homebrew prompt."
                  : "History restore was confirmed, but the disposable config tree did not return to the pre-test baseline content cleanly.",
              );
              if (!restored.ok)
                state.failures.push(
                  "Rollback cleanup did not restore the disposable config tree to baseline content.",
                );
            } else {
              updateScenario(
                state,
                "rollbackCleanup",
                "fail",
                "History restore preview appeared, but Computer Use could not click Confirm Restore.",
              );
              state.failures.push("History restore confirmation was not reachable.");
            }
          } else {
            updateScenario(
              state,
              "rollbackCleanup",
              "fail",
              "History opened after Save, but no Restore control was reachable for the disposable baseline.",
            );
            state.failures.push("No History Restore control was reachable after Step 3 commit.");
          }
        } else {
          updateScenario(
            state,
            "rollbackCleanup",
            "fail",
            "Step 3 Commit passed, but Computer Use could not open History for rollback cleanup.",
          );
          state.failures.push(
            "History was not reachable for rollback cleanup after Step 3 commit.",
          );
        }
      } else if (
        state.scenarios.rollbackCleanup.status === "inconclusive" &&
        state.scenarios.rollbackCleanup.notes.length === 0
      ) {
        updateScenario(
          state,
          "rollbackCleanup",
          "inconclusive",
          "Rollback cleanup was not attempted because Step 3 Save did not pass.",
        );
      }

      if (state.scenarios.rollbackCleanup.status === "pass") {
        updateScenario(
          state,
          "discard",
          "pass",
          "Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.",
        );
      } else if (activationAuthRequired(text)) {
        updateScenario(
          state,
          "discard",
          "inconclusive",
          "Discard was not exercised because activation was blocked by macOS administrator authentication; external disposable-state restore handles cleanup.",
        );
      } else if (buildAppearsActive(text)) {
        updateScenario(
          state,
          "discard",
          "inconclusive",
          "Discard was not exercised because Build & Test still appeared active; external disposable-state restore handles cleanup.",
        );
      } else if (
        await clickByPattern(
          driver,
          state,
          text,
          "Discard",
          [/Discard/i],
          "Open Discard confirmation.",
        )
      ) {
        text = await captureState(
          driver,
          state,
          "discard-boundary",
          "Computer Use opened Discard confirmation.",
        );
        const boundary = /Discard|Cancel|Are you sure|Confirm/i.test(text);
        state.confirmationBoundaries.push(
          "Discard boundary observed; confirmation only safe for disposable state.",
        );
        const canConfirmDiscard =
          state.safety?.disposableConfig === true && state.safety?.discardConfirmEnabled === true;
        let exitedDiscard = false;
        if (canConfirmDiscard) {
          exitedDiscard = await clickByPattern(
            driver,
            state,
            text,
            "Confirm discard",
            [/button Confirm/i, /^button Discard$/i],
            "Confirm discard in proven disposable state.",
          );
        } else {
          await addEvent(state, "safety.discard-confirm.skipped", {
            reason:
              "Disposable config mode was not explicitly proven/enabled; Discard confirmation was not clicked.",
            disposableConfig: Boolean(state.safety?.disposableConfig),
            discardConfirmEnabled: Boolean(state.safety?.discardConfirmEnabled),
          });
        }
        if (!exitedDiscard)
          await clickByPattern(
            driver,
            state,
            text,
            "Cancel discard",
            [/Cancel/i, /Close/i, /^button ×/i, /^button X/i],
            "Exit Discard dialog without confirming.",
          );
        text = await captureState(
          driver,
          state,
          "after-discard",
          "Computer Use exited Discard flow.",
        );
        if (!boundary) {
          updateScenario(
            state,
            "discard",
            "fail",
            "Discard did not show a visible confirmation boundary.",
          );
        } else if (canConfirmDiscard && !exitedDiscard) {
          updateScenario(
            state,
            "discard",
            "fail",
            "Discard confirmation appeared in proven disposable state, but Computer Use could not confirm it.",
          );
          state.failures.push("Discard confirmation was not reachable in disposable mode.");
        } else if (canConfirmDiscard) {
          const returnedToStart = exitedDiscard && /Progress: step 1 of 3|Get started/i.test(text);
          updateScenario(
            state,
            "discard",
            returnedToStart ? "pass" : "fail",
            returnedToStart
              ? "Discard was confirmed in proven disposable state and returned to the prompt/start state."
              : "Discard confirmation did not return to start.",
          );
          if (!returnedToStart)
            state.failures.push("Discard confirmation did not return to the prompt/start state.");
        } else {
          updateScenario(
            state,
            "discard",
            "inconclusive",
            "Discard boundary appeared, but confirmation was skipped because disposable config mode was not proven.",
          );
        }
      } else {
        updateScenario(
          state,
          "discard",
          "fail",
          "Discard cleanup was required, but Computer Use could not open the Discard confirmation.",
        );
      }
    } else {
      updateScenario(
        state,
        "summary",
        "inconclusive",
        "Summary was not tested because the real provider workflow did not reach Review.",
      );
      updateScenario(
        state,
        "diff",
        "inconclusive",
        "Diff was not tested because the real provider workflow did not reach Review.",
      );
      updateScenario(
        state,
        "buildBoundary",
        "inconclusive",
        "Build & Test boundary was not tested because the real provider workflow did not reach Review.",
      );
      updateScenario(
        state,
        "saveFlow",
        "inconclusive",
        "Step 3 Save / Keep changes was not tested because the real provider workflow did not reach Review.",
      );
      updateScenario(
        state,
        "rollbackCleanup",
        "inconclusive",
        "Rollback cleanup was not tested because the real provider workflow did not reach Review.",
      );
      updateScenario(
        state,
        "discard",
        "inconclusive",
        "Discard-after-review was not tested because the real provider workflow did not reach Review.",
      );
    }

    for (const caseDef of enabledExtraEvolvedCases()) {
      const executor = evolvedCaseExecutorForMode(caseDef.mode);
      if (executor) {
        text = await executor(driver, state, caseDef);
      } else {
        await addEvent(state, "evolved-case.skipped", {
          id: caseDef.id,
          reason: `Mode ${caseDef.mode} is not executed by the default remote runner.`,
        });
      }
    }

    if (executionTopology === "local-cua-driver") {
      for (const screenshot of state.screenshots) {
        if (screenshot.source === "Codex Computer Use get_app_state image") {
          screenshot.source = "CuaDriver get_window_state image";
        }
      }
    }

    const coreSurfaceLabels = new Set(state.screenshots.map((shot) => shot.label));
    const requiredVisualSurfaces = [
      "launch",
      "settings-general",
      "settings-ai-models",
      "settings-preferences",
      "history",
      "feedback",
      "report-issue",
      "typed-intent",
    ];
    const missingVisualSurfaces = requiredVisualSurfaces.filter(
      (label) => !coreSurfaceLabels.has(label),
    );
    updateScenario(
      state,
      "visualCoverage",
      missingVisualSurfaces.length === 0 ? "pass" : "fail",
      missingVisualSurfaces.length === 0
        ? "Screenshots/text snapshots cover the core app shell, settings, support dialogs, prompt input, and provider flow."
        : `Missing expected visual evidence for: ${missingVisualSurfaces.join(", ")}.`,
    );

    updateMainCoverageFreshness(state);

    state.cleanup.note =
      executionTopology === "local-cua-driver"
        ? "The local CuaDriver owns target-app and daemon cleanup; disposable config cleanup is finalized by the workflow."
        : "Remote app state was not restored by this runner. CI wrapper is responsible for remote app-support backup/restore; local artifacts are retained.";
    addTimingPhase(state, {
      id: "computer-use-run",
      label: "Computer Use run",
      category: "computer-use",
      source: "runner",
      status: "success",
      startedAt: computerUseStartedAt,
      endedAt: nowIso(),
      note:
        executionTopology === "local-cua-driver"
          ? "Connected to the local CuaDriver, exercised the calibrated nixmac Computer Use suite, and reached report generation."
          : "Connected to Codex app-server, exercised the calibrated nixmac Computer Use suite, and reached report generation.",
    });
    if (executionTopology === "local-cua-driver") {
      await transitionRunAttempt(runDir, "UPLOADING");
    }
    await render(state);
    if (executionTopology === "remote-codex-app-server") {
      const inspectReport =
        transportBoundaries.inspectReportWithComputerUse || inspectReportWithComputerUse;
      await inspectReport(driver, state, transportBoundaries);
    }
    refreshVisualProofQuality(state);
    updatePrSpecificCoverage(state);
    await render(state);
    await saveState(state);
    suiteCompleted = true;
  } catch (error) {
    suiteFailure = error;
    if (
      executionTopology === "local-cua-driver" &&
      runProvisioning &&
      classifySuiteFailure(error, { executionTopology }).code === "macos_permissions"
    ) {
      try {
        await recordRunPermissions(runDir, {
          accessibilityGranted: false,
          screenRecordingGranted: false,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
      } catch (permissionError) {
        suiteFailure = new AggregateError(
          [error, permissionError],
          "Computer Use permission probe failed and its denial sidecar could not be recorded",
        );
      }
    }
  } finally {
    const targetSnapshot = processCleanupSnapshot("target", driver?.ownedTarget);
    const daemonSnapshot = processCleanupSnapshot("daemon", driver?.daemonPeer);
    ownedProcessSnapshots = [targetSnapshot.entry, daemonSnapshot.entry];
    processSnapshotFailure = [targetSnapshot.failure, daemonSnapshot.failure]
      .filter(Boolean)
      .join("; ");
    if (driver) {
      try {
        await driver.close();
      } catch (error) {
        closeFailure = error;
      }
    }
  }
  if (executionTopology === "local-cua-driver") {
    if (trustedRunPreflight) {
      try {
        await assertRunPreflight(runDir);
        await verifyLocalCuaPreflight(localPreflight, localPreflightDependencies);
      } catch (error) {
        suiteFailure = suiteFailure
          ? new AggregateError(
              [suiteFailure, error],
              "Computer Use suite failed and final identity revalidation also failed",
            )
          : error;
      }
    }
    const finalizationMode = env.NIXMAC_E2E_FINALIZATION_MODE;
    const capture = captureLifecycleForRun({ uiStarted, failure: suiteFailure });
    const boundInput = trustedRunPreflight?.input || runProvisioning?.input || null;
    if (finalizationMode === "local-finalize" && boundInput) {
      const cleanupStartedAt = nowIso();
      const pathIdentities = [
        ["staging-parent", boundInput.stagingParent],
        ["app-bundle", boundInput.appBundlePath],
        ["disposable-config", boundInput.disposableConfigPath],
        ["daemon-socket-directory", boundInput.daemonSocketDirectory],
        ["daemon-socket", boundInput.daemonSocketPath],
      ];
      let cleanupFailure = [
        processSnapshotFailure,
        closeFailure
          ? `CuaDriver close failed: ${redact(
              closeFailure instanceof Error ? closeFailure.message : String(closeFailure),
            )}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      for (const ownedRoot of [boundInput.stagingParent, boundInput.daemonSocketDirectory]) {
        try {
          await rm(ownedRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupFailure = [
            cleanupFailure,
            `failed to remove ${ownedRoot}: ${redact(
              error instanceof Error ? error.message : String(error),
            )}`,
          ]
            .filter(Boolean)
            .join("; ");
        }
      }
      const ownedPaths = pathIdentities.map(([kind, ownedPath]) => ({
        kind,
        path: ownedPath,
        expectedFinalState: "absent",
        observedFinalState:
          typeof ownedPath === "string" && path.isAbsolute(ownedPath)
            ? existsSync(ownedPath)
              ? "present"
              : "absent"
            : "unverified",
      }));
      if (ownedPaths.some((ownedPath) => ownedPath.observedFinalState !== "absent")) {
        cleanupFailure = [cleanupFailure, "one or more exactly owned paths remain after cleanup"]
          .filter(Boolean)
          .join("; ");
      }
      const processInstances = ownedProcessSnapshots.map((instance) => ({
        ...instance,
        terminated: instance.status === "not_started" || !closeFailure,
      }));
      const remainingProcesses = processInstances
        .filter((instance) => !instance.terminated)
        .map(({ role, pid, birthMarker, executable }) => ({
          role,
          pid,
          birthMarker,
          executable,
        }));
      const cleanup = {
        ownershipMode: "local-ephemeral",
        attempted: true,
        restored: cleanupFailure === "",
        clean: cleanupFailure === "",
        startedAt: cleanupStartedAt,
        completedAt: nowIso(),
        ownedPaths,
        processInstances,
        remainingProcesses,
        failureReason: cleanupFailure,
        lifecycle: {
          driverCloseAttempted: driver !== null,
          driverClosed: !closeFailure,
          ownershipMatched: processSnapshotFailure === "",
          pathsProbed: ownedPaths.every(
            (ownedPath) => ownedPath.observedFinalState !== "unverified",
          ),
          processesProbed: !closeFailure && processSnapshotFailure === "",
        },
      };
      state.cleanup = {
        attempted: cleanup.attempted,
        restored: cleanup.restored,
        clean: cleanup.clean,
        note: cleanup.clean
          ? "CuaDriver target/daemon shutdown and exact staged-app removal completed before evidence sealing."
          : `Final cleanup failed: ${cleanup.failureReason}`,
      };
      try {
        await writeRunCleanup(runDir, cleanup);
        activeRunFinalization = { capture, cleanup, finalizationMode, runDir };
        if (suiteCompleted && !suiteFailure && !closeFailure) {
          await render(state);
          await finalizeLocalEvidence(runDir, { capture, cleanup, verdict: state.verdict });
          activeRunFinalization = null;
        }
      } catch (error) {
        suiteFailure = suiteFailure
          ? new AggregateError(
              [suiteFailure, error],
              "Computer Use suite failed and evidence finalization also failed",
            )
          : error;
      }
    } else if (finalizationMode === "controller-finalize" && boundInput) {
      state.cleanup = {
        attempted: true,
        restored: false,
        clean: false,
        note: "CuaDriver target/daemon shutdown completed; static SSH staging/config cleanup and owner-matched host-lease release remain controller-owned.",
      };
      activeRunFinalization = {
        cleanup: null,
        capture,
        finalizationMode,
        runDir,
        runnerCleanupFailure: closeFailure
          ? redact(closeFailure instanceof Error ? closeFailure.message : String(closeFailure))
          : "",
      };
      if (suiteCompleted && !suiteFailure && !closeFailure) {
        await render(state);
        await stageControllerEvidence(runDir, { capture, verdict: state.verdict });
        activeRunFinalization = null;
      }
    } else if (boundInput) {
      throw new Error(
        "local CuaDriver requires NIXMAC_E2E_FINALIZATION_MODE=local-finalize or controller-finalize",
      );
    } else {
      if (socketEndpoint) {
        try {
          await rm(socketEndpoint.directory, { recursive: true, force: true });
        } catch (error) {
          suiteFailure = suiteFailure
            ? new AggregateError(
                [suiteFailure, error],
                "Computer Use setup failed and socket cleanup also failed",
              )
            : error;
        }
      }
    }
  }
  if (suiteFailure || closeFailure) {
    const failures = [suiteFailure, closeFailure].filter(Boolean);
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Computer Use suite and exact cleanup both failed");
  }
  console.log(path.join(state.runDir, "index.html"));
  if (shouldFailProcessForVerdict(state, env)) {
    console.error(
      `Computer Use E2E verdict was ${state.verdict}; failing the check while preserving the evidence report.`,
    );
    process.exitCode = 1;
  }
}

export async function runSmokeWithDriver(
  args,
  {
    createDriver,
    env = process.env,
    executionTopology = "local-cua-driver",
    localPreflightDependencies = {},
  } = {},
) {
  if (executionTopology !== "local-cua-driver") {
    throw new Error("CuaDriver smoke supports only the local-cua-driver topology");
  }
  if (args.includes("--prompt") || env.NIXMAC_E2E_PROMPT) {
    throw new Error("CuaDriver smoke does not accept a custom prompt");
  }
  if (typeof createDriver !== "function") {
    throw new TypeError("runSmokeWithDriver requires createDriver");
  }

  const options = {
    app: env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  };
  let runDir = argValue(args, "--run-dir", path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  runDir = await realpath(runDir);
  activeRunDir = runDir;
  const localPreflight = await validateLocalCuaPreflight(
    {
      appBundleId: options.app,
      runDir,
    },
    {
      env,
      ...localPreflightDependencies,
    },
  );
  const state = await baseState(runDir, options, { env });
  state.executionTopology = executionTopology;
  state.suiteMode = "smoke";
  state.smoke = {
    schemaVersion: 1,
    contract: "launch-settings-report",
    bounded: true,
    publishesExternally: false,
  };
  for (const key of Object.keys(state.scenarios)) {
    updateScenario(
      state,
      key,
      "not_required",
      "The bounded smoke command covers only launch, Settings General, and local report rendering.",
    );
  }
  updateScenario(state, "launch", "inconclusive", "Smoke launch has not run yet.");
  updateScenario(
    state,
    "settingsGeneral",
    "inconclusive",
    "Smoke Settings General has not run yet.",
  );
  markLocalReportInspectionNotRequired(state);
  state.localApp = {
    artifactSha: localPreflight.appArtifactSha,
    bundleDigestSha256: localPreflight.appBundleDigestSha256,
    bundleId: localPreflight.appBundleId,
    path: localPreflight.appPath,
  };
  await saveState(state);

  const driver = validateRuntimeDriver(
    createDriver({
      ...options,
      runDir,
    }),
  );
  let runError = null;
  try {
    await prepareSuiteDriver(driver, {
      executionTopology,
      appBundleId: options.app,
      localPreflight,
    });
    await verifyLocalCuaPreflight(localPreflight, localPreflightDependencies);
    let text = await captureState(
      driver,
      state,
      "launch",
      "CuaDriver smoke observed the exact staged nixmac app at launch.",
    );
    const launchPassed = /nixmac/i.test(text) && /button Settings/i.test(text);
    updateScenario(
      state,
      "launch",
      launchPassed ? "pass" : "fail",
      launchPassed
        ? "The exact staged app launched and exposed the Settings control."
        : "The exact staged app did not expose the expected launch shell and Settings control.",
    );

    const settingsOpened = await clickByPattern(
      driver,
      state,
      text,
      "Smoke Settings",
      [/button Settings/i],
      "Open Settings for the bounded smoke check.",
    );
    if (settingsOpened) {
      text = await captureState(
        driver,
        state,
        "settings-general",
        "CuaDriver smoke opened Settings General.",
      );
    }
    const settingsPassed = settingsOpened && hasSettingsGeneralEvidence(text);
    updateScenario(
      state,
      "settingsGeneral",
      settingsPassed ? "pass" : "fail",
      settingsPassed
        ? "Settings General rendered the expected configuration controls."
        : "Settings General did not render the expected configuration controls.",
    );
    if (!launchPassed || !settingsPassed) {
      const productFailure = new Error(
        "nixmac app UI did not satisfy the bounded launch and Settings smoke contract",
      );
      state.runFailure = classifySuiteFailure(productFailure, { executionTopology });
      state.failures.push(state.runFailure.summary);
    }
  } catch (error) {
    runError = error;
  }

  let cleanupError = null;
  try {
    await driver.close();
    state.cleanup = {
      attempted: true,
      restored: true,
      note: "The exact smoke target and owned CuaDriver daemon were closed before report rendering.",
    };
  } catch (error) {
    cleanupError = error;
  }
  if (runError && cleanupError) {
    throw new AggregateError(
      [runError, cleanupError],
      `CuaDriver smoke failed and cleanup failed: ${runError.message}; ${cleanupError.message}`,
    );
  }
  if (cleanupError) throw cleanupError;
  if (runError) throw runError;

  for (const screenshot of state.screenshots) {
    if (screenshot.source === "Codex Computer Use get_app_state image") {
      screenshot.source = "CuaDriver get_window_state image";
    }
  }
  state.smoke.outcome = state.runFailure ? `${state.runFailure.category}_failure` : "pass";
  await render(state, {
    generateVideo: false,
    updateStorybook: false,
  });
  await saveState(state);
  console.log(path.join(state.runDir, "index.html"));
  if (shouldFailProcessForVerdict(state, env)) process.exitCode = 1;
  return state;
}

async function runSuite(args) {
  return runSuiteWithDriver(args, {
    createDriver: (options) => new CodexAppServerDriver(options.ws),
    executionTopology: "remote-codex-app-server",
  });
}

async function renderUnavailable(args) {
  const note = argValue(args, "--note", "Computer Use remote runner was not available.");
  const runDir = argValue(args, "--run-dir", path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  const state = await baseState(runDir, {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  });
  await mergeWorkflowTimingsFromArgs(state, args);
  addNarrative(state, note);
  for (const key of Object.keys(state.scenarios)) updateScenario(state, key, "inconclusive", note);
  state.cleanup.note = "No app state touched; unavailable report only.";
  await render(state);
  console.log(path.join(runDir, "index.html"));
}

async function renderStorybookOnly(args) {
  const note = argValue(
    args,
    "--note",
    "Native Computer Use skipped because the PR is UI-only and has Storybook preview evidence.",
  );
  const runDir = argValue(args, "--run-dir", path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  const state = await baseState(runDir, {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  });
  await mergeWorkflowTimingsFromArgs(state, args);
  state.nativeComputerUse = {
    skipped: true,
    reason: note,
    policy: "storybook-ui-only",
    skippedAt: new Date().toISOString(),
  };
  addNarrative(state, note);
  for (const key of Object.keys(state.scenarios)) {
    updateScenario(
      state,
      key,
      "not_required",
      "Native Computer Use was intentionally skipped for this UI-only PR; Storybook preview is the required proof lane.",
    );
  }
  state.cleanup.note =
    "No app state touched; native Computer Use skipped for UI-only Storybook proof.";
  await render(state);
  console.log(path.join(runDir, "index.html"));
}

async function loadExistingRunState(runDir) {
  const statePath = path.join(runDir, "state.json");
  if (!existsSync(statePath)) return null;
  const original = JSON.parse(await readFile(statePath, "utf8"));
  return ensureCurrentSchema({
    ...original,
    runDir,
    crashFallbackRenderedAt: new Date().toISOString(),
  });
}

async function renderExisting(args) {
  const runDir = argValue(args, "--run-dir", "");
  if (!runDir) throw new Error("render-existing requires --run-dir <path>");
  const statePath = path.join(runDir, "state.json");
  const original = JSON.parse(await readFile(statePath, "utf8"));
  const state = ensureCurrentSchema({
    ...original,
    runDir,
    regeneratedFrom: "state.json",
    regeneratedAt: new Date().toISOString(),
  });
  await mergeWorkflowTimingsFromArgs(state, args);

  applyHistoricalRenderMigration(state);
  refreshVisualProofQuality(state);
  state.claims = Object.values(state.scenarios).map((scenario) => ({
    claim: scenario.label,
    status: scenario.status,
    evidence: scenario.notes.join(" ") || "See proof artifacts and coverage gaps.",
  }));
  updateMainCoverageFreshness(state);
  updatePrSpecificCoverage(state);
  await render(state, { stateFileName: "state.regenerated.json", recordEvent: false });
  console.log(path.join(runDir, "index.html"));
}

export async function renderSuiteErrorReport(
  error,
  args,
  { env = process.env, executionTopology = "remote-codex-app-server", suiteMode = "full" } = {},
) {
  const lane = executionTopology === "local-cua-driver" ? "local CuaDriver" : "remote";
  const note = `Computer Use ${lane} runner failed before completing the suite: ${redact(error instanceof Error ? error.message : String(error))}`;
  let runDir = argValue(args, "--run-dir", activeRunDir || "");
  if (runDir && executionTopology === "local-cua-driver") {
    runDir = await realpath(runDir);
  }
  const fallbackArgs = withRunDirArg(args, runDir);
  if (!runDir) {
    await renderUnavailable([...fallbackArgs, "--note", note]);
    return;
  }
  await assertEvidenceTreeMutable(runDir);

  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  let existingState = await loadExistingRunState(runDir);
  if (!existingState) {
    if (executionTopology !== "local-cua-driver") {
      await renderUnavailable([...fallbackArgs, "--note", note]);
      return;
    }
    existingState = await baseState(
      runDir,
      {
        app: env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
        prompt: DEFAULT_PROMPT,
      },
      { env },
    );
    existingState.executionTopology = executionTopology;
  }

  await mergeWorkflowTimingsFromArgs(existingState, args);
  existingState.executionTopology = executionTopology;
  if (suiteMode === "smoke") existingState.suiteMode = "smoke";
  existingState.runFailure = classifySuiteFailure(error, { executionTopology });
  if (suiteMode === "smoke") {
    existingState.smoke ||= {
      schemaVersion: 1,
      contract: "launch-settings-report",
      bounded: true,
      publishesExternally: false,
    };
    existingState.smoke.outcome = existingState.runFailure.infrastructureBlocker
      ? "infrastructure_blocker"
      : `${existingState.runFailure.category}_failure`;
  }
  if (executionTopology === "local-cua-driver") {
    markLocalReportInspectionNotRequired(existingState);
  } else {
    updateScenario(
      existingState,
      "reportInspection",
      "fail",
      "Runner crashed before the report inspection step; fallback report was rendered from partial run evidence.",
    );
  }
  addNarrative(existingState, note);
  existingState.failures.push(note);
  const finalization = activeRunFinalization?.runDir === runDir ? activeRunFinalization : null;
  if (finalization?.finalizationMode === "local-finalize") {
    existingState.cleanup = {
      attempted: finalization.cleanup.attempted,
      restored: finalization.cleanup.restored,
      clean: finalization.cleanup.clean,
      note: finalization.cleanup.clean
        ? "CuaDriver target/daemon shutdown and exact staged-app removal completed after the runner failure."
        : `Final cleanup failed after runner failure: ${finalization.cleanup.failureReason}`,
    };
  } else if (finalization?.finalizationMode === "controller-finalize") {
    existingState.cleanup = {
      attempted: true,
      restored: false,
      clean: false,
      note: finalization.runnerCleanupFailure
        ? `CuaDriver target/daemon shutdown failed and requires controller quarantine: ${finalization.runnerCleanupFailure}`
        : "CuaDriver target/daemon shutdown completed after the runner failure; static cleanup and host-lease release remain controller-owned.",
    };
  }
  await addEvent(existingState, "runner.crash-fallback", { note });
  if (finalization?.capture?.uiStarted === false) {
    const blockerTextPath = path.join(runDir, "texts", "pre-ui-blocker.txt");
    await writeFile(
      blockerTextPath,
      `${note}\nCapture status: ${finalization.capture.status}\nReason: ${finalization.capture.reason}\n`,
      "utf8",
    );
    existingState.screenshots = [];
    existingState.textSnapshots = [
      {
        label: "Pre-UI infrastructure blocker",
        path: "texts/pre-ui-blocker.txt",
        capturedAt: nowIso(),
        note: "Deterministic text evidence retained because the UI lifecycle never began.",
      },
    ];
  }
  await render(existingState, {
    generateVideo:
      existingState.suiteMode !== "smoke" && finalization?.capture?.uiStarted !== false,
    updateStorybook: existingState.suiteMode !== "smoke",
  });
  if (finalization?.capture?.uiStarted === false) {
    existingState.video = {
      status: finalization.capture.status,
      note: "No screenshot or video was created because the lifecycle proves the UI never began.",
    };
    await saveState(existingState);
  }
  if (finalization) {
    try {
      if (finalization.finalizationMode === "local-finalize") {
        await finalizeLocalEvidence(runDir, {
          capture: finalization.capture,
          cleanup: finalization.cleanup,
          verdict: existingState.verdict,
        });
      } else {
        await stageControllerEvidence(runDir, {
          capture: finalization.capture,
          verdict: existingState.verdict,
        });
      }
    } finally {
      activeRunFinalization = null;
    }
  }
  console.log(path.join(runDir, "index.html"));
}

async function runSelfTest() {
  const { coverageManifestSelfTest } = await import("./coverage-manifest.test.mjs");
  coverageManifestSelfTest();
  const launchText = `
    5 button History
    6 button Give feedback
    7 button Settings
    8 content list Progress: step 1 of 3, Describe
    15 heading Get started, Value: 3
    26 button Report Issue
  `;
  const settingsFrame = `
    27 button Close settings
    28 text Settings
    30 button General
    31 button AI Models
    32 button API Keys
    33 button Preferences
    34 button Close
  `;
  assert.equal(
    hasSettingsGeneralEvidence(launchText),
    false,
    "launch text must not satisfy Settings General evidence",
  );
  assert.equal(
    hasSettingsAIModelsEvidence(
      `${settingsFrame}\n35 heading General\n37 text Configuration Directory\n44 text Host`,
    ),
    false,
    "General pane must not satisfy AI Models evidence",
  );
  assert.equal(
    hasSettingsPreferencesEvidence(
      `${settingsFrame}\n35 heading AI Models\n37 heading Evolution Model\n40 text Provider\n44 text Model Name\n66 text Max Build Attempts`,
    ),
    false,
    "AI Models pane must not satisfy Preferences evidence",
  );
  assert.equal(
    hasSettingsGeneralEvidence(
      `${settingsFrame}\n35 heading General\n37 text Configuration Directory\n39 button Browse\n44 text Host`,
    ),
    true,
    "General pane should satisfy General evidence",
  );
  assert.equal(
    hasSettingsAIModelsEvidence(
      `${settingsFrame}\n35 heading AI Models\n37 heading Evolution Model\n40 text Provider\n44 text Model Name\n66 text Max Build Attempts`,
    ),
    true,
    "AI Models pane should satisfy AI Models evidence",
  );
  assert.equal(
    hasSettingsAPIKeysEvidence(
      `${settingsFrame}\n35 heading API Keys\n38 heading OpenRouter\n41 text API Key\n43 secure text field API Key\n49 heading OpenAI`,
    ),
    true,
    "API Keys pane should satisfy API Keys evidence",
  );
  assert.equal(
    hasSettingsPreferencesEvidence(
      `${settingsFrame}\n35 heading Preferences\n37 text Confirmation dialogs\n38 text Build\n41 text Clear / Discard\n44 text Rollback\n50 switch (settable, boolean) off`,
    ),
    true,
    "Preferences pane should satisfy Preferences evidence",
  );
  assert.equal(
    containsUnmaskedSecret(`${settingsFrame}\n43 secure text field API Key, Value: ••••••••••••`),
    false,
    "masked API key text should not be treated as an unmasked secret",
  );
  assert.equal(
    containsUnmaskedSecret(
      `${settingsFrame}\n43 text API Key, Value: sk-or-v1-1234567890abcdef1234567890abcdef`,
    ),
    true,
    "raw OpenRouter key should be treated as an unmasked secret",
  );
  assert.equal(
    containsUnmaskedSecret(
      `${settingsFrame}\n43 text API Key, Value: sk-ant-api03-1234567890abcdef1234567890abcdef`,
    ),
    true,
    "raw Anthropic-style key should be treated as an unmasked secret",
  );
  assert.equal(
    containsUnmaskedSecret("OPENAI_API_KEY=sk-1234567890abcdef1234567890abcdef"),
    true,
    "raw API key env var should be treated as an unmasked secret",
  );
  assert.equal(
    redact("ordinary text"),
    "ordinary text",
    "redact should leave ordinary text unchanged",
  );
  assert.equal(
    redact("OPENAI_API_KEY=sk-1234567890abcdef1234567890abcdef"),
    "OPENAI_API_KEY=[REDACTED]",
    "redact should mask provider API key environment assignments",
  );
  assert.equal(
    redact("Bearer abcdefghijklmnopqrstuvwxyz"),
    "Bearer [REDACTED]",
    "redact should mask Bearer tokens",
  );
  assert.equal(
    verdictFor({ scenarios: { launch: { status: "pass" }, review: { status: "fail" } } }),
    "fail",
    "verdictFor should fail when any scenario fails",
  );
  assert.equal(
    verdictFor({ scenarios: { launch: { status: "pass" }, review: { status: "inconclusive" } } }),
    "inconclusive",
    "verdictFor should be inconclusive when no scenario fails but one is inconclusive",
  );
  assert.equal(
    verdictFor({ scenarios: { launch: { status: "pass" }, review: { status: "pass" } } }),
    "pass",
    "verdictFor should pass when all scenarios pass",
  );
  assert.equal(
    verdictFor({
      scenarios: { storybookPreview: { status: "pass" }, launch: { status: "not_required" } },
    }),
    "pass",
    "verdictFor should ignore explicitly not-required scenarios",
  );
  assert.equal(
    shouldFailProcessForVerdict({ verdict: "fail" }, {}),
    true,
    "strict verdict mode should fail the process for fail verdicts",
  );
  assert.equal(
    shouldFailProcessForVerdict({ verdict: "inconclusive" }, {}),
    true,
    "strict verdict mode should fail the process for inconclusive verdicts",
  );
  assert.equal(
    shouldFailProcessForVerdict({ verdict: "pass" }, {}),
    false,
    "strict verdict mode should not fail the process for pass verdicts",
  );
  assert.equal(
    shouldFailProcessForVerdict({ verdict: "fail" }, { NIXMAC_E2E_STRICT_VERDICT: "false" }),
    false,
    "strict verdict env override should suppress process failure",
  );
  const stateHelperRunDir = path.join(os.tmpdir(), `nixmac-state-helper-${Date.now()}`);
  await mkdir(stateHelperRunDir, { recursive: true });
  const stateHelperState = {
    runDir: stateHelperRunDir,
    events: [],
    claims: [],
    narrative: [],
    scenarios: {
      sample: { label: "Sample scenario", status: "inconclusive", notes: [] },
    },
  };
  updateScenario(
    stateHelperState,
    "sample",
    "fail",
    "OPENAI_API_KEY=sk-1234567890abcdef1234567890abcdef leaked",
  );
  updateScenario(
    stateHelperState,
    "sample",
    "pass",
    "Recovered with Bearer abcdefghijklmnopqrstuvwxyz",
  );
  assert.equal(
    stateHelperState.scenarios.sample.status,
    "pass",
    "updateScenario should update scenario status",
  );
  assert.deepEqual(
    stateHelperState.scenarios.sample.notes,
    ["OPENAI_API_KEY=[REDACTED] leaked", "Recovered with Bearer [REDACTED]"],
    "updateScenario should redact scenario notes",
  );
  assert.deepEqual(
    stateHelperState.claims,
    [{ claim: "Sample scenario", status: "pass", evidence: "Recovered with Bearer [REDACTED]" }],
    "updateScenario should upsert a redacted claim for the scenario label",
  );
  addNarrative(stateHelperState, "Narrative includes OPENROUTER_API_KEY=sk-or-v1-1234567890abcdef");
  assert.equal(
    stateHelperState.narrative[0].text,
    "Narrative includes OPENROUTER_API_KEY=[REDACTED]",
    "addNarrative should redact narrative text",
  );
  await addEvent(stateHelperState, "state.self-test", { detail: "event detail" });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(stateHelperRunDir, "events.json"), "utf8")).map(
      (event) => event.type,
    ),
    ["state.self-test"],
    "addEvent should persist events.json",
  );
  await saveState(stateHelperState);
  assert.equal(
    JSON.parse(await readFile(path.join(stateHelperRunDir, "state.json"), "utf8")).scenarios.sample
      .status,
    "pass",
    "saveState should persist state.json",
  );
  const schemaLifecycleState = ensureStateCurrentSchema(
    {
      runDir: stateHelperRunDir,
      scenarios: {
        sample: { label: "Old sample label", status: "pass", notes: [] },
        videoEvidence: { label: "Legacy video evidence", status: "pass", notes: [] },
      },
      screenshots: [{ label: "sample-shot", path: "screenshots/sample.png" }],
    },
    {
      scenarioLabels: { sample: "Sample scenario", added: "Added scenario" },
      evolvedCaseStrategy: () => ({ defaultCaseId: "homebrew-bat", extraCaseIds: [] }),
      buildPrFocus: () => ({ changedFiles: ["apps/native/src/app.tsx"], scenarioKeys: ["sample"] }),
      pngDimensions: (filePath) =>
        filePath.endsWith("screenshots/sample.png") ? { width: 100, height: 80 } : null,
      env: {
        NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
        NIXMAC_E2E_ALLOW_BUILD_CONFIRM: "true",
        NIXMAC_E2E_ALLOW_DISCARD_CONFIRM: "false",
        NIXMAC_E2E_BUILD_GATE_STATUS: "ready",
        NIXMAC_E2E_BUILD_ARTIFACT_SHA: "same-head-sha",
        NIXMAC_E2E_BUILD_RUN_ID: "12345",
        NIXMAC_E2E_BUILD_GATE_REASON: "same-head-build-artifact-ready",
      },
    },
  );
  assert.equal(
    schemaLifecycleState.scenarios.sample.label,
    "Sample scenario",
    "ensureCurrentSchema should refresh existing scenario labels",
  );
  assert.equal(
    schemaLifecycleState.scenarios.added.status,
    "inconclusive",
    "ensureCurrentSchema should add missing scenarios as inconclusive",
  );
  assert.equal(
    Object.hasOwn(schemaLifecycleState.scenarios, "videoEvidence"),
    false,
    "ensureCurrentSchema should remove legacy videoEvidence scenario",
  );
  assert.deepEqual(
    schemaLifecycleState.screenshots[0].imageSize,
    { width: 100, height: 80 },
    "ensureCurrentSchema should backfill screenshot dimensions",
  );
  assert.equal(
    schemaLifecycleState.safety.disposableConfig,
    true,
    "ensureCurrentSchema should derive safety defaults from injected env",
  );
  assert.equal(
    schemaLifecycleState.safety.buildConfirmEnabled,
    true,
    "ensureCurrentSchema should derive build-confirm safety from injected env",
  );
  assert.equal(
    schemaLifecycleState.safety.discardConfirmEnabled,
    false,
    "ensureCurrentSchema should derive discard-confirm safety from injected env",
  );
  assert.deepEqual(
    {
      status: schemaLifecycleState.buildGate.status,
      requiredHeadSha: schemaLifecycleState.buildGate.requiredHeadSha,
      buildRunId: schemaLifecycleState.buildGate.buildRunId,
      reason: schemaLifecycleState.buildGate.reason,
    },
    {
      status: "ready",
      requiredHeadSha: "same-head-sha",
      buildRunId: "12345",
      reason: "same-head-build-artifact-ready",
    },
    "ensureCurrentSchema should derive same-head build gate metadata from injected env",
  );
  assert.deepEqual(
    schemaLifecycleState.prFocus.scenarioKeys,
    ["sample"],
    "ensureCurrentSchema should derive prFocus from injected builder",
  );
  assert.deepEqual(
    schemaLifecycleState.evolvedCaseStrategy.extraCaseIds,
    [],
    "ensureCurrentSchema should derive evolved-case strategy from injected builder",
  );
  const previousPrFocus = schemaLifecycleState.prFocus;
  const previousSafety = schemaLifecycleState.safety;
  const previousEvolvedCaseStrategy = schemaLifecycleState.evolvedCaseStrategy;
  ensureStateCurrentSchema(schemaLifecycleState, {
    scenarioLabels: { sample: "Sample scenario", added: "Added scenario" },
    evolvedCaseStrategy: () => ({ defaultCaseId: "unexpected", extraCaseIds: ["unexpected"] }),
    buildPrFocus: () => ({ scenarioKeys: ["unexpected"] }),
    pngDimensions: () => ({ width: 1, height: 1 }),
    env: {
      NIXMAC_E2E_DISPOSABLE_CONFIG: "false",
      NIXMAC_E2E_ALLOW_BUILD_CONFIRM: "false",
      NIXMAC_E2E_ALLOW_DISCARD_CONFIRM: "true",
    },
  });
  assert.equal(
    schemaLifecycleState.prFocus,
    previousPrFocus,
    "ensureCurrentSchema should not replace existing prFocus on a later call",
  );
  assert.equal(
    schemaLifecycleState.safety,
    previousSafety,
    "ensureCurrentSchema should not replace existing safety on a later call",
  );
  assert.equal(
    schemaLifecycleState.evolvedCaseStrategy,
    previousEvolvedCaseStrategy,
    "ensureCurrentSchema should not replace existing evolved-case strategy on a later call",
  );
  assert.deepEqual(
    schemaLifecycleState.screenshots[0].imageSize,
    { width: 100, height: 80 },
    "ensureCurrentSchema should not replace existing screenshot dimensions on a later call",
  );
  const baseLifecycleState = await createBaseState(
    stateHelperRunDir,
    { ws: "ws://test", app: "com.darkmatter.test", prompt: "Test prompt" },
    {
      tryRun: (command, args) => {
        if (command === "git" && args.join(" ") === "branch --show-current")
          return { stdout: "feature/product-proof" };
        if (command === "git" && args.join(" ") === "rev-parse --short HEAD")
          return { stdout: "abc1234" };
        if (command === "sw_vers") return { stdout: "26.2" };
        return { stdout: "" };
      },
      repoRoot: "/repo",
      remoteAppPathFromEnv: () => "/tmp/nixmac.app",
      scenarioLabels: { launch: "App launches", review: "Review renders" },
      evolvedCaseStrategy: () => ({ defaultCaseId: "homebrew-bat", selectedAt: "stubbed" }),
      buildPrFocus: () => ({ changedFiles: ["apps/native/src/app.tsx"], scenarioKeys: ["launch"] }),
      env: {
        NIXMAC_E2E_MACOS_VERSION: "test-macos",
        NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
        NIXMAC_E2E_ALLOW_BUILD_CONFIRM: "false",
        NIXMAC_E2E_ALLOW_DISCARD_CONFIRM: "true",
        NIXMAC_E2E_BUILD_GATE_STATUS: "not_ready",
        NIXMAC_E2E_BUILD_ARTIFACT_SHA: "head-under-test",
        NIXMAC_E2E_BUILD_GATE_REASON: "same-head-build-not-ready-before-timeout",
      },
      now: () => "2026-05-02T00:00:00.000Z",
    },
  );
  assert.equal(
    baseLifecycleState.startedAt,
    "2026-05-02T00:00:00.000Z",
    "createBaseState should accept deterministic startedAt injection",
  );
  assert.equal(
    baseLifecycleState.branch,
    "feature/product-proof",
    "createBaseState should record branch from injected runner",
  );
  assert.equal(
    baseLifecycleState.sha,
    "abc1234",
    "createBaseState should record SHA from injected runner",
  );
  assert.equal(
    baseLifecycleState.macosVersion,
    "test-macos",
    "createBaseState should prefer macOS env override",
  );
  assert.equal(
    baseLifecycleState.appCommand,
    "open -n /tmp/nixmac.app",
    "createBaseState should derive app command from injected remote app path",
  );
  assert.equal(
    baseLifecycleState.scenarios.launch.status,
    "inconclusive",
    "createBaseState should initialize scenarios as inconclusive",
  );
  assert.deepEqual(
    baseLifecycleState.scenarios.launch.notes,
    [],
    "createBaseState should initialize fresh-run scenario notes as empty",
  );
  assert.equal(
    baseLifecycleState.cleanup.note,
    "Cleanup has not run yet.",
    "createBaseState should preserve fresh-run cleanup copy",
  );
  assert.equal(
    baseLifecycleState.provider.kind,
    "real-openrouter-compatible-provider",
    "createBaseState should preserve provider kind copy",
  );
  assert.match(
    baseLifecycleState.provider.note,
    /key value is never written/,
    "createBaseState should preserve provider secrecy copy",
  );
  assert.equal(
    baseLifecycleState.safety.disposableConfig,
    true,
    "createBaseState should derive disposable safety from injected env",
  );
  assert.equal(
    baseLifecycleState.safety.buildConfirmEnabled,
    false,
    "createBaseState should derive build-confirm safety from injected env",
  );
  assert.equal(
    baseLifecycleState.safety.discardConfirmEnabled,
    true,
    "createBaseState should derive discard-confirm safety from injected env",
  );
  assert.match(
    baseLifecycleState.safety.note,
    /only allowed when disposable config mode is explicitly proven/,
    "createBaseState should preserve safety note copy",
  );
  assert.equal(
    baseLifecycleState.buildGate.status,
    "not_ready",
    "createBaseState should record build gate status",
  );
  assert.equal(
    baseLifecycleState.buildGate.requiredHeadSha,
    "head-under-test",
    "createBaseState should record build gate head SHA",
  );
  assert.deepEqual(
    baseLifecycleState.evolvedCaseRuns,
    [],
    "createBaseState should initialize evolved case runs as empty",
  );
  assert.deepEqual(
    baseLifecycleState.prFocus.scenarioKeys,
    ["launch"],
    "createBaseState should derive PR focus from injected builder",
  );
  assert.deepEqual(
    baseLifecycleState.evolvedCaseStrategy,
    { defaultCaseId: "homebrew-bat", selectedAt: "stubbed" },
    "createBaseState should derive evolved strategy from injected builder",
  );
  const historicalState = {
    safety: { disposableConfig: false },
    scenarios: {
      saveFlow: {
        status: "inconclusive",
        notes: ["Scenario was added after this run or was not exercised by this runner."],
      },
      discard: { status: "pass", notes: ["Historical discard passed."] },
      rollbackCleanup: { status: "pass", notes: ["Cleanup passed."] },
    },
  };
  applyHistoricalRenderMigration(historicalState);
  assert.deepEqual(
    historicalState.scenarios.saveFlow.notes,
    ["Step 3 Save / Keep changes was not exercised in this historical run."],
    "historical migration should rewrite stale saveFlow note",
  );
  assert.equal(
    historicalState.scenarios.discard.status,
    "pass",
    "historical migration should re-promote discard when rollback cleanup proved stronger cleanup",
  );
  assert.deepEqual(
    historicalState.scenarios.discard.notes,
    [
      "Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.",
    ],
    "historical migration should replace discard notes with the stronger-cleanup explanation",
  );
  const historicalAfterFirstMigration = structuredClone(historicalState);
  applyHistoricalRenderMigration(historicalState);
  assert.deepEqual(
    historicalState,
    historicalAfterFirstMigration,
    "historical migration should be idempotent",
  );
  const nativeInconclusiveDiscardState = {
    safety: { disposableConfig: true },
    scenarios: {
      discard: { status: "inconclusive", notes: ["Native historical inconclusive."] },
      rollbackCleanup: { status: "pass", notes: [] },
    },
  };
  applyHistoricalRenderMigration(nativeInconclusiveDiscardState);
  assert.equal(
    nativeInconclusiveDiscardState.scenarios.discard.status,
    "pass",
    "historical migration should re-promote any inconclusive discard when rollback cleanup passed",
  );
  assert.deepEqual(
    nativeInconclusiveDiscardState.scenarios.discard.notes,
    [
      "Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.",
    ],
    "historical migration should replace native inconclusive discard notes during re-promotion",
  );
  const negativeHistoricalState = {
    safety: { disposableConfig: true },
    scenarios: {
      saveFlow: {
        status: "inconclusive",
        notes: ["Scenario was added after this run.", "Extra note."],
      },
      discard: { status: "pass", notes: ["Disposable config was proven."] },
      rollbackCleanup: { status: "fail", notes: ["Cleanup failed."] },
    },
  };
  const negativeBeforeMigration = structuredClone(negativeHistoricalState);
  applyHistoricalRenderMigration(negativeHistoricalState);
  assert.deepEqual(
    negativeHistoricalState,
    negativeBeforeMigration,
    "historical migration should not broaden no-op conditions",
  );
  const negativeSaveFlowOnly = {
    scenarios: {
      saveFlow: {
        status: "inconclusive",
        notes: ["Scenario was added after this run.", "Extra note."],
      },
    },
  };
  const negativeSaveFlowOnlyBefore = structuredClone(negativeSaveFlowOnly);
  applyHistoricalRenderMigration(negativeSaveFlowOnly);
  assert.deepEqual(
    negativeSaveFlowOnly,
    negativeSaveFlowOnlyBefore,
    "historical migration should not rewrite multi-note saveFlow states",
  );
  const negativeDisposableDiscardOnly = {
    safety: { disposableConfig: true },
    scenarios: {
      discard: { status: "pass", notes: ["Disposable config was proven."] },
    },
  };
  const negativeDisposableDiscardOnlyBefore = structuredClone(negativeDisposableDiscardOnly);
  applyHistoricalRenderMigration(negativeDisposableDiscardOnly);
  assert.deepEqual(
    negativeDisposableDiscardOnly,
    negativeDisposableDiscardOnlyBefore,
    "historical migration should not downgrade discard when disposable config was proven",
  );
  const negativeRollbackOnly = {
    safety: { disposableConfig: true },
    scenarios: {
      discard: { status: "pass", notes: ["Already passed."] },
      rollbackCleanup: { status: "pass", notes: ["Cleanup passed."] },
    },
  };
  const negativeRollbackOnlyBefore = structuredClone(negativeRollbackOnly);
  applyHistoricalRenderMigration(negativeRollbackOnly);
  assert.deepEqual(
    negativeRollbackOnly,
    negativeRollbackOnlyBefore,
    "historical migration should not re-promote discard unless discard is inconclusive",
  );
  assert.equal(
    sourcePrefixExists("apps/native/src/components/widget/settings/"),
    true,
    "coverage freshness should accept existing directory prefixes",
  );
  assert.equal(
    sourcePrefixExists("apps/native/src/components/widget/settings/settings-dialog.tsx"),
    true,
    "coverage freshness should accept existing file prefixes",
  );
  assert.equal(
    sourcePrefixExists("apps/native/src/components/widget/__missing__/"),
    false,
    "coverage freshness should reject missing directory prefixes",
  );
  const coverageFreshness = buildCoverageFreshness();
  assert.equal(
    coverageFreshness.candidateFiles,
    948,
    "coverage freshness should preserve the full shared PR-visible behavior universe",
  );
  const coverageManifest = loadCoverageManifest();
  const filesUnderCandidateRoots = [
    ...new Set(walkCoverageFiles(REPO_ROOT, coverageManifest.candidateRoots)),
  ];
  assert.deepEqual(
    coverageFreshness.candidateFilePaths,
    filesUnderCandidateRoots
      .filter((file) => isLikelyUserVisiblePrFile(file, coverageManifest))
      .sort(),
    "PR focus and freshness should classify the same files with the same shared predicate",
  );
  assert.deepEqual(
    coverageFreshness.unmappedCandidateFiles,
    [],
    "every current candidate should have explicit manifest ownership",
  );
  assert.deepEqual(
    coverageFreshness.drift,
    [],
    "the checked-in manifest should have no schema, ownership, waiver, or source drift",
  );
  assert.equal(
    coverageFreshness.waivers.length,
    20,
    "the current explicit waiver baseline should remain auditable",
  );
  assert.deepEqual(
    coverageFreshness.waivers.reduce((counts, item) => {
      counts[item.risk] = (counts[item.risk] ?? 0) + 1;
      return counts;
    }, {}),
    { medium: 9, high: 11 },
    "the current waiver risk distribution should remain explicit",
  );
  assert.equal(
    coverageFreshness.drift.some((item) =>
      item.includes("e2e-harness-rust has no scenario mapping and no waiver"),
    ),
    false,
    "coverage freshness should preserve an explicitly non-claiming surface without requiring a scenario or waiver",
  );
  assert.equal(
    coverageFreshness.unmappedCandidateFiles.includes("apps/native/src-tauri/src/commands/mod.rs"),
    false,
    "an isolated non-claiming source prefix should still participate in candidate-file coverage",
  );
  const coverageOwnersFor = (file) =>
    coverageManifest.surfaces
      .filter((surface) => changedFileMatchesSurface(file, surface))
      .map((surface) => surface.id)
      .sort();
  assert.deepEqual(
    coverageOwnersFor("apps/native/src-tauri/src/commands/mod.rs"),
    ["internal-runtime-plumbing"],
    "the isolated command registry should be owned only by the non-claiming plumbing surface",
  );
  assert.deepEqual(
    coverageOwnersFor("apps/native/src/components/widget/settings/ai-models-tab.tsx"),
    ["settings"],
    "the AI Models tab should remain mapped to the exercised settings scenarios",
  );
  for (const file of [
    "apps/native/src/hooks/use-darwin-config.ts",
    "apps/native/src/hooks/use-prefs.ts",
    "apps/native/src/ipc/preferences.ts",
    "apps/native/src/viewmodel/preferences.ts",
    "apps/native/src-tauri/src/commands/ui_prefs.rs",
    "apps/native/src-tauri/src/state/preferences.rs",
    "apps/native/src-tauri/src/state/ui_prefs.rs",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["settings-unexercised"],
      `${file} should be waived because rendered tabs do not exercise its state-changing behavior`,
    );
  }
  for (const file of [
    "apps/native/src/components/widget/settings/account-tab.tsx",
    "apps/native/src/components/widget/settings/permissions-tab.tsx",
    "apps/native/src/components/widget/settings/tuning-tab.tsx",
    "apps/native/src/components/widget/settings/developer-tab.tsx",
    "apps/native/src/components/widget/settings/backup-restore-section.tsx",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["settings-unexercised"],
      `${file} should be waived without inheriting the exercised Settings-tab claim`,
    );
  }
  assert.deepEqual(
    coverageOwnersFor("apps/native/src-tauri/src/ai/providers/openai.rs"),
    ["provider-review"],
    "the configured OpenAI-compatible/OpenRouter provider path should remain mapped",
  );
  for (const file of [
    "apps/native/src-tauri/src/ai/providers/cli.rs",
    "apps/native/src-tauri/src/ai/providers/ollama.rs",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["alternate-ai-providers"],
      `${file} should be waived instead of inheriting the configured provider claim`,
    );
  }
  assert.deepEqual(
    coverageOwnersFor("apps/native/src-tauri/src/commands/updater.rs"),
    ["updater-runtime"],
    "the updater runtime should be waived because an absent banner currently passes",
  );
  for (const file of [
    "apps/native/src/components/widget/layout/update-banner.tsx",
    "apps/native/src/hooks/use-updater.ts",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["updater-runtime"],
      `${file} should share the updater-runtime waiver until update behavior is deterministic`,
    );
  }
  assert.deepEqual(
    coverageOwnersFor("apps/native/src/preview-indicator-window.tsx"),
    ["preview-indicator"],
    "the preview side-window entrypoint should share the preview-indicator waiver",
  );
  assert.deepEqual(
    coverageOwnersFor("apps/native/src/evolve-mascot-window.tsx"),
    ["evolve-mascot-indicator"],
    "the experimental mascot side-window entrypoint should not inherit main-window proof",
  );
  for (const file of [
    "apps/native/src/lib/auth-deep-link.ts",
    "apps/native/src/lib/auth.ts",
    "apps/native/src/lib/orpc.ts",
    "apps/native/src/lib/providers/ai-defaults.ts",
    "apps/native/src/lib/providers/ai-models.ts",
    "apps/native/src/lib/providers/ai-provider-migration.ts",
    "apps/native/src/lib/providers/ai-provider-validation.ts",
    "apps/native/src/lib/providers/api-key-verification.ts",
    "apps/native/src/lib/providers/cli-providers-flag.ts",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["native-auth-provider-runtime"],
      `${file} should have explicit managed waiver ownership`,
    );
  }
  const nativeRuntimeLibraryFiles = [
    "apps/native/src/lib/boot-diagnostics.ts",
    "apps/native/src/lib/constants.ts",
    "apps/native/src/lib/dev-onboarding-reset.ts",
    "apps/native/src/lib/env.ts",
    "apps/native/src/lib/errors.ts",
    "apps/native/src/lib/flags.ts",
    "apps/native/src/lib/lsp-client.ts",
    "apps/native/src/lib/lsp-monaco-bridge.ts",
    "apps/native/src/lib/nix-grammar.ts",
    "apps/native/src/lib/query-persist.ts",
    "apps/native/src/lib/summarize-queue.ts",
    "apps/native/src/lib/telemetry/context.tsx",
    "apps/native/src/lib/telemetry/forwarding-processor.ts",
    "apps/native/src/lib/telemetry/init.ts",
    "apps/native/src/lib/telemetry/instance.ts",
    "apps/native/src/lib/telemetry/noop.ts",
    "apps/native/src/lib/telemetry/provider.ts",
    "apps/native/src/lib/telemetry/sanitize.ts",
    "apps/native/src/lib/telemetry/types.ts",
    "apps/native/src/lib/telemetry/use-feature-flag.ts",
    "apps/native/src/lib/utils.ts",
  ];
  for (const file of nativeRuntimeLibraryFiles) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["native-runtime-library"],
      `${file} should have explicit managed waiver ownership`,
    );
  }
  assert.equal(
    nativeRuntimeLibraryFiles.length + 9,
    30,
    "the native library ownership audit should enumerate every current non-test source file",
  );
  for (const file of [
    "apps/native/src-tauri/tauri.conf.json",
    "apps/native/src-tauri/tauri.conf.dev.json",
    "apps/native/src-tauri/Info.plist",
    "apps/native/src-tauri/entitlements.plist",
    "apps/native/src-tauri/capabilities/default.json",
    "apps/native/src-tauri/capabilities/http.json",
    "apps/native/src-tauri/capabilities/macos-passkey.json",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["desktop-security-config"],
      `${file} should be visible to freshness under a managed desktop-security waiver`,
    );
  }
  for (const file of [
    "apps/native/src/components/widget/layout/error-message.tsx",
    "apps/native/src/components/widget/layout/git-status-debug.tsx",
    "apps/native/src/components/widget/notifications/uncommitted-changes-detected.tsx",
    "apps/native/src/components/widget/notifications/unsummarized-changes-detected.tsx",
  ]) {
    assert.deepEqual(
      coverageOwnersFor(file),
      ["recovery-and-activation-preflight"],
      `${file} should be waived until its recovery state is deterministically asserted`,
    );
  }
  const previousExtraCases = process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES;
  process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES = "inline-question-font";
  assert.deepEqual(
    enabledExtraEvolvedCases().map((item) => item.id),
    ["inline-question-font"],
    "inline question optional case should register by env id",
  );
  assert.equal(
    evolvedCaseStrategy().extraCaseIds.includes("inline-question-font"),
    true,
    "inline question optional case should appear in evolved strategy",
  );
  assert.equal(
    typeof evolvedCaseExecutorForMode("question-answer-calibration"),
    "function",
    "question-answer mode should be dispatched",
  );
  assert.equal(
    evolvedCaseExecutorForMode("adversarial-advisory"),
    null,
    "adversarial advisory mode should remain skipped by the default runner",
  );
  assert.equal(
    scenarioGroups.some((group) => group.keys.includes("inlineQuestionAnswer")),
    true,
    "inline question scenario should be grouped",
  );
  assert.equal(
    Boolean(scenarioProofCatalog.inlineQuestionAnswer),
    true,
    "inline question scenario should have proof catalog metadata",
  );
  assert.equal(
    scenarioAssertionTypeHints.inlineQuestionAnswer.includes("question_answer"),
    true,
    "inline question scenario should expose question-answer assertion hint",
  );
  assert.equal(
    isStableCoverageScenarioKey("inlineQuestionAnswer"),
    false,
    "optional evolved cases should not become stable coverage-manifest claims",
  );
  const evolvedScenarioKeys = Object.values(EVOLVED_CASE_CATALOG)
    .map((caseDef) => caseDef.scenarioKey)
    .filter(Boolean);
  const catalogScenarioKeys = new Set([
    ...Object.keys(scenarioLabels),
    ...evolvedScenarioKeys,
    "adversarialOutOfBounds",
  ]);
  const referencedScenarioKeys = new Set([
    ...scenarioGroups.flatMap((group) => group.keys),
    ...curatedProofKeys,
    ...Object.keys(scenarioProofCatalog),
    ...Object.keys(scenarioAssertionTypeHints),
  ]);
  const unknownCatalogKeys = [...referencedScenarioKeys].filter(
    (key) => !catalogScenarioKeys.has(key),
  );
  assert.deepEqual(
    unknownCatalogKeys,
    [],
    "scenario catalog references should resolve to default, optional evolved, or adversarial-only scenario keys",
  );
  const screenshotProofLabels = new Set(
    Object.values(scenarioProofCatalog).flatMap((proof) => proof.screenshots || []),
  );
  const visualContractLabels = new Set(
    Object.values(scenarioVisualContracts).flatMap((contract) =>
      (contract.screenshots || []).map((shot) => shot.label),
    ),
  );
  const annotationLabels = new Set(Object.keys(screenshotAnnotations));
  const unknownAnnotationLabels = [...annotationLabels].filter(
    (label) => !visualContractLabels.has(label) && !screenshotProofLabels.has(label),
  );
  assert.deepEqual(
    unknownAnnotationLabels,
    [],
    "screenshot annotations should target visual contracts or proof-catalog screenshots",
  );
  // These labels are intentionally unannotated: suggestion/provider/report frames
  // are visually asserted by signalstats but do not have stable callout geometry.
  const knownUnannotatedVisualLabels = new Set([
    "suggestion-card",
    "provider-progress-05",
    "HTML report inspection",
  ]);
  const unannotatedVisualLabels = [...visualContractLabels].filter(
    (label) => !annotationLabels.has(label) && !knownUnannotatedVisualLabels.has(label),
  );
  assert.deepEqual(
    unannotatedVisualLabels,
    [],
    "visual contract screenshots should be annotated or explicitly allowed as unannotated",
  );
  const proofGrades = new Set(Object.values(scenarioProofCatalog).map((proof) => proof.grade));
  const unmappedProofGrades = [...proofGrades].filter(
    (grade) => !Object.hasOwn(v1GradeToEvidenceStrength, grade),
  );
  assert.deepEqual(
    unmappedProofGrades,
    [],
    "every proof-catalog evidence grade should map to a V2 evidence strength",
  );
  const emittedFailureClasses = [
    "app",
    "provider",
    "credential",
    "remote_infra",
    "harness",
    "coverage",
    "inconclusive",
  ];
  const missingFailureTaxonomyClasses = emittedFailureClasses.filter(
    (key) => !Object.hasOwn(failureTaxonomy, key),
  );
  assert.deepEqual(
    missingFailureTaxonomyClasses,
    [],
    "failure taxonomy should cover every class emitted by classifyScenarioResult",
  );
  assert.equal(
    Object.hasOwn(ensureCurrentSchema({ scenarios: {} }).scenarios, "inlineQuestionAnswer"),
    false,
    "optional inline question scenario should not be injected into default or historical reports until executed",
  );
  if (previousExtraCases === undefined) delete process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES;
  else process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES = previousExtraCases;

  const questionInputText = `
    1 text Ask a clarifying question
    2 text entry area Type your answer...
    3 button Send
    20 text entry area Home prompt
    21 button Send
  `;
  const questionInput = findQuestionInputEntry(questionInputText);
  assert.equal(
    questionInput?.index,
    "2",
    "question input lookup should prefer the Type your answer placeholder",
  );
  assert.equal(
    findQuestionSubmitEntry(questionInputText, questionInput)?.index,
    "3",
    "question submit lookup should scope Send to the question input",
  );
  const questionChoiceText = `
    1 text What should I configure?
    2 button Add a programming font
    3 button Configure screenshots
    20 button Settings
  `;
  assert.equal(
    findQuestionChoiceEntry(questionChoiceText, [/programming font/i])?.index,
    "2",
    "question choice lookup should find configured choice labels",
  );
  const stopOnlyText = `
    1 button Stop
    2 text Generating...
    3 button Settings
  `;
  assert.equal(
    findQuestionChoiceEntry(stopOnlyText, [/programming font/i]),
    null,
    "question choice lookup must not treat Stop as a fallback answer choice",
  );
  const configuredChoiceWithoutMarker = `
    1 button Stop
    2 button Add a programming font
  `;
  assert.equal(
    findQuestionChoiceEntry(configuredChoiceWithoutMarker, [/programming font/i])?.index,
    "2",
    "question choice lookup may use configured choice labels even when marker text is absent",
  );
  assert.equal(
    hasAnsweredQuestionEvidence(
      "12 text Answered: Add a programming font",
      "Add a programming font",
    ),
    true,
    "answered question evidence should match the submitted answer",
  );

  const simpleElementText = "1 button Settings\n2 text entry area Prompt\n3 button Send";
  assert.equal(
    findElement(simpleElementText, [/button Send/i]),
    "3",
    "findElement should return the first matching AX element index",
  );
  assert.equal(
    findElement(simpleElementText, [/button Missing/i]),
    null,
    "findElement should return null when no AX element matches",
  );
  assert.deepEqual(
    elementEntries(simpleElementText),
    [
      { lineNumber: 0, index: "1", label: "button Settings" },
      { lineNumber: 1, index: "2", label: "text entry area Prompt" },
      { lineNumber: 2, index: "3", label: "button Send" },
    ],
    "elementEntries should parse indexed AX text lines",
  );

  const dispatched = [];
  const dispatchExits = [];
  let dispatchUsageCalls = 0;
  await dispatchRemoteCuaCommand(
    ["run", "--sample", "value"],
    {
      run: async (args) => dispatched.push(["run", args]),
      renderUnavailable: async (args) => dispatched.push(["renderUnavailable", args]),
      renderExisting: async (args) => dispatched.push(["renderExisting", args]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.deepEqual(
    dispatched.pop(),
    ["run", ["--sample", "value"]],
    "CLI dispatcher should forward run args unchanged",
  );
  await dispatchRemoteCuaCommand(
    ["render-existing", "--run-dir", "/tmp/run"],
    {
      run: async (args) => dispatched.push(["run", args]),
      renderUnavailable: async (args) => dispatched.push(["renderUnavailable", args]),
      renderExisting: async (args) => dispatched.push(["renderExisting", args]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.deepEqual(
    dispatched.pop(),
    ["renderExisting", ["--run-dir", "/tmp/run"]],
    "CLI dispatcher should dispatch render-existing args",
  );
  await dispatchRemoteCuaCommand(
    ["render-unavailable", "--note", "not ready"],
    {
      run: async (args) => dispatched.push(["run", args]),
      renderUnavailable: async (args) => dispatched.push(["renderUnavailable", args]),
      renderExisting: async (args) => dispatched.push(["renderExisting", args]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.deepEqual(
    dispatched.pop(),
    ["renderUnavailable", ["--note", "not ready"]],
    "CLI dispatcher should dispatch render-unavailable args",
  );
  await dispatchRemoteCuaCommand(
    ["self-test", "--ignored"],
    {
      run: async (args) => dispatched.push(["run", args]),
      renderUnavailable: async (args) => dispatched.push(["renderUnavailable", args]),
      renderExisting: async (args) => dispatched.push(["renderExisting", args]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.deepEqual(
    dispatched.pop(),
    ["selfTest", []],
    "CLI dispatcher should not pass argv through to self-test",
  );
  await dispatchRemoteCuaCommand(
    ["unknown-command"],
    {
      run: async () => dispatched.push(["run", []]),
      renderUnavailable: async () => dispatched.push(["renderUnavailable", []]),
      renderExisting: async () => dispatched.push(["renderExisting", []]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.equal(dispatchUsageCalls, 1, "CLI dispatcher should print usage for unknown commands");
  assert.equal(dispatchExits.at(-1), 1, "CLI dispatcher should exit 1 for unknown commands");
  await dispatchRemoteCuaCommand(
    [],
    {
      run: async () => dispatched.push(["run", []]),
      renderUnavailable: async () => dispatched.push(["renderUnavailable", []]),
      renderExisting: async () => dispatched.push(["renderExisting", []]),
      selfTest: async () => dispatched.push(["selfTest", []]),
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
    },
  );
  assert.equal(dispatchUsageCalls, 2, "CLI dispatcher should print usage for missing commands");
  assert.equal(dispatchExits.at(-1), 0, "CLI dispatcher should exit 0 for missing commands");
  const dispatchErrors = [];
  await dispatchRemoteCuaCommand(
    ["render-unavailable", "--note", "x"],
    {
      run: async () => {},
      renderUnavailable: async () => {
        throw new Error("synthetic render-unavailable failure");
      },
      renderExisting: async () => {},
      selfTest: async () => {},
    },
    {
      usage: () => {
        dispatchUsageCalls += 1;
      },
      exit: (code) => {
        dispatchExits.push(code);
      },
      onError: (error, context) => {
        dispatchErrors.push({ message: error.message, context });
      },
    },
  );
  assert.deepEqual(
    dispatchErrors,
    [
      {
        message: "synthetic render-unavailable failure",
        context: { command: "render-unavailable", args: ["--note", "x"] },
      },
    ],
    "CLI dispatcher should expose failing command context to wrapper error policy",
  );
  assert.equal(dispatchExits.at(-1), 1, "CLI dispatcher should exit 1 after handler errors");

  assert.deepEqual(
    builtInElementAddressKinds,
    ["codex-index", "text-pattern"],
    "driver contract should only ship address kinds exercised by the current runner",
  );
  assert.equal(
    validateElementAddress({ kind: "codex-index", index: 7 }).normalized.index,
    "7",
    "driver contract should normalize numeric Codex indexes",
  );
  assert.equal(
    validateElementAddress({ kind: "codex-index", index: "abc" }).ok,
    false,
    "driver contract should reject invalid Codex indexes",
  );
  assert.deepEqual(
    validateElementAddress({ kind: "text-pattern", source: "button Send", flags: "i" }).normalized,
    { kind: "text-pattern", patterns: [{ source: "button Send", flags: "i" }] },
    "driver contract should normalize text-pattern addresses",
  );
  assert.equal(
    validateElementAddress({ kind: "text-pattern", source: "button Send", flags: "[" }).ok,
    false,
    "driver contract should reject invalid regex flags",
  );
  assert.equal(
    validateElementAddress({ kind: "text-pattern", source: "[" }).ok,
    false,
    "driver contract should reject invalid regex sources",
  );
  assert.equal(
    validateElementAddress({ kind: "coordinate", x: 1, y: 2 }).ok,
    false,
    "driver contract should reject future address kinds until an adapter registers them",
  );
  assert.equal(
    validateElementAddress(
      { kind: "coordinate", x: 1, y: 2 },
      {
        additionalAddressValidators: {
          coordinate: (address) => ({
            ok: Number.isFinite(address.x) && Number.isFinite(address.y),
            issues: [],
            normalized: address,
          }),
        },
      },
    ).ok,
    true,
    "driver contract should support explicit future address-kind extension by adapter chunk",
  );
  const cuaAddressValidators = {
    "cua-element-index": validateCuaElementIndexAddress,
  };
  const validCuaAddress = {
    kind: "cua-element-index",
    elementIndex: 7,
    pid: 101,
    windowId: 202,
    snapshotId: "turn-1",
  };
  assert.deepEqual(
    validateElementAddress(validCuaAddress, {
      additionalAddressValidators: cuaAddressValidators,
    }).normalized,
    validCuaAddress,
    "driver contract should normalize explicitly registered CuaDriver element indexes",
  );
  assert.equal(
    validateElementAddress(validCuaAddress).ok,
    false,
    "CuaDriver element indexes should remain adapter-scoped",
  );
  for (const [field, value] of [
    ["elementIndex", "7"],
    ["pid", 101.5],
    ["windowId", null],
    ["snapshotId", "   "],
  ]) {
    const result = validateElementAddress(
      { ...validCuaAddress, [field]: value },
      { additionalAddressValidators: cuaAddressValidators },
    );
    assert.equal(result.ok, false, `driver contract should reject invalid CuaDriver ${field}`);
    assert.equal(
      result.issues.some((entry) => entry.path === field),
      true,
      `driver contract should identify invalid CuaDriver ${field}`,
    );
  }
  assert.equal(
    validateDriverCapabilities({
      ...codexAppServerDriverDescriptor.capabilities,
      unsupported: true,
    }).ok,
    false,
    "driver contract should reject unknown capabilities",
  );
  assert.equal(
    validateDriverCapabilities({ ...codexAppServerDriverDescriptor.capabilities, click: false }).ok,
    false,
    "driver contract should reject missing required capabilities",
  );
  assert.equal(
    validateDriverDescriptor({ ...codexAppServerDriverDescriptor, contractVersion: "future" }).ok,
    false,
    "driver contract should reject descriptor version drift",
  );
  assert.equal(
    validateDriverDescriptor({ ...codexAppServerDriverDescriptor, addressKinds: ["coordinate"] })
      .ok,
    false,
    "driver contract should reject unregistered descriptor address kinds",
  );
  assert.throws(
    () =>
      createDriverDescriptor({
        ...codexAppServerDriverDescriptor,
        capabilities: { ...codexAppServerDriverDescriptor.capabilities, click: false },
      }),
    /Invalid Computer Use driver descriptor/,
    "driver descriptor creation should fail fast for invalid descriptors",
  );
  assert.deepEqual(
    validateDriverDescriptor(codexAppServerDriverDescriptor).issues,
    [],
    "Codex app-server descriptor should satisfy the driver contract at load time",
  );
  assert.deepEqual(
    currentRunnerDriverCapabilityUse.filter(
      (capability) => codexAppServerDriverDescriptor.capabilities[capability] !== true,
    ),
    [],
    "Codex app-server descriptor should declare every capability the current runner uses",
  );
  assert.equal(
    driverCapabilityKeys.includes("metadata"),
    true,
    "driver contract should distinguish optional metadata capability from required UI actions",
  );
  assert.equal(
    codexAppServerDriverDescriptor.contractVersion,
    driverContractVersion,
    "Codex app-server descriptor should publish the active driver contract version",
  );
  assert.equal(
    shellQuote("a'b"),
    "'a'\\''b'",
    "shellQuote should preserve single quotes safely for remote shell commands",
  );
  assert.equal(
    sshArgs("true", {}),
    null,
    "sshArgs should be unavailable without a remote destination",
  );
  assert.equal(
    scpArgs("/tmp/local", "/tmp/remote", {}),
    null,
    "scpArgs should be unavailable without a remote destination",
  );
  assert.equal(
    remoteAppPathFromEnv({}),
    "/Applications/nixmac.app",
    "remoteAppPathFromEnv should default to the installed app path",
  );
  assert.equal(
    remoteAppPathFromEnv({ NIXMAC_E2E_REMOTE_APP_PATH: "/tmp/nixmac.app" }),
    "/tmp/nixmac.app",
    "remoteAppPathFromEnv should accept an explicit app path override",
  );
  const remoteStageEnv = {
    NIXMAC_E2E_REMOTE_SSH_DEST: "user@example",
    NIXMAC_E2E_SSH_KNOWN_HOSTS: "/tmp/known_hosts",
    NIXMAC_E2E_SSH_KEY: "/tmp/key",
  };
  assert.deepEqual(
    sshArgs("true", remoteStageEnv),
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/tmp/known_hosts",
      "-i",
      "/tmp/key",
      "user@example",
      "true",
    ],
    "sshArgs should build strict noninteractive SSH args with known_hosts and key overrides",
  );
  assert.deepEqual(
    scpArgs("/tmp/local", "/tmp/remote", remoteStageEnv),
    [
      "-r",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/tmp/known_hosts",
      "-i",
      "/tmp/key",
      "/tmp/local",
      "user@example:/tmp/remote",
    ],
    "scpArgs should build strict noninteractive SCP args with known_hosts and key overrides",
  );
  assert.equal(
    meaningfulBaselineDiff({ baselineDiffNameOnly: "flake.lock\nresult\n" }),
    "",
    "generated build artifacts should not make Homebrew rollback cleanup fail",
  );
  assert.equal(
    meaningfulBaselineDiff({
      baselineDiffNameOnly: "modules/darwin/homebrew.nix\nflake.lock\nresult\n",
    }),
    "modules/darwin/homebrew.nix",
    "user-visible Homebrew config drift should remain meaningful",
  );
  assert.equal(
    hasExpectedHomebrewSourceDiff({
      baselineDiffNameOnly: "modules/darwin/homebrew.nix\nflake.lock\nresult\n",
    }),
    true,
    "Homebrew proof should accept module source path",
  );
  assert.equal(
    hasExpectedHomebrewSourceDiff({
      baselineDiffNameOnly: "flake-modules/darwin.nix\nflake.lock\nresult\n",
    }),
    true,
    "Homebrew proof should accept flake-modules source path",
  );
  assert.equal(
    hasExpectedHomebrewSourceDiff({
      baselineDiffNameOnly: "modules/darwin/system.nix\nflake.lock\nresult\n",
    }),
    false,
    "Homebrew proof should reject non-Homebrew committed paths",
  );
  assert.deepEqual(
    parseSignalStats("lavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=235\n"),
    { YMIN: 16, YMAX: 235 },
    "signalstats parser should extract luminance metrics",
  );
  assert.deepEqual(
    probeCropForImage({ width: 768, height: 768 }, { x: 5, y: 35, w: 90, h: 22 }),
    { x: 38, y: 268, w: 691, h: 168 },
    "visual probe coordinates should map to image pixels",
  );
  assert.equal(
    probeCropForImage({ width: 768, height: 768 }, { x: 95, y: 95, w: 10, h: 10 }),
    null,
    "out-of-bounds visual probes should be rejected",
  );
  assert.deepEqual(
    evaluateScreenshotVisualContract(
      { screenshots: [], runDir: os.tmpdir() },
      { label: "missing-proof", probes: [] },
    ),
    {
      label: "missing-proof",
      status: "fail",
      checks: [
        {
          name: "screenshot artifact",
          status: "fail",
          detail: "Required screenshot artifact is missing from state.screenshots.",
        },
      ],
    },
    "visual contract evaluation should fail with a stable shape when the required screenshot is missing",
  );
  assert.deepEqual(
    evaluateScreenshotVisualContract(
      { screenshots: [], runDir: os.tmpdir() },
      {
        label: "provider-progress-05",
        labels: ["provider-progress-05", "provider-progress-04", "provider-progress-01"],
        probes: [],
      },
    ),
    {
      label: "provider-progress-05",
      status: "fail",
      checks: [
        {
          name: "screenshot artifact",
          status: "fail",
          detail:
            "Required screenshot artifact is missing from state.screenshots: provider-progress-05, provider-progress-04, provider-progress-01.",
        },
      ],
    },
    "visual contract evaluation should report all fallback labels when none are available",
  );
  assert.equal(
    evaluateScreenshotVisualContract(
      {
        runDir: os.tmpdir(),
        screenshots: [
          { label: "provider-progress-01", path: "missing-provider-progress-01.png" },
          { label: "provider-progress-05", path: "missing-provider-progress-05.png" },
        ],
      },
      {
        label: "provider-progress-05",
        labels: ["provider-progress-05", "provider-progress-01"],
        probes: [],
      },
    ).label,
    "provider-progress-05",
    "visual contract evaluation should prefer earlier fallback labels when multiple screenshots are present",
  );

  const previousChangedFiles = process.env.NIXMAC_E2E_PR_CHANGED_FILES;
  process.env.NIXMAC_E2E_PR_CHANGED_FILES =
    "apps/native/src/components/widget/adversarial-new-visible-surface.tsx\ndocs/history.md";
  const prFocus = buildPrFocus();
  assert.deepEqual(
    prFocus.userVisibleFiles,
    ["apps/native/src/components/widget/adversarial-new-visible-surface.tsx"],
    "PR focus should infer user-visible files",
  );
  assert.deepEqual(
    prFocus.scenarioKeys,
    [],
    "non-user-visible changed files must not create PR scenario mappings",
  );
  const waiverOnlyFiles = [
    "apps/native/src-tauri/src/storage/store.rs",
    "apps/native/src-tauri/src/storage/credential_store.rs",
    "apps/native/src-tauri/src/ai/providers/cli.rs",
    "apps/native/src-tauri/src/ai/providers/ollama.rs",
    "apps/native/src-tauri/src/commands/updater.rs",
  ];
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = waiverOnlyFiles.join("\n");
  const waiverOnlyPrFocus = buildPrFocus();
  assert.deepEqual(
    waiverOnlyPrFocus.scenarioKeys,
    [],
    "waiver-only source files must not inherit exercised scenario coverage",
  );
  assert.deepEqual(
    waiverOnlyPrFocus.userVisibleFiles,
    waiverOnlyFiles,
    "waiver-only source files should remain visible to PR focus",
  );
  assert.deepEqual(
    waiverOnlyPrFocus.unmappedUserVisibleFiles,
    waiverOnlyFiles,
    "waiver-only source files should remain explicit scenario debt",
  );
  assert.deepEqual(
    [
      ...new Set(
        waiverOnlyPrFocus.matchedSurfaces
          .filter((surface) => Boolean(surface.waiver))
          .map((surface) => surface.id),
      ),
    ],
    ["settings-unexercised", "alternate-ai-providers", "updater-runtime"],
    "waiver-only source files should retain their manifest waiver ownership",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = [
    "apps/native/src/components/widget/settings/settings-dialog.tsx",
    "apps/native/src-tauri/src/commands/system_defaults.rs",
    "apps/native/src-tauri/src/commands/homebrew.rs",
    "apps/native/src-tauri/src/summarize/build_prompt.rs",
  ].join("\n");
  const manifestClaimingPrFocus = buildPrFocus();
  for (const scenarioKey of [
    "settingsGeneral",
    "settingsAIModels",
    "settingsAPIKeys",
    "settingsPreferences",
    "customizationSaveRollback",
    "homebrewSaveRollback",
    "summary",
    "saveFlow",
  ]) {
    assert.equal(
      manifestClaimingPrFocus.scenarioKeys.includes(scenarioKey),
      true,
      `claiming manifest surfaces should continue to map ${scenarioKey}`,
    );
  }
  const mainAppRootFiles = [
    "apps/native/src/App.css",
    "apps/native/src/App.tsx",
    "apps/native/src/index.css",
    "apps/native/src/main.tsx",
    "apps/native/src/router.tsx",
  ];
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = mainAppRootFiles.join("\n");
  const rootPrFocus = buildPrFocus();
  assert.deepEqual(
    rootPrFocus.userVisibleFiles,
    mainAppRootFiles,
    "PR focus should infer exact main-app root files as user-visible",
  );
  assert.equal(
    rootPrFocus.scenarioKeys.includes("launch"),
    true,
    "root-level native app source changes should focus launch coverage",
  );
  assert.equal(
    rootPrFocus.scenarioKeys.includes("visualCoverage"),
    true,
    "exact main-app root changes should focus visual coverage",
  );
  assert(
    rootPrFocus.matchedSurfaces.every((surface) => surface.id === "app-shell"),
    "exact main-app root files should be manifest-owned by app-shell",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "apps/native/src/preview-indicator-window.tsx";
  const previewEntrypointPrFocus = buildPrFocus();
  assert.deepEqual(
    previewEntrypointPrFocus.scenarioKeys,
    [],
    "the preview side-window entrypoint must not inherit main-window launch or visual proof",
  );
  assert.deepEqual(
    previewEntrypointPrFocus.unmappedUserVisibleFiles,
    ["apps/native/src/preview-indicator-window.tsx"],
    "the preview side-window entrypoint should remain explicit waived scenario debt",
  );
  assert.equal(
    previewEntrypointPrFocus.matchedSurfaces.some(
      (surface) => surface.id === "preview-indicator" && Boolean(surface.waiver),
    ),
    true,
    "the preview side-window entrypoint should retain its waiver ownership",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "apps/native/src/evolve-mascot-window.tsx";
  const mascotEntrypointPrFocus = buildPrFocus();
  assert.deepEqual(
    mascotEntrypointPrFocus.scenarioKeys,
    [],
    "other side-window entrypoints must not inherit main-window launch or visual proof",
  );
  assert.deepEqual(
    mascotEntrypointPrFocus.unmappedUserVisibleFiles,
    ["apps/native/src/evolve-mascot-window.tsx"],
    "the experimental mascot side window should remain explicit waived debt",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "apps/native/src/new-side-window.tsx";
  const newSideWindowPrFocus = buildPrFocus();
  assert.deepEqual(
    newSideWindowPrFocus.scenarioKeys,
    [],
    "a new root side-window entrypoint must fail closed instead of inheriting app-shell proof",
  );
  assert.deepEqual(
    newSideWindowPrFocus.unmappedUserVisibleFiles,
    ["apps/native/src/new-side-window.tsx"],
    "a new root side-window entrypoint should require explicit manifest ownership",
  );
  const updaterFocusFiles = [
    "apps/native/src/components/widget/layout/update-banner.tsx",
    "apps/native/src/hooks/use-updater.ts",
    "apps/native/src-tauri/src/commands/updater.rs",
  ];
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = updaterFocusFiles.join("\n");
  const updaterPrFocus = buildPrFocus();
  assert.deepEqual(
    updaterPrFocus.scenarioKeys,
    [],
    "updater source changes must not inherit the optional absent-banner scenario",
  );
  assert.deepEqual(
    updaterPrFocus.unmappedUserVisibleFiles,
    updaterFocusFiles,
    "updater source changes should remain explicit waived scenario debt",
  );
  const settingsMutationFiles = [
    "apps/native/src/hooks/use-darwin-config.ts",
    "apps/native/src/hooks/use-prefs.ts",
    "apps/native/src/ipc/preferences.ts",
    "apps/native/src/viewmodel/preferences.ts",
    "apps/native/src-tauri/src/commands/ui_prefs.rs",
    "apps/native/src-tauri/src/state/preferences.rs",
    "apps/native/src-tauri/src/state/ui_prefs.rs",
  ];
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = settingsMutationFiles.join("\n");
  const settingsMutationPrFocus = buildPrFocus();
  assert.deepEqual(
    settingsMutationPrFocus.scenarioKeys,
    [],
    "mixed settings persistence and mutation modules must not inherit render-only tab proof",
  );
  assert.deepEqual(
    settingsMutationPrFocus.unmappedUserVisibleFiles,
    settingsMutationFiles,
    "mixed settings persistence and mutation modules should remain explicit waived debt",
  );
  const restoredVisibilityFiles = [
    "apps/native/src/lib/auth-deep-link.ts",
    "apps/native/src/lib/telemetry/init.ts",
    "apps/native/src-tauri/tauri.conf.json",
    "apps/native/src-tauri/capabilities/default.json",
  ];
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = restoredVisibilityFiles.join("\n");
  const restoredVisibilityPrFocus = buildPrFocus();
  assert.deepEqual(
    restoredVisibilityPrFocus.userVisibleFiles,
    restoredVisibilityFiles,
    "native libraries and desktop security config should remain visible to PR focus",
  );
  assert.deepEqual(
    restoredVisibilityPrFocus.waivedUserVisibleFiles,
    restoredVisibilityFiles,
    "unexercised native libraries and desktop config should remain explicit PR debt",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES =
    "apps/native/src/components/widget/settings/settings-dialog.tsx";
  const claimedOnlyPrFocus = buildPrFocus();
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = [
    "apps/native/src/components/widget/settings/settings-dialog.tsx",
    "apps/native/src-tauri/src/storage/store.rs",
  ].join("\n");
  const claimedAndWaivedPrFocus = buildPrFocus();
  process.env.NIXMAC_E2E_PR_CHANGED_FILES =
    "apps/native/src/components/widget/new-visible-surface.tsx";
  const unmatchedOnlyPrFocus = buildPrFocus();
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "apps/native/src-tauri/src/commands/mod.rs";
  const nonClaimingOnlyPrFocus = buildPrFocus();
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = [
    "apps/native/src/components/widget/settings/settings-dialog.tsx",
    "apps/native/src-tauri/src/commands/mod.rs",
  ].join("\n");
  const claimedAndNonClaimingPrFocus = buildPrFocus();
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "tests/e2e/computer-use/run-remote-cua.mjs";
  const toolPrFocus = buildPrFocus();
  assert.equal(
    toolPrFocus.scenarioKeys.includes("visualProofQuality"),
    true,
    "Computer Use E2E changes should focus visual proof quality",
  );
  assert.equal(
    toolPrFocus.scenarioKeys.includes("reportInspection"),
    true,
    "Computer Use E2E changes should focus report inspection",
  );
  assert.equal(
    toolPrFocus.scenarioKeys.includes("prSpecificCoverage"),
    false,
    "PR focus coverage must not require itself",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "tests/e2e/computer-use/new-proof-signal.mjs";
  const unownedProofSystemPrFocus = buildPrFocus();
  assert.deepEqual(
    unownedProofSystemPrFocus.unmatchedUserVisibleFiles,
    ["tests/e2e/computer-use/new-proof-signal.mjs"],
    "new Computer Use proof-system files should fail closed until explicitly owned",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = "tests/e2e/computer-use/new-proof.test.ts";
  const unownedProofCollisionPrFocus = buildPrFocus();
  assert.deepEqual(
    unownedProofCollisionPrFocus.unmatchedUserVisibleFiles,
    ["tests/e2e/computer-use/new-proof.test.ts"],
    "source-oriented test exclusions must not suppress Computer Use proof-system debt",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES =
    ".github/workflows/computer-use-e2e.yml\ntests/e2e/computer-use/report.mjs";
  const workflowAndReportPrFocus = buildPrFocus();
  assert.equal(
    workflowAndReportPrFocus.scenarioKeys.includes("visualProofQuality"),
    true,
    "Computer Use workflow and report changes should focus visual proof quality",
  );
  assert.equal(
    workflowAndReportPrFocus.scenarioKeys.includes("reportInspection"),
    true,
    "Computer Use workflow and report changes should focus report inspection",
  );
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = ".github/workflows/e2e.yml";
  const exactE2eWorkflowPrFocus = buildPrFocus();
  assert.deepEqual(
    exactE2eWorkflowPrFocus.nonClaimingUserVisibleFiles,
    [".github/workflows/e2e.yml"],
    "the exact e2e workflow should remain visible with its explicit non-claiming ownership",
  );
  if (previousChangedFiles === undefined) delete process.env.NIXMAC_E2E_PR_CHANGED_FILES;
  else process.env.NIXMAC_E2E_PR_CHANGED_FILES = previousChangedFiles;

  const prCoverageState = ensureCurrentSchema({
    scenarios: {},
    claims: [],
    prFocus: {
      configured: true,
      changedFiles: ["tests/e2e/computer-use/run-remote-cua.mjs"],
      userVisibleFiles: ["tests/e2e/computer-use/run-remote-cua.mjs"],
      scenarioKeys: ["review", "summary"],
    },
  });
  updateScenario(prCoverageState, "review", "pass", "review passed");
  updateScenario(prCoverageState, "summary", "inconclusive", "summary did not run");
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(
    prCoverageState.scenarios.prSpecificCoverage.status,
    "inconclusive",
    "PR focus coverage should not pass while mapped scenarios are incomplete",
  );
  updateScenario(prCoverageState, "summary", "pass", "summary passed");
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(
    prCoverageState.scenarios.prSpecificCoverage.status,
    "pass",
    "PR focus coverage should pass only when mapped scenarios pass",
  );
  updateScenario(prCoverageState, "review", "fail", "review failed");
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(
    prCoverageState.scenarios.prSpecificCoverage.status,
    "fail",
    "PR focus coverage should fail when a mapped scenario fails",
  );
  const waiverOnlyCoverageState = ensureCurrentSchema({
    scenarios: {},
    claims: [],
    prFocus: { ...waiverOnlyPrFocus, configured: true },
  });
  for (const scenarioKey of [
    "settingsGeneral",
    "settingsAIModels",
    "settingsAPIKeys",
    "settingsPreferences",
  ]) {
    updateScenario(
      waiverOnlyCoverageState,
      scenarioKey,
      "pass",
      "Previously exercised Settings proof passed.",
    );
  }
  updatePrSpecificCoverage(waiverOnlyCoverageState);
  assert.equal(
    waiverOnlyCoverageState.scenarios.prSpecificCoverage.status,
    "inconclusive",
    "waiver-only changes must not false-pass from unrelated previously exercised Settings proof",
  );
  const evaluatePrSpecificFocus = (focus, scenarioStatus = "pass") => {
    const state = ensureCurrentSchema({
      scenarios: {},
      claims: [],
      prFocus: { ...focus, configured: true },
    });
    for (const scenarioKey of focus.scenarioKeys ?? []) {
      if (scenarioKey === "prSpecificCoverage") continue;
      updateScenario(state, scenarioKey, scenarioStatus, `Synthetic ${scenarioStatus} proof.`);
    }
    updatePrSpecificCoverage(state);
    return state.scenarios.prSpecificCoverage.status;
  };
  assert.equal(
    evaluatePrSpecificFocus(claimedOnlyPrFocus),
    "pass",
    "claimed-only PR focus should pass when all mapped scenarios pass",
  );
  assert.equal(
    evaluatePrSpecificFocus(waiverOnlyPrFocus),
    "inconclusive",
    "waived-only PR focus should remain inconclusive",
  );
  assert.equal(
    evaluatePrSpecificFocus(claimedAndWaivedPrFocus),
    "inconclusive",
    "claimed and waived PR focus should remain inconclusive even when claimed scenarios pass",
  );
  assert.equal(
    evaluatePrSpecificFocus(unmatchedOnlyPrFocus),
    "inconclusive",
    "an unmatched user-visible PR focus should remain inconclusive",
  );
  assert.equal(
    evaluatePrSpecificFocus(nonClaimingOnlyPrFocus),
    "pass",
    "an explicitly non-claiming-only PR focus should be a passing no-op",
  );
  assert.equal(
    evaluatePrSpecificFocus(claimedAndNonClaimingPrFocus),
    "pass",
    "claimed plus explicitly non-claiming PR focus should follow passing claimed scenarios",
  );
  assert.equal(
    evaluatePrSpecificFocus(claimedAndNonClaimingPrFocus, "fail"),
    "fail",
    "claimed plus explicitly non-claiming PR focus should follow failing claimed scenarios",
  );

  const renderRunDir = path.join(os.tmpdir(), `nixmac-e2e-self-test-${Date.now()}`);
  await mkdir(renderRunDir, { recursive: true });
  const renderState = await baseState(renderRunDir, {
    app: DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  });
  renderState.prFocus = {
    configured: true,
    number: "63",
    title: "Self-test PR",
    headRef: "feature",
    baseRef: "main",
    changedFiles: ["tests/e2e/computer-use/run-remote-cua.mjs"],
    userVisibleFiles: ["tests/e2e/computer-use/run-remote-cua.mjs"],
    scenarioKeys: ["visualProofQuality", "reportInspection"],
  };
  for (const key of Object.keys(renderState.scenarios)) {
    renderState.scenarios[key].status = "pass";
    renderState.scenarios[key].notes = ["Self-test pass note."];
  }
  renderState.screenshots.push({
    path: "screenshots/self-test.png",
    label: "Self test",
    note: "Synthetic screenshot metadata.",
    capturedAt: new Date().toISOString(),
  });
  renderState.textSnapshots.push({ path: "texts/self-test.txt", label: "Self test text" });
  renderState.remoteMachine = {
    hostname: "DXU97120",
    macosProductVersion: "26.2",
    architecture: "arm64",
  };
  renderState.remoteApp = { bundleName: "nixmac", shortVersion: "0.22.40", codesignVerified: true };
  renderState.processEnvVerification = {
    processFound: true,
    pid: "123",
    openrouterApiKeyInProcess: "present-redacted",
    secretValuesRecorded: false,
  };
  renderState.buildGate = {
    status: "ready",
    requiredHeadSha: "5aa5e5ab",
    buildRunId: "25268041985",
    artifactName: "nixmac-macos-app",
    reason: "same-head-build-artifact-ready",
    note: "Computer Use E2E may start remote setup only after a successful Build macOS App artifact exists for this exact head SHA.",
  };
  addTimingPhase(renderState, {
    id: "self-test-phase",
    label: "Self-test timing phase",
    category: "self-test",
    source: "runner",
    status: "success",
    startedAt: "2026-05-02T00:00:00.000Z",
    endedAt: "2026-05-02T00:00:03.500Z",
    note: "Synthetic phase proves timing renders in Product Proof reports.",
  });
  renderState.confirmationBoundaries = ["Self-test confirmation boundary."];
  await render(renderState, { stateFileName: "state.self-test.json", recordEvent: false });
  const renderedHtml = await readFile(path.join(renderRunDir, "index.html"), "utf8");
  for (const anchor of [
    'id="summary"',
    'id="timing-breakdown"',
    'id="evidence-pack"',
    'class="report-nav"',
    'id="storybook-preview"',
    'id="pull-request-focus"',
    'id="findings-first"',
    'id="evidence-quality"',
    'id="visual-assertions"',
    'id="v2-evidence-model"',
    'id="accessibility-risk"',
    'id="failure-taxonomy"',
    'id="confirmation-boundaries"',
    'id="visual-proof"',
    'id="scenario-checklist"',
    'id="remote-metadata"',
    'id="raw-evidence"',
    'id="screenshots"',
    'id="narrative"',
    'id="claims"',
    'id="pr-specific-focus"',
    'id="cleanup"',
  ]) {
    assert.equal(renderedHtml.includes(anchor), true, `rendered report should include ${anchor}`);
  }
  assert.equal(
    renderedHtml.includes('id="open-issues"'),
    false,
    "duplicate open-issues section should not be rendered",
  );
  assert.equal(
    renderedHtml.includes("Build Gate"),
    true,
    "rendered report should include build gate metadata",
  );
  assert.equal(
    renderedHtml.includes("5aa5e5ab"),
    true,
    "rendered report should include same-head build gate SHA",
  );
  const ids = [...renderedHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, [], "rendered report should not include duplicate element ids");
  const screenshotAnchors = [...renderedHtml.matchAll(/href="#(screenshot-[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(
    screenshotAnchors.every((anchor) => ids.includes(anchor)),
    true,
    "artifact screenshot links should target rendered screenshot gallery anchors",
  );

  const crashRunDir = path.join(os.tmpdir(), `nixmac-e2e-crash-fallback-${Date.now()}`);
  await mkdir(path.join(crashRunDir, "texts"), { recursive: true });
  await mkdir(path.join(crashRunDir, "screenshots"), { recursive: true });
  const crashState = await baseState(crashRunDir, {
    app: DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  });
  updateScenario(
    crashState,
    "launch",
    "pass",
    "Launch partial evidence was captured before the synthetic crash.",
  );
  await writeFile(path.join(crashRunDir, "texts", "01-partial.txt"), "partial evidence\n", "utf8");
  crashState.textSnapshots.push({ path: "texts/01-partial.txt", label: "Partial evidence" });
  await saveState(crashState);
  const previousActiveRunDir = activeRunDir;
  activeRunDir = crashRunDir;
  try {
    await renderSuiteErrorReport(new Error("synthetic fallback crash"), []);
  } finally {
    activeRunDir = previousActiveRunDir;
  }
  const crashFallbackState = JSON.parse(
    await readFile(path.join(crashRunDir, "state.json"), "utf8"),
  );
  assert.equal(
    crashFallbackState.runDir,
    crashRunDir,
    "crash fallback should reuse the active run directory",
  );
  assert.equal(
    crashFallbackState.scenarios.launch.status,
    "pass",
    "crash fallback should preserve partial scenario state",
  );
  assert.equal(
    crashFallbackState.scenarios.reportInspection.status,
    "fail",
    "crash fallback should fail report inspection",
  );
  assert.equal(
    crashFallbackState.textSnapshots.length,
    1,
    "crash fallback should preserve partial text evidence",
  );
  assert.equal(
    existsSync(path.join(crashRunDir, "index.html")),
    true,
    "crash fallback should render an index in the active run directory",
  );
  console.log("Computer Use E2E runner self-test passed.");
}

async function main() {
  await dispatchRemoteCuaCommand(
    process.argv.slice(2),
    {
      run: runSuite,
      renderUnavailable,
      renderStorybookOnly,
      renderExisting,
      selfTest: runSelfTest,
    },
    {
      usage,
      exit: (code) => process.exit(code),
      onError: async (error, { command, args }) => {
        console.error(
          redact(error instanceof Error ? error.stack || error.message : String(error)),
        );
        if (command === "run") {
          try {
            await renderSuiteErrorReport(error, args);
          } catch (reportError) {
            console.error(
              redact(
                reportError instanceof Error
                  ? reportError.stack || reportError.message
                  : String(reportError),
              ),
            );
          }
        }
      },
    },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) await main();
