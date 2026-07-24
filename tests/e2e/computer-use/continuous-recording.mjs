import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tryRun } from "./process-utils.mjs";

export const CONTINUOUS_RECORDING_KIND = "continuous-screen-recording";
export const SCREENSHOT_REEL_KIND = "derived-screenshot-reel";

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fractionToNumber(value) {
  if (typeof value !== "string" || !value) return numeric(value);
  const [numerator, denominator] = value.split("/").map(Number);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
    return numerator / denominator;
  }
  return numeric(value);
}

function isoMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function mediaToolEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  delete sanitized.LD_LIBRARY_PATH;
  delete sanitized.FONTCONFIG_FILE;
  return sanitized;
}

function runMediaTool(run, command, args) {
  return run(command, args, { env: mediaToolEnvironment() });
}

function frameHash(stdout) {
  const match = stdout.match(/,\s*([a-f0-9]{32,})\s*$/im);
  return match?.[1] || "";
}

function recordingTimelineIssue(state, metadata) {
  const captureStart = isoMs(metadata.startedAt);
  const captureEnd = isoMs(metadata.endedAt);
  const runStart = isoMs(state.startedAt);
  const eventTimes = (state.events || []).map((event) => isoMs(event.ts)).filter(Number.isFinite);
  const lastEvent = eventTimes.length ? Math.max(...eventTimes) : runStart;
  if (captureStart === null || captureEnd === null) {
    return "recording metadata is missing valid startedAt/endedAt timestamps";
  }
  if (captureEnd <= captureStart) return "recording endedAt is not after startedAt";
  if (runStart !== null && captureStart > runStart) {
    return "recording started after the Computer Use run began";
  }
  if (lastEvent !== null && captureEnd < lastEvent) {
    return "recording ended before the final recorded Computer Use event";
  }
  return "";
}

export function inspectContinuousRecording(
  state,
  { relativePath, metadata, run = tryRun, minimumDurationSeconds = 5, minimumUniqueSamples = 2 },
) {
  if (!relativePath) return { ok: false, issue: "continuous recording path is empty" };
  const fullPath = path.resolve(state.runDir, relativePath);
  if (!existsSync(fullPath)) return { ok: false, issue: "continuous recording file is missing" };
  const stats = statSync(fullPath);
  if (!stats.isFile() || stats.size < 1024) {
    return { ok: false, issue: "continuous recording file is empty or too small" };
  }
  if (metadata?.captureMethod !== "ffmpeg-avfoundation-terminal-gui") {
    return {
      ok: false,
      issue: `unexpected capture method: ${metadata?.captureMethod || "missing"}`,
    };
  }
  if (metadata?.status && metadata.status !== "available") {
    return {
      ok: false,
      issue: `recording metadata reports ${metadata.status}`,
    };
  }
  const timelineIssue = recordingTimelineIssue(state, metadata || {});
  if (timelineIssue) return { ok: false, issue: timelineIssue };

  const probe = runMediaTool(run, "ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate:format=duration",
    "-of",
    "json",
    fullPath,
  ]);
  if (!probe.ok) {
    return {
      ok: false,
      issue: `ffprobe could not inspect the continuous recording: ${probe.stderr || probe.error}`,
    };
  }

  let probeJson;
  try {
    probeJson = JSON.parse(probe.stdout);
  } catch {
    return { ok: false, issue: "ffprobe returned malformed JSON for the continuous recording" };
  }
  const stream = probeJson.streams?.[0] || {};
  const durationSeconds = numeric(probeJson.format?.duration);
  const width = numeric(stream.width);
  const height = numeric(stream.height);
  const framesPerSecond = fractionToNumber(stream.avg_frame_rate);
  if (durationSeconds < minimumDurationSeconds) {
    return {
      ok: false,
      issue: `continuous recording is too short (${durationSeconds.toFixed(2)}s)`,
    };
  }
  const captureSpanSeconds = (isoMs(metadata.endedAt) - isoMs(metadata.startedAt)) / 1000;
  if (durationSeconds + 5 < captureSpanSeconds) {
    return {
      ok: false,
      issue: `continuous recording covers only ${durationSeconds.toFixed(2)}s of the ${captureSpanSeconds.toFixed(2)}s capture timeline`,
    };
  }
  if (width < 640 || height < 360 || framesPerSecond < 1) {
    return {
      ok: false,
      issue: `continuous recording dimensions/frame rate are invalid (${width}x${height} at ${framesPerSecond.toFixed(2)}fps)`,
    };
  }

  const sampleTimes = [
    Math.min(1, durationSeconds / 10),
    durationSeconds * 0.25,
    durationSeconds * 0.5,
    durationSeconds * 0.75,
    Math.max(0, durationSeconds - 1),
  ];
  const hashes = sampleTimes
    .map((seconds) =>
      runMediaTool(run, "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        seconds.toFixed(3),
        "-i",
        fullPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=64:64,format=gray",
        "-f",
        "framemd5",
        "-",
      ]),
    )
    .filter((result) => result.ok)
    .map((result) => frameHash(result.stdout))
    .filter(Boolean);
  const uniqueSampleHashes = [...new Set(hashes)];
  if (hashes.length < 3 || uniqueSampleHashes.length < minimumUniqueSamples) {
    return {
      ok: false,
      issue: `continuous recording lacks changing visual samples (${hashes.length} sampled, ${uniqueSampleHashes.length} unique)`,
    };
  }

  return {
    ok: true,
    fullPath,
    durationSeconds,
    width,
    height,
    framesPerSecond,
    bytes: stats.size,
    sha256: fileSha256(fullPath),
    sampledFrames: hashes.length,
    uniqueSampleHashes: uniqueSampleHashes.length,
    sampleTimes,
  };
}

async function extractSampleFrames(state, inspection, run = tryRun) {
  const videoDir = path.join(state.runDir, "video");
  await mkdir(videoDir, { recursive: true });
  const candidates = [
    ["continuous-start", inspection.sampleTimes[0]],
    ["continuous-middle", inspection.sampleTimes[2]],
    ["continuous-end", inspection.sampleTimes[4]],
  ];
  const samples = [];
  for (const [label, seconds] of candidates) {
    const relativePath = `video/${label}.png`;
    const outputPath = path.join(state.runDir, relativePath);
    const result = runMediaTool(run, "ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      seconds.toFixed(3),
      "-i",
      inspection.fullPath,
      "-frames:v",
      "1",
      outputPath,
    ]);
    if (result.ok && existsSync(outputPath) && statSync(outputPath).size > 0) {
      samples.push({ label, path: relativePath, seconds });
    }
  }
  return samples;
}

export async function attachContinuousRecording(
  state,
  { relativePath, metadata, run = tryRun, extractSamples = true },
) {
  const inspection = inspectContinuousRecording(state, { relativePath, metadata, run });
  const priorVideo = state.video;
  if (priorVideo?.kind === SCREENSHOT_REEL_KIND || /screenshot/i.test(priorVideo?.note || "")) {
    state.derivedVideo = {
      ...priorVideo,
      kind: SCREENSHOT_REEL_KIND,
      note:
        priorVideo.note ||
        "Derived screenshot reel retained as a secondary scanning aid; it is not continuous evidence.",
    };
  }
  if (!inspection.ok) {
    state.video = {
      status: "unavailable",
      kind: CONTINUOUS_RECORDING_KIND,
      note: `Continuous remote-Mac recording is not usable: ${inspection.issue}.`,
      captureMethod: metadata?.captureMethod || "",
      startedAt: metadata?.startedAt || "",
      endedAt: metadata?.endedAt || "",
    };
    return inspection;
  }

  const sampleFrames = extractSamples ? await extractSampleFrames(state, inspection, run) : [];
  if (extractSamples && sampleFrames.length !== 3) {
    const failedInspection = {
      ...inspection,
      ok: false,
      issue: `continuous recording sample extraction produced ${sampleFrames.length}/3 frames`,
    };
    state.video = {
      status: "unavailable",
      kind: CONTINUOUS_RECORDING_KIND,
      note: `Continuous remote-Mac recording is not usable: ${failedInspection.issue}.`,
      captureMethod: metadata?.captureMethod || "",
      startedAt: metadata?.startedAt || "",
      endedAt: metadata?.endedAt || "",
    };
    return failedInspection;
  }
  state.video = {
    status: "available",
    kind: CONTINUOUS_RECORDING_KIND,
    path: relativePath,
    captureMethod: metadata.captureMethod,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
    durationSeconds: inspection.durationSeconds,
    width: inspection.width,
    height: inspection.height,
    framesPerSecond: inspection.framesPerSecond,
    bytes: inspection.bytes,
    sha256: inspection.sha256,
    sampledFrames: inspection.sampledFrames,
    uniqueSampleHashes: inspection.uniqueSampleHashes,
    sampleFrames,
    note: "Continuous remote macOS GUI recording captured through Terminal's Screen Recording permission using ffmpeg AVFoundation.",
  };
  return inspection;
}

export async function readRecordingMetadata(metadataPath) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  return metadata;
}

export async function runContinuousRecordingSelfTest() {
  const now = Date.now();
  const state = {
    runDir: `/tmp/continuous-recording-self-test-${now}`,
    startedAt: new Date(now).toISOString(),
    events: [{ ts: new Date(now + 2_000).toISOString(), type: "click" }],
    video: {
      status: "available",
      kind: SCREENSHOT_REEL_KIND,
      path: "video/screenshot-reel.mp4",
      note: "Screenshot-compilation video.",
    },
  };
  const metadata = {
    captureMethod: "ffmpeg-avfoundation-terminal-gui",
    startedAt: new Date(now - 2_000).toISOString(),
    endedAt: new Date(now + 4_000).toISOString(),
  };
  const calls = [];
  const fakeRun = (command, args, options) => {
    calls.push([command, args, options]);
    if (command === "ffprobe") {
      return {
        ok: true,
        stdout: JSON.stringify({
          streams: [{ width: 1280, height: 720, avg_frame_rate: "20/1" }],
          format: { duration: "6.0" },
        }),
        stderr: "",
      };
    }
    const second = Number(args[args.indexOf("-ss") + 1] || 0);
    return {
      ok: true,
      stdout: `#format: frame checksums\n0, 0, 0, 1, 1, ${second < 2 ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`,
      stderr: "",
    };
  };
  const exists = existsSync;
  assert.equal(typeof exists, "function");
  assert.equal(
    recordingTimelineIssue(state, metadata),
    "",
    "capture should span the Computer Use event timeline",
  );
  assert.match(
    recordingTimelineIssue(state, { ...metadata, startedAt: new Date(now + 1_000).toISOString() }),
    /started after/,
    "late capture should be rejected",
  );
  assert.equal(fractionToNumber("30000/1001") > 29, true, "fractional frame rate should parse");
  assert.deepEqual(
    mediaToolEnvironment({
      PATH: "/usr/bin",
      LD_LIBRARY_PATH: "/nix/store/incompatible-glibc",
      FONTCONFIG_FILE: "/nix/store/incompatible-fontconfig",
    }),
    { PATH: "/usr/bin" },
    "host media tools must not inherit Nix runtime library or fontconfig overrides",
  );
  assert.equal(
    frameHash("0, 0, 0, 1, 1, abcdefabcdefabcdefabcdefabcdefab"),
    "abcdefabcdefabcdefabcdefabcdefab",
  );
  await mkdir(path.join(state.runDir, "video"), { recursive: true });
  await writeFile(path.join(state.runDir, "video", "continuous.mp4"), Buffer.alloc(2048, 1));
  const inspection = inspectContinuousRecording(state, {
    relativePath: "video/continuous.mp4",
    metadata,
    run: fakeRun,
  });
  assert.equal(inspection.ok, true, inspection.issue);
  assert.equal(inspection.uniqueSampleHashes, 2);
  assert.match(
    inspectContinuousRecording(state, {
      relativePath: "video/continuous.mp4",
      metadata: { ...metadata, endedAt: new Date(now + 20_000).toISOString() },
      run: fakeRun,
    }).issue,
    /covers only/,
    "a partial video must not qualify as evidence for a longer capture timeline",
  );
  await attachContinuousRecording(state, {
    relativePath: "video/continuous.mp4",
    metadata,
    run: fakeRun,
    extractSamples: false,
  });
  assert.equal(state.video.kind, CONTINUOUS_RECORDING_KIND);
  assert.equal(state.video.status, "available");
  assert.equal(state.derivedVideo.kind, SCREENSHOT_REEL_KIND);
  assert.equal(
    calls.some(([command]) => command === "ffprobe"),
    true,
  );
  assert.equal(
    calls.every(([, , options]) => {
      return !("LD_LIBRARY_PATH" in options.env) && !("FONTCONFIG_FILE" in options.env);
    }),
    true,
    "every ffmpeg/ffprobe child must use the sanitized host-tool environment",
  );
  console.log("Continuous recording self-test passed.");
}
