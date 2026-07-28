#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { redact } from "./redaction.mjs";

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = "nixmac.e2e.terminal-result.v1";
const MAX_SCREENSHOTS = 6;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SCREENSHOT_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const MAX_HTML_BYTES = 42 * 1024 * 1024;
const STATUSES = new Set(["pass", "fail", "inconclusive"]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

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

function requireStatus(value, name) {
  if (!STATUSES.has(value)) fail(`${name} must be pass, fail, or inconclusive`);
  return value;
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
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) fail(`${name} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateMp4Header(buffer, name) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    fail(`${name} is not an MP4 with an ftyp header`);
  }
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
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,pix_fmt:format=duration",
        "-of",
        "json",
        filePath,
      ]);
      const parsed = JSON.parse(stdout);
      const stream = parsed.streams?.[0];
      if (!stream) fail("ffprobe did not find a video stream");
      return {
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        pixelFormat: stream.pix_fmt,
        durationSeconds: Number(parsed.format?.duration),
      };
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`ffprobe is required to validate the evidence video: ${lastError?.message || "not found"}`);
}

function validateOutcome(result) {
  const scenarioStatuses = result.scenarios.map((scenario) => scenario.status);
  const assertionStatuses = result.scenarios.flatMap((scenario) =>
    scenario.assertions.map((assertion) => assertion.status),
  );
  const allStatuses = [...scenarioStatuses, ...assertionStatuses];
  const hasFail = allStatuses.includes("fail");
  const hasInconclusive = allStatuses.includes("inconclusive");
  if (result.verdict === "pass" && (hasFail || hasInconclusive)) {
    fail("a pass verdict requires every scenario and assertion to pass");
  }
  if (result.verdict === "fail" && !hasFail) {
    fail("a fail verdict requires at least one failed scenario or assertion");
  }
  if (result.verdict === "inconclusive" && !hasInconclusive) {
    fail("an inconclusive verdict requires at least one inconclusive scenario or assertion");
  }
}

export async function loadTerminalResult(inputPath, { probe = true } = {}) {
  const inputReal = await realpath(inputPath);
  const result = JSON.parse(await readFile(inputReal, "utf8"));
  if (result.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion must be ${SCHEMA_VERSION}`);
  }

  requireString(result.request?.id, "request.id", { pattern: SAFE_ID_RE, max: 80 });
  if (result.request?.repository !== "darkmatter/nixmac") {
    fail("request.repository must be darkmatter/nixmac");
  }
  requireInteger(result.request?.pullRequest?.number, "request.pullRequest.number");
  requireString(result.request?.pullRequest?.title, "request.pullRequest.title", { max: 300 });
  requireString(result.request?.pullRequest?.url, "request.pullRequest.url", {
    pattern: /^https:\/\/github\.com\/darkmatter\/nixmac\/pull\/\d+$/,
    max: 200,
  });
  requireStatus(result.verdict, "verdict");
  requireString(result.summary, "summary", { max: 1_000 });
  requireString(result.testedArtifact?.headSha, "testedArtifact.headSha", { pattern: GIT_SHA_RE });
  requireInteger(result.testedArtifact?.actionsRunId, "testedArtifact.actionsRunId");
  requireInteger(result.testedArtifact?.artifactId, "testedArtifact.artifactId");
  requireString(result.testedArtifact?.artifactName, "testedArtifact.artifactName", { max: 200 });
  requireString(result.testedArtifact?.appVersion, "testedArtifact.appVersion", { max: 100 });
  requireString(result.testedArtifact?.archiveSha256, "testedArtifact.archiveSha256", {
    pattern: SHA256_RE,
  });
  requireString(result.testedArtifact?.appSha256, "testedArtifact.appSha256", {
    pattern: SHA256_RE,
  });
  if (result.reportTool?.repository !== "darkmatter/nixmac") {
    fail("reportTool.repository must be darkmatter/nixmac");
  }
  requireString(result.reportTool?.sha, "reportTool.sha", { pattern: GIT_SHA_RE });
  requireString(result.runner?.host, "runner.host", { max: 200 });
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
    requireString(scenario.changedBehavior, `${prefix}.changedBehavior`, { max: 1_000 });
    requireString(scenario.declaredPostcondition, `${prefix}.declaredPostcondition`, { max: 1_000 });
    requireStatus(scenario.status, `${prefix}.status`);
    requireArray(scenario.assertions, `${prefix}.assertions`, { min: 1, max: 12 }).forEach(
      (assertion, assertionIndex) => {
        requireString(assertion.description, `${prefix}.assertions[${assertionIndex}].description`, {
          max: 1_000,
        });
        requireStatus(assertion.status, `${prefix}.assertions[${assertionIndex}].status`);
        requireString(assertion.evidence, `${prefix}.assertions[${assertionIndex}].evidence`, {
          max: 2_000,
        });
      },
    );
  });
  validateOutcome(result);

  requireString(result.evidence?.root, "evidence.root", { max: 1_000 });
  const root = await realpath(result.evidence.root);
  const screenshots = [];
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
    if (file.size > MAX_SCREENSHOT_BYTES) fail(`${name} exceeds ${formatBytes(MAX_SCREENSHOT_BYTES)}`);
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
  if (videoFile.size > MAX_VIDEO_BYTES) fail(`evidence.video exceeds ${formatBytes(MAX_VIDEO_BYTES)}`);
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
      };
  if (videoProbe.codec !== "h264" || videoProbe.pixelFormat !== "yuv420p") {
    fail("evidence.video must be H.264 with yuv420p pixel format");
  }
  if (
    !Number.isFinite(videoProbe.durationSeconds) ||
    videoProbe.durationSeconds <= 0 ||
    videoProbe.durationSeconds > 600
  ) {
    fail("evidence.video duration must be between 0 and 600 seconds");
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

  requireStatus(result.cleanup?.status, "cleanup.status");
  requireString(result.cleanup?.note, "cleanup.note", { max: 1_000 });
  if (result.verdict === "pass" && result.cleanup.status !== "pass") {
    fail("a pass verdict requires cleanup.status to be pass");
  }
  requireArray(result.knownLimits, "knownLimits", { min: 0, max: 12 }).forEach((limit, index) =>
    requireString(limit, `knownLimits[${index}]`, { max: 1_000 }),
  );
  const startedAt = parseIso(result.timestamps?.startedAt, "timestamps.startedAt");
  const completedAt = parseIso(result.timestamps?.completedAt, "timestamps.completedAt");
  if (completedAt < startedAt) fail("timestamps.completedAt must not precede timestamps.startedAt");

  return {
    ...result,
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

function renderScenario(scenario) {
  const assertions = scenario.assertions
    .map(
      (assertion) => `<li class="assertion">
        <span class="badge ${escapeHtml(assertion.status)}">${escapeHtml(verdictLabel(assertion.status))}</span>
        <div><strong>${escapeHtml(assertion.description)}</strong><small>${escapeHtml(assertion.evidence)}</small></div>
      </li>`,
    )
    .join("");
  return `<article class="scenario">
    <header><div><small>PR-focused scenario</small><h3>${escapeHtml(scenario.title)}</h3></div><span class="badge ${escapeHtml(scenario.status)}">${escapeHtml(verdictLabel(scenario.status))}</span></header>
    <dl><div><dt>Changed behavior</dt><dd>${escapeHtml(scenario.changedBehavior)}</dd></div><div><dt>Declared postcondition</dt><dd>${escapeHtml(scenario.declaredPostcondition)}</dd></div></dl>
    <ul class="assertions">${assertions}</ul>
  </article>`;
}

export function renderTerminalReportHtml(result) {
  const pr = result.request.pullRequest;
  const artifact = result.testedArtifact;
  const video = result.evidence.video;
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
  const reportHashSeed = JSON.stringify({
    schemaVersion: result.schemaVersion,
    requestId: result.request.id,
    headSha: artifact.headSha,
    verdict: result.verdict,
    screenshotHashes: result.evidence.screenshots.map((item) => item.sha256),
    videoHash: video.sha256,
  });
  const evidenceSetHash = sha256(Buffer.from(reportHashSeed));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="nixmac-e2e-schema" content="${SCHEMA_VERSION}">
  <meta name="nixmac-e2e-evidence-set-sha256" content="${evidenceSetHash}">
  <title>nixmac E2E · PR #${pr.number} · ${verdictLabel(result.verdict)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --bg:#0c0f14; --panel:#131821; --line:#293241; --muted:#9ba8b8; --text:#eef3f9; --blue:#84c5ff; }
    * { box-sizing:border-box; } html { background:var(--bg); scroll-behavior:smooth; } body { margin:0; color:var(--text); background:radial-gradient(circle at 70% -20%, #193250 0, transparent 38rem), var(--bg); }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:40px 0 72px; } a { color:var(--blue); } h1 { margin:8px 0 14px; font-size:clamp(30px, 5vw, 54px); line-height:1.02; letter-spacing:-.04em; } h2 { margin:42px 0 14px; font-size:22px; } h3 { margin:3px 0 0; font-size:19px; }
    p, dd, li { line-height:1.55; color:#c8d1dc; } code { color:#b9dcff; overflow-wrap:anywhere; } small { display:block; color:var(--muted); } .eyebrow { color:var(--blue); text-transform:uppercase; letter-spacing:.12em; font-weight:800; font-size:12px; }
    .hero { padding:28px; border:1px solid #35506c; border-radius:20px; background:linear-gradient(145deg, rgba(27,38,53,.97), rgba(14,18,25,.97)); box-shadow:0 24px 80px rgba(0,0,0,.3); } .hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; } .summary-copy { max-width:800px; font-size:17px; }
    .badge { display:inline-flex; align-items:center; justify-content:center; min-width:76px; padding:7px 11px; border-radius:999px; font-size:12px; font-weight:900; letter-spacing:.05em; white-space:nowrap; } .pass { color:#9af0bd; background:#123c2a; border:1px solid #266b4a; } .fail { color:#ffb1ae; background:#481d1e; border:1px solid #7a3434; } .inconclusive { color:#ffda84; background:#463612; border:1px solid #766023; }
    .metrics { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-top:22px; } .metric, .panel, .scenario { border:1px solid var(--line); border-radius:14px; background:rgba(19,24,33,.94); } .metric { padding:14px; } .metric strong { display:block; margin-top:5px; font-size:18px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; } .panel { padding:18px; min-width:0; } .panel h2 { margin-top:0; } dl { margin:0; } dl > div { padding:10px 0; border-top:1px solid var(--line); } dl > div:first-child { border-top:0; padding-top:0; } dt { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; } dd { margin:4px 0 0; }
    .scenario { padding:20px; margin-top:12px; } .scenario header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; } .assertions { list-style:none; padding:0; margin:18px 0 0; } .assertion { display:grid; grid-template-columns:auto 1fr; align-items:start; gap:12px; padding:12px 0; border-top:1px solid var(--line); } .assertion small { margin-top:4px; line-height:1.45; }
    .video { padding:14px; border:1px solid var(--line); border-radius:16px; background:#05070a; } video { display:block; width:100%; max-height:720px; border-radius:10px; background:#000; } .video figcaption { padding:12px 4px 2px; display:grid; grid-template-columns:1fr auto; gap:8px; }
    .shots { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; } figure { margin:0; } .shots figure { padding:10px; border:1px solid var(--line); border-radius:14px; background:var(--panel); } img { display:block; width:100%; border-radius:9px; background:#000; } figcaption span, figcaption code { display:block; margin-top:5px; font-size:12px; color:var(--muted); }
    .integrity { overflow-x:auto; } table { width:100%; border-collapse:collapse; min-width:680px; } th,td { text-align:left; border-top:1px solid var(--line); padding:11px 8px; vertical-align:top; } th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; } footer { margin-top:42px; color:var(--muted); font-size:12px; }
    @media (max-width:760px) { main { width:min(100% - 20px, 1180px); padding-top:18px; } .hero { padding:20px; } .hero-top { display:block; } .hero-top > .badge { margin-top:8px; } .metrics, .grid, .shots { grid-template-columns:1fr; } .video figcaption { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <div class="hero-top"><div><span class="eyebrow">nixmac · Computer Use E2E</span><h1>PR #${pr.number}: ${escapeHtml(pr.title)}</h1></div><span class="badge ${result.verdict}">${verdictLabel(result.verdict)}</span></div>
    <p class="summary-copy">${escapeHtml(result.summary)}</p>
    <div class="metrics">
      <div class="metric"><small>Scenarios</small><strong>${result.scenarios.length} / ${result.scenarios.length} exercised</strong></div>
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
    </dl></section>
    <section class="panel"><dl>
      <div><dt>Runner</dt><dd>${escapeHtml(result.runner.host)} · macOS ${escapeHtml(result.runner.macosVersion)}</dd></div>
      <div><dt>CuaDriver</dt><dd>${escapeHtml(result.runner.cuaDriverVersion)} · ${result.runner.sockets.map((item) => `<code>${escapeHtml(item)}</code>`).join(" · ")}</dd></div>
      <div><dt>Report tool pin</dt><dd><code>${escapeHtml(result.reportTool.repository)}@${result.reportTool.sha}</code></dd></div>
      <div><dt>Request</dt><dd><code>${escapeHtml(result.request.id)}</code></dd></div>
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
      <tr><td>Staged nixmac.app</td><td><code>${artifact.appSha256}</code></td><td>source identity</td></tr>
      ${result.evidence.screenshots.map((shot) => `<tr><td>${escapeHtml(shot.label)}</td><td><code>${shot.sha256}</code></td><td>${escapeHtml(formatBytes(shot.size))}</td></tr>`).join("")}
      <tr><td>${escapeHtml(video.label)}</td><td><code>${video.sha256}</code></td><td>${escapeHtml(formatBytes(video.size))}</td></tr>
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

async function renderCommand(input, outputDir, { probe = true } = {}) {
  const result = await loadTerminalResult(input, { probe });
  const html = renderTerminalReportHtml(result);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    fail(`rendered report exceeds ${formatBytes(MAX_HTML_BYTES)}`);
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), html);
  const normalized = {
    ...result,
    evidence: {
      root: result.evidence.root,
      screenshots: result.evidence.screenshots.map(({ dataUri: _dataUri, ...item }) => item),
      video: (({ dataUri: _dataUri, ...item }) => item)(result.evidence.video),
    },
  };
  await writeFile(path.join(outputDir, "terminal-result.normalized.json"), `${JSON.stringify(normalized, null, 2)}\n`);
  return { html, normalized };
}

async function selfTest() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nixmac-terminal-report-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAUAAAAHgCAIAAAC6s0uzAAAAC0lEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAfg0GGAABvRr9AAAAAElFTkSuQmCC",
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
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    request: {
      id: "self-test",
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
    },
    reportTool: { repository: "darkmatter/nixmac", sha: "d".repeat(40) },
    runner: {
      host: "test-runner",
      macosVersion: "15.0",
      cuaDriverVersion: "test",
      sockets: ["/tmp/cua.sock"],
    },
    scenarios: [
      {
        id: "self-test",
        title: "Self test",
        changedBehavior: "Exercise the adapter.",
        declaredPostcondition: "The report renders.",
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
        durationSeconds: 1,
      },
    },
    knownLimits: [],
    cleanup: { status: "pass", note: "Self-test cleanup." },
    timestamps: {
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:01Z",
    },
  };
  const manifestPath = path.join(dir, "terminal-result.v1.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const outputDir = path.join(dir, "report");
  const { html } = await renderCommand(manifestPath, outputDir, { probe: false });
  for (const needle of [
    SCHEMA_VERSION,
    "data:image/png;base64,",
    "data:video/mp4;base64,",
    "Product verdict is derived only",
  ]) {
    if (!html.includes(needle)) fail(`self-test output is missing ${needle}`);
  }
  const invalid = structuredClone(manifest);
  invalid.verdict = "pass";
  invalid.scenarios[0].status = "inconclusive";
  await writeFile(manifestPath, `${JSON.stringify(invalid, null, 2)}\n`);
  let rejected = false;
  try {
    await loadTerminalResult(manifestPath, { probe: false });
  } catch (error) {
    rejected = error.message.includes("pass verdict requires");
  }
  if (!rejected) fail("self-test expected inconsistent verdict to be rejected");
  process.stdout.write("terminal-report self-test passed\n");
}

function usage() {
  return `Usage:
  node tests/e2e/computer-use/terminal-report.mjs render --input <manifest.json> --output-dir <dir>
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
  const { normalized } = await renderCommand(input, outputDir);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      verdict: normalized.verdict,
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
