#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AUDIT_SCHEMA = "nixmac.e2e.semantic-audit.v3";
const REVIEWER = "GitHub Actions protected vision review";
const REVIEWER_KIND = "github-actions-protected-vision-review";

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
    decision.terminalStateVisible !== true
  ) {
    fail(`trusted vision review could not verify the required semantics: ${decision.rationale}`);
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
  return requireFiniteNumber(Number(stdout.trim()), "video duration", { min: 0.01, max: 600 });
}

function reviewTimes(durationSeconds) {
  const candidates = [0];
  for (let second = 1; second <= Math.min(15, durationSeconds); second += 3) {
    candidates.push(second);
  }
  for (let fraction = 0.1; fraction < 1; fraction += 0.1) {
    candidates.push(durationSeconds * fraction);
  }
  for (const offset of [9, 6, 3, 1]) {
    candidates.push(Math.max(0, durationSeconds - offset));
  }
  return [
    ...new Set(
      candidates
        .filter((second) => second < durationSeconds)
        .map((second) => Math.round(second * 10) / 10),
    ),
  ].sort((left, right) => left - right);
}

async function extractReviewImages(videoPath, screenshotPaths, durationSeconds, outputDir) {
  const images = [];
  for (const [index, second] of reviewTimes(durationSeconds).entries()) {
    const output = path.join(outputDir, `video-${String(index).padStart(2, "0")}.jpg`);
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-ss",
      second.toFixed(1),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=512:-2",
      "-q:v",
      "5",
      output,
    ]);
    images.push({ label: `Video frame at ${second.toFixed(1)} seconds`, path: output });
  }
  for (const [index, screenshotPath] of screenshotPaths.entries()) {
    const output = path.join(outputDir, `screenshot-${String(index).padStart(2, "0")}.jpg`);
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-i",
      screenshotPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=768:-2",
      "-q:v",
      "5",
      output,
    ]);
    images.push({ label: `Curated evidence screenshot ${index + 1}`, path: output });
  }
  return images;
}

async function imageContent(images) {
  const content = [];
  for (const image of images) {
    const buffer = await readFile(image.path);
    if (buffer.length > 2 * 1024 * 1024) fail(`review image is too large: ${image.label}`);
    content.push({ type: "text", text: image.label });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` },
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
    "Inspect every supplied frame in chronological order. Fail closed if frames are unrelated,",
    "the changed behavior is not visible, the timeline is incoherent, or the terminal state is absent.",
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
      firstMeaningfulActionSeconds: { type: "number" },
      terminalStateVisibleSeconds: { type: "number" },
      rationale: { type: "string" },
    },
    required: [
      "verdict",
      "changedBehaviorVisible",
      "timelineCoherent",
      "terminalStateVisible",
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

async function review({ manifestPath, evidenceRoot, outputPath, model, apiKey }) {
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
  const videoBuffer = await readFile(videoPath);
  if (sha256(videoBuffer) !== manifest.evidence.video.sha256) {
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
  const durationSeconds = await videoDuration(videoPath);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nixmac-video-audit-"));
  try {
    const images = await extractReviewImages(
      videoPath,
      screenshotPaths,
      durationSeconds,
      temporary,
    );
    if (images.length < 5 || images.length > 30) fail("unexpected trusted review frame count");
    const decision = validateDecision(
      await requestDecision({ apiKey, model, manifest, images, durationSeconds }),
      durationSeconds,
    );
    const audit = {
      schemaVersion: AUDIT_SCHEMA,
      reviewer: REVIEWER,
      reviewerKind: REVIEWER_KIND,
      reviewScope:
        "Independent protected vision inspection of the decoded full-video timeline and curated screenshots",
      reviewToolSha: process.env.REPORT_TOOL_SHA,
      reviewRunId: Number(process.env.GITHUB_RUN_ID),
      reviewRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      reviewModel: model,
      reviewedFrameCount: images.length,
      videoSha256: manifest.evidence.video.sha256,
      status: "pass",
      firstMeaningfulActionSeconds: decision.firstMeaningfulActionSeconds,
      watchedStartToFinish: true,
      terminalStateVisible: true,
      terminalStateVisibleSeconds: decision.terminalStateVisibleSeconds,
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

function selfTest() {
  const pass = validateDecision(
    {
      verdict: "pass",
      changedBehaviorVisible: true,
      timelineCoherent: true,
      terminalStateVisible: true,
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
}

async function main() {
  if (process.argv[2] === "--self-test") {
    selfTest();
    console.log("trusted video audit self-test passed");
    return;
  }
  if (process.argv.length !== 6) {
    fail(`Usage: ${process.argv[1]} <manifest.json> <evidence-root> <output.json> <model>`);
  }
  await review({
    manifestPath: process.argv[2],
    evidenceRoot: process.argv[3],
    outputPath: process.argv[4],
    model: process.argv[5],
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

main().catch((error) => {
  console.error(`trusted-video-audit: ${error.message}`);
  process.exit(1);
});
