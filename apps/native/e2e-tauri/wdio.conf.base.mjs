import path from 'node:path';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  setupNixmacTestEnvironment,
  teardownNixmacTestEnvironment,
} from './tests/wdio/helpers/test-env.mjs';
import {
  createE2eReportContext,
  recordE2eCaptureLimitation,
  recordE2ePhase,
  resetE2eReportContext,
  writeE2eReport,
} from './tests/wdio/helpers/e2e-report.mjs';
import { analyzeImageFramesForProof } from './scripts/visual-analysis.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '..');
const execFileAsync = promisify(execFile);
const VIDEO_FRAME_INTERVAL_MS = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_INTERVAL_MS ?? 750);
const VIDEO_CAPTURE_TIMEOUT_MS = Number(process.env.NIXMAC_E2E_VIDEO_CAPTURE_TIMEOUT_MS ?? 8000);
const VIDEO_MAX_FRAMES = Number(process.env.NIXMAC_E2E_VIDEO_MAX_FRAMES ?? 600);
const VIDEO_OUTPUT_FPS = Number(process.env.NIXMAC_E2E_VIDEO_OUTPUT_FPS ?? 20);
const VIDEO_CAPTURE_PIXEL_RATIO = Number(process.env.NIXMAC_E2E_VIDEO_CAPTURE_PIXEL_RATIO ?? 1.5);
const VIDEO_FRAME_HOLD_MIN_MS = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_HOLD_MIN_MS ?? 200);
const VIDEO_FRAME_HOLD_MAX_MS = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_HOLD_MAX_MS ?? 2000);
const VIDEO_FINAL_FRAME_HOLD_MS = Number(process.env.NIXMAC_E2E_VIDEO_FINAL_FRAME_HOLD_MS ?? 1000);
const VIDEO_MAX_DURATION_MS = Number(process.env.NIXMAC_E2E_VIDEO_MAX_DURATION_MS ?? 30000);
const VIDEO_MIN_VALID_DURATION_MS = Number(process.env.NIXMAC_E2E_VIDEO_MIN_VALID_DURATION_MS ?? 1000);
const VIDEO_MIN_VALID_SIZE_BYTES = Number(process.env.NIXMAC_E2E_VIDEO_MIN_VALID_SIZE_BYTES ?? 50000);
const VIDEO_MIN_VALID_FRAMES = Number(process.env.NIXMAC_E2E_VIDEO_MIN_VALID_FRAMES ?? 8);
const VIDEO_MAX_CONSECUTIVE_FRAME_ERRORS = Number(
  process.env.NIXMAC_E2E_VIDEO_MAX_CONSECUTIVE_FRAME_ERRORS ?? 3,
);
const PROOF_CONTENT_THRESHOLD = Number(process.env.NIXMAC_E2E_PROOF_CONTENT_THRESHOLD ?? 16);
const PROOF_CONTENT_CROP_PADDING = Number(process.env.NIXMAC_E2E_PROOF_CONTENT_CROP_PADDING ?? 28);
const PROOF_CONTENT_MIN_CROP_WIDTH = Number(process.env.NIXMAC_E2E_PROOF_CONTENT_MIN_CROP_WIDTH ?? 360);
const PROOF_CONTENT_MIN_CROP_HEIGHT = Number(process.env.NIXMAC_E2E_PROOF_CONTENT_MIN_CROP_HEIGHT ?? 260);
const LEGACY_WEBVIEW_PROOF_DISABLED = process.env.NIXMAC_E2E_VIDEO === '0';
const WEBVIEW_FRAME_TIMELINE_ENABLED =
  !LEGACY_WEBVIEW_PROOF_DISABLED && process.env.NIXMAC_E2E_FRAME_TIMELINE !== '0';
const WEBVIEW_VIDEO_ENABLED =
  !LEGACY_WEBVIEW_PROOF_DISABLED && process.env.NIXMAC_E2E_WEBVIEW_VIDEO === '1';
const USE_DOM_PROOF_CAPTURE = process.env.NIXMAC_E2E_DOM_PROOF_CAPTURE !== '0';
const PROOF_TARGET_SELECTORS = [
  '[data-testid="feedback-dialog"]',
  '[data-testid="settings-dialog"]',
  '[data-testid="confirmation-dialog"]',
  '[data-testid="discard-uncommitted-dialog"]',
  '[data-testid="begin-evolve-warning"]',
  '[data-testid="history-step"]',
  '[data-testid="evolve-proof-region"]',
  '[data-testid="setup-step"]',
  '[data-testid="prompt-input-section"]',
  '[data-testid="widget-shell"]',
];

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function createVideoRecorder({ context, testTitle }) {
  const slug = sanitizeSegment(testTitle || 'test');
  const startedAt = Date.now();
  const frameDir = path.join(context.artifactDir, `proof-frames-${slug}`);
  const videoPath = path.join(context.artifactDir, `recording-${slug}-${startedAt}.mp4`);

  return {
    disabled: !WEBVIEW_FRAME_TIMELINE_ENABLED && !WEBVIEW_VIDEO_ENABLED,
    error: null,
    consecutiveFrameErrors: 0,
    frameCount: 0,
    frameDir,
    frames: [],
    lastFrameAt: 0,
    phase: testTitle,
    saving: false,
    slug,
    startedAt,
    videoPath,
  };
}

async function captureVideoFrame(recorder, label = 'frame') {
  if (
    !recorder ||
    recorder.disabled ||
    recorder.saving ||
    recorder.frameCount >= VIDEO_MAX_FRAMES ||
    !globalThis.browser?.saveScreenshot
  ) {
    return;
  }

  recorder.saving = true;
  try {
    await mkdir(recorder.frameDir, { recursive: true });
    const framePath = path.join(
      recorder.frameDir,
      `frame-${String(recorder.frameCount).padStart(5, '0')}-${sanitizeSegment(label)}.png`,
    );
    const capturedAtMs = Date.now();
    await withTimeout(
      saveVideoFrameScreenshot(framePath),
      VIDEO_CAPTURE_TIMEOUT_MS,
      `Timed out capturing E2E video frame after ${VIDEO_CAPTURE_TIMEOUT_MS}ms`,
    );
    recorder.frameCount += 1;
    recorder.frames.push({ path: framePath, capturedAtMs, label });
    recorder.consecutiveFrameErrors = 0;
    recorder.lastFrameAt = capturedAtMs;
  } catch (error) {
    recorder.error = error instanceof Error ? error.message : String(error);
    recorder.consecutiveFrameErrors += 1;
    console.warn(`[wdio:e2e-video] Skipped video frame: ${recorder.error}`);
    if (recorder.consecutiveFrameErrors >= VIDEO_MAX_CONSECUTIVE_FRAME_ERRORS) {
      // Video capture is proof infrastructure, not the scenario assertion itself.
      // Keep screenshots and functional assertions authoritative if capture degrades.
      recorder.disabled = true;
      console.warn(
        `[wdio:e2e-video] Disabled video capture after ${recorder.consecutiveFrameErrors} consecutive frame errors`,
      );
    }
  } finally {
    recorder.saving = false;
  }
}

async function saveVideoFrameScreenshot(outputPath) {
  await saveProofScreenshot(outputPath, {
    includeAnnotations: true,
    pixelRatio: VIDEO_CAPTURE_PIXEL_RATIO,
  });
}

async function saveProofScreenshot(outputPath, options = {}) {
  if (USE_DOM_PROOF_CAPTURE) {
    try {
      const dataUrl = await captureProofDataUrl(options);
      if (dataUrl) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        await writeFile(outputPath, Buffer.from(base64, 'base64'));
        await cropProofImageInPlace(outputPath);
        return;
      }
    } catch (error) {
      console.warn(
        `[wdio:e2e-proof] DOM proof capture failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  try {
    await globalThis.browser.saveScreenshot(outputPath);
    await cropProofImageInPlace(outputPath);
    return;
  } catch (error) {
    console.warn(
      `[wdio:e2e-proof] Failed browser screenshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (const selector of PROOF_TARGET_SELECTORS) {
    const matches = await globalThis.browser.$$(selector);
    if (matches.length === 0) {
      continue;
    }

    const target = matches[0];
    if (!(await target.isExisting())) {
      continue;
    }

    try {
      await target.saveScreenshot(outputPath);
      await cropProofImageInPlace(outputPath);
      return;
    } catch (error) {
      console.warn(
        `[wdio:e2e-proof] Failed element screenshot for ${selector}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  await globalThis.browser.saveScreenshot(outputPath);
  await cropProofImageInPlace(outputPath);
}

async function captureProofDataUrl(options = {}) {
  if (!globalThis.browser?.executeAsync) {
    return null;
  }

  const result = await globalThis.browser.executeAsync((captureOptions, done) => {
    const capture = window.__testWidget?.captureProofPng;
    if (!capture) {
      done(null);
      return;
    }

    capture(captureOptions)
      .then((dataUrl) => done(dataUrl ?? null))
      .catch((error) => {
        done({
          __codexProofError:
            error instanceof Error ? error.message : String(error),
        });
      });
  }, options);

  if (result && typeof result === 'object' && '__codexProofError' in result) {
    console.warn(`[wdio:e2e-proof] DOM proof capture failed: ${result.__codexProofError}`);
    return null;
  }

  return typeof result === 'string' && result.startsWith('data:image/png;base64,')
    ? result
    : null;
}

function clampVideoFrameHold(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return VIDEO_FRAME_HOLD_MIN_MS;
  }

  return Math.max(VIDEO_FRAME_HOLD_MIN_MS, Math.min(VIDEO_FRAME_HOLD_MAX_MS, ms));
}

async function probeImageDimensions(imagePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      imagePath,
    ], {
      timeout: 10000,
    });
    const stream = JSON.parse(stdout).streams?.[0] ?? {};
    return {
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function evenDimension(value) {
  return Math.max(2, Math.ceil(value / 2) * 2);
}

function expandCropBounds(bounds, dimensions) {
  const minCropWidth = Math.min(dimensions.width, PROOF_CONTENT_MIN_CROP_WIDTH);
  const minCropHeight = Math.min(dimensions.height, PROOF_CONTENT_MIN_CROP_HEIGHT);

  let x = Math.max(0, bounds.minX - PROOF_CONTENT_CROP_PADDING);
  let y = Math.max(0, bounds.minY - PROOF_CONTENT_CROP_PADDING);
  let width = Math.min(dimensions.width - x, bounds.maxX - bounds.minX + 1 + PROOF_CONTENT_CROP_PADDING * 2);
  let height = Math.min(dimensions.height - y, bounds.maxY - bounds.minY + 1 + PROOF_CONTENT_CROP_PADDING * 2);

  if (width < minCropWidth) {
    const centerX = x + width / 2;
    x = Math.max(0, Math.min(dimensions.width - minCropWidth, Math.round(centerX - minCropWidth / 2)));
    width = minCropWidth;
  }

  if (height < minCropHeight) {
    const centerY = y + height / 2;
    y = Math.max(0, Math.min(dimensions.height - minCropHeight, Math.round(centerY - minCropHeight / 2)));
    height = minCropHeight;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

async function detectImageContentCrop(imagePath) {
  const dimensions = await probeImageDimensions(imagePath);
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return null;
  }

  let stdout;
  try {
    const result = await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      imagePath,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ], {
      encoding: 'buffer',
      maxBuffer: dimensions.width * dimensions.height * 3 + 4096,
      timeout: 30000,
    });
    stdout = Buffer.from(result.stdout);
  } catch {
    return {
      ...dimensions,
      x: 0,
      y: 0,
    };
  }

  let minX = dimensions.width;
  let minY = dimensions.height;
  let maxX = -1;
  let maxY = -1;
  const threshold = PROOF_CONTENT_THRESHOLD;

  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const index = (y * dimensions.width + x) * 3;
      const red = stdout[index] ?? 0;
      const green = stdout[index + 1] ?? 0;
      const blue = stdout[index + 2] ?? 0;
      if (Math.max(red, green, blue) <= threshold || red + green + blue <= threshold * 3) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      ...dimensions,
      x: 0,
      y: 0,
    };
  }

  return expandCropBounds({ minX, minY, maxX, maxY }, dimensions);
}

function isFullImageCrop(crop, dimensions) {
  return (
    !crop ||
    (crop.x === 0 &&
      crop.y === 0 &&
      crop.width === dimensions.width &&
      crop.height === dimensions.height)
  );
}

async function cropProofImageInPlace(imagePath) {
  const crop = await detectImageContentCrop(imagePath);
  if (!crop) {
    return;
  }

  const dimensions = await probeImageDimensions(imagePath);
  if (isFullImageCrop(crop, dimensions)) {
    return;
  }

  const tempPath = path.join(
    path.dirname(imagePath),
    `.${path.basename(imagePath, path.extname(imagePath))}.cropped.png`,
  );
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    imagePath,
    '-vf',
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    tempPath,
  ], {
    timeout: 30000,
  });
  await rename(tempPath, imagePath);
}

async function normalizeVideoSourceFrames(frames, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const measuredFrames = [];
  for (const frame of frames) {
    const crop = await detectImageContentCrop(frame.path);
    const dimensions = await probeImageDimensions(frame.path);
    measuredFrames.push({
      ...frame,
      crop: crop ?? { ...dimensions, x: 0, y: 0 },
      dimensions,
    });
  }

  const maxWidth = Math.max(1, ...measuredFrames.map((frame) => frame.crop.width));
  const maxHeight = Math.max(1, ...measuredFrames.map((frame) => frame.crop.height));
  const targetWidth = evenDimension(maxWidth);
  const targetHeight = evenDimension(maxHeight);

  const normalizedFrames = [];
  for (let i = 0; i < measuredFrames.length; i += 1) {
    const frame = measuredFrames[i];
    const outputPath = path.join(outputDir, `source-${String(i).padStart(5, '0')}.png`);
    const { x, y, width, height } = frame.crop;

    if (x === 0 && y === 0 && width === targetWidth && height === targetHeight) {
      await copyFile(frame.path, outputPath);
    } else {
      await execFileAsync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        frame.path,
        '-vf',
        `crop=${width}:${height}:${x}:${y},pad=${targetWidth}:${targetHeight}:0:0:color=black`,
        outputPath,
      ], {
        timeout: 30000,
      });
    }

    normalizedFrames.push({
      path: outputPath,
      capturedAtMs: frame.capturedAtMs,
      label: frame.label,
    });
  }

  return {
    frames: normalizedFrames,
    width: targetWidth,
    height: targetHeight,
  };
}

async function renderTimestampedFrames(recorder) {
  const renderedDir = path.join(recorder.frameDir, 'rendered');
  const normalizedDir = path.join(recorder.frameDir, 'normalized');
  await rm(renderedDir, { recursive: true, force: true });
  await mkdir(renderedDir, { recursive: true });
  const normalized = await normalizeVideoSourceFrames(recorder.frames, normalizedDir);

  let outputIndex = 0;
  let renderedDurationMs = 0;
  const frameDurationMs = 1000 / VIDEO_OUTPUT_FPS;

  for (let i = 0; i < normalized.frames.length && renderedDurationMs < VIDEO_MAX_DURATION_MS; i += 1) {
    const frame = normalized.frames[i];
    const nextFrame = normalized.frames[i + 1];
    const rawHoldMs = nextFrame
      ? nextFrame.capturedAtMs - frame.capturedAtMs
      : VIDEO_FINAL_FRAME_HOLD_MS;
    const remainingMs = VIDEO_MAX_DURATION_MS - renderedDurationMs;
    const holdMs = Math.min(clampVideoFrameHold(rawHoldMs), remainingMs);
    const duplicateCount = Math.max(1, Math.round(holdMs / frameDurationMs));

    for (let j = 0; j < duplicateCount && renderedDurationMs < VIDEO_MAX_DURATION_MS; j += 1) {
      const outputPath = path.join(renderedDir, `frame-${String(outputIndex).padStart(5, '0')}.png`);
      await copyFile(frame.path, outputPath);
      outputIndex += 1;
      renderedDurationMs = outputIndex * frameDurationMs;
    }
  }

  return {
    renderedDir,
    renderedFrames: outputIndex,
    renderedDurationMs,
    width: normalized.width,
    height: normalized.height,
  };
}

async function validateVideoProof(videoPath) {
  const metadata = {
    durationMs: 0,
    frameCount: 0,
    height: 0,
    reasons: [],
    sizeBytes: 0,
    width: 0,
  };

  try {
    const fileStat = await stat(videoPath);
    metadata.sizeBytes = fileStat.size;
  } catch {
    metadata.reasons.push('missing_file');
    return metadata;
  }

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,nb_frames,duration',
      '-of',
      'json',
      videoPath,
    ], {
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0] ?? {};
    metadata.width = Number(stream.width) || 0;
    metadata.height = Number(stream.height) || 0;
    metadata.durationMs = Math.round((Number(stream.duration) || 0) * 1000);
    metadata.frameCount =
      Number(stream.nb_frames) || Math.round((metadata.durationMs / 1000) * VIDEO_OUTPUT_FPS);
  } catch (error) {
    metadata.reasons.push(
      `ffprobe_failed:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (metadata.sizeBytes < VIDEO_MIN_VALID_SIZE_BYTES) {
    metadata.reasons.push(`file_too_small:${metadata.sizeBytes}`);
  }
  if (metadata.durationMs < VIDEO_MIN_VALID_DURATION_MS) {
    metadata.reasons.push(`duration_too_short:${metadata.durationMs}`);
  }
  if (metadata.frameCount < VIDEO_MIN_VALID_FRAMES) {
    metadata.reasons.push(`too_few_frames:${metadata.frameCount}`);
  }
  if (metadata.width <= 0 || metadata.height <= 0) {
    metadata.reasons.push(`invalid_dimensions:${metadata.width}x${metadata.height}`);
  }

  return metadata;
}

function isLowInformationFrame(frame) {
  const observations = frame?.observations ?? [];
  const contrast = Number(frame?.contrast) || 0;
  const edgeScore = Number(frame?.edgeScore) || 0;
  const width = Number(frame?.width) || 0;
  const height = Number(frame?.height) || 0;

  if (width <= 0 || height <= 0) {
    return true;
  }

  if (observations.includes('mostly blank or single-color frame')) {
    return true;
  }

  return (
    observations.includes('low-detail frame') &&
    contrast < 0.045 &&
    edgeScore < 0.012
  );
}

function visualTimelineQualityReasons(visualAnalysis) {
  if (!visualAnalysis || visualAnalysis.status !== 'completed') {
    return ['visual_analysis_missing'];
  }

  const frames = Array.isArray(visualAnalysis.frames) ? visualAnalysis.frames : [];
  if (frames.length === 0) {
    return ['visual_analysis_missing_frames'];
  }

  const lowInformationFrames = frames.filter(isLowInformationFrame);
  const lowInformationRatio = lowInformationFrames.length / frames.length;
  const informativeFrames = frames.filter((frame) => {
    const contrast = Number(frame?.contrast) || 0;
    const edgeScore = Number(frame?.edgeScore) || 0;
    return contrast >= 0.045 || edgeScore >= 0.012;
  });
  const finalFrame = frames.at(-1);
  const reasons = [];

  if (lowInformationFrames.length === frames.length || informativeFrames.length === 0) {
    reasons.push('visual_content_missing');
  }
  if (lowInformationRatio >= 0.8) {
    reasons.push(`mostly_low_information_frames:${lowInformationFrames.length}/${frames.length}`);
  }
  if (finalFrame && isLowInformationFrame(finalFrame)) {
    reasons.push('final_frame_low_information');
  }

  return reasons;
}

function frameTimelineCaption() {
  return `Webview frame timeline (source frames: action + ${VIDEO_FRAME_INTERVAL_MS}ms throttle; deterministic assertions remain the gate)`;
}

function webviewVideoCaption() {
  return `Legacy webview frame-replay MP4 (source frames: action + ${VIDEO_FRAME_INTERVAL_MS}ms throttle, output: ${VIDEO_OUTPUT_FPS} fps)`;
}

async function buildFrameTimelineProof(recorder, { passed, context }) {
  if (!recorder || recorder.frameCount === 0) {
    if (context && WEBVIEW_FRAME_TIMELINE_ENABLED) {
      await recordE2eCaptureLimitation(context, 'webview_frame_timeline_missing');
    }
    return null;
  }

  try {
    const durationMs = Math.max(
      VIDEO_MIN_VALID_DURATION_MS,
      Math.max(...recorder.frames.map((frame) => frame.capturedAtMs - recorder.startedAt), 0) +
        VIDEO_FINAL_FRAME_HOLD_MS,
    );
    const visualAnalysis = await analyzeImageFramesForProof({
      frames: recorder.frames.map((frame) => ({
        path: frame.path,
        timestampMs: Math.max(0, frame.capturedAtMs - recorder.startedAt),
        label: frame.label,
      })),
      artifactDir: context.artifactDir,
      artifactRoot: path.resolve(context.artifactDir, '..'),
      phase: recorder.phase,
      proofSlug: recorder.slug,
      durationMs,
    });

    const visualQualityReasons = visualTimelineQualityReasons(visualAnalysis);
    if (visualQualityReasons.length > 0) {
      recorder.error = visualQualityReasons.join(', ');
      console.warn(`[wdio:e2e-proof] Frame timeline failed visual validation: ${recorder.error}`);
      if (context) {
        await recordE2eCaptureLimitation(context, 'webview_frame_timeline_low_information');
      }
      return null;
    }

    const primaryFrame = visualAnalysis.frames.at(-1);
    if (!primaryFrame?.path) {
      if (context) {
        await recordE2eCaptureLimitation(context, 'webview_frame_timeline_missing');
      }
      return null;
    }

    return {
      kind: 'screenshot',
      path: primaryFrame.path,
      url: null,
      thumbnailUrl: null,
      timestampMs: passed ? null : primaryFrame.timestampMs ?? Math.max(0, Date.now() - recorder.startedAt),
      phase: recorder.phase,
      caption: frameTimelineCaption(),
      isPrimary: true,
      isFailureProof: !passed,
      metadata: {
        source: 'wdio-source-frames',
        sourceFrameCount: recorder.frameCount,
        selectedFrameCount: visualAnalysis.selectedFrameCount ?? visualAnalysis.frames.length,
      },
      visualAnalysis,
    };
  } catch (error) {
    recorder.error = error instanceof Error ? error.message : String(error);
    console.warn(`[wdio:e2e-proof] Failed to build frame timeline: ${recorder.error}`);
    if (context) {
      await recordE2eCaptureLimitation(context, 'webview_frame_timeline_invalid');
    }
    return null;
  } finally {
    await rm(recorder.frameDir, { recursive: true, force: true });
  }
}

async function encodeVideo(recorder, { passed, context }) {
  if (!WEBVIEW_VIDEO_ENABLED) {
    return null;
  }

  if (!recorder || recorder.frameCount === 0) {
    if (context) {
      await recordE2eCaptureLimitation(context, 'webview_recording_missing');
    }
    return null;
  }

  try {
    const rendered = await renderTimestampedFrames(recorder);
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      String(VIDEO_OUTPUT_FPS),
      '-i',
      path.join(rendered.renderedDir, 'frame-%05d.png'),
      '-vf',
      'pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      recorder.videoPath,
    ], {
      timeout: 120000,
    });

    const validation = await validateVideoProof(recorder.videoPath);
    if (validation.reasons.length > 0) {
      recorder.error = validation.reasons.join(', ');
      console.warn(`[wdio:e2e-video] Encoded video failed validation: ${recorder.error}`);
      await rm(recorder.videoPath, { force: true });
      if (context) {
        await recordE2eCaptureLimitation(context, 'webview_recording_invalid');
      }
      return null;
    }

    let visualAnalysis = null;
    try {
      visualAnalysis = await analyzeImageFramesForProof({
        frames: recorder.frames.map((frame) => ({
          path: frame.path,
          timestampMs: Math.max(0, frame.capturedAtMs - recorder.startedAt),
          label: frame.label,
        })),
        artifactDir: context.artifactDir,
        artifactRoot: path.resolve(context.artifactDir, '..'),
        phase: recorder.phase,
        proofSlug: recorder.slug,
        durationMs: validation.durationMs,
      });
    } catch (error) {
      console.warn(
        `[wdio:e2e-visual] Failed to analyze source frames: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const visualQualityReasons = visualTimelineQualityReasons(visualAnalysis);
    if (visualQualityReasons.length > 0) {
      recorder.error = visualQualityReasons.join(', ');
      console.warn(`[wdio:e2e-video] Encoded video failed visual validation: ${recorder.error}`);
      await rm(recorder.videoPath, { force: true });
      if (context) {
        await recordE2eCaptureLimitation(context, 'webview_recording_invalid');
      }
      return null;
    }

    return {
      kind: 'video',
      path: recorder.videoPath,
      url: null,
      thumbnailUrl: null,
      timestampMs: passed ? null : Math.max(0, Date.now() - recorder.startedAt),
      phase: recorder.phase,
      caption: webviewVideoCaption(),
      isPrimary: true,
      isFailureProof: false,
      metadata: {
        durationMs: validation.durationMs,
        frameCount: validation.frameCount,
        renderedFrameCount: rendered.renderedFrames,
        sourceFrameCount: recorder.frameCount,
      },
      visualAnalysis,
    };
  } catch (error) {
    recorder.error = error instanceof Error ? error.message : String(error);
    console.warn(`[wdio:e2e-video] Failed to encode video: ${recorder.error}`);
    await rm(recorder.videoPath, { force: true });
    if (context) {
      await recordE2eCaptureLimitation(context, 'webview_recording_invalid');
    }
    return null;
  } finally {
    await rm(recorder.frameDir, { recursive: true, force: true });
  }
}

/**
 * Create a WDIO config for a specific test suite.
 *
 * @param {object} opts
 * @param {string | string[]} opts.specs  - glob(s) for spec files, relative to apps/native/e2e-tauri/
 * @param {object} [opts.setupOptions]    - options forwarded to setupNixmacTestEnvironment
 * @param {string} [opts.scenario]        - stable scenario id written into e2e-report.json
 * @param {string} [opts.lane]            - stable lane id written into e2e-report.json
 */
export function createWdioConfig({ specs, setupOptions = {}, scenario, lane = 'tauri-wdio' }) {
  let testEnvironment;
  let reportContext;
  let primaryProofCaptured = false;
  let activeVideoRecorder = null;

  const resolvedSpecs = (Array.isArray(specs) ? specs : [specs]).map((s) =>
    path.resolve(THIS_DIR, s),
  );
  const scenarioName =
    scenario ??
    path.basename(resolvedSpecs[0] ?? 'wdio', path.extname(resolvedSpecs[0] ?? 'wdio'));

  async function ensureReportContext() {
    if (!reportContext) {
      reportContext = await createE2eReportContext({ scenario: scenarioName, lane });
    }
    return reportContext;
  }

  return {
    runner: 'local',
    port: 4444,
    connectionRetryCount: 10,
    connectionRetryTimeout: 120000,
    waitforTimeout: 45000,
    specs: resolvedSpecs,
    maxInstances: 1,
    capabilities: [
      {
        'tauri:options': {
          binary: path.resolve(APPS_NATIVE_DIR, '../../target/debug/nixmac'),
        },
      },
    ],
    logLevel: process.env.NIXMAC_E2E_WDIO_LOG_LEVEL ?? 'warn',
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
      ui: 'bdd',
      timeout: 120000,
    },
    async onPrepare() {
      await resetE2eReportContext({ scenario: scenarioName, lane });
      testEnvironment = await setupNixmacTestEnvironment(setupOptions);
    },
    async before() {
      await ensureReportContext();
    },
    async beforeTest(test) {
      const context = await ensureReportContext();
      activeVideoRecorder = createVideoRecorder({ context, testTitle: test.title });
      globalThis.__nixmacCaptureE2eVideoFrame = async (label = 'action') => {
        if (!activeVideoRecorder || activeVideoRecorder.disabled || activeVideoRecorder.saving) {
          return false;
        }

        await captureVideoFrame(activeVideoRecorder, label);
        return true;
      };
      await captureVideoFrame(activeVideoRecorder, 'start');
    },
    async afterCommand() {
      if (!activeVideoRecorder || activeVideoRecorder.disabled) {
        return;
      }

      const elapsed = Date.now() - activeVideoRecorder.lastFrameAt;
      if (elapsed >= VIDEO_FRAME_INTERVAL_MS) {
        await captureVideoFrame(activeVideoRecorder, 'step');
      }
    },
    async afterTest(test, _context, { error, duration, passed }) {
      const context = await ensureReportContext();
      const proof = [];

      await captureVideoFrame(activeVideoRecorder, passed ? 'final-proof' : 'final-failure');
      const primaryWebviewProof = WEBVIEW_VIDEO_ENABLED
        ? await encodeVideo(activeVideoRecorder, { passed, context })
        : await buildFrameTimelineProof(activeVideoRecorder, { passed, context });
      activeVideoRecorder = null;
      delete globalThis.__nixmacCaptureE2eVideoFrame;
      if (primaryWebviewProof) {
        proof.push(primaryWebviewProof);
        primaryProofCaptured = true;
      }

      if (globalThis.browser?.saveScreenshot) {
        const screenshotPath = path.join(
          context.artifactDir,
          `${passed ? 'proof' : 'failure'}-${Date.now()}.png`,
        );
        try {
          await withTimeout(
            saveProofScreenshot(screenshotPath),
            VIDEO_CAPTURE_TIMEOUT_MS,
            `Timed out capturing E2E proof screenshot after ${VIDEO_CAPTURE_TIMEOUT_MS}ms`,
          );
          proof.push({
            kind: 'screenshot',
            path: screenshotPath,
            url: null,
            thumbnailUrl: null,
            timestampMs: null,
            phase: test.title,
            caption: `${passed ? 'Proof' : 'Failure'} screenshot for ${test.title}`,
            isPrimary: !primaryProofCaptured,
            isFailureProof: !passed,
          });
          primaryProofCaptured = true;
        } catch (screenshotError) {
          console.warn(
            `[wdio:e2e-report] Failed to capture screenshot: ${
              screenshotError instanceof Error ? screenshotError.message : String(screenshotError)
            }`,
          );
        }
      }

      await recordE2ePhase(context, {
        name: test.title,
        status: passed ? 'passed' : 'failed',
        startedAt: null,
        finishedAt: new Date().toISOString(),
        durationMs: duration ?? 0,
        assertions: [test.title],
        proof,
        error: error?.message ?? null,
      });
    },
    async after(exitCode) {
      const context = await ensureReportContext();
      await writeE2eReport(context, { exitCode });
    },
    async onComplete() {
      await teardownNixmacTestEnvironment(testEnvironment);
    },
  };
}
