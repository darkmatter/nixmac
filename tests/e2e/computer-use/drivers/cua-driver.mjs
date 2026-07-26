import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDriverDescriptor,
  driverContractVersion,
  validateCuaElementIndexAddress,
} from "./contract.mjs";
import { normalizeActionResult, normalizeVisibleState } from "./runtime-contract.mjs";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1_048_576;
const DEFAULT_KILL_GRACE_MS = 1_000;
const PINNED_CURRENT_SPACE_FALLBACK_VERSION = "0.12.6";
const PINNED_METADATA_PATH = fileURLToPath(
  new URL("../fixtures/cua-driver/metadata.json", import.meta.url),
);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const pinnedCuaDriverMetadata = deepFreeze(
  JSON.parse(await readFile(PINNED_METADATA_PATH, "utf8")),
);

export const cuaDriverDescriptor = createDriverDescriptor(
  {
    id: "cua-driver",
    displayName: "CuaDriver",
    contractVersion: driverContractVersion,
    status: "fixture-contract-qualified",
    addressKinds: ["cua-element-index", "text-pattern"],
    capabilities: {
      connect: true,
      visibleState: true,
      findElement: true,
      click: true,
      setValue: true,
      screenshotFromState: true,
      textFromState: true,
      close: true,
      metadata: true,
      wait: false,
    },
  },
  {
    additionalAddressValidators: {
      "cua-element-index": validateCuaElementIndexAddress,
    },
  },
);

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.includes("\0")) throw new TypeError(`${label} must not contain NUL`);
  return value;
}

function requireArgv(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("process argv must be an array of NUL-free strings");
  }
  return args;
}

export class CuaProcessError extends Error {
  constructor(
    message,
    { command, args, code = null, signal = null, stdout = "", stderr = "" } = {},
  ) {
    super(message);
    this.name = "CuaProcessError";
    this.command = command;
    this.args = args;
    this.code = code;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function createCuaProcessRunner({
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  return Object.freeze({
    run(command, args, options = {}) {
      const executable = requireNonEmptyString(command, "process command");
      const argv = requireArgv(args);
      const effectiveTimeoutMs = options.timeoutMs ?? timeoutMs;
      const effectiveMaxOutputBytes = options.maxOutputBytes ?? maxOutputBytes;
      if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
        throw new TypeError("process timeoutMs must be a positive integer");
      }
      if (!Number.isInteger(effectiveMaxOutputBytes) || effectiveMaxOutputBytes <= 0) {
        throw new TypeError("process maxOutputBytes must be a positive integer");
      }

      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnImpl(executable, argv, {
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
        } catch (error) {
          reject(error);
          return;
        }

        let stdout = "";
        let stderr = "";
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let terminalError = null;
        let forceKillTimer = null;

        const terminate = () => {
          try {
            child.kill("SIGTERM");
          } catch {}
          forceKillTimer ??= setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, killGraceMs);
          forceKillTimer.unref?.();
        };

        const append = (streamName, chunk) => {
          const text = String(chunk);
          const bytes = Buffer.byteLength(text);
          if (streamName === "stdout") {
            stdoutBytes += bytes;
            if (stdoutBytes <= effectiveMaxOutputBytes) stdout += text;
          } else {
            stderrBytes += bytes;
            if (stderrBytes <= effectiveMaxOutputBytes) stderr += text;
          }
          if (
            !terminalError &&
            (stdoutBytes > effectiveMaxOutputBytes || stderrBytes > effectiveMaxOutputBytes)
          ) {
            terminalError = new CuaProcessError(
              `CuaDriver ${streamName} exceeds ${effectiveMaxOutputBytes} bytes`,
              { command: executable, args: argv, stdout, stderr },
            );
            terminate();
          }
        };

        child.stdout?.setEncoding?.("utf8");
        child.stderr?.setEncoding?.("utf8");
        child.stdout?.on?.("data", (chunk) => append("stdout", chunk));
        child.stderr?.on?.("data", (chunk) => append("stderr", chunk));

        const timeout = setTimeout(() => {
          if (terminalError) return;
          terminalError = new CuaProcessError(
            `CuaDriver process timed out after ${effectiveTimeoutMs}ms`,
            { command: executable, args: argv, stdout, stderr },
          );
          terminate();
        }, effectiveTimeoutMs);
        timeout.unref?.();

        child.once("error", (error) => {
          clearTimeout(timeout);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timeout);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          if (terminalError) {
            terminalError.code = code;
            terminalError.signal = signal;
            terminalError.stdout = stdout;
            terminalError.stderr = stderr;
            reject(terminalError);
            return;
          }
          if (code !== 0) {
            reject(
              new CuaProcessError(`CuaDriver process exited with ${code ?? `signal ${signal}`}`, {
                command: executable,
                args: argv,
                code,
                signal,
                stdout,
                stderr,
              }),
            );
            return;
          }
          resolve({ stdout, stderr });
        });
      });
    },
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEnvelope(value) {
  if (!Array.isArray(value.content)) {
    throw new Error("malformed CuaDriver output: MCP content must be an array");
  }
  if (typeof value.isError !== "boolean") {
    throw new Error("malformed CuaDriver output: MCP isError must be a boolean");
  }
  if (!isPlainObject(value.structuredContent)) {
    throw new Error("malformed CuaDriver output: MCP structuredContent must be an object");
  }
  for (const [index, item] of value.content.entries()) {
    if (!isPlainObject(item) || !["text", "image"].includes(item.type)) {
      throw new Error(`malformed CuaDriver output: invalid MCP content[${index}]`);
    }
    const payload = item.type === "text" ? item.text : item.data;
    if (typeof payload !== "string") {
      throw new Error(`malformed CuaDriver output: invalid MCP content[${index}] payload`);
    }
  }
}

export function parseCuaCliOutput(output, { maxBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
  if (typeof output !== "string") {
    throw new TypeError("CuaDriver output must be a string");
  }
  const bytes = Buffer.byteLength(output);
  if (bytes > maxBytes) throw new Error(`CuaDriver output exceeds ${maxBytes} bytes`);
  const trimmed = output.trim();
  if (trimmed === "") {
    throw new Error("malformed CuaDriver output: empty stdout");
  }

  let decoded;
  try {
    decoded = JSON.parse(trimmed);
  } catch (error) {
    if (/^[{[]/.test(trimmed)) {
      throw new Error(`malformed CuaDriver output: ${error.message}`);
    }
    return Object.freeze({
      structured: null,
      text: trimmed,
      imageBase64: "",
      isError: false,
      envelope: false,
    });
  }

  if (!isPlainObject(decoded)) {
    throw new Error("malformed CuaDriver output: expected a JSON object");
  }
  const envelope = Object.hasOwn(decoded, "content") || Object.hasOwn(decoded, "structuredContent");
  if (!envelope) {
    return Object.freeze({
      structured: decoded,
      text: "",
      imageBase64: "",
      isError: false,
      envelope: false,
    });
  }

  validateEnvelope(decoded);
  const text = decoded.content.find((item) => item.type === "text")?.text ?? "";
  const imageBase64 = decoded.content.find((item) => item.type === "image")?.data ?? "";
  return Object.freeze({
    structured: decoded.structuredContent,
    text,
    imageBase64,
    isError: decoded.isError,
    envelope: true,
  });
}

export function normalizeCuaActionOutput(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("parsed CuaDriver action output is required");
  }
  const structured = isPlainObject(parsed.structured) ? parsed.structured : {};
  const isError = parsed.isError === true || structured.isError === true;
  const text = parsed.text || (typeof structured.message === "string" ? structured.message : "");
  return normalizeActionResult({
    ok: !isError && structured.ok !== false,
    text,
    isError,
  });
}

async function walkRegularFiles(root, directory = root, result = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkRegularFiles(root, absolutePath, result);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`CuaDriver bundle digest rejects non-regular entry: ${absolutePath}`);
    }
    result.push({
      absolutePath,
      relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
    });
  }
  return result;
}

export async function hashCuaBundleTree(appPath) {
  const root = requireNonEmptyString(appPath, "bundle path");
  const files = await walkRegularFiles(root);
  files.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  if (files.length === 0) throw new Error(`bundle has no regular files: ${root}`);
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(file.absolutePath);
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function parseCuaCodesignIdentity(output) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("CuaDriver.app codesign output is empty");
  }
  const digest = output.match(/^CandidateCDHashFull sha256=([0-9a-f]{64})$/m)?.[1];
  const authority = output.match(/^Authority=Developer ID Application: (.+)$/m)?.[1];
  const teamIdentifier = output.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
  if (!digest || !authority || !teamIdentifier) {
    throw new Error("CuaDriver.app codesign output is missing its full signing identity");
  }
  return Object.freeze({
    codeSigningDigestSha256: digest,
    developerId: authority,
    teamIdentifier,
  });
}

function compareWindows(left, right) {
  const zDifference = Number(right.z_index) - Number(left.z_index);
  if (zDifference !== 0) return zDifference;
  return Number(left.window_id) - Number(right.window_id);
}

export function selectCuaWindow(
  windows,
  pid,
  { version = pinnedCuaDriverMetadata.cli.version } = {},
) {
  if (!Array.isArray(windows)) throw new TypeError("CuaDriver windows must be an array");
  if (!Number.isInteger(pid) || pid <= 0)
    throw new TypeError("target pid must be a positive integer");
  const eligible = windows.filter(
    (window) =>
      isPlainObject(window) &&
      window.pid === pid &&
      window.layer === 0 &&
      window.is_on_screen === true &&
      window.on_current_space !== false &&
      Number.isInteger(window.window_id) &&
      window.window_id > 0 &&
      Number.isFinite(window.z_index),
  );
  const explicit = eligible
    .filter((window) => window.on_current_space === true)
    .sort(compareWindows);
  if (explicit.length > 0) {
    return Object.freeze({
      window: Object.freeze({ ...explicit[0] }),
      currentSpaceEvidence: "explicit",
    });
  }
  const fallback =
    version === PINNED_CURRENT_SPACE_FALLBACK_VERSION
      ? eligible.filter((window) => window.on_current_space === null).sort(compareWindows)
      : [];
  if (fallback.length > 0) {
    return Object.freeze({
      window: Object.freeze({ ...fallback[0] }),
      currentSpaceEvidence: "is_on_screen_fallback",
    });
  }
  throw new Error(
    `CuaDriver found no eligible on-screen current-Space layer-0 window for pid ${pid}`,
  );
}

async function defaultCanonicalPath(inputPath) {
  return realpath(inputPath);
}

async function defaultRemoveFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function defaultReadBundleIdentity(
  appPath,
  processRunner,
  { requireDeveloperSigningIdentity = false } = {},
) {
  const stats = await lstat(appPath);
  if (!stats.isDirectory()) throw new Error(`app bundle is not a directory: ${appPath}`);
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const readPlistField = async (field) => {
    const result = await processRunner.run("/usr/bin/plutil", [
      "-extract",
      field,
      "raw",
      "-o",
      "-",
      infoPlist,
    ]);
    return result.stdout.trim();
  };
  const [bundleId, shortVersion, buildVersion, digestSha256] = await Promise.all([
    readPlistField("CFBundleIdentifier"),
    readPlistField("CFBundleShortVersionString"),
    readPlistField("CFBundleVersion"),
    hashCuaBundleTree(appPath),
  ]);
  const identity = {
    bundleId,
    shortVersion,
    buildVersion,
    digestSha256,
  };
  if (!requireDeveloperSigningIdentity) return identity;
  await processRunner.run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
  const codesignResult = await processRunner.run("/usr/bin/codesign", [
    "-d",
    "--verbose=4",
    appPath,
  ]);
  return {
    ...identity,
    ...parseCuaCodesignIdentity(`${codesignResult.stdout}\n${codesignResult.stderr}`),
  };
}

async function defaultQueryPidExecutable(pid, processRunner) {
  const result = await processRunner.run("/bin/ps", ["-p", String(pid), "-o", "comm="]);
  const executable = result.stdout.trim();
  if (!executable) throw new Error(`could not resolve executable for pid ${pid}`);
  return executable;
}

function assertIdentity(actual, expected, label) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (actual?.[field] !== expectedValue) {
      throw new Error(
        `${label} ${field} mismatch: expected ${expectedValue}, got ${actual?.[field] ?? "<missing>"}`,
      );
    }
  }
}

function requireAbsoluteCanonicalInput(appPath, canonicalPath) {
  if (!path.isAbsolute(appPath) || path.normalize(appPath) !== appPath) {
    throw new Error("target appPath must be an absolute normalized path");
  }
  if (canonicalPath !== appPath) {
    throw new Error(`target appPath must be canonical: expected ${canonicalPath}`);
  }
  if (!appPath.endsWith(".app")) throw new Error("target appPath must name an .app bundle");
}

function pathIsWithin(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeRole(role) {
  const roleMap = {
    AXApplication: "application",
    AXButton: "button",
    AXCheckBox: "checkbox",
    AXComboBox: "combo box",
    AXHeading: "heading",
    AXLink: "link",
    AXList: "list",
    AXPopUpButton: "popup button",
    AXRadioButton: "radio button",
    AXStaticText: "text",
    AXTextArea: "text area",
    AXTextField: "text field",
    AXWebArea: "web area",
    AXWindow: "window",
  };
  if (roleMap[role]) return roleMap[role];
  const withoutPrefix = String(role || "element").replace(/^AX/, "");
  return withoutPrefix.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function normalizeElementsText(elements, treeMarkdown) {
  if (!Array.isArray(elements)) {
    throw new Error("CuaDriver window state elements must be an array");
  }
  const lines = elements.map((element, index) => {
    if (!isPlainObject(element) || !Number.isInteger(element.element_index)) {
      throw new Error(`CuaDriver window state has invalid element at index ${index}`);
    }
    const label =
      typeof element.label === "string" && element.label.trim() !== ""
        ? element.label.trim()
        : typeof element.value === "string"
          ? element.value.trim()
          : "";
    const value =
      typeof element.value === "string" &&
      element.value.trim() !== "" &&
      element.value.trim() !== label
        ? ` value=${element.value.trim()}`
        : "";
    return `${element.element_index} ${normalizeRole(element.role)}${label ? ` ${label}` : ""}${value}`;
  });
  if (lines.length > 0) return lines.join("\n");
  if (typeof treeMarkdown !== "string") {
    throw new Error("CuaDriver window state tree_markdown must be a string");
  }
  return treeMarkdown;
}

function requireStructured(parsed, tool) {
  if (!isPlainObject(parsed.structured)) {
    throw new Error(`CuaDriver ${tool} did not return structured JSON`);
  }
  if (parsed.isError) {
    throw new Error(parsed.text || `CuaDriver ${tool} returned isError:true`);
  }
  return parsed.structured;
}

function actionErrorText(error) {
  if (error instanceof CuaProcessError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error?.message || String(error);
}

export class CuaDriver {
  constructor({
    attachSocket = "",
    cliPath = "cua-driver",
    dependencies = {},
    driverAppPath = "/Applications/CuaDriver.app",
    maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
    metadata = pinnedCuaDriverMetadata,
    processRunner = createCuaProcessRunner(),
    runId = randomUUID(),
    socketDirectory = os.tmpdir(),
    statusAttempts = 20,
    statusPollMs = 250,
  } = {}) {
    this.cliPath = requireNonEmptyString(cliPath, "CuaDriver CLI path");
    this.driverAppPath = requireNonEmptyString(driverAppPath, "CuaDriver.app path");
    this.processRunner = processRunner;
    this.runId = requireNonEmptyString(runId, "CuaDriver runId").replace(/[^a-zA-Z0-9._-]/g, "-");
    this.socketDirectory = requireNonEmptyString(socketDirectory, "CuaDriver socket directory");
    this.attachMode = attachSocket !== "";
    this.socketPath = this.attachMode
      ? requireNonEmptyString(attachSocket, "CuaDriver attach socket")
      : path.join(this.socketDirectory, `nixmac-cua-${this.runId}.sock`);
    if (!path.isAbsolute(this.socketPath)) {
      throw new Error("CuaDriver socket path must be absolute");
    }
    this.maxImageBytes = maxImageBytes;
    this.metadata = metadata;
    this.statusAttempts = statusAttempts;
    this.statusPollMs = statusPollMs;
    this.dependencies = {
      canonicalPath: defaultCanonicalPath,
      queryPidExecutable: (pid) => defaultQueryPidExecutable(pid, this.processRunner),
      readBundleIdentity: (appPath, options) =>
        defaultReadBundleIdentity(appPath, this.processRunner, options),
      readFile,
      removeFile: defaultRemoveFile,
      sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
      ...dependencies,
    };
    this.connected = false;
    this.startedDaemon = false;
    this.boundTarget = null;
    this.latestSnapshot = null;
    this.turnId = 0;
  }

  async _run(args, options) {
    return this.processRunner.run(this.cliPath, args, options);
  }

  async _call(tool, input, { screenshotOutFile = "" } = {}) {
    const args = ["call", tool, JSON.stringify(input)];
    if (screenshotOutFile) {
      args.push("--screenshot-out-file", screenshotOutFile);
    }
    args.push("--socket", this.socketPath);
    const result = await this._run(args);
    return parseCuaCliOutput(result.stdout);
  }

  async _callStructured(tool, input, options) {
    return requireStructured(await this._call(tool, input, options), tool);
  }

  async _pollStatus() {
    let lastError;
    for (let attempt = 1; attempt <= this.statusAttempts; attempt += 1) {
      try {
        await this._run(["status", "--socket", this.socketPath]);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.statusAttempts) {
          await this.dependencies.sleep(this.statusPollMs);
        }
      }
    }
    throw new Error(
      `CuaDriver daemon did not become ready at ${this.socketPath}: ${actionErrorText(lastError)}`,
    );
  }

  async connect() {
    if (this.connected) return;
    const versionResult = await this._run(["--version"]);
    const actualVersion = versionResult.stdout.trim();
    if (actualVersion !== this.metadata.cli.version_output) {
      throw new Error(
        `CuaDriver CLI version mismatch: expected ${this.metadata.cli.version_output}, got ${actualVersion}`,
      );
    }
    const appIdentity = await this.dependencies.readBundleIdentity(this.driverAppPath, {
      requireDeveloperSigningIdentity: true,
    });
    assertIdentity(
      appIdentity,
      {
        bundleId: this.metadata.app.bundle_id,
        shortVersion: this.metadata.app.short_version,
        buildVersion: this.metadata.app.build_version,
        digestSha256: this.metadata.app.content_tree_sha256,
        codeSigningDigestSha256: this.metadata.app.code_signing_digest_sha256,
        developerId: this.metadata.app.developer_id,
        teamIdentifier: this.metadata.app.team_identifier,
      },
      "CuaDriver.app",
    );

    try {
      if (!this.attachMode) {
        await this.processRunner.run("/usr/bin/open", [
          "-n",
          "-g",
          "-a",
          "CuaDriver",
          "--args",
          "serve",
          "--socket",
          this.socketPath,
        ]);
        this.startedDaemon = true;
      }
      await this._pollStatus();
      const permissions = await this._callStructured("check_permissions", {
        prompt: false,
      });
      if (permissions.accessibility !== true || permissions.screen_recording !== true) {
        throw new Error("CuaDriver requires Accessibility and Screen Recording permissions");
      }
      if (
        permissions.source?.attribution !== "driver-daemon" ||
        permissions.source?.bundle_id !== this.metadata.app.bundle_id
      ) {
        throw new Error(
          "CuaDriver permissions must be attributed to the installed CuaDriver.app daemon",
        );
      }
      this.connected = true;
    } catch (error) {
      if (this.startedDaemon) {
        try {
          await this.close();
        } catch {}
      }
      throw error;
    }
  }

  async _registeredTargetRecords(appBundleId, appPath, { expectedRunningPid = 0 } = {}) {
    const listing = await this._callStructured("list_apps", {});
    if (!Array.isArray(listing.apps)) {
      throw new Error("CuaDriver list_apps response is missing apps");
    }
    const bundleRecords = listing.apps.filter(
      (app) => isPlainObject(app) && app.bundle_id === appBundleId,
    );
    const runningRecords = bundleRecords.filter(
      (record) => record.running === true || Number(record.pid) > 0,
    );
    if (expectedRunningPid === 0 && runningRecords.length > 0) {
      throw new Error(
        `competing ${appBundleId} process is already running with pid ${runningRecords[0].pid}`,
      );
    }
    if (
      expectedRunningPid > 0 &&
      (runningRecords.length !== 1 || runningRecords[0].pid !== expectedRunningPid)
    ) {
      throw new Error(
        `CuaDriver list_apps did not resolve ${appBundleId} to launched pid ${expectedRunningPid}`,
      );
    }
    const records = [];
    for (const record of bundleRecords) {
      if (typeof record.launch_path !== "string" || record.launch_path === "") continue;
      let launchPath;
      try {
        launchPath = await this.dependencies.canonicalPath(record.launch_path);
      } catch {
        continue;
      }
      records.push({ ...record, canonicalLaunchPath: launchPath });
    }
    const exact = records.filter((record) => record.canonicalLaunchPath === appPath);
    if (exact.length !== 1 || records.some((record) => record.canonicalLaunchPath !== appPath)) {
      throw new Error(`CuaDriver could not uniquely bind ${appBundleId} to staged app ${appPath}`);
    }
    return exact[0];
  }

  async prepareTarget({ appBundleId, appPath } = {}) {
    if (!this.connected) throw new Error("CuaDriver must connect before prepareTarget");
    const bundleId = requireNonEmptyString(appBundleId, "target appBundleId");
    const inputPath = requireNonEmptyString(appPath, "target appPath");
    const canonicalAppPath = await this.dependencies.canonicalPath(inputPath);
    requireAbsoluteCanonicalInput(inputPath, canonicalAppPath);
    const preflightIdentity = await this.dependencies.readBundleIdentity(canonicalAppPath);
    if (preflightIdentity.bundleId !== bundleId) {
      throw new Error(
        `target bundle ID mismatch: expected ${bundleId}, got ${preflightIdentity.bundleId}`,
      );
    }

    const preflightRecord = await this._registeredTargetRecords(bundleId, canonicalAppPath);
    if (preflightRecord.running === true || Number(preflightRecord.pid) > 0) {
      throw new Error(
        `competing ${bundleId} process is already running with pid ${preflightRecord.pid}`,
      );
    }

    const launched = await this._callStructured("launch_app", {
      bundle_id: bundleId,
    });
    if (!Number.isInteger(launched.pid) || launched.pid <= 0) {
      throw new Error("CuaDriver launch_app returned an invalid pid");
    }
    if (launched.bundle_id !== bundleId) {
      throw new Error(
        `CuaDriver launch_app bundle mismatch: expected ${bundleId}, got ${launched.bundle_id}`,
      );
    }
    const pid = launched.pid;
    const runningRecord = await this._registeredTargetRecords(bundleId, canonicalAppPath, {
      expectedRunningPid: pid,
    });
    if (runningRecord.running !== true || runningRecord.pid !== pid) {
      throw new Error(`CuaDriver list_apps did not resolve ${bundleId} to launched pid ${pid}`);
    }

    const executable = await this.dependencies.queryPidExecutable(pid);
    const canonicalExecutable = await this.dependencies.canonicalPath(executable);
    const executableDirectory = path.join(canonicalAppPath, "Contents", "MacOS");
    if (!pathIsWithin(canonicalExecutable, executableDirectory)) {
      throw new Error(`pid ${pid} executable is outside staged app: ${canonicalExecutable}`);
    }
    const runningIdentity = await this.dependencies.readBundleIdentity(canonicalAppPath);
    if (runningIdentity.bundleId !== bundleId) {
      throw new Error(`running bundle identity changed for pid ${pid}`);
    }
    if (runningIdentity.digestSha256 !== preflightIdentity.digestSha256) {
      throw new Error(`running bundle digest changed for pid ${pid}`);
    }

    const windows = await this._callStructured("list_windows", { pid });
    const selected = selectCuaWindow(windows.windows, pid, {
      version: this.metadata.cli.version,
    });
    this.boundTarget = Object.freeze({
      appBundleId: bundleId,
      appPath: canonicalAppPath,
      digestSha256: preflightIdentity.digestSha256,
      pid,
      windowId: selected.window.window_id,
      currentSpaceEvidence: selected.currentSpaceEvidence,
    });
    this.latestSnapshot = null;
    this.turnId = 0;
    return Object.freeze({
      pid,
      windowId: selected.window.window_id,
      currentSpaceEvidence: selected.currentSpaceEvidence,
    });
  }

  _requireBoundApp(app) {
    if (!this.boundTarget) throw new Error("CuaDriver target has not been prepared");
    if (app !== undefined && app !== this.boundTarget.appBundleId) {
      throw new Error(`CuaDriver action app mismatch: expected ${this.boundTarget.appBundleId}`);
    }
    return this.boundTarget;
  }

  _screenshotPath(turnId) {
    return path.join(this.socketDirectory, `nixmac-cua-${this.runId}-state-${turnId}.png`);
  }

  async visibleState({ app } = {}) {
    const target = this._requireBoundApp(app);
    const turnId = this.turnId + 1;
    const screenshotPath = this._screenshotPath(turnId);
    let screenshotBytes;
    let state;
    try {
      state = await this._callStructured(
        "get_window_state",
        {
          pid: target.pid,
          window_id: target.windowId,
        },
        { screenshotOutFile: screenshotPath },
      );
      if (state.pid !== target.pid || state.window_id !== target.windowId) {
        throw new Error("CuaDriver window state target identity mismatch");
      }
      screenshotBytes = await this.dependencies.readFile(screenshotPath);
    } finally {
      await this.dependencies.removeFile(screenshotPath);
    }
    if (!Buffer.isBuffer(screenshotBytes)) {
      screenshotBytes = Buffer.from(screenshotBytes);
    }
    if (screenshotBytes.length === 0 || screenshotBytes.length > this.maxImageBytes) {
      throw new Error(
        `CuaDriver screenshot size ${screenshotBytes.length} is outside allowed bounds`,
      );
    }
    if (
      screenshotBytes.length < 8 ||
      !screenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    ) {
      throw new Error("CuaDriver screenshot is not a valid PNG");
    }

    this.turnId = turnId;
    const snapshotId = `${target.pid}:${target.windowId}:${turnId}`;
    const elementTokens = new Map();
    for (const element of state.elements) {
      if (
        Number.isInteger(element?.element_index) &&
        typeof element?.element_token === "string" &&
        element.element_token !== ""
      ) {
        elementTokens.set(element.element_index, element.element_token);
      }
    }
    this.latestSnapshot = Object.freeze({
      pid: target.pid,
      windowId: target.windowId,
      snapshotId,
      elementTokens,
    });
    return normalizeVisibleState({
      text: normalizeElementsText(state.elements, state.tree_markdown),
      imageBase64: screenshotBytes.toString("base64"),
      target: {
        pid: target.pid,
        windowId: target.windowId,
        snapshotId,
      },
      metadata: {
        appBundleId: target.appBundleId,
        appPath: target.appPath,
        bundleDigestSha256: target.digestSha256,
        cuaSnapshotId: state.snapshot_id ?? "",
        currentSpaceEvidence: target.currentSpaceEvidence,
      },
    });
  }

  _validatedActionAddress(method, request) {
    const target = this._requireBoundApp(request?.app);
    if (!this.latestSnapshot) {
      throw new Error(`CuaDriver ${method} requires a visibleState snapshot`);
    }
    const validation = validateCuaElementIndexAddress(request?.elementAddress);
    if (!validation.ok) {
      throw new TypeError(`CuaDriver ${method} requires a valid cua-element-index address`);
    }
    const address = validation.normalized;
    if (
      address.pid !== target.pid ||
      address.windowId !== target.windowId ||
      address.snapshotId !== this.latestSnapshot.snapshotId
    ) {
      throw new Error(`stale CuaDriver element address for ${method}`);
    }
    if (
      request.elementIndex !== undefined &&
      String(request.elementIndex) !== String(address.elementIndex)
    ) {
      throw new Error(`CuaDriver ${method} element index does not match its address`);
    }
    return {
      address,
      elementToken: this.latestSnapshot.elementTokens.get(address.elementIndex) ?? "",
    };
  }

  async click(request = {}) {
    const { address, elementToken } = this._validatedActionAddress("click", request);
    const input = {
      pid: address.pid,
      window_id: address.windowId,
      element_index: address.elementIndex,
    };
    if (elementToken) input.element_token = elementToken;
    try {
      return normalizeCuaActionOutput(await this._call("click", input));
    } catch (error) {
      return normalizeActionResult({
        ok: false,
        text: actionErrorText(error),
        isError: true,
      });
    }
  }

  async setValue(request = {}) {
    if (typeof request.value !== "string") {
      throw new TypeError("CuaDriver setValue requires a string value");
    }
    const { address, elementToken } = this._validatedActionAddress("setValue", request);
    const input = {
      pid: address.pid,
      window_id: address.windowId,
      element_index: address.elementIndex,
    };
    if (elementToken) input.element_token = elementToken;
    input.value = request.value;
    try {
      return normalizeCuaActionOutput(await this._call("set_value", input));
    } catch (error) {
      return normalizeActionResult({
        ok: false,
        text: actionErrorText(error),
        isError: true,
      });
    }
  }

  async close() {
    if (!this.startedDaemon) {
      this.connected = false;
      return;
    }
    this.startedDaemon = false;
    this.connected = false;
    await this._run(["stop", "--socket", this.socketPath]);
  }
}
