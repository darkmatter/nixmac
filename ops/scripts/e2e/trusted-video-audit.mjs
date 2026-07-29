#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AUDIT_SCHEMA = "nixmac.e2e.semantic-audit.v6";
const REVIEWER = "GitHub Actions protected vision review";
const REVIEWER_KIND = "github-actions-protected-vision-review";
const MAX_REVIEW_VIDEO_SECONDS = 120;
const TIMELINE_SAMPLE_RATE = 2;
const TIMELINE_SAMPLE_INTERVAL_SECONDS = 1 / TIMELINE_SAMPLE_RATE;
const CONTACT_SHEET_COLUMNS = 3;
const CONTACT_SHEET_ROWS = 4;
const CONTACT_SHEET_FRAME_COUNT = CONTACT_SHEET_COLUMNS * CONTACT_SHEET_ROWS;

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function stripPngAncillaryMetadata(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < signature.length || !buffer.subarray(0, 8).equals(signature)) {
    fail("reviewed screenshot is not a PNG");
  }
  const chunks = [signature];
  let offset = signature.length;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) fail("reviewed screenshot has a truncated PNG chunk");
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) fail("reviewed screenshot has an oversized PNG chunk");
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) fail("reviewed screenshot has an invalid PNG chunk");
    if (!sawHeader && type !== "IHDR") fail("reviewed screenshot must start with IHDR");
    if (type === "IHDR") {
      if (sawHeader) fail("reviewed screenshot contains duplicate IHDR");
      sawHeader = true;
    }
    if (type === "IDAT") sawImageData = true;
    if (type[0] === type[0].toUpperCase()) chunks.push(buffer.subarray(offset, end));
    offset = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== buffer.length) {
    fail("reviewed screenshot is not a complete PNG");
  }
  return Buffer.concat(chunks);
}

function requireFiniteNumber(value, name, { min = 0, max = Number.MAX_VALUE } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function validateDecision(decision, durationSeconds) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    fail("vision review must return a JSON object");
  }
  if (decision.verdict !== "pass") {
    fail(`trusted vision review did not pass: ${decision.rationale || decision.verdict}`);
  }
  if (
    decision.changedBehaviorVisible !== true ||
    decision.timelineCoherent !== true ||
    decision.terminalStateVisible !== true ||
    decision.sensitiveContentVisible !== false
  ) {
    fail(
      `trusted vision review could not verify safe publication and the required semantics: ${decision.rationale}`,
    );
  }
  const firstMeaningfulActionSeconds = requireFiniteNumber(
    decision.firstMeaningfulActionSeconds,
    "firstMeaningfulActionSeconds",
    { max: Math.min(15, durationSeconds) },
  );
  const terminalStateVisibleSeconds = requireFiniteNumber(
    decision.terminalStateVisibleSeconds,
    "terminalStateVisibleSeconds",
    { min: 3, max: durationSeconds },
  );
  if (firstMeaningfulActionSeconds + terminalStateVisibleSeconds > durationSeconds) {
    fail("trusted vision review timings do not fit within the video");
  }
  if (typeof decision.rationale !== "string" || !decision.rationale.trim()) {
    fail("trusted vision review must include a rationale");
  }
  return {
    firstMeaningfulActionSeconds,
    terminalStateVisibleSeconds,
    rationale: decision.rationale.trim().slice(0, 2_000),
  };
}

async function videoDuration(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  return requireFiniteNumber(Number(stdout.trim()), "video duration", {
    min: 0.01,
    max: MAX_REVIEW_VIDEO_SECONDS,
  });
}

function expectedTimelineFrameCount(durationSeconds) {
  return Math.max(1, Math.ceil(durationSeconds * TIMELINE_SAMPLE_RATE));
}

async function videoFrameCount(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=nb_read_frames",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const count = requireFiniteNumber(Number(stdout.trim()), "reviewed video frame count", {
    min: 1,
    max: MAX_REVIEW_VIDEO_SECONDS * TIMELINE_SAMPLE_RATE,
  });
  if (!Number.isSafeInteger(count)) fail("reviewed video frame count must be an integer");
  return count;
}

async function extractReviewImages(videoPath, screenshotPaths, reviewedFrameCount, outputDir) {
  const images = [];
  const expectedContactSheetCount = Math.ceil(
    reviewedFrameCount / CONTACT_SHEET_FRAME_COUNT,
  );
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-n",
    "-i",
    videoPath,
    "-vf",
    [
      `fps=${TIMELINE_SAMPLE_RATE}:start_time=0:round=down`,
      "scale=512:-2:flags=lanczos",
      `tile=${CONTACT_SHEET_COLUMNS}x${CONTACT_SHEET_ROWS}:padding=4:margin=4`,
    ].join(","),
    "-q:v",
    "5",
    path.join(outputDir, "timeline-%03d.jpg"),
  ]);
  const contactSheets = (await readdir(outputDir))
    .filter((entry) => /^timeline-\d{3}\.jpg$/.test(entry))
    .sort();
  if (contactSheets.length !== expectedContactSheetCount) {
    fail(
      `trusted timeline extraction produced ${contactSheets.length} contact sheets; expected ${expectedContactSheetCount}`,
    );
  }
  for (const [index, entry] of contactSheets.entries()) {
    const firstFrame = index * CONTACT_SHEET_FRAME_COUNT + 1;
    const lastFrame = Math.min(
      reviewedFrameCount,
      firstFrame + CONTACT_SHEET_FRAME_COUNT - 1,
    );
    images.push({
      label:
        `Dense video timeline contact sheet ${index + 1}/${contactSheets.length}: ` +
        `chronological ${TIMELINE_SAMPLE_RATE} Hz samples ${firstFrame}-${lastFrame}`,
      path: path.join(outputDir, entry),
      mime: "image/jpeg",
      maxBytes: 2 * 1024 * 1024,
    });
  }
  for (const [index, screenshotPath] of screenshotPaths.entries()) {
    images.push({
      label: `Exact curated evidence screenshot ${index + 1}`,
      path: screenshotPath,
      mime: "image/png",
      maxBytes: 4 * 1024 * 1024,
    });
  }
  return {
    images,
    reviewedFrameCount,
    reviewedContactSheetCount: contactSheets.length,
    reviewedScreenshotCount: screenshotPaths.length,
  };
}

async function createReviewedPublicVideo(sourceVideoPath, publicVideoPath) {
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-n",
    "-i",
    sourceVideoPath,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `fps=${TIMELINE_SAMPLE_RATE}:start_time=0:round=down,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    publicVideoPath,
  ]);
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-i",
    publicVideoPath,
    "-map",
    "0:v:0",
    "-f",
    "null",
    "-",
  ]);
}

async function createReviewedScreenshot(sourcePath, outputPath, temporaryPath) {
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-n",
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-map_metadata",
    "-1",
    temporaryPath,
  ]);
  const sanitized = stripPngAncillaryMetadata(await readFile(temporaryPath));
  if (sanitized.length > 4 * 1024 * 1024) fail("reviewed screenshot exceeds 4 MiB");
  await writeFile(outputPath, sanitized, { flag: "wx" });
  return {
    sourceSha256: sha256(await readFile(sourcePath)),
    sha256: sha256(sanitized),
  };
}

async function imageContent(images) {
  const content = [];
  for (const image of images) {
    const buffer = await readFile(image.path);
    if (buffer.length > image.maxBytes) fail(`review image is too large: ${image.label}`);
    content.push({ type: "text", text: image.label });
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mime};base64,${buffer.toString("base64")}` },
    });
  }
  return content;
}

async function requestDecision({ apiKey, model, manifest, images, durationSeconds }) {
  const scenarioSummary = manifest.scenarios.map((scenario) => ({
    title: scenario.title,
    intent: scenario.intent,
    changedBehavior: scenario.changedBehavior,
    terminalState: scenario.terminalState?.description,
  }));
  const prompt = [
    "You are the independent presentation-quality reviewer for a macOS UI E2E run.",
    `The contact sheets cover the full video at ${TIMELINE_SAMPLE_RATE} frames per second ` +
      `(maximum ${TIMELINE_SAMPLE_INTERVAL_SECONDS.toFixed(1)} seconds between samples).`,
    "Inspect every cell of every contact sheet in chronological order. Fail closed if frames are unrelated,",
    "the changed behavior is not visible, the timeline is incoherent, or the terminal state is absent.",
    "Also inspect every cell and curated screenshot for passwords, API keys, tokens, private keys,",
    "recovery codes, authentication cookies, or other credential-like content. Treat uncertainty as sensitive.",
    `Video duration: ${durationSeconds.toFixed(3)} seconds.`,
    `Scenarios: ${JSON.stringify(scenarioSummary)}`,
    "Estimate the first meaningful UI action time and how long the final terminal state stays visible.",
    "Return only the requested JSON.",
  ].join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["pass", "fail", "inconclusive"] },
      changedBehaviorVisible: { type: "boolean" },
      timelineCoherent: { type: "boolean" },
      terminalStateVisible: { type: "boolean" },
      sensitiveContentVisible: { type: "boolean" },
      firstMeaningfulActionSeconds: { type: "number" },
      terminalStateVisibleSeconds: { type: "number" },
      rationale: { type: "string" },
    },
    required: [
      "verdict",
      "changedBehaviorVisible",
      "timelineCoherent",
      "terminalStateVisible",
      "sensitiveContentVisible",
      "firstMeaningfulActionSeconds",
      "terminalStateVisibleSeconds",
      "rationale",
    ],
  };
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/darkmatter/nixmac",
      "X-Title": "nixmac protected E2E video audit",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "nixmac_video_audit", strict: true, schema },
      },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...(await imageContent(images))],
        },
      ],
    }),
  });
  if (!response.ok) {
    fail(`trusted vision review request failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") fail("trusted vision review returned no JSON content");
  try {
    return JSON.parse(content);
  } catch {
    fail("trusted vision review returned invalid JSON");
  }
}

async function review({
  manifestPath,
  evidenceRoot,
  outputPath,
  publicVideoPath,
  model,
  apiKey,
}) {
  if (!apiKey || !model) fail("trusted vision review credentials/model are unavailable");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const root = await realpath(evidenceRoot);
  const confined = async (relativePath) => {
    const candidate = await realpath(path.join(root, relativePath));
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      fail(`evidence path escapes the local root: ${relativePath}`);
    }
    return candidate;
  };
  const videoPath = await confined(manifest.evidence.video.path);
  const screenshotPaths = await Promise.all(
    manifest.evidence.screenshots.map((screenshot) => confined(screenshot.path)),
  );
  for (const [index, screenshotPath] of screenshotPaths.entries()) {
    if (sha256(await readFile(screenshotPath)) !== manifest.evidence.screenshots[index].sha256) {
      fail(`trusted vision review screenshot ${index + 1} hash does not match the manifest`);
    }
  }
  const sourceVideoBuffer = await readFile(videoPath);
  const sourceVideoSha256 = sha256(sourceVideoBuffer);
  if (sourceVideoSha256 !== manifest.evidence.video.sha256) {
    fail("trusted vision review video hash does not match the manifest");
  }
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-i",
    videoPath,
    "-map",
    "0:v:0",
    "-f",
    "null",
    "-",
  ]);
  await videoDuration(videoPath);
  const publicVideoParent = await realpath(path.dirname(publicVideoPath));
  if (publicVideoParent !== root && !publicVideoParent.startsWith(`${root}${path.sep}`)) {
    fail("reviewed public video output must stay inside the local evidence root");
  }
  await createReviewedPublicVideo(videoPath, publicVideoPath);
  const durationSeconds = await videoDuration(publicVideoPath);
  const reviewedFrameCount = await videoFrameCount(publicVideoPath);
  const publicVideoBuffer = await readFile(publicVideoPath);
  const publicVideoSha256 = sha256(publicVideoBuffer);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nixmac-video-audit-"));
  try {
    const reviewedScreenshots = [];
    for (const [index, screenshotPath] of screenshotPaths.entries()) {
      const filename = `publisher-reviewed-screenshot-${String(index + 1).padStart(2, "0")}.png`;
      const reviewedPath = path.join(root, filename);
      const identity = await createReviewedScreenshot(
        screenshotPath,
        reviewedPath,
        path.join(temporary, `screenshot-${String(index + 1).padStart(2, "0")}.png`),
      );
      reviewedScreenshots.push({ path: filename, ...identity });
    }
    const reviewEvidence = await extractReviewImages(
      publicVideoPath,
      reviewedScreenshots.map((screenshot) => path.join(root, screenshot.path)),
      reviewedFrameCount,
      temporary,
    );
    if (reviewEvidence.images.length < 2 || reviewEvidence.images.length > 30) {
      fail("unexpected trusted review image count");
    }
    const decision = validateDecision(
      await requestDecision({
        apiKey,
        model,
        manifest,
        images: reviewEvidence.images,
        durationSeconds,
      }),
      durationSeconds,
    );
    const audit = {
      schemaVersion: AUDIT_SCHEMA,
      reviewer: REVIEWER,
      reviewerKind: REVIEWER_KIND,
      reviewScope:
        "Independent protected sensitivity and semantic inspection of the exact 2 Hz public video and sanitized curated screenshots",
      reviewToolSha: process.env.REPORT_TOOL_SHA,
      reviewRunId: Number(process.env.GITHUB_RUN_ID),
      reviewRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      reviewModel: model,
      reviewedFrameCount: reviewEvidence.reviewedFrameCount,
      reviewedContactSheetCount: reviewEvidence.reviewedContactSheetCount,
      reviewedScreenshotCount: reviewEvidence.reviewedScreenshotCount,
      reviewedScreenshots,
      reviewSampleIntervalSeconds: TIMELINE_SAMPLE_INTERVAL_SECONDS,
      sourceVideoSha256,
      videoSha256: publicVideoSha256,
      status: "pass",
      firstMeaningfulActionSeconds: decision.firstMeaningfulActionSeconds,
      watchedStartToFinish: true,
      terminalStateVisible: true,
      terminalStateVisibleSeconds: decision.terminalStateVisibleSeconds,
      sensitiveContentVisible: false,
      rationale: decision.rationale,
    };
    if (!/^[a-f0-9]{40}$/.test(audit.reviewToolSha ?? "")) fail("invalid report-tool SHA");
    requireFiniteNumber(audit.reviewRunId, "review run ID", { min: 1 });
    requireFiniteNumber(audit.reviewRunAttempt, "review run attempt", { min: 1 });
    await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, { flag: "wx" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function selfTest() {
  const pass = validateDecision(
    {
      verdict: "pass",
      changedBehaviorVisible: true,
      timelineCoherent: true,
      terminalStateVisible: true,
      sensitiveContentVisible: false,
      firstMeaningfulActionSeconds: 4,
      terminalStateVisibleSeconds: 3,
      rationale: "The expected transition and stable terminal state are visible.",
    },
    10,
  );
  if (pass.firstMeaningfulActionSeconds !== 4) fail("decision self-test changed timing");
  let rejected = false;
  try {
    validateDecision(
      {
        verdict: "pass",
        changedBehaviorVisible: false,
        timelineCoherent: true,
        terminalStateVisible: true,
        sensitiveContentVisible: false,
        firstMeaningfulActionSeconds: 1,
        terminalStateVisibleSeconds: 3,
        rationale: "Changed behavior is absent.",
      },
      10,
    );
  } catch {
    rejected = true;
  }
  if (!rejected) fail("decision self-test accepted missing changed behavior");
  rejected = false;
  try {
    validateDecision(
      {
        verdict: "pass",
        changedBehaviorVisible: true,
        timelineCoherent: true,
        terminalStateVisible: true,
        sensitiveContentVisible: true,
        firstMeaningfulActionSeconds: 1,
        terminalStateVisibleSeconds: 3,
        rationale: "A credential is visible.",
      },
      10,
    );
  } catch {
    rejected = true;
  }
  if (!rejected) fail("decision self-test accepted sensitive content");
  const secretTextChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 21]),
    Buffer.from("tEXt"),
    Buffer.from("token\0sk-secret-value"),
    Buffer.alloc(4),
  ]);
  const minimalPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("IHDR"),
    Buffer.alloc(4),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("IDAT"),
    Buffer.alloc(4),
    secretTextChunk,
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("IEND"),
    Buffer.alloc(4),
  ]);
  const strippedPng = stripPngAncillaryMetadata(minimalPng);
  if (strippedPng.includes(Buffer.from("sk-secret-value"))) {
    fail("PNG metadata self-test retained a secret");
  }
  if (expectedTimelineFrameCount(0.1) !== 1) fail("short-video frame count is invalid");
  if (expectedTimelineFrameCount(MAX_REVIEW_VIDEO_SECONDS) !== 240) {
    fail("maximum-video frame count is invalid");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nixmac-video-audit-self-test-"));
  try {
    const videoPath = path.join(temporary, "timeline.mp4");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30:duration=13.2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ]);
    const sourceScreenshotPath = path.join(temporary, "source-screenshot.png");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      sourceScreenshotPath,
    ]);
    const reviewedScreenshotPath = path.join(temporary, "reviewed-screenshot.png");
    const reviewedScreenshot = await createReviewedScreenshot(
      sourceScreenshotPath,
      reviewedScreenshotPath,
      path.join(temporary, "reviewed-screenshot-intermediate.png"),
    );
    if (reviewedScreenshot.sha256 !== sha256(await readFile(reviewedScreenshotPath))) {
      fail("reviewed screenshot self-test changed its final hash");
    }
    const publicVideoPath = path.join(temporary, "reviewed.mp4");
    await createReviewedPublicVideo(videoPath, publicVideoPath);
    const publicDuration = await videoDuration(publicVideoPath);
    const reviewedFrameCount = await videoFrameCount(publicVideoPath);
    const evidence = await extractReviewImages(
      publicVideoPath,
      [],
      reviewedFrameCount,
      temporary,
    );
    if (
      publicDuration !== 13 ||
      evidence.reviewedFrameCount !== 26 ||
      evidence.reviewedContactSheetCount !== 3 ||
      evidence.images.length !== 3
    ) {
      fail("dense timeline extraction self-test produced unexpected coverage");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === "--self-test") {
    await selfTest();
    console.log("trusted video audit self-test passed");
    return;
  }
  if (process.argv.length !== 7) {
    fail(
      `Usage: ${process.argv[1]} <manifest.json> <evidence-root> <audit-output.json> <public-video.mp4> <model>`,
    );
  }
  await review({
    manifestPath: process.argv[2],
    evidenceRoot: process.argv[3],
    outputPath: process.argv[4],
    publicVideoPath: process.argv[5],
    model: process.argv[6],
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

main().catch((error) => {
  console.error(`trusted-video-audit: ${error.message}`);
  process.exit(1);
});
