import path from 'node:path';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VECTOR_WIDTH = Number(process.env.NIXMAC_E2E_VISUAL_VECTOR_WIDTH ?? 24);
const VECTOR_HEIGHT = Number(process.env.NIXMAC_E2E_VISUAL_VECTOR_HEIGHT ?? 14);
const CHANGE_THRESHOLD = Number(process.env.NIXMAC_E2E_VISUAL_CHANGE_THRESHOLD ?? 0.035);
const LARGE_CHANGE_THRESHOLD = Number(process.env.NIXMAC_E2E_VISUAL_LARGE_CHANGE_THRESHOLD ?? 0.16);
const MAX_SELECTED_FRAMES = Number(process.env.NIXMAC_E2E_VISUAL_MAX_FRAMES ?? 14);
const MAX_VIDEO_SAMPLE_FRAMES = Number(process.env.NIXMAC_E2E_VISUAL_MAX_SAMPLE_FRAMES ?? 160);
const VIDEO_SAMPLE_INTERVAL_SEC = Number(process.env.NIXMAC_E2E_VISUAL_SAMPLE_INTERVAL_SEC ?? 2);
const VIDEO_SAMPLE_WIDTH = Number(process.env.NIXMAC_E2E_VISUAL_SAMPLE_WIDTH ?? 960);

function sanitizeSegment(value) {
  return String(value || 'frame').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'frame';
}

function toPosixRelative(filePath, root) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

async function commandAvailable(command) {
  try {
    await execFileAsync(command, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function readImageVector(imagePath) {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      imagePath,
      '-vf',
      `scale=${VECTOR_WIDTH}:${VECTOR_HEIGHT}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    {
      encoding: 'buffer',
      maxBuffer: VECTOR_WIDTH * VECTOR_HEIGHT + 4096,
      timeout: 10000,
    },
  );

  return Buffer.from(stdout);
}

async function probeMediaDimensions(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 10000 },
    );
    const stream = JSON.parse(stdout).streams?.[0] ?? {};
    return {
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      durationMs: Math.round((Number(stream.duration) || 0) * 1000),
    };
  } catch {
    return { width: 0, height: 0, durationMs: 0 };
  }
}

function vectorStats(vector) {
  if (!vector.length) {
    return { brightness: 0, contrast: 0, edgeScore: 0 };
  }

  let sum = 0;
  for (const value of vector) {
    sum += value;
  }
  const mean = sum / vector.length;

  let varianceSum = 0;
  for (const value of vector) {
    varianceSum += (value - mean) ** 2;
  }

  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < VECTOR_HEIGHT; y += 1) {
    for (let x = 0; x < VECTOR_WIDTH; x += 1) {
      const index = y * VECTOR_WIDTH + x;
      if (x + 1 < VECTOR_WIDTH) {
        edgeSum += Math.abs(vector[index] - vector[index + 1]);
        edgeCount += 1;
      }
      if (y + 1 < VECTOR_HEIGHT) {
        edgeSum += Math.abs(vector[index] - vector[index + VECTOR_WIDTH]);
        edgeCount += 1;
      }
    }
  }

  return {
    brightness: mean / 255,
    contrast: Math.sqrt(varianceSum / vector.length) / 255,
    edgeScore: edgeCount > 0 ? edgeSum / edgeCount / 255 : 0,
  };
}

function vectorDifference(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return null;
  }

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length / 255;
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function observationsForFrame(frame, { isLateFrame = false } = {}) {
  const observations = [];
  const { brightness, contrast, edgeScore } = frame;

  if ((brightness < 0.08 || brightness > 0.94) && contrast < 0.035) {
    observations.push('mostly blank or single-color frame');
  } else if (contrast < 0.045) {
    observations.push('low-contrast frame');
  }

  if (edgeScore < 0.012 && contrast < 0.08) {
    observations.push('low-detail frame');
  }

  if ((frame.changeScore ?? 0) >= LARGE_CHANGE_THRESHOLD) {
    observations.push('large visual change from previous sample');
  }

  if (isLateFrame) {
    observations.push('late-flow frame');
  }

  return observations.length ? observations : ['stable visual state'];
}

function noteForFrame(frame) {
  const seconds = ((frame.timestampMs ?? 0) / 1000).toFixed(1);
  const label = frame.label ? `, label "${frame.label}"` : '';
  return `Selected at ${seconds}s${label}; ${frame.observations.join('; ')}.`;
}

function selectFrameCandidates(analyzedFrames) {
  if (analyzedFrames.length <= 1) {
    return analyzedFrames;
  }

  const lastIndex = analyzedFrames.length - 1;
  const middle = analyzedFrames
    .filter((frame) => frame.sampleIndex > 0 && frame.sampleIndex < lastIndex)
    .filter((frame) => (frame.changeScore ?? 0) >= CHANGE_THRESHOLD)
    .sort((a, b) => (b.changeScore ?? 0) - (a.changeScore ?? 0));

  return [analyzedFrames[0], ...middle, analyzedFrames[lastIndex]]
    .filter(
      (frame, index, all) =>
        all.findIndex((candidate) => candidate.sampleIndex === frame.sampleIndex) === index,
    )
    .sort((a, b) => a.sampleIndex - b.sampleIndex);
}

function capSelectedFrames(selected, maxFrames) {
  if (selected.length <= maxFrames) {
    return selected;
  }

  const first = selected[0];
  const last = selected.at(-1);
  const middle = selected
    .slice(1, -1)
    .sort((a, b) => (b.changeScore ?? 0) - (a.changeScore ?? 0))
    .slice(0, Math.max(0, maxFrames - 2));

  return [first, ...middle, last].sort((a, b) => a.sampleIndex - b.sampleIndex);
}

function selectFrames(analyzedFrames, options = {}) {
  return capSelectedFrames(selectFrameCandidates(analyzedFrames), options.maxFrames ?? MAX_SELECTED_FRAMES);
}

async function analyzeImageSequence({
  frames,
  artifactDir,
  artifactRoot,
  outputSubdir,
  source,
  phase,
  durationMs,
}) {
  const warnings = [];
  if (!frames.length) {
    return {
      schemaVersion: 1,
      status: 'skipped',
      source,
      phase,
      reason: 'no frames available',
      frames: [],
      warnings,
    };
  }

  if (!(await commandAvailable('ffmpeg'))) {
    return {
      schemaVersion: 1,
      status: 'skipped',
      source,
      phase,
      reason: 'ffmpeg unavailable',
      frames: [],
      warnings,
    };
  }

  const analyzedFrames = [];
  let previousVector = null;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    try {
      const vector = await readImageVector(frame.path);
      const dimensions = await probeMediaDimensions(frame.path);
      const stats = vectorStats(vector);
      const changeScore = vectorDifference(previousVector, vector);
      previousVector = vector;
      analyzedFrames.push({
        ...frame,
        sampleIndex: i,
        vector,
        changeScore,
        width: dimensions.width,
        height: dimensions.height,
        ...stats,
      });
    } catch (error) {
      warnings.push(
        `Skipped frame ${i}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!analyzedFrames.length) {
    return {
      schemaVersion: 1,
      status: 'skipped',
      source,
      phase,
      reason: 'all frame analysis failed',
      frames: [],
      warnings,
    };
  }

  const outputDir = path.join(artifactDir, 'visual-analysis', sanitizeSegment(outputSubdir));
  await mkdir(outputDir, { recursive: true });

  const selected = selectFrames(analyzedFrames);
  const selectedFrames = [];

  for (let order = 0; order < selected.length; order += 1) {
    const frame = selected[order];
    const label = sanitizeSegment(frame.label || `t-${Math.round(frame.timestampMs ?? 0)}ms`);
    const outputPath = path.join(outputDir, `frame-${String(order).padStart(3, '0')}-${label}.png`);
    await copyFile(frame.path, outputPath);

    const timestampMs = Math.max(0, Math.round(frame.timestampMs ?? 0));
    const isLateFrame =
      order === selected.length - 1 ||
      (Number.isFinite(durationMs) && durationMs > 0 && timestampMs / durationMs >= 0.8);
    const serializableFrame = {
      index: order,
      sampleIndex: frame.sampleIndex,
      path: toPosixRelative(outputPath, artifactRoot),
      url: null,
      thumbnailUrl: null,
      timestampMs,
      label: frame.label ?? null,
      changeScore: roundMetric(frame.changeScore),
      brightness: roundMetric(frame.brightness),
      contrast: roundMetric(frame.contrast),
      edgeScore: roundMetric(frame.edgeScore),
      width: frame.width,
      height: frame.height,
      observations: observationsForFrame(frame, { isLateFrame }),
      note: '',
    };
    serializableFrame.note = noteForFrame(serializableFrame);
    selectedFrames.push(serializableFrame);
  }

  return {
    schemaVersion: 1,
    status: 'completed',
    source,
    phase,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    sampleCount: analyzedFrames.length,
    selectedFrameCount: selectedFrames.length,
    changeThreshold: CHANGE_THRESHOLD,
    maxSelectedFrames: MAX_SELECTED_FRAMES,
    frames: selectedFrames,
    warnings,
  };
}

export async function analyzeImageFramesForProof({
  frames,
  artifactDir,
  artifactRoot = path.dirname(artifactDir),
  phase,
  proofSlug,
  durationMs,
}) {
  return analyzeImageSequence({
    frames,
    artifactDir,
    artifactRoot,
    outputSubdir: proofSlug || phase || 'wdio-source-frames',
    source: 'wdio-source-frames',
    phase,
    durationMs,
  });
}

async function extractVideoSamples({ videoPath, outputDir, durationMs }) {
  const sampleDir = path.join(outputDir, 'samples');
  await rm(sampleDir, { recursive: true, force: true });
  await mkdir(sampleDir, { recursive: true });

  const durationSec = Math.max(0, (durationMs ?? 0) / 1000);
  const effectiveIntervalSec =
    durationSec > 0
      ? Math.max(VIDEO_SAMPLE_INTERVAL_SEC, durationSec / Math.max(1, MAX_VIDEO_SAMPLE_FRAMES - 1))
      : VIDEO_SAMPLE_INTERVAL_SEC;
  const sampleFps = 1 / effectiveIntervalSec;
  const pattern = path.join(sampleDir, 'sample-%05d.png');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-vf',
      `fps=${sampleFps},scale=${VIDEO_SAMPLE_WIDTH}:-2:flags=lanczos`,
      '-frames:v',
      String(MAX_VIDEO_SAMPLE_FRAMES),
      pattern,
    ],
    { timeout: 120000 },
  );

  const entries = (await readdir(sampleDir))
    .filter((entry) => entry.endsWith('.png') && entry.startsWith('sample-'))
    .sort();
  const frames = entries.map((entry, index) => ({
    path: path.join(sampleDir, entry),
    timestampMs: Math.round(index * effectiveIntervalSec * 1000),
    label: `sample-${index}`,
  }));

  if (durationSec > 0) {
    const finalPath = path.join(sampleDir, 'sample-final.png');
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(Math.max(0, durationSec - 0.2)),
          '-i',
          videoPath,
          '-frames:v',
          '1',
          '-vf',
          `scale=${VIDEO_SAMPLE_WIDTH}:-2:flags=lanczos`,
          finalPath,
        ],
        { timeout: 30000 },
      );
      frames.push({
        path: finalPath,
        timestampMs: Math.round(durationSec * 1000),
        label: 'final',
      });
    } catch {
      // The sampled sequence is still useful without a separately-seeked final frame.
    }
  }

  return { frames, sampleDir };
}

export async function analyzeVideoProof({ proof, artifactDir, artifactRoot = path.dirname(artifactDir) }) {
  if (!proof || proof.kind !== 'video' || !proof.path) {
    return null;
  }

  if (proof.visualAnalysis?.schemaVersion === 1) {
    return proof.visualAnalysis;
  }

  if (!(await commandAvailable('ffmpeg')) || !(await commandAvailable('ffprobe'))) {
    return {
      schemaVersion: 1,
      status: 'skipped',
      source: 'video-sampling',
      phase: proof.phase,
      reason: 'ffmpeg or ffprobe unavailable',
      frames: [],
      warnings: [],
    };
  }

  const videoPath = path.isAbsolute(proof.path) ? proof.path : path.join(artifactRoot, proof.path);
  const videoMetadata = await probeMediaDimensions(videoPath);
  const outputSubdir = sanitizeSegment(
    `${proof.phase || 'video'}-${path.basename(videoPath, path.extname(videoPath))}`,
  );
  const outputDir = path.join(artifactDir, 'visual-analysis', outputSubdir);

  try {
    const { frames, sampleDir } = await extractVideoSamples({
      videoPath,
      outputDir,
      durationMs: videoMetadata.durationMs,
    });
    const analysis = await analyzeImageSequence({
      frames,
      artifactDir,
      artifactRoot,
      outputSubdir,
      source: 'video-sampling',
      phase: proof.phase,
      durationMs: videoMetadata.durationMs,
    });
    await rm(sampleDir, { recursive: true, force: true });
    return analysis;
  } catch (error) {
    return {
      schemaVersion: 1,
      status: 'skipped',
      source: 'video-sampling',
      phase: proof.phase,
      reason: error instanceof Error ? error.message : String(error),
      frames: [],
      warnings: [],
    };
  }
}

function proofKey(proof) {
  return [proof?.kind, proof?.phase, proof?.path].map((value) => String(value ?? '')).join('|');
}

export async function analyzeReportVisualProofs(report, { artifactRoot, artifactDir }) {
  let changed = false;
  const topLevelProof = Array.isArray(report.proof) ? report.proof : [];
  const phaseProofByKey = new Map();

  for (const phase of report.phases ?? []) {
    for (const proof of phase.proof ?? []) {
      phaseProofByKey.set(proofKey(proof), proof);
    }
  }

  for (const proof of topLevelProof) {
    if (proof.kind !== 'video') continue;
    if (proof.visualAnalysis?.schemaVersion === 1) continue;

    const visualAnalysis = await analyzeVideoProof({ proof, artifactDir, artifactRoot });
    if (!visualAnalysis) continue;

    proof.visualAnalysis = visualAnalysis;
    const phaseProof = phaseProofByKey.get(proofKey(proof));
    if (phaseProof) {
      phaseProof.visualAnalysis = visualAnalysis;
    }
    changed = true;
  }

  return { report, changed };
}
