import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createE2eReportContext,
  recordE2eCaptureLimitation,
  recordE2ePhase,
  writeE2eReport,
} from '../tests/wdio/helpers/e2e-report.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const APPS_NATIVE_DIR = path.resolve(E2E_TAURI_DIR, '..');

function usage() {
  console.error(
    'Usage: node e2e-tauri/scripts/write-infra-failure.mjs <scenario> <message> [log-path]',
  );
}

function lastSignalLines(logText) {
  return logText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /Failed to create a session|WebDriverError|plugin request failed|no window|ERROR|Error|error|failed|exited with code/i.test(
        line,
      ),
    )
    .slice(-8);
}

function inferFallbackStatus(logText) {
  if (
    /Error in "|Timeout of \d+ms exceeded|AssertionError|\b\d+\) .+|Spec Files:\s+\d+ passed,\s+\d+ failed/i.test(
      logText,
    )
  ) {
    return 'failed';
  }

  return 'infra_failed';
}

async function existingReportHasPhases(context) {
  try {
    const report = JSON.parse(
      await readFile(path.join(context.artifactDir, 'e2e-report.json'), 'utf-8'),
    );
    return Array.isArray(report.phases) && report.phases.length > 0;
  } catch {
    return false;
  }
}

const [scenario, message, logPathArg] = process.argv.slice(2);
if (!scenario || !message) {
  usage();
  process.exit(2);
}

const context = await createE2eReportContext({ scenario, lane: 'tauri-wdio' });
if (await existingReportHasPhases(context)) {
  process.exit(0);
}

const logPath = logPathArg ? path.resolve(APPS_NATIVE_DIR, logPathArg) : null;
let logText = '';
let hasLog = false;
if (logPath) {
  try {
    logText = await readFile(logPath, 'utf-8');
    hasLog = true;
  } catch {
    logText = '';
  }
}

const signals = lastSignalLines(logText);
const error = [message, ...signals].filter(Boolean).join('\n');
const status = inferFallbackStatus(logText);
const phaseName = status === 'failed' ? 'WDIO scenario/test' : 'WDIO session/bootstrap';
if (status === 'infra_failed') {
  await recordE2eCaptureLimitation(context, 'pre_scenario_setup_failed');
}
await recordE2ePhase(context, {
  name: phaseName,
  status,
  startedAt: context.startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: 0,
  assertions:
    status === 'failed'
      ? ['Run the WDIO scenario command to completion']
      : ['Create a WDIO session and attach to the Tauri webview'],
  proof: logPath && hasLog
    ? [
        {
          kind: 'log',
          path: logPath,
          url: null,
          thumbnailUrl: null,
          timestampMs: null,
          phase: phaseName,
          caption:
            status === 'failed'
              ? 'WDIO scenario failure diagnostic log'
              : 'WDIO session/bootstrap diagnostic log',
          isPrimary: true,
          isFailureProof: true,
        },
      ]
    : [],
  error,
});

await writeE2eReport(context, { exitCode: 1 });
