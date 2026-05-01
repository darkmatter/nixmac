#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');
const DEFAULT_BASE_ROOT = path.resolve(REPO_ROOT, process.env.NIXMAC_E2E_ADVERSARIAL_BASE_ROOT || 'artifacts/computer-use-remote');
const OUT_ROOT = path.join(REPO_ROOT, 'artifacts/computer-use-adversarial');
const RUNNER = path.join(TOOL_DIR, 'run-remote-cua.mjs');

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-adversarial.mjs [--base-run artifacts/computer-use-remote/<timestamp>]

When --base-run is omitted, the runner uses the newest local
artifacts/computer-use-remote/<timestamp> directory that contains state.json.
`);
}

function argValue(args, flag, fallback = '') {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '').replace('Z', 'Z');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: REPO_ROOT, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function discoverLatestBaseRun() {
  if (!existsSync(DEFAULT_BASE_ROOT)) return '';
  const candidates = readdirSync(DEFAULT_BASE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(DEFAULT_BASE_ROOT, entry.name))
    .filter((candidate) => existsSync(path.join(candidate, 'state.json')))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  return candidates[0] ?? '';
}

function resolveBaseRun(args) {
  const explicitBaseRun = argValue(args, '--base-run');
  if (explicitBaseRun) return path.resolve(REPO_ROOT, explicitBaseRun);
  const discovered = discoverLatestBaseRun();
  if (discovered) return discovered;
  throw new Error(
    `No baseline remote E2E artifact found under ${DEFAULT_BASE_ROOT}. ` +
      'Run/download a baseline report first or pass --base-run artifacts/computer-use-remote/<timestamp>.',
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function mutateScenario(state, key, status, note) {
  state.scenarios[key] ||= { label: key, status: 'inconclusive', notes: [] };
  state.scenarios[key].status = status;
  state.scenarios[key].notes = [note];
}

function resetDerivedState(state) {
  delete state.coverageFreshness;
  state.regeneratedFrom = undefined;
  state.regeneratedAt = undefined;
}

function renderExisting(runDir) {
  run('node', [RUNNER, 'render-existing', '--run-dir', runDir]);
  return readJson(path.join(runDir, 'state.regenerated.json'));
}

function reportPositionChecks(runDir) {
  const html = readFileSync(path.join(runDir, 'index.html'), 'utf8');
  const positions = {
    prFocus: html.indexOf('<h2>Pull Request Focus</h2>'),
    findings: html.indexOf('<h2>Findings First</h2>'),
    failures: html.indexOf('<h3>Failures</h3>'),
    inconclusive: html.indexOf('<h3>Inconclusive</h3>'),
    passes: html.indexOf('<summary>Passing Checks'),
  };
  return {
    positions,
    ordered:
      positions.findings >= 0 &&
      positions.failures > positions.findings &&
      positions.inconclusive > positions.failures &&
      positions.passes > positions.inconclusive,
    prFirst: positions.prFocus >= 0 && positions.findings > positions.prFocus,
  };
}

function createBlackPng(file) {
  run('ffmpeg', ['-f', 'lavfi', '-i', 'color=black:s=768x768', '-frames:v', '1', file, '-y']);
}

function addSensitiveScreenshot(state) {
  const source = state.screenshots.find((shot) => shot.label === 'launch')?.path;
  if (!source) throw new Error('launch screenshot missing from base state');
  const dest = 'screenshots/adversarial-settings-api-keys.png';
  state.screenshots.push({
    label: 'settings-api-keys',
    path: dest,
    note: 'Adversarial fixture: sensitive API Keys screenshot should not be allowed.',
    capturedAt: new Date().toISOString(),
  });
  return { source, dest };
}

function prepareCase(root, baseRun, id, slug) {
  const runDir = path.join(root, `${String(id).padStart(2, '0')}-${slug}`);
  rmSync(runDir, { recursive: true, force: true });
  cpSync(baseRun, runDir, { recursive: true });
  rmSync(path.join(runDir, 'state.regenerated.json'), { force: true });
  const statePath = path.join(runDir, 'state.json');
  const state = readJson(statePath);
  resetDerivedState(state);
  return { runDir, statePath, state };
}

const caseDefinitions = [
  {
    id: 1,
    slug: 'api-keys-blank-render',
    name: 'API Keys blank-screen/render crash',
    expected: 'settingsAPIKeys fails and the report verdict is fail.',
    mutate({ state }) {
      mutateScenario(state, 'settingsAPIKeys', 'fail', 'Adversarial fixture: API Keys collapsed to a blank WebView/accessibility tree.');
    },
    evaluate(state) {
      return state.scenarios.settingsAPIKeys.status === 'fail' && state.verdict === 'fail';
    },
  },
  {
    id: 2,
    slug: 'settings-content-mismatch',
    name: 'Settings tab content mismatch',
    expected: 'settingsAIModels fails when provider/model controls are absent or replaced.',
    mutate({ state }) {
      mutateScenario(state, 'settingsAIModels', 'fail', 'Adversarial fixture: AI Models tab rendered Preferences content instead of provider/model controls.');
    },
    evaluate(state) {
      return state.scenarios.settingsAIModels.status === 'fail';
    },
  },
  {
    id: 3,
    slug: 'missing-provider-credential',
    name: 'Missing provider credential / invalid OpenRouter key',
    expected: 'review fails with a credential-classified note.',
    mutate({ state }) {
      mutateScenario(state, 'review', 'fail', 'The real provider call failed because nixmac could not access an API key.');
      for (const key of ['summary', 'diff', 'buildBoundary', 'saveFlow', 'rollbackCleanup', 'discard']) {
        mutateScenario(state, key, 'inconclusive', 'Not exercised because provider credential failure prevented Review.');
      }
    },
    evaluate(state) {
      return state.scenarios.review.status === 'fail' && /API key|credential/i.test(state.scenarios.review.notes.join(' '));
    },
  },
  {
    id: 4,
    slug: 'provider-timeout',
    name: 'Provider workflow stuck before Review',
    expected: 'review is inconclusive and downstream provider scenarios are not claimed as pass.',
    mutate({ state }) {
      mutateScenario(state, 'review', 'inconclusive', 'The prompt was submitted, but Review did not appear before the polling window ended.');
      for (const key of ['summary', 'diff', 'buildBoundary', 'saveFlow', 'rollbackCleanup', 'discard']) {
        mutateScenario(state, key, 'inconclusive', 'Not exercised because Review did not appear before timeout.');
      }
    },
    evaluate(state) {
      return state.scenarios.review.status === 'inconclusive' && state.verdict !== 'pass';
    },
  },
  {
    id: 5,
    slug: 'build-boundary-missing',
    name: 'Build & Test confirmation missing or bypassed',
    expected: 'buildBoundary fails and Save is not counted as pass.',
    mutate({ state }) {
      mutateScenario(state, 'buildBoundary', 'fail', 'Adversarial fixture: Build & Test did not present an obvious confirmation boundary.');
      mutateScenario(state, 'saveFlow', 'inconclusive', 'Step 3 not exercised because the destructive boundary was missing.');
    },
    evaluate(state) {
      return state.scenarios.buildBoundary.status === 'fail' && state.scenarios.saveFlow.status !== 'pass';
    },
  },
  {
    id: 6,
    slug: 'commit-noop',
    name: 'Build succeeds visually but Step 3 Commit no-ops',
    expected: 'saveFlow fails when git proof does not show a committed change.',
    mutate({ state }) {
      mutateScenario(state, 'saveFlow', 'fail', 'Step 3 Commit was clicked, but the disposable repo did not show a clean committed bat/Homebrew change.');
    },
    evaluate(state) {
      return state.scenarios.saveFlow.status === 'fail';
    },
  },
  {
    id: 7,
    slug: 'rollback-noop',
    name: 'Rollback/History restore no-op or wrong target',
    expected: 'rollbackCleanup fails when baseline content is not restored.',
    mutate({ state }) {
      mutateScenario(state, 'rollbackCleanup', 'fail', 'History restore did not return the disposable config tree to the baseline content.');
    },
    evaluate(state) {
      return state.scenarios.rollbackCleanup.status === 'fail';
    },
  },
  {
    id: 8,
    slug: 'corrupt-evidence',
    name: 'Report evidence artifact corruption',
    expected: 'visualProofQuality and videoEvidence fail when referenced artifacts are missing.',
    mutate({ runDir }) {
      rmSync(path.join(runDir, 'screenshots/01-launch.png'), { force: true });
      rmSync(path.join(runDir, 'video/computer-use-evidence.mp4'), { force: true });
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && state.scenarios.videoEvidence.status === 'fail';
    },
  },
  {
    id: 9,
    slug: 'blank-screenshot',
    name: 'Visual UI regression: blank/occluded screenshot',
    expected: 'visualProofQuality fails when a required screenshot is visually blank.',
    mutate({ runDir }) {
      createBlackPng(path.join(runDir, 'screenshots/01-launch.png'));
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /blank|occluded/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 10,
    slug: 'pr-priority',
    name: 'PR focus/report prioritization regression',
    expected: 'PR focus is above findings and failures precede inconclusive/pass checks.',
    mutate({ state }) {
      state.prFocus = {
        configured: true,
        eventName: 'pull_request',
        number: '999',
        title: 'Adversarial settings regression fixture',
        headRef: 'adversarial/settings-regression',
        baseRef: 'main',
        changedFiles: ['apps/native/src/components/widget/settings-dialog.tsx'],
        userVisibleFiles: ['apps/native/src/components/widget/settings-dialog.tsx'],
        scenarioKeys: ['settingsGeneral', 'settingsAIModels', 'settingsAPIKeys', 'settingsPreferences'],
      };
      mutateScenario(state, 'settingsAIModels', 'fail', 'Adversarial fixture: AI Models tab rendered the wrong content.');
    },
    evaluate(state, runDir) {
      const checks = reportPositionChecks(runDir);
      return checks.prFirst && checks.ordered && state.scenarios.settingsAIModels.status === 'fail';
    },
  },
  {
    id: 11,
    slug: 'main-coverage-drift',
    name: 'Main coverage freshness drift',
    expected: 'mainCoverageFreshness fails when a new user-visible component appears without manifest mapping.',
    before() {
      const file = path.join(REPO_ROOT, 'apps/native/src/components/widget/adversarial-new-visible-surface.tsx');
      writeFileSync(file, 'export function AdversarialNewVisibleSurface() { return <button>New Visible Surface</button>; }\n');
      return () => rmSync(file, { force: true });
    },
    evaluate(state) {
      return state.scenarios.mainCoverageFreshness.status === 'fail' && /adversarial-new-visible-surface/i.test(state.scenarios.mainCoverageFreshness.notes.join(' '));
    },
  },
  {
    id: 12,
    slug: 'zero-byte-screenshot',
    name: 'Zero-byte screenshot artifact',
    expected: 'visualProofQuality fails when a linked screenshot file is empty.',
    mutate({ runDir }) {
      truncateSync(path.join(runDir, 'screenshots/01-launch.png'), 0);
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /empty/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 13,
    slug: 'zero-byte-text',
    name: 'Zero-byte redacted text artifact',
    expected: 'visualProofQuality fails when a linked text proof file is empty.',
    mutate({ runDir }) {
      truncateSync(path.join(runDir, 'texts/01-launch.txt'), 0);
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /empty/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 14,
    slug: 'findings-order',
    name: 'Findings ordering with mixed statuses',
    expected: 'report keeps failures first, inconclusive second, passing checks last.',
    mutate({ state }) {
      mutateScenario(state, 'feedback', 'fail', 'Adversarial fixture: feedback dialog failed.');
      mutateScenario(state, 'reportIssue', 'inconclusive', 'Adversarial fixture: report issue dialog was not exercised.');
    },
    evaluate(_state, runDir) {
      return reportPositionChecks(runDir).ordered;
    },
  },
  {
    id: 15,
    slug: 'sensitive-screenshot',
    name: 'Sensitive screenshot leak',
    expected: 'visualProofQuality fails if API Keys/Console screenshots are attached.',
    mutate({ runDir, state }) {
      const { source, dest } = addSensitiveScreenshot(state);
      cpSync(path.join(runDir, source), path.join(runDir, dest));
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /Sensitive surface/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 16,
    slug: 'stale-verdict',
    name: 'Stale green verdict in state.json',
    expected: 'render recalculates verdict as fail when any scenario fails.',
    mutate({ state }) {
      state.verdict = 'pass';
      mutateScenario(state, 'history', 'fail', 'Adversarial fixture: stale state claimed pass but History failed.');
    },
    evaluate(state) {
      return state.verdict === 'fail' && state.scenarios.history.status === 'fail';
    },
  },
  {
    id: 17,
    slug: 'missing-report-inspection-proof',
    name: 'Missing report-inspection proof artifact',
    expected: 'visualProofQuality fails when a passing reportInspection scenario lacks its proof screenshot/text.',
    mutate({ runDir, state }) {
      const removedProofPaths = state.screenshots
        .concat(state.textSnapshots)
        .filter((artifact) => artifact.label === 'HTML report inspection')
        .map((artifact) => artifact.path);
      state.screenshots = state.screenshots.filter((shot) => shot.label !== 'HTML report inspection');
      state.textSnapshots = state.textSnapshots.filter((shot) => shot.label !== 'HTML report inspection');
      for (const artifactPath of removedProofPaths) {
        rmSync(path.join(runDir, artifactPath), { force: true });
      }
      mutateScenario(state, 'reportInspection', 'pass', 'Adversarial fixture: report inspection was marked pass without proof.');
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /Generated HTML report is inspected/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 18,
    slug: 'pr-unmapped-user-visible',
    name: 'PR user-visible change without mapped scenario',
    expected: 'prSpecificCoverage is inconclusive when user-visible PR files have no scenario mapping.',
    mutate({ state }) {
      state.prFocus = {
        configured: true,
        eventName: 'pull_request',
        number: '1000',
        title: 'Unmapped visible change fixture',
        headRef: 'adversarial/unmapped-visible',
        baseRef: 'main',
        changedFiles: ['apps/native/src/components/widget/adversarial-new-visible-surface.tsx'],
        userVisibleFiles: ['apps/native/src/components/widget/adversarial-new-visible-surface.tsx'],
        scenarioKeys: [],
      };
      mutateScenario(state, 'prSpecificCoverage', 'pass', 'Adversarial fixture: stale pass should be downgraded.');
    },
    evaluate(state) {
      return state.scenarios.prSpecificCoverage.status === 'inconclusive' && /no dedicated PR-specific/i.test(state.scenarios.prSpecificCoverage.notes.join(' '));
    },
  },
  {
    id: 19,
    slug: 'video-unavailable-stale-pass',
    name: 'Unavailable video with stale pass status',
    expected: 'videoEvidence fails when video status is unavailable even if stale state claimed pass.',
    mutate({ state }) {
      state.video = { status: 'unavailable', path: null, note: 'Adversarial fixture: encoder failed.' };
      mutateScenario(state, 'videoEvidence', 'pass', 'Adversarial fixture: stale pass should be downgraded.');
    },
    evaluate(state) {
      return state.scenarios.videoEvidence.status === 'fail' && /unavailable|encoder failed/i.test(state.scenarios.videoEvidence.notes.join(' '));
    },
  },
  {
    id: 20,
    slug: 'rollback-proof-missing',
    name: 'Rollback cleanup pass without restore proof',
    expected: 'visualProofQuality fails when rollbackCleanup is pass but restore proof artifacts are absent.',
    mutate({ state }) {
      mutateScenario(state, 'rollbackCleanup', 'pass', 'Adversarial fixture: rollback cleanup marked pass without restore proof.');
      state.screenshots = state.screenshots.filter((shot) => !/history-(before-restore|restore-preview)|after-history-restore/.test(shot.label));
      state.textSnapshots = state.textSnapshots.filter((shot) => !/history-(before-restore|restore-preview)|after-history-restore/.test(shot.label));
    },
    evaluate(state) {
      return state.scenarios.visualProofQuality.status === 'fail' && /Rollback cleanup/i.test(state.scenarios.visualProofQuality.notes.join(' '));
    },
  },
  {
    id: 21,
    slug: 'activation-admin-auth-blocker',
    name: 'Activation waits for macOS administrator authentication',
    expected: 'saveFlow fails with an administrator-authentication blocker instead of timing out as a generic slow build.',
    mutate({ state }) {
      mutateScenario(state, 'saveFlow', 'fail', 'Build & Test reached macOS activation, but the remote lane requires an interactive administrator authentication prompt before Step 3 can appear.');
      mutateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because activation was blocked by macOS administrator authentication.');
      mutateScenario(state, 'discard', 'inconclusive', 'Discard was not exercised because activation was blocked by macOS administrator authentication; external disposable-state restore handles cleanup.');
    },
    evaluate(state) {
      return (
        state.scenarios.saveFlow.status === 'fail' &&
        /administrator authentication|admin/i.test(state.scenarios.saveFlow.notes.join(' ')) &&
        state.scenarios.rollbackCleanup.status === 'inconclusive'
      );
    },
  },
];

function runCase(root, baseRun, definition) {
  const { runDir, statePath, state } = prepareCase(root, baseRun, definition.id, definition.slug);
  let cleanup = null;
  try {
    cleanup = definition.before?.() || null;
    definition.mutate?.({ runDir, state, statePath });
    writeJson(statePath, state);
    const renderedState = renderExisting(runDir);
    const caught = definition.evaluate(renderedState, runDir);
    return {
      id: definition.id,
      name: definition.name,
      slug: definition.slug,
      expected: definition.expected,
      verdict: caught ? 'caught' : 'missed',
      scenarioStatuses: Object.fromEntries(Object.entries(renderedState.scenarios).map(([key, value]) => [key, value.status])),
      report: path.relative(REPO_ROOT, path.join(runDir, 'index.html')),
      state: path.relative(REPO_ROOT, path.join(runDir, 'state.regenerated.json')),
      notes: caught ? 'Expected failure was surfaced by the E2E/reporting suite.' : 'Expected failure was not surfaced correctly.',
    };
  } catch (error) {
    return {
      id: definition.id,
      name: definition.name,
      slug: definition.slug,
      expected: definition.expected,
      verdict: 'blocked',
      report: path.relative(REPO_ROOT, path.join(runDir, 'index.html')),
      notes: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cleanup?.();
  }
}

function renderAggregate(root, results, baseRun) {
  const caught = results.filter((item) => item.verdict === 'caught').length;
  const missed = results.filter((item) => item.verdict === 'missed').length;
  const blocked = results.filter((item) => item.verdict === 'blocked').length;
  const rows = results
    .map(
      (item) => `<tr><td>${item.id}</td><td>${escapeHtml(item.name)}</td><td><span class="verdict ${escapeHtml(item.verdict)}">${escapeHtml(item.verdict)}</span></td><td>${escapeHtml(item.expected)}</td><td>${escapeHtml(item.notes)}</td><td><a href="${escapeHtml(path.relative(root, path.join(REPO_ROOT, item.report)).replaceAll(path.sep, '/'))}">case report</a></td></tr>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>nixmac E2E Adversarial Validation</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #eef1f5; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    p, li { color: #c5cbd3; line-height: 1.5; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
    .metric, .panel { border: 1px solid #303640; border-radius: 8px; background: #171a21; padding: 14px; }
    .metric strong { display: block; font-size: 28px; color: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #303640; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #20242d; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .caught { background: #123d2a; color: #8bf0bb; }
    .missed { background: #471a1a; color: #ff9e9e; }
    .blocked { background: #443512; color: #ffd36e; }
    a, code { color: #a7d7ff; }
  </style>
</head>
<body>
<main>
  <h1>nixmac E2E Adversarial Validation</h1>
  <p>Reversible fixtures intentionally damage app-state evidence, scenario outcomes, PR context, coverage freshness, or report artifacts to verify that the E2E/reporting suite does not make false green claims.</p>
  <section class="summary">
    <div class="metric"><strong>${caught}</strong>Caught</div>
    <div class="metric"><strong>${missed}</strong>Missed</div>
    <div class="metric"><strong>${blocked}</strong>Blocked</div>
    <div class="metric"><strong>${results.length}</strong>Total</div>
  </section>
  <section class="panel"><strong>Base run</strong><br><code>${escapeHtml(path.relative(REPO_ROOT, baseRun))}</code></section>
  <h2>Executed Cases</h2>
  <table>
    <thead><tr><th>ID</th><th>Case</th><th>Verdict</th><th>Expected Detection</th><th>Actual Notes</th><th>Artifact</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Scope Note</h2>
  <p>These adversarial cases alter copied E2E artifacts and temporary disposable files only. They validate the E2E/reporting suite's ability to classify failures; they do not patch or ship core nixmac product behavior.</p>
</main>
</body>
</html>`;
  writeFileSync(path.join(root, 'index.html'), html);
  writeJson(path.join(root, 'summary.json'), {
    generatedAt: new Date().toISOString(),
    baseRun: path.relative(REPO_ROOT, baseRun),
    counts: { caught, missed, blocked, total: results.length },
    results,
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const baseRun = resolveBaseRun(args);
  if (!existsSync(path.join(baseRun, 'state.json'))) throw new Error(`Base run is missing state.json: ${baseRun}`);
  const root = path.join(OUT_ROOT, timestampSlug());
  mkdirSync(root, { recursive: true });
  const results = caseDefinitions.map((definition) => runCase(root, baseRun, definition));
  renderAggregate(root, results, baseRun);
  const uncaught = results.filter((result) => result.verdict !== 'caught');
  if (uncaught.length > 0) {
    console.error(
      `Adversarial validation did not catch all cases: ${uncaught
        .map((result) => `${result.id}:${result.verdict}`)
        .join(', ')}. Check the aggregate report for details.`,
    );
    process.exitCode = 1;
  }
  console.log(path.join(root, 'index.html'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
