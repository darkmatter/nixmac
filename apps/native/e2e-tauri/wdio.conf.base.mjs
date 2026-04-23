import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    async afterTest(test, _context, { error, duration, passed }) {
      const context = await ensureReportContext();
      const proof = [];
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
