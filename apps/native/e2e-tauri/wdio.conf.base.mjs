import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  setupNixmacTestEnvironment,
  teardownNixmacTestEnvironment,
} from './tests/wdio/helpers/test-env.mjs';
import {
  createE2eReportContext,
  recordE2ePhase,
  resetE2eReportContext,
  writeE2eReport,
} from './tests/wdio/helpers/e2e-report.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '..');
const execFileAsync = promisify(execFile);
const VIDEO_FRAME_INTERVAL_MS = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_INTERVAL_MS ?? 1500);
const VIDEO_CAPTURE_TIMEOUT_MS = Number(process.env.NIXMAC_E2E_VIDEO_CAPTURE_TIMEOUT_MS ?? 5000);
const VIDEO_MAX_FRAMES = Number(process.env.NIXMAC_E2E_VIDEO_MAX_FRAMES ?? 120);

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
  const frameDir = path.join(context.artifactDir, `video-frames-${slug}`);
  const videoPath = path.join(context.artifactDir, `recording-${slug}-${startedAt}.mp4`);

  return {
    disabled: process.env.NIXMAC_E2E_VIDEO === '0',
    error: null,
    frameCount: 0,
    frameDir,
    lastFrameAt: 0,
    phase: testTitle,
    saving: false,
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
    await withTimeout(
      globalThis.browser.saveScreenshot(framePath),
      VIDEO_CAPTURE_TIMEOUT_MS,
      `Timed out capturing E2E video frame after ${VIDEO_CAPTURE_TIMEOUT_MS}ms`,
    );
    recorder.frameCount += 1;
    recorder.lastFrameAt = Date.now();
  } catch (error) {
    recorder.error = error instanceof Error ? error.message : String(error);
    // Video capture is proof infrastructure, not the scenario assertion itself.
    // Keep screenshots and functional assertions authoritative if capture degrades.
    recorder.disabled = true;
    console.warn(`[wdio:e2e-video] Disabled video capture: ${recorder.error}`);
  } finally {
    recorder.saving = false;
  }
}

async function encodeVideo(recorder, { passed }) {
  if (!recorder || recorder.frameCount === 0) {
    return null;
  }

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      '1',
      '-pattern_type',
      'glob',
      '-i',
      path.join(recorder.frameDir, 'frame-*.png'),
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

    return {
      kind: 'video',
      path: recorder.videoPath,
      url: null,
      thumbnailUrl: null,
      timestampMs: passed ? null : Math.max(0, Date.now() - recorder.startedAt),
      phase: recorder.phase,
      caption: 'Flow recording (webview)',
      isPrimary: true,
      isFailureProof: false,
    };
  } catch (error) {
    recorder.error = error instanceof Error ? error.message : String(error);
    console.warn(`[wdio:e2e-video] Failed to encode video: ${recorder.error}`);
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
    logLevel: 'info',
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
      const videoProof = await encodeVideo(activeVideoRecorder, { passed });
      activeVideoRecorder = null;
      if (videoProof) {
        proof.push(videoProof);
        primaryProofCaptured = true;
      }

      if (globalThis.browser?.saveScreenshot) {
        const screenshotPath = path.join(
          context.artifactDir,
          `${passed ? 'proof' : 'failure'}-${Date.now()}.png`,
        );
        try {
          await globalThis.browser.saveScreenshot(screenshotPath);
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
    async onComplete(exitCode) {
      await teardownNixmacTestEnvironment(testEnvironment);
    },
  };
}
