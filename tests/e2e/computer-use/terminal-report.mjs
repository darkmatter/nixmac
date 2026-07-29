#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import { redact } from "./redaction.mjs";

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = "nixmac.e2e.terminal-result.v2";
const MAX_SCREENSHOTS = 6;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 40_000_000;
const MAX_SCREENSHOT_DECODED_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const MAX_PROVIDER_TRACE_BYTES = 1024 * 1024;
const MAX_SEMANTIC_AUDIT_BYTES = 256 * 1024;
const MAX_RUNTIME_ATTESTATION_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 42 * 1024 * 1024;
const MAX_VIDEO_DURATION_SECONDS = 120;
const REVIEW_SAMPLE_INTERVAL_SECONDS = 0.5;
const REVIEW_CONTACT_SHEET_FRAME_COUNT = 12;
const STATUSES = new Set(["pass", "fail", "inconclusive"]);
const INTENTS = new Set(["positive-flow", "expected-refusal"]);
const PROVIDER_KINDS = new Set(["scripted-mock", "real"]);
const ENDPOINT_CLASSES = new Set(["loopback", "remote"]);
const REQUIRED_PROVIDER_TRACE_EVENTS = ["request", "tool_request", "tool_response", "response"];
const TOOL_RESPONSE_STATUSES = new Set(["success", "error"]);
const MAX_FIRST_ACTION_SECONDS = 15;
const MIN_TERMINAL_VISIBLE_SECONDS = 3;
const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const REQUEST_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const TOOL_CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RUNTIME_ATTESTATION_SCHEMA = "nixmac.e2e.runtime-attestation.v1";
const SEMANTIC_AUDIT_SCHEMA = "nixmac.e2e.semantic-audit.v6";
const SEMANTIC_AUDIT_REVIEWER = "GitHub Actions protected vision review";
const SEMANTIC_AUDIT_REVIEWER_KIND = "github-actions-protected-vision-review";

function fail(message) {
  throw new Error(message);
}

function requireString(value, name, { pattern, max = 2_000 } = {}) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} must be a non-empty string`);
  if (value.length > max) fail(`${name} exceeds ${max} characters`);
  if (pattern && !pattern.test(value)) fail(`${name} has an invalid format`);
  return value;
}

function requireInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive integer`);
  return value;
}

function requireNonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative number`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function requireEnum(value, name, allowed) {
  if (!allowed.has(value)) fail(`${name} has an unsupported value`);
  return value;
}

function requireStatus(value, name) {
  if (!STATUSES.has(value)) fail(`${name} must be pass, fail, or inconclusive`);
  return value;
}

function validateProviderTrace(buffer, expectedCorrelation) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("provider.trace must be valid UTF-8 JSONL");
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => !line.trim())) {
    fail("provider.trace must contain non-empty JSONL records");
  }

  const records = lines.map((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      fail(`provider.trace line ${index + 1} must be valid JSON`);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(`provider.trace line ${index + 1} must be a JSON object`);
    }
    requireString(record.event, `provider.trace line ${index + 1} event`, { max: 100 });
    if (record.event === "tool_request" || record.event === "tool_response") {
      requireString(record.tool, `provider.trace line ${index + 1} tool`, { max: 200 });
      requireString(record.callId, `provider.trace line ${index + 1} callId`, {
        pattern: TOOL_CALL_ID_RE,
        max: 128,
      });
    }
    if (record.event === "tool_response") {
      requireEnum(
        record.status,
        `provider.trace line ${index + 1} status`,
        TOOL_RESPONSE_STATUSES,
      );
    }
    return record;
  });

  const eventIndexes = REQUIRED_PROVIDER_TRACE_EVENTS.map((event) =>
    records.findIndex((record) => record.event === event),
  );
  if (eventIndexes.some((index) => index === -1)) {
    fail(
      `provider.trace must include ${REQUIRED_PROVIDER_TRACE_EVENTS.join(", ")} event records`,
    );
  }
  if (eventIndexes.some((index, position) => position > 0 && index <= eventIndexes[position - 1])) {
    fail("provider.trace events must be ordered request, tool_request, tool_response, response");
  }
  if (
    records[0].event !== "request" ||
    records.at(-1).event !== "response" ||
    records.filter((record) => record.event === "request").length !== 1 ||
    records.filter((record) => record.event === "response").length !== 1
  ) {
    fail("provider.trace must start with one request and end with one response");
  }
  const pendingToolRequests = new Map();
  const seenToolCallIds = new Set();
  let matchedToolResponse = false;
  for (const [index, record] of records.entries()) {
    if (record.event === "tool_request") {
      if (seenToolCallIds.has(record.callId)) {
        fail(`provider.trace line ${index + 1} tool_request callId must be unique`);
      }
      seenToolCallIds.add(record.callId);
      pendingToolRequests.set(record.callId, record.tool);
    }
    if (record.event === "tool_response") {
      const requestedTool = pendingToolRequests.get(record.callId);
      if (!requestedTool) {
        fail(
          `provider.trace line ${index + 1} tool_response callId must match a preceding tool_request`,
        );
      }
      if (requestedTool !== record.tool) {
        fail(
          `provider.trace line ${index + 1} tool_response tool must match its callId request`,
        );
      }
      pendingToolRequests.delete(record.callId);
      matchedToolResponse = true;
    }
  }
  if (!matchedToolResponse) {
    fail("provider.trace must include a tool_response matching a tool_request");
  }
  if (pendingToolRequests.size !== 0) {
    fail("provider.trace must not contain unanswered tool_request records");
  }
  for (const [index, record] of records.entries()) {
    for (const [field, expected] of Object.entries(expectedCorrelation)) {
      requireString(record[field], `provider.trace line ${index + 1} ${field}`, { max: 300 });
      if (record[field] !== expected) {
        fail(`provider.trace line ${index + 1} ${field} must match the terminal result`);
      }
    }
  }
  return records;
}

function requireArray(value, name, { min = 0, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${name} must contain ${min}-${max} items`);
  }
  return value;
}

function parseIso(value, name) {
  requireString(value, name, { max: 64 });
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail(`${name} must be an ISO-8601 timestamp`);
  return time;
}

function escapeHtml(value) {
  return redact(String(value ?? ""))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function safeDataUri(value, mime) {
  const prefix = `data:${mime};base64,`;
  if (!value.startsWith(prefix) || !/^[A-Za-z0-9+/=]+$/.test(value.slice(prefix.length))) {
    fail(`invalid embedded ${mime} data URI`);
  }
  return value;
}

function dataUri(mime, buffer) {
  return safeDataUri(`data:${mime};base64,${buffer.toString("base64")}`, mime);
}

function displaySha(value) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

async function confinedFile(root, relativePath, name) {
  requireString(relativePath, name, { max: 1_000 });
  if (path.isAbsolute(relativePath)) fail(`${name} must be relative to evidence.root`);
  const rootReal = await realpath(root);
  const candidate = await realpath(path.resolve(rootReal, relativePath));
  const prefix = `${rootReal}${path.sep}`;
  if (candidate !== rootReal && !candidate.startsWith(prefix)) {
    fail(`${name} escapes evidence.root`);
  }
  const fileStat = await stat(candidate);
  if (!fileStat.isFile()) fail(`${name} is not a regular file`);
  return { absolutePath: candidate, size: fileStat.size };
}

function validatePng(buffer, name) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) {
    fail(`${name} is not a complete PNG`);
  }

  let offset = signature.length;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let chunkCount = 0;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  let sawPlte = false;
  const idatChunks = [];

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) fail(`${name} has a truncated PNG chunk`);
    const length = buffer.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) fail(`${name} has a truncated PNG chunk`);

    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) fail(`${name} has an invalid PNG chunk type`);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) fail(`${name} has an invalid PNG chunk checksum`);

    if (chunkCount === 0 && type !== "IHDR") fail(`${name} must begin with a PNG IHDR chunk`);
    if (type === "IHDR") {
      if (chunkCount !== 0 || length !== 13 || width !== undefined) {
        fail(`${name} has an invalid PNG IHDR chunk`);
      }
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      const validDepths = {
        0: new Set([1, 2, 4, 8, 16]),
        2: new Set([8, 16]),
        3: new Set([1, 2, 4, 8]),
        4: new Set([8, 16]),
        6: new Set([8, 16]),
      };
      if (
        !width ||
        !height ||
        width > MAX_SCREENSHOT_DIMENSION ||
        height > MAX_SCREENSHOT_DIMENSION ||
        width * height > MAX_SCREENSHOT_PIXELS
      ) {
        fail(`${name} dimensions are outside the supported range`);
      }
      if (
        !validDepths[colorType]?.has(bitDepth) ||
        buffer[dataStart + 10] !== 0 ||
        buffer[dataStart + 11] !== 0 ||
        buffer[dataStart + 12] !== 0
      ) {
        fail(`${name} has unsupported PNG image parameters`);
      }
    } else if (type === "PLTE") {
      if (sawPlte || sawIdat || length === 0 || length > 768 || length % 3 !== 0) {
        fail(`${name} has an invalid PNG palette`);
      }
      sawPlte = true;
    } else if (type === "IDAT") {
      if (endedIdat || sawIend) fail(`${name} has PNG image data out of order`);
      sawIdat = true;
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0 || !sawIdat || sawIend || chunkEnd !== buffer.length) {
        fail(`${name} has an invalid PNG IEND chunk`);
      }
      sawIend = true;
    } else {
      if (sawIdat) endedIdat = true;
      if ((typeBuffer[0] & 0x20) === 0) fail(`${name} has an unknown critical PNG chunk`);
    }

    chunkCount += 1;
    offset = chunkEnd;
  }
  if (!sawIend || width === undefined || height === undefined) {
    fail(`${name} is not a complete PNG`);
  }
  if (colorType === 3 && !sawPlte) fail(`${name} indexed PNG is missing its palette`);
  if ([0, 4].includes(colorType) && sawPlte) {
    fail(`${name} grayscale PNG must not contain a palette`);
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const decodedBytes = height * (rowBytes + 1);
  if (decodedBytes > MAX_SCREENSHOT_DECODED_BYTES) {
    fail(`${name} decoded image exceeds ${formatBytes(MAX_SCREENSHOT_DECODED_BYTES)}`);
  }
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idatChunks), {
      maxOutputLength: decodedBytes + 1,
    });
  } catch {
    fail(`${name} could not be fully decoded`);
  }
  if (decoded.length !== decodedBytes) fail(`${name} has an invalid decoded PNG size`);
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)] > 4) fail(`${name} has an invalid PNG row filter`);
  }
  return { width, height };
}

function validateMp4Header(buffer, name) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    fail(`${name} is not an MP4 with an ftyp header`);
  }
}

function videoProbeFromFfprobe(parsed) {
  const streams = parsed.streams ?? [];
  if (streams.length !== 1 || streams[0]?.codec_type !== "video") {
    fail("evidence.video must contain exactly one video stream and no audio or extra streams");
  }
  const stream = streams[0];
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt,
    durationSeconds: Number(parsed.format?.duration),
    streamCount: streams.length,
    audioStreamCount: streams.filter((item) => item.codec_type === "audio").length,
  };
}

async function probeVideo(filePath) {
  const candidates = [
    process.env.FFPROBE_BIN,
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "ffprobe",
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, [
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height,pix_fmt:format=duration",
        "-of",
        "json",
        filePath,
      ]);
      const parsed = JSON.parse(stdout);
      return videoProbeFromFfprobe(parsed);
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `ffprobe is required to validate the evidence video: ${lastError?.message || "not found"}`,
  );
}

async function decodeVideo(filePath) {
  const candidates = [
    process.env.FFMPEG_BIN,
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "ffmpeg",
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, [
        "-v",
        "error",
        "-xerror",
        "-err_detect",
        "explode",
        "-i",
        filePath,
        "-f",
        "null",
        "-",
      ]);
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") {
        fail(`evidence.video failed full decode: ${error?.stderr || error?.message}`);
      }
    }
  }
  fail(`ffmpeg is required to decode the evidence video: ${lastError?.message || "not found"}`);
}

function dominantStatus(statuses) {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("inconclusive")) return "inconclusive";
  return "pass";
}

function validateOutcome(result) {
  for (const scenario of result.scenarios) {
    const componentStatuses = [
      ...scenario.preconditions.map((precondition) => precondition.status),
      scenario.terminalState.status,
      ...scenario.assertions.map((assertion) => assertion.status),
    ];
    const expectedStatus = dominantStatus(componentStatuses);
    if (scenario.status !== expectedStatus) {
      fail(`scenario "${scenario.id}" status must be ${expectedStatus} to match its evidence`);
    }
  }

  const scenarioStatuses = result.scenarios.map((scenario) => scenario.status);
  const componentStatuses = result.scenarios.flatMap((scenario) => [
    ...scenario.preconditions.map((precondition) => precondition.status),
    scenario.terminalState.status,
    ...scenario.assertions.map((assertion) => assertion.status),
  ]);
  const expectedVerdict = dominantStatus([
    ...scenarioStatuses,
    ...componentStatuses,
    result.cleanup.status,
  ]);
  if (result.verdict !== expectedVerdict) {
    fail(`${expectedVerdict} evidence requires verdict to be ${expectedVerdict}`);
  }
}

export async function loadTerminalResult(
  inputPath,
  { probe = true, verifiedAppVersion } = {},
) {
  const inputReal = await realpath(inputPath);
  const result = JSON.parse(await readFile(inputReal, "utf8"));
  if (result.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion must be ${SCHEMA_VERSION}`);
  }

  requireString(result.request?.id, "request.id", { pattern: REQUEST_ID_RE, max: 80 });
  if (result.request?.repository !== "darkmatter/nixmac") {
    fail("request.repository must be darkmatter/nixmac");
  }
  requireInteger(result.request?.pullRequest?.number, "request.pullRequest.number");
  requireString(result.request?.pullRequest?.title, "request.pullRequest.title", { max: 300 });
  requireString(result.request?.pullRequest?.url, "request.pullRequest.url", {
    pattern: /^https:\/\/github\.com\/darkmatter\/nixmac\/pull\/\d+$/,
    max: 200,
  });
  const expectedPullRequestUrl = `https://github.com/darkmatter/nixmac/pull/${result.request.pullRequest.number}`;
  if (result.request.pullRequest.url !== expectedPullRequestUrl) {
    fail("request.pullRequest.url must match request.pullRequest.number");
  }
  requireStatus(result.verdict, "verdict");
  requireString(result.summary, "summary", { max: 1_000 });
  requireString(result.testedArtifact?.headSha, "testedArtifact.headSha", { pattern: GIT_SHA_RE });
  requireInteger(result.testedArtifact?.actionsRunId, "testedArtifact.actionsRunId");
  requireInteger(result.testedArtifact?.artifactId, "testedArtifact.artifactId");
  requireString(result.testedArtifact?.artifactName, "testedArtifact.artifactName", { max: 200 });
  requireString(result.testedArtifact?.appVersion, "testedArtifact.appVersion", { max: 100 });
  if (verifiedAppVersion !== undefined) {
    requireString(verifiedAppVersion, "verifiedAppVersion", { max: 100 });
    if (result.testedArtifact.appVersion !== verifiedAppVersion) {
      fail(
        `testedArtifact.appVersion must match the downloaded app bundle (${verifiedAppVersion})`,
      );
    }
  }
  requireString(result.testedArtifact?.archiveSha256, "testedArtifact.archiveSha256", {
    pattern: SHA256_RE,
  });
  requireString(result.testedArtifact?.appSha256, "testedArtifact.appSha256", {
    pattern: SHA256_RE,
  });
  requireString(result.testedArtifact?.appBundleSha256, "testedArtifact.appBundleSha256", {
    pattern: SHA256_RE,
  });
  requireString(
    result.testedArtifact?.runtimeAttestation?.path,
    "testedArtifact.runtimeAttestation.path",
    { max: 1_000 },
  );
  requireString(
    result.testedArtifact?.runtimeAttestation?.sha256,
    "testedArtifact.runtimeAttestation.sha256",
    { pattern: SHA256_RE },
  );
  if (result.reportTool?.repository !== "darkmatter/nixmac") {
    fail("reportTool.repository must be darkmatter/nixmac");
  }
  requireString(result.reportTool?.sha, "reportTool.sha", { pattern: GIT_SHA_RE });
  requireEnum(result.provider?.kind, "provider.kind", PROVIDER_KINDS);
  requireEnum(result.provider?.endpointClass, "provider.endpointClass", ENDPOINT_CLASSES);
  requireString(result.provider?.label, "provider.label", { max: 200 });
  requireString(result.provider?.model, "provider.model", { max: 200 });
  requireString(result.provider?.trace?.path, "provider.trace.path", { max: 1_000 });
  requireString(result.provider?.trace?.sha256, "provider.trace.sha256", {
    pattern: SHA256_RE,
  });
  requireString(result.runner?.label, "runner.label", { max: 200 });
  if (result.runner?.host !== undefined) {
    requireString(result.runner.host, "runner.host", { max: 200 });
  }
  requireString(result.runner?.macosVersion, "runner.macosVersion", { max: 100 });
  requireString(result.runner?.cuaDriverVersion, "runner.cuaDriverVersion", { max: 100 });
  requireArray(result.runner?.sockets, "runner.sockets", { min: 1, max: 8 }).forEach(
    (socket, index) => requireString(socket, `runner.sockets[${index}]`, { max: 300 }),
  );

  const ids = new Set();
  requireArray(result.scenarios, "scenarios", { min: 1, max: 3 }).forEach((scenario, index) => {
    const prefix = `scenarios[${index}]`;
    requireString(scenario.id, `${prefix}.id`, { pattern: SAFE_ID_RE, max: 80 });
    if (ids.has(scenario.id)) fail(`${prefix}.id must be unique`);
    ids.add(scenario.id);
    requireString(scenario.title, `${prefix}.title`, { max: 200 });
    requireEnum(scenario.intent, `${prefix}.intent`, INTENTS);
    requireBoolean(scenario.coversChangedBehavior, `${prefix}.coversChangedBehavior`);
    requireString(scenario.changedBehavior, `${prefix}.changedBehavior`, { max: 1_000 });
    requireString(scenario.declaredPostcondition, `${prefix}.declaredPostcondition`, {
      max: 1_000,
    });
    requireArray(scenario.preconditions, `${prefix}.preconditions`, { min: 1, max: 12 }).forEach(
      (precondition, preconditionIndex) => {
        requireString(
          precondition.description,
          `${prefix}.preconditions[${preconditionIndex}].description`,
          { max: 1_000 },
        );
        requireStatus(precondition.status, `${prefix}.preconditions[${preconditionIndex}].status`);
        requireString(
          precondition.evidence,
          `${prefix}.preconditions[${preconditionIndex}].evidence`,
          { max: 2_000 },
        );
      },
    );
    requireString(scenario.terminalState?.description, `${prefix}.terminalState.description`, {
      max: 1_000,
    });
    requireStatus(scenario.terminalState?.status, `${prefix}.terminalState.status`);
    requireString(scenario.terminalState?.evidence, `${prefix}.terminalState.evidence`, {
      max: 2_000,
    });
    requireStatus(scenario.status, `${prefix}.status`);
    requireArray(scenario.assertions, `${prefix}.assertions`, { min: 1, max: 12 }).forEach(
      (assertion, assertionIndex) => {
        requireString(
          assertion.description,
          `${prefix}.assertions[${assertionIndex}].description`,
          {
            max: 1_000,
          },
        );
        requireStatus(assertion.status, `${prefix}.assertions[${assertionIndex}].status`);
        requireString(assertion.evidence, `${prefix}.assertions[${assertionIndex}].evidence`, {
          max: 2_000,
        });
      },
    );
  });
  if (!result.scenarios.some((scenario) => scenario.coversChangedBehavior)) {
    fail("at least one scenario must cover changed behavior");
  }

  requireStatus(result.presentation?.status, "presentation.status");
  requireNonNegativeNumber(
    result.presentation?.firstMeaningfulActionSeconds,
    "presentation.firstMeaningfulActionSeconds",
  );
  requireBoolean(result.presentation?.watchedStartToFinish, "presentation.watchedStartToFinish");
  requireBoolean(result.presentation?.terminalStateVisible, "presentation.terminalStateVisible");
  requireNonNegativeNumber(
    result.presentation?.terminalStateVisibleSeconds,
    "presentation.terminalStateVisibleSeconds",
  );
  requireString(result.presentation?.note, "presentation.note", { max: 1_000 });
  requireString(result.presentation?.semanticAudit?.path, "presentation.semanticAudit.path", {
    max: 1_000,
  });
  requireString(result.presentation?.semanticAudit?.sha256, "presentation.semanticAudit.sha256", {
    pattern: SHA256_RE,
  });
  requireString(
    result.presentation?.semanticAudit?.reviewer,
    "presentation.semanticAudit.reviewer",
    { max: 200 },
  );
  if (result.presentation.semanticAudit.reviewer !== SEMANTIC_AUDIT_REVIEWER) {
    fail(`presentation.semanticAudit.reviewer must be ${SEMANTIC_AUDIT_REVIEWER}`);
  }
  if (result.presentation.semanticAudit.reviewerKind !== SEMANTIC_AUDIT_REVIEWER_KIND) {
    fail(
      `presentation.semanticAudit.reviewerKind must be ${SEMANTIC_AUDIT_REVIEWER_KIND}`,
    );
  }
  requireString(
    result.presentation.semanticAudit.reviewScope,
    "presentation.semanticAudit.reviewScope",
    { max: 500 },
  );
  requireString(
    result.presentation.semanticAudit.reviewToolSha,
    "presentation.semanticAudit.reviewToolSha",
    { pattern: GIT_SHA_RE },
  );
  requireInteger(
    result.presentation.semanticAudit.reviewRunId,
    "presentation.semanticAudit.reviewRunId",
  );
  requireInteger(
    result.presentation.semanticAudit.reviewRunAttempt,
    "presentation.semanticAudit.reviewRunAttempt",
  );
  requireString(
    result.presentation.semanticAudit.reviewModel,
    "presentation.semanticAudit.reviewModel",
    { max: 200 },
  );
  requireInteger(
    result.presentation.semanticAudit.reviewedFrameCount,
    "presentation.semanticAudit.reviewedFrameCount",
  );
  if (
    result.presentation.semanticAudit.reviewedFrameCount < 5 ||
    result.presentation.semanticAudit.reviewedFrameCount > 240
  ) {
    fail("presentation.semanticAudit.reviewedFrameCount must be between 5 and 240");
  }
  requireInteger(
    result.presentation.semanticAudit.reviewedContactSheetCount,
    "presentation.semanticAudit.reviewedContactSheetCount",
  );
  if (result.presentation.semanticAudit.reviewedContactSheetCount > 20) {
    fail("presentation.semanticAudit.reviewedContactSheetCount must be at most 20");
  }
  requireInteger(
    result.presentation.semanticAudit.reviewedScreenshotCount,
    "presentation.semanticAudit.reviewedScreenshotCount",
  );
  if (result.presentation.semanticAudit.reviewedScreenshotCount > MAX_SCREENSHOTS) {
    fail(
      `presentation.semanticAudit.reviewedScreenshotCount must be at most ${MAX_SCREENSHOTS}`,
    );
  }
  requireNonNegativeNumber(
    result.presentation.semanticAudit.reviewSampleIntervalSeconds,
    "presentation.semanticAudit.reviewSampleIntervalSeconds",
  );
  if (
    result.presentation.semanticAudit.reviewSampleIntervalSeconds !==
    REVIEW_SAMPLE_INTERVAL_SECONDS
  ) {
    fail(
      `presentation.semanticAudit.reviewSampleIntervalSeconds must be ${REVIEW_SAMPLE_INTERVAL_SECONDS}`,
    );
  }
  requireString(
    result.presentation.semanticAudit.sourceVideoSha256,
    "presentation.semanticAudit.sourceVideoSha256",
    { pattern: SHA256_RE },
  );
  requireBoolean(
    result.presentation.semanticAudit.sensitiveContentVisible,
    "presentation.semanticAudit.sensitiveContentVisible",
  );
  if (result.presentation.semanticAudit.sensitiveContentVisible) {
    fail("presentation.semanticAudit must reject sensitive content before publication");
  }
  if (result.presentation.status === "pass") {
    if (result.presentation.firstMeaningfulActionSeconds > MAX_FIRST_ACTION_SECONDS) {
      fail(`presentation.firstMeaningfulActionSeconds must be <= ${MAX_FIRST_ACTION_SECONDS}`);
    }
    if (!result.presentation.watchedStartToFinish) {
      fail("presentation.watchedStartToFinish must be true when presentation.status is pass");
    }
    if (!result.presentation.terminalStateVisible) {
      fail("presentation.terminalStateVisible must be true when presentation.status is pass");
    }
    if (result.presentation.terminalStateVisibleSeconds < MIN_TERMINAL_VISIBLE_SECONDS) {
      fail(`presentation.terminalStateVisibleSeconds must be >= ${MIN_TERMINAL_VISIBLE_SECONDS}`);
    }
  }

  requireString(result.evidence?.root, "evidence.root", { max: 1_000 });
  const root = await realpath(result.evidence.root);
  const runtimeAttestationFile = await confinedFile(
    root,
    result.testedArtifact.runtimeAttestation.path,
    "testedArtifact.runtimeAttestation.path",
  );
  if (runtimeAttestationFile.size > MAX_RUNTIME_ATTESTATION_BYTES) {
    fail(
      `testedArtifact.runtimeAttestation exceeds ${formatBytes(MAX_RUNTIME_ATTESTATION_BYTES)}`,
    );
  }
  const runtimeAttestationBuffer = await readFile(runtimeAttestationFile.absolutePath);
  if (sha256(runtimeAttestationBuffer) !== result.testedArtifact.runtimeAttestation.sha256) {
    fail("testedArtifact.runtimeAttestation SHA-256 does not match");
  }
  let runtimeAttestation;
  try {
    runtimeAttestation = JSON.parse(runtimeAttestationBuffer.toString("utf8"));
  } catch {
    fail("testedArtifact.runtimeAttestation must be valid JSON");
  }
  if (runtimeAttestation.schemaVersion !== RUNTIME_ATTESTATION_SCHEMA) {
    fail(`testedArtifact.runtimeAttestation schemaVersion must be ${RUNTIME_ATTESTATION_SCHEMA}`);
  }
  requireInteger(runtimeAttestation.processId, "runtimeAttestation.processId");
  if (runtimeAttestation.bundleIdentifier !== "com.darkmatter.nixmac") {
    fail("runtimeAttestation.bundleIdentifier must be com.darkmatter.nixmac");
  }
  requireString(runtimeAttestation.appVersion, "runtimeAttestation.appVersion", { max: 100 });
  requireString(runtimeAttestation.bundlePath, "runtimeAttestation.bundlePath", { max: 1_000 });
  requireString(runtimeAttestation.processExecutable, "runtimeAttestation.processExecutable", {
    max: 1_000,
  });
  requireString(runtimeAttestation.executableSha256, "runtimeAttestation.executableSha256", {
    pattern: SHA256_RE,
  });
  requireString(runtimeAttestation.bundleSha256, "runtimeAttestation.bundleSha256", {
    pattern: SHA256_RE,
  });
  if (runtimeAttestation.codesignVerified !== true) {
    fail("runtimeAttestation.codesignVerified must be true");
  }
  requireInteger(
    runtimeAttestation.loadedExecutableDevice,
    "runtimeAttestation.loadedExecutableDevice",
  );
  requireInteger(
    runtimeAttestation.loadedExecutableInode,
    "runtimeAttestation.loadedExecutableInode",
  );
  requireString(runtimeAttestation.captureToolSha, "runtimeAttestation.captureToolSha", {
    pattern: GIT_SHA_RE,
  });
  if (runtimeAttestation.executableSha256 !== result.testedArtifact.appSha256) {
    fail("runtimeAttestation executable SHA-256 must match the downloaded app");
  }
  if (runtimeAttestation.bundleSha256 !== result.testedArtifact.appBundleSha256) {
    fail("runtimeAttestation bundle SHA-256 must match the downloaded app bundle");
  }
  if (runtimeAttestation.appVersion !== result.testedArtifact.appVersion) {
    fail("runtimeAttestation app version must match testedArtifact.appVersion");
  }
  if (runtimeAttestation.captureToolSha !== result.reportTool.sha) {
    fail("runtimeAttestation capture tool SHA must match reportTool.sha");
  }
  const runtimeAttestationCapturedAt = parseIso(
    runtimeAttestation.capturedAt,
    "runtimeAttestation.capturedAt",
  );
  const providerTraceFile = await confinedFile(
    root,
    result.provider.trace.path,
    "provider.trace.path",
  );
  if (providerTraceFile.size > MAX_PROVIDER_TRACE_BYTES) {
    fail(`provider.trace exceeds ${formatBytes(MAX_PROVIDER_TRACE_BYTES)}`);
  }
  const providerTraceBuffer = await readFile(providerTraceFile.absolutePath);
  if (sha256(providerTraceBuffer) !== result.provider.trace.sha256) {
    fail("provider.trace SHA-256 does not match");
  }
  const providerTraceRecords = validateProviderTrace(providerTraceBuffer, {
    requestId: result.request.id,
    headSha: result.testedArtifact.headSha,
    providerKind: result.provider.kind,
    endpointClass: result.provider.endpointClass,
    providerLabel: result.provider.label,
    model: result.provider.model,
  });
  if (
    result.verdict === "pass" &&
    providerTraceRecords.some(
      (record) => record.event === "tool_response" && record.status !== "success",
    )
  ) {
    fail("pass verdict requires every provider tool_response status to be success");
  }
  const screenshots = [];
  const screenshotPaths = new Set();
  let screenshotBytes = 0;
  for (const [index, screenshot] of requireArray(
    result.evidence?.screenshots,
    "evidence.screenshots",
    { min: 2, max: MAX_SCREENSHOTS },
  ).entries()) {
    const name = `evidence.screenshots[${index}]`;
    requireString(screenshot.label, `${name}.label`, { max: 200 });
    requireString(screenshot.note, `${name}.note`, { max: 1_000 });
    requireString(screenshot.sha256, `${name}.sha256`, { pattern: SHA256_RE });
    const file = await confinedFile(root, screenshot.path, `${name}.path`);
    if (screenshotPaths.has(file.absolutePath)) {
      fail("evidence.screenshots must use distinct file paths");
    }
    screenshotPaths.add(file.absolutePath);
    if (file.size > MAX_SCREENSHOT_BYTES)
      fail(`${name} exceeds ${formatBytes(MAX_SCREENSHOT_BYTES)}`);
    screenshotBytes += file.size;
    const buffer = await readFile(file.absolutePath);
    if (sha256(buffer) !== screenshot.sha256) fail(`${name} SHA-256 does not match`);
    const dimensions = validatePng(buffer, name);
    screenshots.push({
      ...screenshot,
      ...dimensions,
      size: file.size,
      dataUri: dataUri("image/png", buffer),
    });
  }
  if (screenshotBytes > MAX_SCREENSHOT_TOTAL_BYTES) {
    fail(`screenshot total exceeds ${formatBytes(MAX_SCREENSHOT_TOTAL_BYTES)}`);
  }

  const video = result.evidence?.video;
  requireString(video?.label, "evidence.video.label", { max: 200 });
  requireString(video?.note, "evidence.video.note", { max: 1_000 });
  requireString(video?.sha256, "evidence.video.sha256", { pattern: SHA256_RE });
  const videoFile = await confinedFile(root, video.path, "evidence.video.path");
  if (videoFile.size > MAX_VIDEO_BYTES)
    fail(`evidence.video exceeds ${formatBytes(MAX_VIDEO_BYTES)}`);
  const videoBuffer = await readFile(videoFile.absolutePath);
  if (sha256(videoBuffer) !== video.sha256) fail("evidence.video SHA-256 does not match");
  validateMp4Header(videoBuffer, "evidence.video");
  const videoProbe = probe
    ? await probeVideo(videoFile.absolutePath)
    : {
        codec: video.codec,
        width: video.width,
        height: video.height,
        pixelFormat: video.pixelFormat,
        durationSeconds: video.durationSeconds,
        streamCount: video.streamCount,
        audioStreamCount: video.audioStreamCount,
      };
  if (videoProbe.streamCount !== 1 || videoProbe.audioStreamCount !== 0) {
    fail("evidence.video must contain exactly one video stream and no audio or extra streams");
  }
  if (videoProbe.codec !== "h264" || videoProbe.pixelFormat !== "yuv420p") {
    fail("evidence.video must be H.264 with yuv420p pixel format");
  }
  if (
    !Number.isFinite(videoProbe.durationSeconds) ||
    videoProbe.durationSeconds <= 0 ||
    videoProbe.durationSeconds > MAX_VIDEO_DURATION_SECONDS
  ) {
    fail(
      `evidence.video duration must be between 0 and ${MAX_VIDEO_DURATION_SECONDS} seconds`,
    );
  }
  if (result.presentation.firstMeaningfulActionSeconds > videoProbe.durationSeconds) {
    fail("presentation.firstMeaningfulActionSeconds must not exceed evidence.video duration");
  }
  if (result.presentation.terminalStateVisibleSeconds > videoProbe.durationSeconds) {
    fail("presentation.terminalStateVisibleSeconds must not exceed evidence.video duration");
  }
  if (
    result.presentation.firstMeaningfulActionSeconds +
      result.presentation.terminalStateVisibleSeconds >
    videoProbe.durationSeconds
  ) {
    fail("presentation action and terminal-state intervals must fit within evidence.video duration");
  }
  const expectedReviewedFrameCount = Math.max(
    1,
    Math.ceil(videoProbe.durationSeconds / REVIEW_SAMPLE_INTERVAL_SECONDS),
  );
  if (result.presentation.semanticAudit.reviewedFrameCount !== expectedReviewedFrameCount) {
    fail("presentation.semanticAudit reviewedFrameCount must cover the full video at 2 Hz");
  }
  if (
    result.presentation.semanticAudit.reviewedContactSheetCount !==
    Math.ceil(expectedReviewedFrameCount / REVIEW_CONTACT_SHEET_FRAME_COUNT)
  ) {
    fail(
      "presentation.semanticAudit reviewedContactSheetCount must cover every reviewed frame",
    );
  }
  if (
    result.presentation.semanticAudit.reviewedScreenshotCount !==
    result.evidence.screenshots.length
  ) {
    fail("presentation.semanticAudit reviewedScreenshotCount must cover every screenshot");
  }
  if (
    !Number.isSafeInteger(videoProbe.width) ||
    !Number.isSafeInteger(videoProbe.height) ||
    videoProbe.width < 320 ||
    videoProbe.height < 240 ||
    videoProbe.width > 4096 ||
    videoProbe.height > 4096
  ) {
    fail("evidence.video dimensions are outside the supported range");
  }
  if (probe) await decodeVideo(videoFile.absolutePath);

  const semanticAuditFile = await confinedFile(
    root,
    result.presentation.semanticAudit.path,
    "presentation.semanticAudit.path",
  );
  if (semanticAuditFile.size > MAX_SEMANTIC_AUDIT_BYTES) {
    fail(`presentation.semanticAudit exceeds ${formatBytes(MAX_SEMANTIC_AUDIT_BYTES)}`);
  }
  const semanticAuditBuffer = await readFile(semanticAuditFile.absolutePath);
  if (sha256(semanticAuditBuffer) !== result.presentation.semanticAudit.sha256) {
    fail("presentation.semanticAudit SHA-256 does not match");
  }
  let semanticAudit;
  try {
    semanticAudit = JSON.parse(semanticAuditBuffer.toString("utf8"));
  } catch {
    fail("presentation.semanticAudit must be valid JSON");
  }
  if (semanticAudit.schemaVersion !== SEMANTIC_AUDIT_SCHEMA) {
    fail(`presentation.semanticAudit schemaVersion must be ${SEMANTIC_AUDIT_SCHEMA}`);
  }
  if (
    semanticAudit.reviewer !== SEMANTIC_AUDIT_REVIEWER ||
    semanticAudit.reviewerKind !== SEMANTIC_AUDIT_REVIEWER_KIND
  ) {
    fail("presentation.semanticAudit must be produced by the protected publisher");
  }
  if (semanticAudit.videoSha256 !== video.sha256) {
    fail("presentation.semanticAudit videoSha256 must match evidence.video.sha256");
  }
  const reviewedScreenshots = requireArray(
    semanticAudit.reviewedScreenshots,
    "presentation.semanticAudit reviewedScreenshots",
    { min: 2, max: MAX_SCREENSHOTS },
  );
  if (reviewedScreenshots.length !== screenshots.length) {
    fail("presentation.semanticAudit must review every published screenshot");
  }
  for (const [index, reviewedScreenshot] of reviewedScreenshots.entries()) {
    requireString(
      reviewedScreenshot.sourceSha256,
      `presentation.semanticAudit reviewedScreenshots[${index}].sourceSha256`,
      { pattern: SHA256_RE },
    );
    requireString(
      reviewedScreenshot.sha256,
      `presentation.semanticAudit reviewedScreenshots[${index}].sha256`,
      { pattern: SHA256_RE },
    );
    requireString(
      reviewedScreenshot.path,
      `presentation.semanticAudit reviewedScreenshots[${index}].path`,
      { max: 1_000 },
    );
    if (
      reviewedScreenshot.path !== result.evidence.screenshots[index].path ||
      reviewedScreenshot.sha256 !== result.evidence.screenshots[index].sha256
    ) {
      fail("presentation.semanticAudit must bind every published screenshot");
    }
  }
  if (semanticAudit.reviewer !== result.presentation.semanticAudit.reviewer) {
    fail("presentation.semanticAudit reviewer must match its artifact");
  }
  for (const field of [
    "reviewerKind",
    "reviewScope",
    "reviewToolSha",
    "reviewRunId",
    "reviewRunAttempt",
    "reviewModel",
    "reviewedFrameCount",
    "reviewedContactSheetCount",
    "reviewedScreenshotCount",
    "reviewSampleIntervalSeconds",
    "sourceVideoSha256",
    "sensitiveContentVisible",
  ]) {
    if (semanticAudit[field] !== result.presentation.semanticAudit[field]) {
      fail(`presentation.semanticAudit ${field} must match its artifact`);
    }
  }
  if (semanticAudit.reviewToolSha !== result.reportTool.sha) {
    fail("presentation.semanticAudit reviewToolSha must match reportTool.sha");
  }
  requireString(semanticAudit.rationale, "presentation.semanticAudit rationale", {
    max: 2_000,
  });
  if (semanticAudit.status !== result.presentation.status) {
    fail("presentation.semanticAudit status must match presentation.status");
  }
  if (
    semanticAudit.firstMeaningfulActionSeconds !== result.presentation.firstMeaningfulActionSeconds
  ) {
    fail("presentation.semanticAudit firstMeaningfulActionSeconds must match presentation");
  }
  if (semanticAudit.watchedStartToFinish !== result.presentation.watchedStartToFinish) {
    fail("presentation.semanticAudit watchedStartToFinish must match presentation");
  }
  if (semanticAudit.terminalStateVisible !== result.presentation.terminalStateVisible) {
    fail("presentation.semanticAudit terminalStateVisible must match presentation");
  }
  if (
    semanticAudit.terminalStateVisibleSeconds !== result.presentation.terminalStateVisibleSeconds
  ) {
    fail("presentation.semanticAudit terminalStateVisibleSeconds must match presentation");
  }

  requireStatus(result.cleanup?.status, "cleanup.status");
  requireString(result.cleanup?.note, "cleanup.note", { max: 1_000 });
  validateOutcome(result);
  requireArray(result.knownLimits, "knownLimits", { min: 0, max: 12 }).forEach((limit, index) =>
    requireString(limit, `knownLimits[${index}]`, { max: 1_000 }),
  );
  const startedAt = parseIso(result.timestamps?.startedAt, "timestamps.startedAt");
  const completedAt = parseIso(result.timestamps?.completedAt, "timestamps.completedAt");
  if (completedAt < startedAt) fail("timestamps.completedAt must not precede timestamps.startedAt");
  if (
    runtimeAttestationCapturedAt < startedAt ||
    runtimeAttestationCapturedAt > completedAt
  ) {
    fail("runtimeAttestation.capturedAt must fall within the declared run timestamps");
  }

  return {
    ...result,
    testedArtifact: {
      ...result.testedArtifact,
      runtimeAttestation: {
        ...result.testedArtifact.runtimeAttestation,
        capturedAt: runtimeAttestation.capturedAt,
        processId: runtimeAttestation.processId,
        bundleIdentifier: runtimeAttestation.bundleIdentifier,
        appVersion: runtimeAttestation.appVersion,
        executableSha256: runtimeAttestation.executableSha256,
        bundleSha256: runtimeAttestation.bundleSha256,
        codesignVerified: runtimeAttestation.codesignVerified,
        loadedExecutableDevice: runtimeAttestation.loadedExecutableDevice,
        loadedExecutableInode: runtimeAttestation.loadedExecutableInode,
        captureToolSha: runtimeAttestation.captureToolSha,
        size: runtimeAttestationFile.size,
      },
    },
    provider: {
      ...result.provider,
      trace: {
        ...result.provider.trace,
        size: providerTraceFile.size,
      },
    },
    presentation: {
      ...result.presentation,
      semanticAudit: {
        ...result.presentation.semanticAudit,
        size: semanticAuditFile.size,
      },
    },
    evidence: {
      root,
      screenshots,
      video: {
        ...video,
        ...videoProbe,
        size: videoFile.size,
        dataUri: dataUri("video/mp4", videoBuffer),
      },
    },
  };
}

function verdictLabel(verdict) {
  return { pass: "PASS", fail: "FAIL", inconclusive: "INCONCLUSIVE" }[verdict];
}

export function deriveResultLabel(result) {
  if (result.verdict === "fail") return "FAIL";
  if (result.verdict === "inconclusive") return "INCONCLUSIVE";
  const changedScenarios = result.scenarios.filter((scenario) => scenario.coversChangedBehavior);
  if (changedScenarios.some((scenario) => scenario.intent === "positive-flow")) {
    return "POSITIVE FLOW PASS";
  }
  return "EXPECTED REFUSAL VERIFIED";
}

function normalizedTerminalResult(result) {
  return {
    ...result,
    resultLabel: deriveResultLabel(result),
    evidence: {
      root: result.evidence.root,
      screenshots: result.evidence.screenshots.map(({ dataUri: _dataUri, ...item }) => item),
      video: (({ dataUri: _dataUri, ...item }) => item)(result.evidence.video),
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function terminalResultIdentity(result) {
  const normalized = normalizedTerminalResult(result);
  const { root: _stagingRoot, ...evidence } = normalized.evidence;
  return sha256(Buffer.from(canonicalJson({ ...normalized, evidence })));
}

function renderScenario(scenario) {
  const preconditions = scenario.preconditions
    .map(
      (precondition) => `<li class="assertion">
        <span class="badge ${escapeHtml(precondition.status)}">${escapeHtml(verdictLabel(precondition.status))}</span>
        <div><strong>${escapeHtml(precondition.description)}</strong><small>${escapeHtml(precondition.evidence)}</small></div>
      </li>`,
    )
    .join("");
  const assertions = scenario.assertions
    .map(
      (assertion) => `<li class="assertion">
        <span class="badge ${escapeHtml(assertion.status)}">${escapeHtml(verdictLabel(assertion.status))}</span>
        <div><strong>${escapeHtml(assertion.description)}</strong><small>${escapeHtml(assertion.evidence)}</small></div>
      </li>`,
    )
    .join("");
  return `<article class="scenario">
    <header><div><small>${escapeHtml(scenario.intent)} · ${scenario.coversChangedBehavior ? "changed behavior" : "supporting coverage"}</small><h3>${escapeHtml(scenario.title)}</h3></div><span class="badge ${escapeHtml(scenario.status)}">${escapeHtml(verdictLabel(scenario.status))}</span></header>
    <dl><div><dt>Changed behavior</dt><dd>${escapeHtml(scenario.changedBehavior)}</dd></div><div><dt>Declared postcondition</dt><dd>${escapeHtml(scenario.declaredPostcondition)}</dd></div><div><dt>Terminal state</dt><dd><strong>${escapeHtml(scenario.terminalState.description)}</strong><br>${escapeHtml(scenario.terminalState.evidence)}</dd></div></dl>
    <h4>Preconditions</h4><ul class="assertions">${preconditions}</ul>
    <h4>Assertions</h4>
    <ul class="assertions">${assertions}</ul>
  </article>`;
}

export function renderTerminalReportHtml(result) {
  const pr = result.request.pullRequest;
  const artifact = result.testedArtifact;
  const video = result.evidence.video;
  const resultLabel = deriveResultLabel(result);
  const presentationFailed = result.presentation.status !== "pass";
  const changedScenarioCount = result.scenarios.filter(
    (scenario) => scenario.coversChangedBehavior,
  ).length;
  const screenshots = result.evidence.screenshots
    .map(
      (shot) => `<figure>
        <img src="${safeDataUri(shot.dataUri, "image/png")}" alt="${escapeHtml(shot.label)}">
        <figcaption><strong>${escapeHtml(shot.label)}</strong><span>${escapeHtml(shot.note)}</span><code>${escapeHtml(displaySha(shot.sha256))} · ${shot.width}×${shot.height} · ${escapeHtml(formatBytes(shot.size))}</code></figcaption>
      </figure>`,
    )
    .join("");
  const knownLimits = result.knownLimits.length
    ? `<ul>${result.knownLimits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>No known limits were recorded for the declared scenarios.</p>";
  const generatedAt = new Date().toISOString();
  const evidenceSetHash = terminalResultIdentity(result);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="nixmac-e2e-schema" content="${SCHEMA_VERSION}">
  <meta name="nixmac-e2e-evidence-set-sha256" content="${evidenceSetHash}">
  <title>nixmac E2E · PR #${pr.number} · ${escapeHtml(resultLabel)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --bg:#0c0f14; --panel:#131821; --line:#293241; --muted:#9ba8b8; --text:#eef3f9; --blue:#84c5ff; }
    * { box-sizing:border-box; } html { background:var(--bg); scroll-behavior:smooth; } body { margin:0; color:var(--text); background:radial-gradient(circle at 70% -20%, #193250 0, transparent 38rem), var(--bg); }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:40px 0 72px; } a { color:var(--blue); } h1 { margin:8px 0 14px; font-size:clamp(30px, 5vw, 54px); line-height:1.02; letter-spacing:-.04em; } h2 { margin:42px 0 14px; font-size:22px; } h3 { margin:3px 0 0; font-size:19px; }
    p, dd, li { line-height:1.55; color:#c8d1dc; } code { color:#b9dcff; overflow-wrap:anywhere; } small { display:block; color:var(--muted); } .eyebrow { color:var(--blue); text-transform:uppercase; letter-spacing:.12em; font-weight:800; font-size:12px; }
    .hero { padding:28px; border:1px solid #35506c; border-radius:20px; background:linear-gradient(145deg, rgba(27,38,53,.97), rgba(14,18,25,.97)); box-shadow:0 24px 80px rgba(0,0,0,.3); } .hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; } .summary-copy { max-width:800px; font-size:17px; }
    .badge { display:inline-flex; align-items:center; justify-content:center; min-width:76px; padding:7px 11px; border-radius:999px; font-size:12px; font-weight:900; letter-spacing:.05em; white-space:nowrap; } .pass { color:#9af0bd; background:#123c2a; border:1px solid #266b4a; } .fail { color:#ffb1ae; background:#481d1e; border:1px solid #7a3434; } .inconclusive { color:#ffda84; background:#463612; border:1px solid #766023; }
    .warning { margin-top:18px; padding:16px; border:1px solid #8c5b20; border-radius:12px; background:#3a280f; color:#ffe0a0; } h4 { margin:20px 0 4px; }
    .metrics { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-top:22px; } .metric, .panel, .scenario { border:1px solid var(--line); border-radius:14px; background:rgba(19,24,33,.94); } .metric { padding:14px; } .metric strong { display:block; margin-top:5px; font-size:18px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; } .panel { padding:18px; min-width:0; } .panel h2 { margin-top:0; } dl { margin:0; } dl > div { padding:10px 0; border-top:1px solid var(--line); } dl > div:first-child { border-top:0; padding-top:0; } dt { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; } dd { margin:4px 0 0; }
    .scenario { padding:20px; margin-top:12px; } .scenario header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; } .assertions { list-style:none; padding:0; margin:18px 0 0; } .assertion { display:grid; grid-template-columns:auto 1fr; align-items:start; gap:12px; padding:12px 0; border-top:1px solid var(--line); } .assertion small { margin-top:4px; line-height:1.45; }
    .video { padding:14px; border:1px solid var(--line); border-radius:16px; background:#05070a; } video { display:block; width:100%; max-height:720px; border-radius:10px; background:#000; } .video figcaption { padding:12px 4px 2px; display:grid; grid-template-columns:1fr auto; gap:8px; }
    .shots { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; } figure { margin:0; } .shots figure { padding:10px; border:1px solid var(--line); border-radius:14px; background:var(--panel); } img { display:block; width:100%; border-radius:9px; background:#000; } figcaption span, figcaption code { display:block; margin-top:5px; font-size:12px; color:var(--muted); }
    .integrity { overflow-x:auto; } table { width:100%; border-collapse:collapse; min-width:680px; } th,td { text-align:left; border-top:1px solid var(--line); padding:11px 8px; vertical-align:top; } th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; } footer { margin-top:42px; color:var(--muted); font-size:12px; }
    @media (max-width:820px) { main { width:min(100% - 20px, 1180px); padding-top:18px; } .hero { padding:20px; } .hero-top { display:block; } .hero-top > .badge { margin-top:8px; } .metrics, .grid, .shots { grid-template-columns:1fr; } .video figcaption { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <div class="hero-top"><div><span class="eyebrow">nixmac · Computer Use E2E</span><h1>PR #${pr.number}: ${escapeHtml(pr.title)}</h1></div><span class="badge ${result.verdict}">${escapeHtml(resultLabel)}</span></div>
    <p class="summary-copy">${escapeHtml(result.summary)}</p>
    ${resultLabel === "EXPECTED REFUSAL VERIFIED" ? '<p class="warning"><strong>Positive flow not exercised.</strong> This result verifies the declared refusal/guardrail only.</p>' : ""}
    ${presentationFailed ? `<p class="warning"><strong>PRESENTATION QUALITY FAILED.</strong> ${escapeHtml(result.presentation.note)}</p>` : ""}
    <div class="metrics">
      <div class="metric"><small>Changed-behavior coverage</small><strong>${changedScenarioCount} scenario${changedScenarioCount === 1 ? "" : "s"}</strong></div>
      <div class="metric"><small>Exact app</small><strong>${escapeHtml(artifact.appVersion)}</strong></div>
      <div class="metric"><small>Screenshots</small><strong>${result.evidence.screenshots.length} curated</strong></div>
      <div class="metric"><small>Video</small><strong>${escapeHtml(formatDuration(video.durationSeconds))}</strong></div>
    </div>
  </section>

  <h2>Qualification identity</h2>
  <div class="grid">
    <section class="panel"><dl>
      <div><dt>Pull request</dt><dd><a href="${escapeHtml(pr.url)}">#${pr.number}</a></dd></div>
      <div><dt>Tested head SHA</dt><dd><code>${artifact.headSha}</code></dd></div>
      <div><dt>GitHub Actions source</dt><dd><a href="https://github.com/darkmatter/nixmac/actions/runs/${artifact.actionsRunId}">run ${artifact.actionsRunId}</a> · artifact ${artifact.artifactId} (${escapeHtml(artifact.artifactName)})</dd></div>
      <div><dt>Application</dt><dd>${escapeHtml(artifact.appVersion)}</dd></div>
      <div><dt>Live process attestation</dt><dd>PID ${artifact.runtimeAttestation.processId} · captured ${escapeHtml(artifact.runtimeAttestation.capturedAt)}</dd></div>
    </dl></section>
    <section class="panel"><dl>
      <div><dt>Runner</dt><dd>${escapeHtml(result.runner.label)} · macOS ${escapeHtml(result.runner.macosVersion)}</dd></div>
      <div><dt>CuaDriver</dt><dd>${escapeHtml(result.runner.cuaDriverVersion)} · ${result.runner.sockets.map((item) => `<code>${escapeHtml(item)}</code>`).join(" · ")}</dd></div>
      <div><dt>Report tool pin</dt><dd><code>${escapeHtml(result.reportTool.repository)}@${result.reportTool.sha}</code></dd></div>
      <div><dt>Request</dt><dd><code>${escapeHtml(result.request.id)}</code></dd></div>
      <div><dt>Provider</dt><dd><strong>${escapeHtml(result.provider.label)}</strong><br><code>${escapeHtml(result.provider.kind)} · ${escapeHtml(result.provider.endpointClass)} · ${escapeHtml(result.provider.model)}</code></dd></div>
      <div><dt>Presentation audit</dt><dd><span class="badge ${escapeHtml(result.presentation.status)}">${escapeHtml(verdictLabel(result.presentation.status))}</span> · first action ${escapeHtml(String(result.presentation.firstMeaningfulActionSeconds))}s · terminal visible ${escapeHtml(String(result.presentation.terminalStateVisibleSeconds))}s<br>${escapeHtml(result.presentation.note)}</dd></div>
    </dl></section>
  </div>

  <h2>PR-focused scenarios</h2>
  ${result.scenarios.map(renderScenario).join("")}

  <h2>Continuous evidence video</h2>
  <figure class="video">
    <video controls preload="metadata" playsinline src="${safeDataUri(video.dataUri, "video/mp4")}"></video>
    <figcaption><div><strong>${escapeHtml(video.label)}</strong><span>${escapeHtml(video.note)}</span></div><code>${escapeHtml(video.codec)} · ${video.width}×${video.height} · ${escapeHtml(video.pixelFormat)} · ${escapeHtml(formatBytes(video.size))}</code></figcaption>
  </figure>

  <h2>Curated screenshots</h2>
  <div class="shots">${screenshots}</div>

  <h2>Evidence integrity</h2>
  <section class="panel integrity">
    <table><thead><tr><th>Artifact</th><th>SHA-256</th><th>Size</th></tr></thead><tbody>
      <tr><td>Downloaded build archive</td><td><code>${artifact.archiveSha256}</code></td><td>source identity</td></tr>
      <tr><td>nixmac main executable</td><td><code>${artifact.appSha256}</code></td><td>source identity</td></tr>
      <tr><td>Complete staged nixmac.app</td><td><code>${artifact.appBundleSha256}</code></td><td>canonical bundle identity</td></tr>
      <tr><td>Live exercised process attestation</td><td><code>${artifact.runtimeAttestation.sha256}</code></td><td>${escapeHtml(formatBytes(artifact.runtimeAttestation.size))}</td></tr>
      ${result.evidence.screenshots.map((shot) => `<tr><td>${escapeHtml(shot.label)}</td><td><code>${shot.sha256}</code></td><td>${escapeHtml(formatBytes(shot.size))}</td></tr>`).join("")}
      <tr><td>${escapeHtml(video.label)}</td><td><code>${video.sha256}</code></td><td>${escapeHtml(formatBytes(video.size))}</td></tr>
      <tr><td>Provider trace</td><td><code>${result.provider.trace.sha256}</code></td><td>${escapeHtml(formatBytes(result.provider.trace.size))}</td></tr>
      <tr><td>Semantic video audit</td><td><code>${result.presentation.semanticAudit.sha256}</code></td><td>${escapeHtml(formatBytes(result.presentation.semanticAudit.size))}</td></tr>
      <tr><td>Evidence set</td><td><code>${evidenceSetHash}</code></td><td>manifest identity</td></tr>
    </tbody></table>
  </section>

  <div class="grid">
    <section class="panel"><h2>Known limits</h2>${knownLimits}</section>
    <section class="panel"><h2>Cleanup</h2><p><span class="badge ${result.cleanup.status}">${verdictLabel(result.cleanup.status)}</span></p><p>${escapeHtml(result.cleanup.note)}</p></section>
  </div>
  <footer>Generated ${escapeHtml(generatedAt)} from ${SCHEMA_VERSION}. Product verdict is derived only from declared scenarios and assertions; report publication is a separate delivery concern.</footer>
</main>
</body>
</html>`;
}

async function renderCommand(
  input,
  outputDir,
  { probe = true, verifiedAppVersion } = {},
) {
  const result = await loadTerminalResult(input, { probe, verifiedAppVersion });
  const html = renderTerminalReportHtml(result);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    fail(`rendered report exceeds ${formatBytes(MAX_HTML_BYTES)}`);
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), html);
  const normalized = normalizedTerminalResult(result);
  await writeFile(
    path.join(outputDir, "terminal-result.normalized.json"),
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return { html, normalized };
}

async function selfTest() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nixmac-terminal-report-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom"),
    Buffer.alloc(12),
  ]);
  await writeFile(path.join(dir, "proof.png"), png);
  await writeFile(path.join(dir, "proof-after.png"), png);
  await writeFile(path.join(dir, "proof.mp4"), mp4);
  const providerCorrelation = {
    requestId: `nixmac-e2e:${"a".repeat(40)}`,
    headSha: "a".repeat(40),
    providerKind: "scripted-mock",
    endpointClass: "loopback",
    providerLabel: "Deterministic OpenAI-compatible loopback mock",
    model: "nixmac-e2e-scripted",
  };
  const providerTrace = Buffer.from(
    [
      { event: "request", ...providerCorrelation },
      {
        event: "tool_request",
        tool: "ensure_secret",
        callId: "call-1",
        ...providerCorrelation,
      },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
        ...providerCorrelation,
      },
      { event: "response", ...providerCorrelation },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace.jsonl"), providerTrace);
  const semanticAuditIdentity = {
    schemaVersion: SEMANTIC_AUDIT_SCHEMA,
    reviewer: SEMANTIC_AUDIT_REVIEWER,
    reviewerKind: SEMANTIC_AUDIT_REVIEWER_KIND,
    reviewScope:
      "Independent protected sensitivity and semantic inspection of the exact 2 Hz public video and sanitized curated screenshots",
    reviewToolSha: "d".repeat(40),
    reviewRunId: 123,
    reviewRunAttempt: 1,
    reviewModel: "openai/gpt-4.1",
    reviewedFrameCount: 10,
    reviewedContactSheetCount: 1,
    reviewedScreenshotCount: 2,
    reviewSampleIntervalSeconds: 0.5,
    sourceVideoSha256: sha256(mp4),
    sensitiveContentVisible: false,
  };
  const reviewedScreenshots = [
    { path: "proof.png", sourceSha256: sha256(png), sha256: sha256(png) },
    { path: "proof-after.png", sourceSha256: sha256(png), sha256: sha256(png) },
  ];
  const semanticAudit = Buffer.from(
    `${JSON.stringify({
      ...semanticAuditIdentity,
      reviewedScreenshots,
      videoSha256: sha256(mp4),
      status: "pass",
      firstMeaningfulActionSeconds: 1,
      watchedStartToFinish: true,
      terminalStateVisible: true,
      terminalStateVisibleSeconds: 3,
      rationale: "The changed behavior and stable terminal state are visible.",
    })}\n`,
  );
  await writeFile(path.join(dir, "semantic-video-audit.json"), semanticAudit);
  const runtimeAttestation = Buffer.from(
    `${JSON.stringify({
      schemaVersion: RUNTIME_ATTESTATION_SCHEMA,
      capturedAt: "2026-01-01T00:00:00Z",
      processId: 42,
      bundleIdentifier: "com.darkmatter.nixmac",
      appVersion: "0.0.0-test",
      bundlePath: "/private/tmp/nixmac.app",
      processExecutable: "/private/tmp/nixmac.app/Contents/MacOS/nixmac",
      executableSha256: "c".repeat(64),
      bundleSha256: "8".repeat(64),
      codesignVerified: true,
      loadedExecutableDevice: 16777220,
      loadedExecutableInode: 12345,
      captureToolSha: "d".repeat(40),
    })}\n`,
  );
  await writeFile(path.join(dir, "runtime-attestation.json"), runtimeAttestation);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    provider: {
      kind: "scripted-mock",
      endpointClass: "loopback",
      label: "Deterministic OpenAI-compatible loopback mock",
      model: "nixmac-e2e-scripted",
      trace: {
        path: "provider-trace.jsonl",
        sha256: sha256(providerTrace),
      },
    },
    request: {
      id: `nixmac-e2e:${"a".repeat(40)}`,
      repository: "darkmatter/nixmac",
      pullRequest: {
        number: 607,
        title: "Self test",
        url: "https://github.com/darkmatter/nixmac/pull/607",
      },
    },
    verdict: "pass",
    summary: "The declared scenario passed.",
    testedArtifact: {
      headSha: "a".repeat(40),
      actionsRunId: 1,
      artifactId: 2,
      artifactName: "nixmac",
      appVersion: "0.0.0-test",
      archiveSha256: "b".repeat(64),
      appSha256: "c".repeat(64),
      appBundleSha256: "8".repeat(64),
      runtimeAttestation: {
        path: "runtime-attestation.json",
        sha256: sha256(runtimeAttestation),
      },
    },
    reportTool: { repository: "darkmatter/nixmac", sha: "d".repeat(40) },
    runner: {
      label: "test Mac runner",
      macosVersion: "15.0",
      cuaDriverVersion: "test",
      sockets: ["/tmp/cua.sock"],
    },
    scenarios: [
      {
        id: "self-test",
        title: "Self test",
        intent: "positive-flow",
        coversChangedBehavior: true,
        changedBehavior: "Exercise the adapter.",
        declaredPostcondition: "The report renders.",
        preconditions: [
          {
            description: "Disposable fixture is clean",
            status: "pass",
            evidence: "Fixture state recorded.",
          },
        ],
        terminalState: {
          description: "Review is visible with the expected pending diff",
          status: "pass",
          evidence: "AX, screenshot, and Git diff agree.",
        },
        status: "pass",
        assertions: [{ description: "Rendered", status: "pass", evidence: "Self-test output." }],
      },
    ],
    evidence: {
      root: dir,
      screenshots: [
        {
          path: "proof.png",
          label: "Before",
          note: "Self-test before PNG.",
          sha256: sha256(png),
        },
        {
          path: "proof-after.png",
          label: "After",
          note: "Self-test after PNG.",
          sha256: sha256(png),
        },
      ],
      video: {
        path: "proof.mp4",
        label: "Evidence video",
        note: "Self-test MP4 header.",
        sha256: sha256(mp4),
        codec: "h264",
        width: 800,
        height: 800,
        pixelFormat: "yuv420p",
        durationSeconds: 5,
        streamCount: 1,
        audioStreamCount: 0,
      },
    },
    presentation: {
      status: "pass",
      firstMeaningfulActionSeconds: 1,
      watchedStartToFinish: true,
      terminalStateVisible: true,
      terminalStateVisibleSeconds: 3,
      note: "Semantic video audit passed.",
      semanticAudit: {
        path: "semantic-video-audit.json",
        sha256: sha256(semanticAudit),
        ...semanticAuditIdentity,
      },
    },
    knownLimits: [],
    cleanup: { status: "pass", note: "Self-test cleanup." },
    timestamps: {
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:01Z",
    },
  };
  const contractFixture = JSON.parse(
    await readFile(new URL("./fixtures/terminal-result-v2.contract.json", import.meta.url), "utf8"),
  );
  contractFixture.evidence = structuredClone(manifest.evidence);
  contractFixture.provider.trace = structuredClone(manifest.provider.trace);
  contractFixture.presentation = structuredClone(manifest.presentation);
  contractFixture.timestamps = structuredClone(manifest.timestamps);
  contractFixture.testedArtifact.appVersion = manifest.testedArtifact.appVersion;
  contractFixture.testedArtifact.runtimeAttestation = structuredClone(
    manifest.testedArtifact.runtimeAttestation,
  );
  const contractPath = path.join(dir, "terminal-result-v2.contract.json");
  await writeFile(contractPath, `${JSON.stringify(contractFixture, null, 2)}\n`);
  const contractResult = await loadTerminalResult(contractPath, { probe: false });
  const contractHtml = renderTerminalReportHtml(contractResult);
  if (!contractHtml.includes("POSITIVE FLOW PASS")) {
    fail("canonical v2 fixture did not render POSITIVE FLOW PASS");
  }

  const manifestPath = path.join(dir, "terminal-result.v2.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let versionRejected = false;
  try {
    await loadTerminalResult(manifestPath, {
      probe: false,
      verifiedAppVersion: "9.9.9-mismatched",
    });
  } catch (error) {
    versionRejected = error.message.includes("must match the downloaded app bundle");
  }
  if (!versionRejected) {
    fail("self-test expected a mismatched downloaded app version to be rejected");
  }
  const outputDir = path.join(dir, "report");
  const { html } = await renderCommand(manifestPath, outputDir, {
    probe: false,
    verifiedAppVersion: manifest.testedArtifact.appVersion,
  });
  for (const needle of [
    SCHEMA_VERSION,
    "data:image/png;base64,",
    "data:video/mp4;base64,",
    "Product verdict is derived only",
  ]) {
    if (!html.includes(needle)) fail(`self-test output is missing ${needle}`);
  }
  const changedClaim = structuredClone(manifest);
  changedClaim.scenarios[0].assertions[0].evidence = "A materially different claim.";
  if (terminalResultIdentity(manifest) === terminalResultIdentity(changedClaim)) {
    fail("self-test expected every normalized manifest claim to affect report identity");
  }
  const relocatedEvidence = structuredClone(manifest);
  relocatedEvidence.evidence.root = "/another/staging/root";
  if (terminalResultIdentity(manifest) !== terminalResultIdentity(relocatedEvidence)) {
    fail("self-test expected the report identity to ignore its staging root");
  }
  const invalid = structuredClone(manifest);
  invalid.verdict = "pass";
  invalid.scenarios[0].status = "inconclusive";
  invalid.scenarios[0].assertions[0].status = "inconclusive";
  await writeFile(manifestPath, `${JSON.stringify(invalid, null, 2)}\n`);
  let rejected = false;
  try {
    await loadTerminalResult(manifestPath, { probe: false });
  } catch (error) {
    rejected = error.message.includes("inconclusive evidence requires verdict to be inconclusive");
  }
  if (!rejected) fail("self-test expected inconsistent verdict to be rejected");

  const missingIntent = structuredClone(manifest);
  delete missingIntent.scenarios[0].intent;
  await writeFile(manifestPath, `${JSON.stringify(missingIntent, null, 2)}\n`);
  rejected = false;
  try {
    await loadTerminalResult(manifestPath, { probe: false });
  } catch (error) {
    rejected = error.message.includes("scenarios[0].intent");
  }
  if (!rejected) fail("self-test expected missing scenario intent to be rejected");

  const downgraded = structuredClone(manifest);
  downgraded.verdict = "inconclusive";
  downgraded.scenarios[0].status = "fail";
  downgraded.scenarios[0].assertions[0].status = "fail";
  await writeFile(manifestPath, `${JSON.stringify(downgraded, null, 2)}\n`);
  rejected = false;
  try {
    await loadTerminalResult(manifestPath, { probe: false });
  } catch (error) {
    rejected = error.message.includes("fail evidence requires verdict to be fail");
  }
  if (!rejected) fail("self-test expected a failed result downgrade to be rejected");

  for (const testCase of [
    {
      name: "pass scenario with failed assertion",
      scenarioStatus: "pass",
      assertionStatus: "fail",
      verdict: "fail",
      expectedStatus: "fail",
    },
    {
      name: "pass scenario with inconclusive assertion",
      scenarioStatus: "pass",
      assertionStatus: "inconclusive",
      verdict: "inconclusive",
      expectedStatus: "inconclusive",
    },
    {
      name: "failed scenario with passing assertions",
      scenarioStatus: "fail",
      assertionStatus: "pass",
      verdict: "fail",
      expectedStatus: "pass",
    },
    {
      name: "inconclusive scenario with passing assertions",
      scenarioStatus: "inconclusive",
      assertionStatus: "pass",
      verdict: "inconclusive",
      expectedStatus: "pass",
    },
  ]) {
    const contradictory = structuredClone(manifest);
    contradictory.verdict = testCase.verdict;
    contradictory.scenarios[0].status = testCase.scenarioStatus;
    contradictory.scenarios[0].assertions[0].status = testCase.assertionStatus;
    await writeFile(manifestPath, `${JSON.stringify(contradictory, null, 2)}\n`);
    rejected = false;
    try {
      await loadTerminalResult(manifestPath, { probe: false });
    } catch (error) {
      rejected = error.message.includes(
        `status must be ${testCase.expectedStatus} to match its evidence`,
      );
    }
    if (!rejected) fail(`self-test expected ${testCase.name} to be rejected`);
  }

  const expectRejected = async (name, mutation, expectedMessage) => {
    const candidate = structuredClone(manifest);
    mutation(candidate);
    await writeFile(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
    let didReject = false;
    try {
      await loadTerminalResult(manifestPath, { probe: false });
    } catch (error) {
      didReject = error.message.includes(expectedMessage);
    }
    if (!didReject) fail(`self-test expected ${name} to be rejected`);
  };

  await expectRejected(
    "mismatched pull request URL",
    (candidate) => {
      candidate.request.pullRequest.url = "https://github.com/darkmatter/nixmac/pull/608";
    },
    "request.pullRequest.url must match request.pullRequest.number",
  );
  await expectRejected(
    "runtime app hash mismatch",
    (candidate) => {
      candidate.testedArtifact.appSha256 = "a".repeat(64);
    },
    "runtimeAttestation executable SHA-256 must match the downloaded app",
  );
  await expectRejected(
    "runtime bundle hash mismatch",
    (candidate) => {
      candidate.testedArtifact.appBundleSha256 = "7".repeat(64);
    },
    "runtimeAttestation bundle SHA-256 must match the downloaded app bundle",
  );
  const truncatedPng = png.subarray(0, 24);
  await writeFile(path.join(dir, "proof-truncated.png"), truncatedPng);
  await expectRejected(
    "truncated screenshot",
    (candidate) => {
      candidate.evidence.screenshots[0].path = "proof-truncated.png";
      candidate.evidence.screenshots[0].sha256 = sha256(truncatedPng);
    },
    "is not a complete PNG",
  );
  await expectRejected(
    "duplicate screenshot path",
    (candidate) => {
      candidate.evidence.screenshots[1].path = candidate.evidence.screenshots[0].path;
      candidate.evidence.screenshots[1].sha256 = candidate.evidence.screenshots[0].sha256;
    },
    "evidence.screenshots must use distinct file paths",
  );
  const corruptPng = Buffer.from(png);
  corruptPng[50] ^= 0xff;
  await writeFile(path.join(dir, "proof-corrupt.png"), corruptPng);
  await expectRejected(
    "screenshot with invalid chunk checksum",
    (candidate) => {
      candidate.evidence.screenshots[0].path = "proof-corrupt.png";
      candidate.evidence.screenshots[0].sha256 = sha256(corruptPng);
    },
    "invalid PNG chunk checksum",
  );
  await expectRejected(
    "missing coversChangedBehavior",
    (candidate) => delete candidate.scenarios[0].coversChangedBehavior,
    "scenarios[0].coversChangedBehavior",
  );
  await expectRejected(
    "missing preconditions",
    (candidate) => delete candidate.scenarios[0].preconditions,
    "scenarios[0].preconditions",
  );
  await expectRejected(
    "missing terminal state",
    (candidate) => delete candidate.scenarios[0].terminalState,
    "scenarios[0].terminalState.description",
  );
  await expectRejected(
    "no changed-behavior scenario",
    (candidate) => {
      candidate.scenarios[0].coversChangedBehavior = false;
    },
    "at least one scenario must cover changed behavior",
  );
  await expectRejected(
    "late first action",
    (candidate) => {
      candidate.presentation.firstMeaningfulActionSeconds = 16;
    },
    "presentation.firstMeaningfulActionSeconds must be <= 15",
  );
  await expectRejected(
    "unwatched video",
    (candidate) => {
      candidate.presentation.watchedStartToFinish = false;
    },
    "presentation.watchedStartToFinish must be true",
  );
  await expectRejected(
    "short terminal hold",
    (candidate) => {
      candidate.presentation.terminalStateVisibleSeconds = 2;
    },
    "presentation.terminalStateVisibleSeconds must be >= 3",
  );
  await expectRejected(
    "first action beyond video duration",
    (candidate) => {
      candidate.evidence.video.durationSeconds = 0.5;
    },
    "presentation.firstMeaningfulActionSeconds must not exceed evidence.video duration",
  );
  await expectRejected(
    "terminal hold beyond video duration",
    (candidate) => {
      candidate.evidence.video.durationSeconds = 2;
    },
    "presentation.terminalStateVisibleSeconds must not exceed evidence.video duration",
  );
  await expectRejected(
    "impossible presentation intervals",
    (candidate) => {
      candidate.presentation.firstMeaningfulActionSeconds = 3;
      candidate.evidence.video.durationSeconds = 5;
    },
    "presentation action and terminal-state intervals must fit within evidence.video duration",
  );
  await expectRejected(
    "missing provider disclosure",
    (candidate) => delete candidate.provider.kind,
    "provider.kind",
  );
  const oversizedProviderTrace = Buffer.alloc(MAX_PROVIDER_TRACE_BYTES + 1);
  await writeFile(path.join(dir, "provider-trace-oversized.jsonl"), oversizedProviderTrace);
  await expectRejected(
    "oversized provider trace",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-oversized.jsonl",
        sha256: sha256(oversizedProviderTrace),
      };
    },
    "provider.trace exceeds",
  );
  await expectRejected(
    "provider trace hash mismatch",
    (candidate) => {
      candidate.provider.trace.sha256 = "f".repeat(64);
    },
    "provider.trace SHA-256 does not match",
  );
  const malformedProviderTrace = Buffer.from("not-json\n");
  await writeFile(path.join(dir, "provider-trace-malformed.jsonl"), malformedProviderTrace);
  await expectRejected(
    "malformed provider trace",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-malformed.jsonl",
        sha256: sha256(malformedProviderTrace),
      };
    },
    "provider.trace line 1 must be valid JSON",
  );
  const emptyProviderTrace = Buffer.alloc(0);
  await writeFile(path.join(dir, "provider-trace-empty.jsonl"), emptyProviderTrace);
  await expectRejected(
    "empty provider trace",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-empty.jsonl",
        sha256: sha256(emptyProviderTrace),
      };
    },
    "provider.trace must contain non-empty JSONL records",
  );
  const incompleteProviderTrace = Buffer.from(
    '{"event":"request"}\n{"event":"response"}\n',
  );
  await writeFile(path.join(dir, "provider-trace-incomplete.jsonl"), incompleteProviderTrace);
  await expectRejected(
    "incomplete provider trace",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-incomplete.jsonl",
        sha256: sha256(incompleteProviderTrace),
      };
    },
    "provider.trace must include request, tool_request, tool_response, response",
  );
  const mismatchedProviderTrace = Buffer.from(
    [
      { event: "request" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      { event: "tool_response", tool: "edit_file", callId: "call-1", status: "success" },
      { event: "response" },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace-mismatched.jsonl"), mismatchedProviderTrace);
  await expectRejected(
    "mismatched provider trace tool",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-mismatched.jsonl",
        sha256: sha256(mismatchedProviderTrace),
      };
    },
    "provider.trace line 3 tool_response tool must match its callId request",
  );
  const unansweredProviderTrace = Buffer.from(
    [
      { event: "request" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      { event: "tool_request", tool: "edit_file", callId: "call-2" },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
      },
      { event: "response" },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace-unanswered.jsonl"), unansweredProviderTrace);
  await expectRejected(
    "unanswered provider trace tool request",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-unanswered.jsonl",
        sha256: sha256(unansweredProviderTrace),
      };
    },
    "provider.trace must not contain unanswered tool_request records",
  );
  const reusedToolResponseTrace = Buffer.from(
    [
      { event: "request" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-2" },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
      },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
      },
      { event: "response" },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(dir, "provider-trace-reused-response.jsonl"),
    reusedToolResponseTrace,
  );
  await expectRejected(
    "reused provider tool response",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-reused-response.jsonl",
        sha256: sha256(reusedToolResponseTrace),
      };
    },
    "provider.trace line 5 tool_response callId must match a preceding tool_request",
  );
  const reusedToolRequestTrace = Buffer.from(
    [
      { event: "request" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
      },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
      },
      { event: "response" },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(dir, "provider-trace-reused-request.jsonl"),
    reusedToolRequestTrace,
  );
  await expectRejected(
    "reused provider tool request ID",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-reused-request.jsonl",
        sha256: sha256(reusedToolRequestTrace),
      };
    },
    "provider.trace line 4 tool_request callId must be unique",
  );
  const missingToolStatusTrace = Buffer.from(
    [
      { event: "request" },
      { event: "tool_request", tool: "ensure_secret", callId: "call-1" },
      { event: "tool_response", tool: "ensure_secret", callId: "call-1" },
      { event: "response" },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace-missing-tool-status.jsonl"), missingToolStatusTrace);
  await expectRejected(
    "provider trace missing tool response status",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-missing-tool-status.jsonl",
        sha256: sha256(missingToolStatusTrace),
      };
    },
    "provider.trace line 3 status",
  );
  const failedToolTrace = Buffer.from(
    [
      { event: "request", ...providerCorrelation },
      {
        event: "tool_request",
        tool: "ensure_secret",
        callId: "call-1",
        ...providerCorrelation,
      },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "error",
        ...providerCorrelation,
      },
      { event: "response", ...providerCorrelation },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace-failed-tool.jsonl"), failedToolTrace);
  await expectRejected(
    "pass verdict with failed tool response",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-failed-tool.jsonl",
        sha256: sha256(failedToolTrace),
      };
    },
    "pass verdict requires every provider tool_response status to be success",
  );
  const staleProviderTrace = Buffer.from(
    [
      { event: "request", ...providerCorrelation, requestId: "nixmac-e2e:stale" },
      {
        event: "tool_request",
        tool: "ensure_secret",
        callId: "call-1",
        ...providerCorrelation,
      },
      {
        event: "tool_response",
        tool: "ensure_secret",
        callId: "call-1",
        status: "success",
        ...providerCorrelation,
      },
      { event: "response", ...providerCorrelation },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  await writeFile(path.join(dir, "provider-trace-stale.jsonl"), staleProviderTrace);
  await expectRejected(
    "provider trace from another request",
    (candidate) => {
      candidate.provider.trace = {
        path: "provider-trace-stale.jsonl",
        sha256: sha256(staleProviderTrace),
      };
    },
    "provider.trace line 1 requestId must match the terminal result",
  );
  await expectRejected(
    "semantic audit hash mismatch",
    (candidate) => {
      candidate.presentation.semanticAudit.sha256 = "f".repeat(64);
    },
    "presentation.semanticAudit SHA-256 does not match",
  );
  await expectRejected(
    "sensitive content audit",
    (candidate) => {
      candidate.presentation.semanticAudit.sensitiveContentVisible = true;
    },
    "presentation.semanticAudit must reject sensitive content before publication",
  );
  const contradictoryAudit = Buffer.from(
    `${JSON.stringify({
      ...semanticAuditIdentity,
      reviewedScreenshots,
      videoSha256: sha256(mp4),
      status: "pass",
      firstMeaningfulActionSeconds: 53,
      watchedStartToFinish: false,
      terminalStateVisible: false,
      terminalStateVisibleSeconds: 0,
      rationale: "The audit contradicts the presentation fields.",
    })}\n`,
  );
  await writeFile(path.join(dir, "semantic-video-audit-contradictory.json"), contradictoryAudit);
  await expectRejected(
    "contradictory semantic audit",
    (candidate) => {
      candidate.presentation.semanticAudit = {
        ...candidate.presentation.semanticAudit,
        path: "semantic-video-audit-contradictory.json",
        sha256: sha256(contradictoryAudit),
      };
    },
    "firstMeaningfulActionSeconds must match presentation",
  );
  const oversizedSemanticAudit = Buffer.alloc(MAX_SEMANTIC_AUDIT_BYTES + 1);
  await writeFile(path.join(dir, "semantic-video-audit-oversized.json"), oversizedSemanticAudit);
  await expectRejected(
    "oversized semantic audit",
    (candidate) => {
      candidate.presentation.semanticAudit = {
        ...candidate.presentation.semanticAudit,
        path: "semantic-video-audit-oversized.json",
        sha256: sha256(oversizedSemanticAudit),
      };
    },
    "presentation.semanticAudit exceeds",
  );
  await expectRejected(
    "audio stream",
    (candidate) => {
      candidate.evidence.video.streamCount = 2;
      candidate.evidence.video.audioStreamCount = 1;
    },
    "exactly one video stream",
  );
  await expectRejected(
    "failed cleanup with pass verdict",
    (candidate) => {
      candidate.cleanup.status = "fail";
    },
    "fail evidence requires verdict to be fail",
  );

  const expectedRefusal = structuredClone(manifest);
  expectedRefusal.scenarios[0].intent = "expected-refusal";
  expectedRefusal.scenarios[0].title = "Safe refusal";
  expectedRefusal.scenarios[0].terminalState.description = "Safe refusal visible";
  expectedRefusal.scenarios.push({
    ...structuredClone(expectedRefusal.scenarios[0]),
    id: "supporting-positive",
    title: "Supporting positive coverage",
    intent: "positive-flow",
    coversChangedBehavior: false,
  });
  await writeFile(manifestPath, `${JSON.stringify(expectedRefusal, null, 2)}\n`);
  const expectedRefusalResult = await loadTerminalResult(manifestPath, { probe: false });
  const expectedRefusalHtml = renderTerminalReportHtml(expectedRefusalResult);
  for (const needle of ["EXPECTED REFUSAL VERIFIED", "Positive flow not exercised"]) {
    if (!expectedRefusalHtml.includes(needle)) {
      fail(`self-test expected-refusal output is missing ${needle}`);
    }
  }
  if (expectedRefusalHtml.includes("POSITIVE FLOW PASS")) {
    fail("self-test expected unrelated positive coverage not to qualify the result");
  }

  const correctionAuditIdentity = {
    ...semanticAuditIdentity,
    reviewedFrameCount: 150,
    reviewedContactSheetCount: 13,
  };
  const failedAudit = Buffer.from(
    `${JSON.stringify({
      ...correctionAuditIdentity,
      reviewedScreenshots,
      videoSha256: sha256(mp4),
      status: "fail",
      firstMeaningfulActionSeconds: 53,
      watchedStartToFinish: true,
      terminalStateVisible: true,
      terminalStateVisibleSeconds: 15,
      rationale: "The presentation has a long idle prefix.",
    })}\n`,
  );
  await writeFile(path.join(dir, "semantic-video-audit-failed.json"), failedAudit);
  const correction = structuredClone(expectedRefusal);
  correction.scenarios = [correction.scenarios[0]];
  correction.evidence.video.durationSeconds = 75;
  correction.presentation = {
    ...correction.presentation,
    status: "fail",
    firstMeaningfulActionSeconds: 53,
    terminalStateVisibleSeconds: 15,
    note: "The 53-second idle prefix is not demo quality.",
    semanticAudit: {
      path: "semantic-video-audit-failed.json",
      sha256: sha256(failedAudit),
      ...correctionAuditIdentity,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(correction, null, 2)}\n`);
  const correctionResult = await loadTerminalResult(manifestPath, { probe: false });
  const correctionHtml = renderTerminalReportHtml(correctionResult);
  if (!correctionHtml.includes("PRESENTATION QUALITY FAILED")) {
    fail("self-test correction output is missing presentation failure warning");
  }

  for (const streams of [
    [
      { codec_type: "video", codec_name: "h264" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    [
      { codec_type: "video", codec_name: "h264" },
      { codec_type: "video", codec_name: "h264" },
    ],
  ]) {
    rejected = false;
    try {
      videoProbeFromFfprobe({ streams, format: { duration: "1" } });
    } catch (error) {
      rejected = error.message.includes("exactly one video stream");
    }
    if (!rejected) fail("self-test expected extra media streams to be rejected");
  }

  rejected = false;
  try {
    await decodeVideo(path.join(dir, "proof.mp4"));
  } catch (error) {
    rejected = error.message.includes("failed full decode");
  }
  if (!rejected) fail("self-test expected corrupt video decode to be rejected");
  process.stdout.write("terminal-report self-test passed\n");
}

function usage() {
  return `Usage:
  node tests/e2e/computer-use/terminal-report.mjs render --input <manifest.json> --output-dir <dir> --verified-app-version <version>
  node tests/e2e/computer-use/terminal-report.mjs self-test
`;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "self-test") return selfTest();
  if (command !== "render") {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1 || !args[index + 1]) fail(`${flag} is required`);
    return args[index + 1];
  };
  const input = value("--input");
  const outputDir = value("--output-dir");
  const verifiedAppVersion = value("--verified-app-version");
  const { normalized } = await renderCommand(input, outputDir, { verifiedAppVersion });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      verdict: normalized.verdict,
      resultLabel: normalized.resultLabel,
      headSha: normalized.testedArtifact.headSha,
      outputDir: path.resolve(outputDir),
    })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`terminal-report: ${error.message}\n`);
    process.exitCode = 1;
  });
}
