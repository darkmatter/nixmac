import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
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
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_MAX_DIMENSION = 16_384;
const PNG_MAX_DECODED_BYTES = 100 * 1_048_576;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

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
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
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
          forceKillTimer ??= scheduleTimeout(() => {
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

        const timeout = scheduleTimeout(() => {
          if (terminalError) return;
          terminalError = new CuaProcessError(
            `CuaDriver process timed out after ${effectiveTimeoutMs}ms`,
            { command: executable, args: argv, stdout, stderr },
          );
          terminate();
        }, effectiveTimeoutMs);
        timeout.unref?.();

        child.once("error", (error) => {
          cancelTimeout(timeout);
          if (forceKillTimer) cancelTimeout(forceKillTimer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          cancelTimeout(timeout);
          if (forceKillTimer) cancelTimeout(forceKillTimer);
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

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function invalidPng(reason) {
  throw new Error(`CuaDriver screenshot is not a valid PNG: ${reason}`);
}

export function validatePngScreenshot(bytes) {
  const png = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalidPng("signature mismatch");
  }
  let offset = 8;
  let ihdr = null;
  let sawIend = false;
  let sawIdat = false;
  let idatEnded = false;
  const idatChunks = [];
  while (offset < png.length) {
    if (png.length - offset < 12) invalidPng("truncated chunk");
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > png.length) {
      invalidPng("chunk length exceeds file bounds");
    }
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) invalidPng("invalid chunk type");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = png.readUInt32BE(offset + 8 + length);
    const actualCrc = pngCrc32(png.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) invalidPng(`${type} CRC mismatch`);
    if (sawIend) invalidPng("trailing chunk after IEND");
    if (type === "IHDR") {
      if (offset !== 8 || ihdr !== null || length !== 13) invalidPng("invalid IHDR");
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (width === 0 || height === 0 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) {
        invalidPng("unsafe IHDR dimensions");
      }
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
        invalidPng("screenshot must use qualified 8-bit RGB or RGBA encoding");
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        invalidPng("unsupported IHDR encoding");
      }
      ihdr = { bitDepth, colorType, height, width };
    } else if (type === "IDAT") {
      if (!ihdr || idatEnded) invalidPng("invalid IDAT ordering");
      sawIdat = true;
      idatChunks.push(data);
    } else {
      if (sawIdat) idatEnded = true;
      if (type === "IEND") {
        if (length !== 0 || !ihdr || !sawIdat) invalidPng("invalid IEND");
        sawIend = true;
      } else if (type === "PLTE") {
        invalidPng("PLTE is not allowed by the qualified RGB/RGBA screenshot contract");
      } else if (type[0] === type[0].toUpperCase()) {
        invalidPng(`unknown critical PNG chunk ${type}`);
      }
    }
    offset = chunkEnd;
  }
  if (!sawIend || offset !== png.length) invalidPng("missing complete IEND");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  const rowBytes = Math.ceil((ihdr.width * ihdr.bitDepth * channels) / 8);
  const expectedInflatedBytes = ihdr.height * (rowBytes + 1);
  if (
    !Number.isSafeInteger(expectedInflatedBytes) ||
    expectedInflatedBytes > PNG_MAX_DECODED_BYTES
  ) {
    invalidPng(`decoded PNG size exceeds ${PNG_MAX_DECODED_BYTES} bytes`);
  }
  const concatenatedIdat = Buffer.concat(idatChunks);
  let inflateResult;
  try {
    inflateResult = inflateSync(concatenatedIdat, {
      info: true,
      maxOutputLength: expectedInflatedBytes + 1,
    });
  } catch (error) {
    invalidPng(`IDAT inflate failed: ${error.message}`);
  }
  if (inflateResult.engine.bytesWritten !== concatenatedIdat.length) {
    invalidPng("trailing bytes after zlib stream");
  }
  const inflated = inflateResult.buffer;
  if (inflated.length !== expectedInflatedBytes) {
    invalidPng("IDAT scanline length mismatch");
  }
  for (let row = 0; row < ihdr.height; row += 1) {
    if (inflated[row * (rowBytes + 1)] > 4) invalidPng("invalid scanline filter");
  }
  return Object.freeze({ height: ihdr.height, width: ihdr.width });
}

function hasExactKeys(value, required, optional = []) {
  const actual = Object.keys(value).sort();
  const requiredKeys = [...required].sort();
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return actual.every((key) => allowed.has(key));
}

function validateEnvelope(value) {
  for (const key of Object.keys(value)) {
    if (!["content", "structuredContent", "isError"].includes(key)) {
      throw new Error(`malformed CuaDriver output: unknown MCP envelope key ${key}`);
    }
  }
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
    const validText =
      isPlainObject(item) &&
      item.type === "text" &&
      hasExactKeys(item, ["type", "text"]) &&
      typeof item.text === "string";
    const validImage =
      isPlainObject(item) &&
      item.type === "image" &&
      hasExactKeys(item, ["type", "data"], ["mimeType"]) &&
      typeof item.data === "string" &&
      (item.mimeType === undefined || typeof item.mimeType === "string");
    if (!validText && !validImage) {
      throw new Error(`malformed CuaDriver output: invalid MCP content[${index}]`);
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

function validateClickSuccess(structured, { historicalEnvelope = false } = {}) {
  return (
    isPlainObject(structured) &&
    hasExactKeys(
      structured,
      historicalEnvelope ? ["effect", "ok", "path", "verified"] : ["effect", "path", "verified"],
    ) &&
    (!historicalEnvelope || structured.ok === true) &&
    structured.effect === "unverifiable" &&
    ["ax", "ax_fg", "cgevent", "cgevent_fg", "cgevent_hid"].includes(structured.path) &&
    structured.verified === false
  );
}

function setValueSuccessGrammar(elementIndex) {
  const suffix =
    "(?:\\n\\n(?:🪟 Action opened new window\\(s\\): [^\\r\\n]+\\.|🔀 Action caused a different app to become frontmost\\.))?";
  const families = [
    `✅ Set AXValue on \\[${elementIndex}\\] AX[A-Za-z0-9]+\\.`,
    `✅ Set AXValue on \\[${elementIndex}\\] AX[A-Za-z0-9]+ via AXIncrement/AXDecrement stepping\\.`,
    `✅ Selected '[^'\\r\\n]*' in AXPopUpButton \\[${elementIndex}\\] "[^"\\r\\n]*" via AX child AXPress\\.`,
    `✅ Set select \\[${elementIndex}\\] '[^'\\r\\n]*' to '[^'\\r\\n]*' via Safari JavaScript \\(DOM value: "[^"\\r\\n]*"\\)\\.`,
  ];
  return new RegExp(`^(?:${families.join("|")})${suffix}$`);
}

export function normalizeCuaActionOutput(
  parsed,
  { tool, input, version = pinnedCuaDriverMetadata.cli.version } = {},
) {
  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("parsed CuaDriver action output is required");
  }
  if (!["click", "set_value"].includes(tool)) {
    throw new TypeError("CuaDriver action tool must be click or set_value");
  }
  if (!Number.isInteger(input?.element_index) || input.element_index < 0) {
    throw new TypeError(`CuaDriver ${tool} requires an integer element_index`);
  }
  if (parsed.isError === true) {
    throw new Error(`CuaDriver ${tool} historical envelope returned isError:true`);
  }
  if (tool === "click") {
    if (parsed.structured?.effect === "suspected_noop") {
      throw new Error("CuaDriver click reported suspected_noop semantic soft failure");
    }
    if (!validateClickSuccess(parsed.structured, { historicalEnvelope: parsed.envelope })) {
      throw new Error("CuaDriver click lacks pinned structured success evidence");
    }
    return normalizeActionResult({ ok: true, text: parsed.text, isError: false });
  }
  if (
    version !== PINNED_CURRENT_SPACE_FALLBACK_VERSION ||
    parsed.envelope ||
    parsed.structured !== null ||
    !setValueSuccessGrammar(input.element_index).test(parsed.text)
  ) {
    throw new Error("CuaDriver set_value lacks pinned plaintext success evidence");
  }
  return normalizeActionResult({ ok: true, text: parsed.text, isError: false });
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
  let result;
  try {
    result = await processRunner.run("/bin/ps", ["-p", String(pid), "-o", "comm="]);
  } catch (error) {
    if (error instanceof CuaProcessError && error.code === 1) {
      const gone = new Error(`pid ${pid} no longer exists`);
      gone.code = "ESRCH";
      throw gone;
    }
    throw error;
  }
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

export function parseCuaSocketOwner(output, canonicalSocketPath) {
  if (typeof output !== "string") throw new TypeError("lsof output must be a string");
  const socketPath = requireNonEmptyString(canonicalSocketPath, "canonical CuaDriver socket path");
  const processes = [];
  let processRecord = null;
  let fileRecord = null;
  for (const line of output.split(/\r?\n/)) {
    if (line === "") continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      const pid = Number(value);
      processRecord = {
        command: "",
        files: [],
        pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
      };
      processes.push(processRecord);
      fileRecord = null;
    } else if (field === "c" && processRecord) {
      processRecord.command = value;
    } else if (field === "f" && processRecord) {
      fileRecord = { descriptor: value, name: "" };
      processRecord.files.push(fileRecord);
    } else if (field === "n" && fileRecord) {
      fileRecord.name = value;
    }
  }
  const owners = processes.filter(
    (record) =>
      record.pid > 0 &&
      record.command === "cua-driver" &&
      record.files.some((file) => file.descriptor !== "" && file.name === socketPath),
  );
  const uniquePids = [...new Set(owners.map((owner) => owner.pid))];
  if (uniquePids.length !== 1) {
    throw new Error(
      `CuaDriver socket ownership requires exactly one CuaDriver listener PID for ${socketPath}`,
    );
  }
  return Object.freeze({
    command: "cua-driver",
    pid: uniquePids[0],
    socketPath,
  });
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

function hasValidPermissionSchema(value) {
  return (
    typeof value.accessibility === "boolean" &&
    typeof value.screen_recording === "boolean" &&
    isPlainObject(value.source) &&
    typeof value.source.attribution === "string" &&
    typeof value.source.bundle_id === "string" &&
    typeof value.source.executable === "string"
  );
}

function hasValidListAppsSchema(value) {
  return (
    Array.isArray(value.apps) &&
    value.apps.every(
      (app) =>
        isPlainObject(app) &&
        typeof app.bundle_id === "string" &&
        Number.isInteger(app.pid) &&
        app.pid >= 0 &&
        typeof app.running === "boolean" &&
        (app.launch_path === null ||
          app.launch_path === undefined ||
          typeof app.launch_path === "string"),
    )
  );
}

function hasValidLaunchAppSchema(value) {
  return (
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.bundle_id === "string" &&
    value.bundle_id !== ""
  );
}

function hasValidListWindowsSchema(value) {
  return (
    Array.isArray(value.windows) &&
    value.windows.every(
      (window) =>
        isPlainObject(window) &&
        Number.isInteger(window.pid) &&
        window.pid > 0 &&
        Number.isInteger(window.window_id) &&
        window.window_id > 0 &&
        Number.isInteger(window.layer) &&
        typeof window.is_on_screen === "boolean" &&
        [true, false, null].includes(window.on_current_space) &&
        Number.isFinite(window.z_index),
    )
  );
}

function hasValidWindowStateSchema(value) {
  return (
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    Number.isInteger(value.window_id) &&
    value.window_id > 0 &&
    typeof value.snapshot_id === "string" &&
    value.snapshot_id !== "" &&
    typeof value.tree_markdown === "string" &&
    Array.isArray(value.elements) &&
    value.elements.every(
      (element) =>
        isPlainObject(element) &&
        Number.isInteger(element.element_index) &&
        element.element_index >= 0 &&
        typeof element.role === "string",
    )
  );
}

function hasValidStructuredToolSchema(tool, value) {
  switch (tool) {
    case "check_permissions":
      return hasValidPermissionSchema(value);
    case "list_apps":
      return hasValidListAppsSchema(value);
    case "launch_app":
      return hasValidLaunchAppSchema(value);
    case "list_windows":
      return hasValidListWindowsSchema(value);
    case "get_window_state":
      return hasValidWindowStateSchema(value);
    default:
      return false;
  }
}

function requireStructured(parsed, tool) {
  if (!isPlainObject(parsed.structured)) {
    throw new Error(`CuaDriver ${tool} did not return structured JSON`);
  }
  if (parsed.isError) {
    throw new Error(parsed.text || `CuaDriver ${tool} returned isError:true`);
  }
  if (!hasValidStructuredToolSchema(tool, parsed.structured)) {
    throw new Error(`malformed CuaDriver ${tool} structured output`);
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
  constructor(options = {}) {
    if (!isPlainObject(options)) throw new TypeError("CuaDriver options must be an object");
    const allowedOptions = new Set([
      "appBundleId",
      "attachSocket",
      "binary",
      "cliPath",
      "daemonTeardownAttempts",
      "daemonTeardownPollMs",
      "dependencies",
      "driverAppPath",
      "maxImageBytes",
      "metadata",
      "processRunner",
      "runDir",
      "runId",
      "socketDirectory",
      "socketPath",
      "statusAttempts",
      "statusPollMs",
      "targetExitAttempts",
      "targetExitPollMs",
      "targetReadyAttempts",
      "targetReadyPollMs",
    ]);
    const unknownOptions = Object.keys(options).filter((key) => !allowedOptions.has(key));
    if (unknownOptions.length > 0) {
      throw new TypeError(`unknown CuaDriver option(s): ${unknownOptions.join(", ")}`);
    }
    if (options.binary !== undefined && options.cliPath !== undefined) {
      throw new TypeError("CuaDriver binary conflicts with cliPath");
    }
    const attachSocket = options.attachSocket ?? "";
    if (attachSocket !== "" && options.socketPath !== undefined) {
      throw new TypeError("CuaDriver attachSocket conflicts with owned socketPath");
    }
    const runDir = options.runDir ?? os.tmpdir();
    const socketDirectory = options.socketDirectory ?? os.tmpdir();
    this.runDir = requireNonEmptyString(runDir, "CuaDriver runDir");
    if (!path.isAbsolute(this.runDir) || path.normalize(this.runDir) !== this.runDir) {
      throw new Error("CuaDriver runDir must be an absolute normalized path");
    }
    this.socketDirectory = requireNonEmptyString(socketDirectory, "CuaDriver socket directory");
    if (
      !path.isAbsolute(this.socketDirectory) ||
      path.normalize(this.socketDirectory) !== this.socketDirectory
    ) {
      throw new Error("CuaDriver socket directory must be an absolute normalized path");
    }
    this.cliPath = requireNonEmptyString(
      options.binary ?? options.cliPath ?? "cua-driver",
      "CuaDriver CLI path",
    );
    const driverAppPath = options.driverAppPath ?? "/Applications/CuaDriver.app";
    this.driverAppPath = requireNonEmptyString(driverAppPath, "CuaDriver.app path");
    this.configuredAppBundleId =
      options.appBundleId === undefined
        ? ""
        : requireNonEmptyString(options.appBundleId, "CuaDriver appBundleId");
    this.processRunner = options.processRunner ?? createCuaProcessRunner();
    const runId = options.runId ?? randomUUID();
    this.runId = requireNonEmptyString(runId, "CuaDriver runId").replace(/[^a-zA-Z0-9._-]/g, "-");
    this.attachMode = attachSocket !== "";
    if (this.attachMode) {
      this.socketPath = requireNonEmptyString(attachSocket, "CuaDriver attach socket");
    } else if (options.socketPath !== undefined) {
      this.socketPath = requireNonEmptyString(options.socketPath, "CuaDriver owned socketPath");
    } else {
      this.socketPath = path.join(this.socketDirectory, `nixmac-cua-${this.runId}.sock`);
    }
    if (!path.isAbsolute(this.socketPath) || path.normalize(this.socketPath) !== this.socketPath) {
      throw new Error("CuaDriver socket path must be an absolute normalized path");
    }
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.metadata = options.metadata ?? pinnedCuaDriverMetadata;
    this.statusAttempts = options.statusAttempts ?? 20;
    this.statusPollMs = options.statusPollMs ?? 250;
    this.daemonTeardownAttempts = options.daemonTeardownAttempts ?? 20;
    this.daemonTeardownPollMs = options.daemonTeardownPollMs ?? 250;
    this.targetReadyAttempts = options.targetReadyAttempts ?? 20;
    this.targetReadyPollMs = options.targetReadyPollMs ?? 250;
    this.targetExitAttempts = options.targetExitAttempts ?? 20;
    this.targetExitPollMs = options.targetExitPollMs ?? 250;
    this.dependencies = {
      canonicalPath: defaultCanonicalPath,
      createScratchDirectory: async (prefix) => {
        const directory = await mkdtemp(prefix);
        await chmod(directory, 0o700);
        return directory;
      },
      lstat,
      openExclusiveFile: (filePath) => openFile(filePath, "wx+", 0o600),
      queryPidExecutable: (pid) => defaultQueryPidExecutable(pid, this.processRunner),
      readBundleIdentity: (appPath, options) =>
        defaultReadBundleIdentity(appPath, this.processRunner, options),
      readFile,
      removeDirectory: (directory) => rm(directory, { force: true, recursive: true }),
      removeFile: defaultRemoveFile,
      sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
      ...options.dependencies,
    };
    this.connected = false;
    this.startedDaemon = false;
    this.daemonPeer = null;
    this.canonicalDriverAppPath = "";
    this.ownedTarget = null;
    this.boundTarget = null;
    this.latestSnapshot = null;
    this.pendingScratchDirectories = new Set();
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

  _assertPinnedDriverIdentity(identity) {
    assertIdentity(
      identity,
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
  }

  async _resolveSocketListener({ allowMissing = false } = {}) {
    let canonicalSocketPath = this.daemonPeer?.socketPath ?? "";
    if (!canonicalSocketPath) {
      try {
        canonicalSocketPath = await this.dependencies.canonicalPath(this.socketPath);
      } catch (error) {
        if (allowMissing && error?.code === "ENOENT") return null;
        throw error;
      }
      if (canonicalSocketPath !== this.socketPath) {
        throw new Error(`CuaDriver socket path must be canonical: expected ${canonicalSocketPath}`);
      }
    }
    let lsofResult;
    try {
      lsofResult = await this.processRunner.run("/usr/sbin/lsof", [
        "-nP",
        "-Fpcn",
        "-a",
        "-U",
        canonicalSocketPath,
      ]);
    } catch (error) {
      if (allowMissing && error instanceof CuaProcessError && error.code === 1) return null;
      throw error;
    }
    if (allowMissing && lsofResult.stdout.trim() === "") return null;
    const socketOwner = parseCuaSocketOwner(lsofResult.stdout, canonicalSocketPath);
    const executable = await this.dependencies.canonicalPath(
      await this.dependencies.queryPidExecutable(socketOwner.pid),
    );
    return Object.freeze({
      executable,
      pid: socketOwner.pid,
      socketPath: canonicalSocketPath,
    });
  }

  async _assertVerifiedDaemonPeer(peer) {
    if (
      !this.canonicalDriverAppPath ||
      !pathIsWithin(peer.executable, path.join(this.canonicalDriverAppPath, "Contents", "MacOS"))
    ) {
      throw new Error("CuaDriver socket owner executable is outside the verified CuaDriver.app");
    }
    const identity = await this.dependencies.readBundleIdentity(this.canonicalDriverAppPath, {
      requireDeveloperSigningIdentity: true,
    });
    this._assertPinnedDriverIdentity(identity);
  }

  async _daemonProcessState(peer = this.daemonPeer) {
    try {
      const executable = await this.dependencies.canonicalPath(
        await this.dependencies.queryPidExecutable(peer.pid),
      );
      return Object.freeze({ exists: true, executable });
    } catch (error) {
      if (error?.code === "ESRCH") return Object.freeze({ exists: false, executable: "" });
      throw error;
    }
  }

  _clearDaemonOwnership() {
    this.startedDaemon = false;
    this.daemonPeer = null;
  }

  async _cleanupOwnedDaemon() {
    if (!this.startedDaemon) return;
    const boundPeer = this.daemonPeer;
    if (!boundPeer) {
      throw new Error("CuaDriver cannot stop an owned daemon without a bound OS-derived peer");
    }
    const currentListener = await this._resolveSocketListener({ allowMissing: true });
    if (!currentListener) {
      const processState = await this._daemonProcessState(boundPeer);
      if (!processState.exists || processState.executable !== boundPeer.executable) {
        this._clearDaemonOwnership();
        return;
      }
      throw new Error("CuaDriver bound daemon pid is still alive without its socket listener");
    }
    if (
      currentListener.pid !== boundPeer.pid ||
      currentListener.executable !== boundPeer.executable
    ) {
      throw new Error("CuaDriver socket listener changed before stop");
    }
    await this._assertVerifiedDaemonPeer(currentListener);
    await this._run(["stop", "--socket", boundPeer.socketPath]);

    let lastProofError;
    for (let attempt = 1; attempt <= this.daemonTeardownAttempts; attempt += 1) {
      let listener;
      let processState;
      try {
        listener = await this._resolveSocketListener({ allowMissing: true });
        processState = await this._daemonProcessState(boundPeer);
        lastProofError = null;
      } catch (error) {
        lastProofError = error;
      }
      if (!lastProofError) {
        const sameListener =
          listener?.pid === boundPeer.pid && listener?.executable === boundPeer.executable;
        const sameProcess = processState.exists && processState.executable === boundPeer.executable;
        if (!sameListener && !sameProcess) {
          this._clearDaemonOwnership();
          return;
        }
      }
      if (attempt < this.daemonTeardownAttempts) {
        await this.dependencies.sleep(this.daemonTeardownPollMs);
      }
    }
    throw new Error(
      `CuaDriver bound daemon did not terminate after ${this.daemonTeardownAttempts} checks${
        lastProofError ? `: ${actionErrorText(lastProofError)}` : ""
      }`,
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
    this.canonicalDriverAppPath = await this.dependencies.canonicalPath(this.driverAppPath);
    requireAbsoluteCanonicalInput(this.driverAppPath, this.canonicalDriverAppPath);
    const appIdentity = await this.dependencies.readBundleIdentity(this.canonicalDriverAppPath, {
      requireDeveloperSigningIdentity: true,
    });
    this._assertPinnedDriverIdentity(appIdentity);

    try {
      if (!this.attachMode) {
        try {
          await this.dependencies.lstat(this.socketPath);
          throw new Error(`CuaDriver owned socket path already exists: ${this.socketPath}`);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
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
      const socketListener = await this._resolveSocketListener();
      await this._assertVerifiedDaemonPeer(socketListener);
      this.daemonPeer = socketListener;
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
      let sourceExecutable;
      try {
        sourceExecutable = await this.dependencies.canonicalPath(
          requireNonEmptyString(
            permissions.source?.executable,
            "CuaDriver permissions source executable",
          ),
        );
      } catch (error) {
        throw new Error(
          `CuaDriver permissions source executable could not be canonicalized: ${actionErrorText(error)}`,
        );
      }
      if (sourceExecutable !== socketListener.executable) {
        throw new Error(
          "CuaDriver permissions source executable does not match the OS-derived socket owner",
        );
      }
      this.connected = true;
    } catch (error) {
      if (this.startedDaemon) {
        try {
          await this.close();
        } catch {}
      } else if (this.attachMode) {
        this.daemonPeer = null;
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

  async _assertOwnedTargetProcess(target = this.ownedTarget) {
    if (!target) throw new Error("CuaDriver has no owned target process");
    const executable = await this.dependencies.queryPidExecutable(target.pid);
    const canonicalExecutable = await this.dependencies.canonicalPath(executable);
    if (!pathIsWithin(canonicalExecutable, path.join(target.appPath, "Contents", "MacOS"))) {
      throw new Error(
        `refusing cleanup for pid ${target.pid}: executable is outside the owned target bundle`,
      );
    }
    const identity = await this.dependencies.readBundleIdentity(target.appPath);
    if (identity.bundleId !== target.appBundleId || identity.digestSha256 !== target.digestSha256) {
      throw new Error(`refusing cleanup for pid ${target.pid}: owned target identity changed`);
    }
    return Object.freeze({ executable: canonicalExecutable, identity });
  }

  _clearOwnedTarget(target) {
    if (this.boundTarget?.pid === target.pid) this.boundTarget = null;
    this.latestSnapshot = null;
    this.ownedTarget = null;
  }

  async _cleanupOwnedTarget() {
    const target = this.ownedTarget;
    if (!target) return;
    try {
      await this._assertOwnedTargetProcess(target);
    } catch (error) {
      if (error?.code === "ESRCH") {
        this._clearOwnedTarget(target);
        return;
      }
      throw error;
    }
    await this.processRunner.run("/bin/kill", ["-KILL", String(target.pid)]);
    let stillOwnedExecutable = "";
    for (let attempt = 1; attempt <= this.targetExitAttempts; attempt += 1) {
      try {
        stillOwnedExecutable = await this.dependencies.canonicalPath(
          await this.dependencies.queryPidExecutable(target.pid),
        );
      } catch (error) {
        if (error?.code === "ESRCH") {
          stillOwnedExecutable = "";
          break;
        }
        throw error;
      }
      if (!pathIsWithin(stillOwnedExecutable, path.join(target.appPath, "Contents", "MacOS"))) {
        stillOwnedExecutable = "";
        break;
      }
      if (attempt < this.targetExitAttempts) {
        await this.dependencies.sleep(this.targetExitPollMs);
      }
    }
    if (stillOwnedExecutable) {
      throw new Error(
        `owned target pid ${target.pid} did not exit after ${this.targetExitAttempts} checks`,
      );
    }
    this._clearOwnedTarget(target);
  }

  async prepareTarget({ appBundleId, appPath } = {}) {
    if (!this.connected) throw new Error("CuaDriver must connect before prepareTarget");
    const bundleId = requireNonEmptyString(
      appBundleId ?? this.configuredAppBundleId,
      "target appBundleId",
    );
    if (this.configuredAppBundleId && bundleId !== this.configuredAppBundleId) {
      throw new Error(`target appBundleId conflicts with configured ${this.configuredAppBundleId}`);
    }
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
    this.ownedTarget = Object.freeze({
      appBundleId: bundleId,
      appPath: canonicalAppPath,
      digestSha256: preflightIdentity.digestSha256,
      pid,
    });
    try {
      let selected;
      let readinessError;
      for (let attempt = 1; attempt <= this.targetReadyAttempts; attempt += 1) {
        try {
          const runningRecord = await this._registeredTargetRecords(bundleId, canonicalAppPath, {
            expectedRunningPid: pid,
          });
          if (runningRecord.running !== true || runningRecord.pid !== pid) {
            throw new Error(
              `CuaDriver list_apps did not resolve ${bundleId} to launched pid ${pid}`,
            );
          }
          await this._assertOwnedTargetProcess();
          const windows = await this._callStructured("list_windows", { pid });
          selected = selectCuaWindow(windows.windows, pid, {
            version: this.metadata.cli.version,
          });
          break;
        } catch (error) {
          readinessError = error;
          if (attempt < this.targetReadyAttempts) {
            await this.dependencies.sleep(this.targetReadyPollMs);
          }
        }
      }
      if (!selected) {
        throw new Error(
          `CuaDriver target did not become ready for pid ${pid}: ${actionErrorText(readinessError)}`,
        );
      }
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
    } catch (error) {
      try {
        await this._cleanupOwnedTarget();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `CuaDriver prepareTarget failed and owned target cleanup failed: ${actionErrorText(error)}; ${actionErrorText(cleanupError)}`,
        );
      }
      throw error;
    }
  }

  _requireBoundApp(app) {
    if (!this.boundTarget) throw new Error("CuaDriver target has not been prepared");
    if (app !== undefined && app !== this.boundTarget.appBundleId) {
      throw new Error(`CuaDriver action app mismatch: expected ${this.boundTarget.appBundleId}`);
    }
    return this.boundTarget;
  }

  async _createScreenshotArtifact() {
    const directory = await this.dependencies.createScratchDirectory(
      path.join(this.runDir, `nixmac-cua-${this.runId}-state-`),
    );
    this.pendingScratchDirectories.add(directory);
    const screenshotPath = path.join(directory, "screenshot.png");
    let handle;
    try {
      handle = await this.dependencies.openExclusiveFile(screenshotPath);
      const stats = await handle.stat();
      if (!stats.isFile() || (stats.mode & 0o777) !== 0o600 || stats.size !== 0) {
        throw new Error(
          "CuaDriver screenshot artifact was not created as an empty 0600 regular file",
        );
      }
      return { directory, handle, initialStats: stats, screenshotPath };
    } catch (setupError) {
      let cleanupError;
      try {
        await handle?.close();
      } catch (error) {
        cleanupError = error;
      }
      try {
        await this._cleanupScratchDirectory(directory);
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError) {
        throw new AggregateError(
          [setupError, cleanupError],
          `CuaDriver screenshot artifact setup and cleanup failed: ${actionErrorText(setupError)}; ${actionErrorText(cleanupError)}`,
        );
      }
      throw setupError;
    }
  }

  async _cleanupScratchDirectory(directory) {
    await this.dependencies.removeDirectory(directory);
    this.pendingScratchDirectories.delete(directory);
  }

  async visibleState({ app } = {}) {
    const target = this._requireBoundApp(app);
    const turnId = this.turnId + 1;
    let artifact;
    let screenshotBytes;
    let state;
    let operationError;
    try {
      artifact = await this._createScreenshotArtifact();
      state = await this._callStructured(
        "get_window_state",
        {
          pid: target.pid,
          window_id: target.windowId,
        },
        { screenshotOutFile: artifact.screenshotPath },
      );
      if (state.pid !== target.pid || state.window_id !== target.windowId) {
        throw new Error("CuaDriver window state target identity mismatch");
      }
      const pathStats = await this.dependencies.lstat(artifact.screenshotPath);
      const handleStats = await artifact.handle.stat();
      if (
        pathStats.isSymbolicLink() ||
        !pathStats.isFile() ||
        pathStats.dev !== artifact.initialStats.dev ||
        pathStats.ino !== artifact.initialStats.ino ||
        handleStats.dev !== artifact.initialStats.dev ||
        handleStats.ino !== artifact.initialStats.ino
      ) {
        throw new Error("CuaDriver screenshot artifact inode changed during capture");
      }
      if (
        (pathStats.mode & 0o777) !== 0o600 ||
        (handleStats.mode & 0o777) !== 0o600 ||
        handleStats.size <= 0
      ) {
        throw new Error("CuaDriver did not produce a fresh screenshot write");
      }
      screenshotBytes = await artifact.handle.readFile();
    } catch (error) {
      operationError = error;
    }
    let cleanupError;
    if (artifact) {
      try {
        await artifact.handle.close();
      } catch (error) {
        cleanupError = error;
      }
      try {
        await this._cleanupScratchDirectory(artifact.directory);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (operationError && cleanupError) {
      throw new AggregateError(
        [operationError, cleanupError],
        `CuaDriver screenshot capture and cleanup failed: ${actionErrorText(operationError)}; ${actionErrorText(cleanupError)}`,
      );
    }
    if (operationError) throw operationError;
    if (cleanupError) throw cleanupError;
    if (!Buffer.isBuffer(screenshotBytes)) {
      screenshotBytes = Buffer.from(screenshotBytes);
    }
    if (screenshotBytes.length === 0 || screenshotBytes.length > this.maxImageBytes) {
      throw new Error(
        `CuaDriver screenshot size ${screenshotBytes.length} is outside allowed bounds`,
      );
    }
    validatePngScreenshot(screenshotBytes);

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
      return normalizeCuaActionOutput(await this._call("click", input), {
        tool: "click",
        input,
        version: this.metadata.cli.version,
      });
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
      return normalizeCuaActionOutput(await this._call("set_value", input), {
        tool: "set_value",
        input,
        version: this.metadata.cli.version,
      });
    } catch (error) {
      return normalizeActionResult({
        ok: false,
        text: actionErrorText(error),
        isError: true,
      });
    }
  }

  async close() {
    const failures = [];
    for (const directory of this.pendingScratchDirectories) {
      try {
        await this._cleanupScratchDirectory(directory);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this._cleanupOwnedTarget();
    } catch (error) {
      failures.push(error);
    }
    if (this.startedDaemon) {
      try {
        await this._cleanupOwnedDaemon();
      } catch (error) {
        failures.push(error);
      }
    }
    this.connected = false;
    if (!this.startedDaemon && this.attachMode) this.daemonPeer = null;
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `CuaDriver cleanup failed: ${failures.map(actionErrorText).join("; ")}`,
      );
    }
  }
}
