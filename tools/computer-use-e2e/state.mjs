import path from 'node:path';
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { redact } from './redaction.mjs';
import { ensureTimingState, recordTimingPhase } from './timing.mjs';

function buildGateFromEnv(env = process.env) {
  const status = env.NIXMAC_E2E_BUILD_GATE_STATUS || '';
  if (!status) return null;
  return {
    status,
    requiredHeadSha: env.NIXMAC_E2E_BUILD_ARTIFACT_SHA || '',
    buildRunId: env.NIXMAC_E2E_BUILD_RUN_ID || '',
    latestRun: env.NIXMAC_E2E_BUILD_LATEST_RUN || '',
    artifactName: env.NIXMAC_E2E_BUILD_ARTIFACT_NAME || 'nixmac-macos-app',
    reason: redact(env.NIXMAC_E2E_BUILD_GATE_REASON || ''),
    note: 'Computer Use E2E may start remote setup only after a successful Build macOS App artifact exists for this exact head SHA.',
  };
}

export function ensureCurrentSchema(
  state,
  {
    scenarioLabels = {},
    evolvedCaseStrategy = () => null,
    buildPrFocus = () => null,
    pngDimensions = () => null,
    env = process.env,
  } = {},
) {
  // Runner-owned defaults are injected by run-remote-cua.mjs to avoid circular
  // imports while keeping this lifecycle helper independently testable.
  state.scenarios ||= {};
  delete state.scenarios.videoEvidence;
  for (const [key, label] of Object.entries(scenarioLabels)) {
    if (!state.scenarios[key]) {
      state.scenarios[key] = {
        label,
        status: 'inconclusive',
        notes: [`Scenario was added after this run or was not exercised by this runner.`],
      };
    }
  }
  for (const [key, label] of Object.entries(scenarioLabels)) state.scenarios[key].label = label;
  state.claims ||= [];
  state.failures ||= [];
  state.narrative ||= [];
  state.confirmationBoundaries ||= [];
  state.screenshots ||= [];
  state.textSnapshots ||= [];
  state.video ||= null;
  state.secretMaskingViolations ||= [];
  state.visualAssertions ||= [];
  ensureTimingState(state);
  state.evolvedCaseStrategy ||= evolvedCaseStrategy();
  state.evolvedCaseRuns ||= [];
  for (const shot of state.screenshots) {
    if (!shot.imageSize && shot.path && state.runDir) {
      const dimensions = pngDimensions(path.join(state.runDir, shot.path));
      if (dimensions) shot.imageSize = dimensions;
    }
  }
  state.cleanup ||= { attempted: false, restored: false, note: 'No cleanup status recorded.' };
  state.safety ||= {
    disposableConfig: env.NIXMAC_E2E_DISPOSABLE_CONFIG === 'true',
    buildConfirmEnabled: env.NIXMAC_E2E_ALLOW_BUILD_CONFIRM === 'true',
    discardConfirmEnabled: env.NIXMAC_E2E_ALLOW_DISCARD_CONFIRM === 'true',
    note: 'Discard/build confirmation is only allowed when disposable config mode is explicitly proven.',
  };
  state.prFocus ||= buildPrFocus();
  state.buildGate ||= buildGateFromEnv(env);
  return state;
}

export async function createBaseState(
  runDir,
  options = {},
  {
    tryRun = () => ({ stdout: '' }),
    repoRoot = process.cwd(),
    remoteAppPathFromEnv = () => '/Applications/nixmac.app',
    scenarioLabels = {},
    evolvedCaseStrategy = () => null,
    buildPrFocus = () => null,
    env = process.env,
    now = () => new Date().toISOString(),
  } = {},
) {
  const branch = tryRun('git', ['branch', '--show-current'], { cwd: repoRoot }).stdout || 'unknown';
  const sha = tryRun('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot }).stdout || 'unknown';
  const macosVersion =
    env.NIXMAC_E2E_MACOS_VERSION ||
    tryRun('sw_vers', ['-productVersion']).stdout ||
    'unknown';
  const remoteAppPath = remoteAppPathFromEnv();
  const scenarios = Object.fromEntries(
    Object.entries(scenarioLabels).map(([key, label]) => [
      key,
      { label, status: 'inconclusive', notes: [] },
    ]),
  );
  return {
    startedAt: now(),
    runDir,
    ws: options.ws,
    app: options.app,
    prompt: options.prompt,
    branch,
    sha,
    macosVersion,
    appCommand: env.NIXMAC_E2E_APP_COMMAND || `open -n ${remoteAppPath}`,
    provider: {
      kind: 'real-openrouter-compatible-provider',
      note: 'The key value is never written to this report. Failures may reflect provider billing/auth state.',
    },
    evolvedCaseStrategy: evolvedCaseStrategy(),
    evolvedCaseRuns: [],
    safety: {
      disposableConfig: env.NIXMAC_E2E_DISPOSABLE_CONFIG === 'true',
      buildConfirmEnabled: env.NIXMAC_E2E_ALLOW_BUILD_CONFIRM === 'true',
      discardConfirmEnabled: env.NIXMAC_E2E_ALLOW_DISCARD_CONFIRM === 'true',
      note: 'Discard/build confirmation is only allowed when disposable config mode is explicitly proven.',
    },
    buildGate: buildGateFromEnv(env),
    prFocus: buildPrFocus(),
    cleanup: { attempted: false, restored: false, note: 'Cleanup has not run yet.' },
    timing: {
      version: 1,
      generatedAt: now(),
      note: 'Timing phases are best-effort telemetry from the GitHub workflow and Computer Use runner. Unobservable phases are reported explicitly instead of inferred.',
      phases: [],
    },
    screenshots: [],
    textSnapshots: [],
    events: [],
    claims: [],
    narrative: [],
    confirmationBoundaries: [],
    failures: [],
    scenarios,
  };
}

export function applyHistoricalRenderMigration(state) {
  if (state.scenarios.saveFlow?.status === 'inconclusive' && state.scenarios.saveFlow.notes.length === 1 && /added after this run/.test(state.scenarios.saveFlow.notes[0])) {
    state.scenarios.saveFlow.notes = ['Step 3 Save / Keep changes was not exercised in this historical run.'];
  }
  if (state.scenarios.discard?.status === 'pass' && !state.safety?.disposableConfig) {
    state.scenarios.discard.status = 'inconclusive';
    state.scenarios.discard.notes.push('Historical pass downgraded for regenerated report: Discard confirmation was not safe to count as pass because disposable config mode was not proven.');
  }
  if (state.scenarios.rollbackCleanup?.status === 'pass' && state.scenarios.discard?.status === 'inconclusive') {
    state.scenarios.discard.status = 'pass';
    state.scenarios.discard.notes = ['Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.'];
  }
  return state;
}

export function verdictFor(state) {
  const statuses = Object.values(state.scenarios).map((item) => item.status);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('inconclusive')) return 'inconclusive';
  return 'pass';
}

export function shouldFailProcessForVerdict(state, env = process.env) {
  if (env.NIXMAC_E2E_STRICT_VERDICT === 'false') return false;
  return state.verdict === 'fail' || state.verdict === 'inconclusive';
}

export async function saveState(state) {
  await writeFile(path.join(state.runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function addEvent(state, type, detail = {}) {
  state.events.push({ ts: new Date().toISOString(), type, ...detail });
  await writeFile(path.join(state.runDir, 'events.json'), `${JSON.stringify(state.events, null, 2)}\n`, 'utf8');
}

export function addTimingPhase(state, phase) {
  return recordTimingPhase(state, phase);
}

export function updateScenario(state, key, status, note) {
  if (!state.scenarios[key]) throw new Error(`Unknown scenario ${key}`);
  state.scenarios[key].status = status;
  if (note) state.scenarios[key].notes.push(redact(note));
  const claim = {
    claim: state.scenarios[key].label,
    status,
    evidence: redact(note || 'See Computer Use screenshots and text snapshots.'),
  };
  const existing = state.claims.find((item) => item.claim === claim.claim);
  if (existing) Object.assign(existing, claim);
  else state.claims.push(claim);
}

export function addNarrative(state, text) {
  state.narrative.push({ ts: new Date().toISOString(), text: redact(text) });
}
