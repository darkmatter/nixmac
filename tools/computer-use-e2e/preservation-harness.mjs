#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');
const FIXTURE_DIR = path.join(TOOL_DIR, 'fixtures/preservation');
const SEED_STATE = path.join(FIXTURE_DIR, 'state.seed.json');
const EXPECTED_REPORT = path.join(FIXTURE_DIR, 'expected-report-signature.json');
const EXPECTED_CONTRACTS = path.join(FIXTURE_DIR, 'expected-scenario-contracts.json');
const EXPECTED_ARTIFACTS = path.join(FIXTURE_DIR, 'expected-artifact-links.json');
const ADVERSARIAL_FIXTURE_FILE = path.join(REPO_ROOT, 'apps/native/src/components/widget/adversarial-new-visible-surface.tsx');
const ADVERSARIAL_FIXTURE_CONTENT = 'export function AdversarialNewVisibleSurface() { return <button>New Visible Surface</button>; }\n';
const LOCK_DIR = path.join(os.tmpdir(), 'nixmac-preservation-harness.lock');
const DYNAMIC_SCENARIOS = new Set(['mainCoverageFreshness', 'prSpecificCoverage']);

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/preservation-harness.mjs run [--work-dir <path>]
  node tools/computer-use-e2e/preservation-harness.mjs update-fixtures [--work-dir <path>]

The run command is the acceptance path. It always runs render-existing and full
adversarial replay against the deterministic fixture. update-fixtures rewrites
the expected snapshots after an intentional report/state contract change and
requires --allow-rewrite.`);
}

function argValue(args, flag, fallback = '') {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`);
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>')
    .replace(/run-\d+/g, 'run-<id>')
    .replace(/\/(?:private\/)?tmp\/[A-Za-z0-9._/-]+/g, '/tmp/<path>')
    .replace(/\/var\/folders\/[A-Za-z0-9._/-]+/g, '/var/folders/<path>')
    .replace(new RegExp(REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<repo>')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertFfmpeg() {
  run('ffmpeg', ['-version']);
}

function acquireLock() {
  try {
    mkdirSync(LOCK_DIR);
    writeFileSync(path.join(LOCK_DIR, 'pid'), `${process.pid}\n`);
  } catch {
    const owner = existsSync(path.join(LOCK_DIR, 'pid')) ? readFileSync(path.join(LOCK_DIR, 'pid'), 'utf8').trim() : 'unknown';
    throw new Error(`Another preservation harness appears to be running (lock ${LOCK_DIR}, pid ${owner}).`);
  }
  return () => rmSync(LOCK_DIR, { recursive: true, force: true });
}

function buildFixtureRun(workDir) {
  const root = workDir ? path.resolve(REPO_ROOT, workDir) : mkdtempSync(path.join(os.tmpdir(), 'nixmac-preservation-'));
  const runDir = path.join(root, 'fixture-run');
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });

  const seed = readJson(SEED_STATE);
  seed.runDir = runDir;
  writeJson(path.join(runDir, 'state.json'), seed);

  const sourceScreenshots = path.join(FIXTURE_DIR, 'screenshots');
  if (existsSync(sourceScreenshots)) cpSync(sourceScreenshots, path.join(runDir, 'screenshots'), { recursive: true });
  mkdirSync(path.join(runDir, 'texts'), { recursive: true });
  for (const item of seed.textSnapshots || []) {
    const fullPath = path.join(runDir, item.path);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `Fixture text snapshot: ${item.label}\n`, 'utf8');
  }

  return { root, runDir };
}

function htmlPosition(html, pattern) {
  if (pattern.startsWith('id=')) return html.indexOf(pattern);
  return html.indexOf(pattern);
}

function reportSignature(runDir, state) {
  const html = readFileSync(path.join(runDir, 'index.html'), 'utf8');
  const anchors = [
    'id="summary"',
    'id="evidence-pack"',
    'class="report-nav"',
    'id="pull-request-focus"',
    'id="findings-first"',
    'id="evidence-quality"',
    'id="visual-assertions"',
    'id="v2-evidence-model"',
    'id="accessibility-risk"',
    'id="failure-taxonomy"',
    'id="visual-proof"',
    'id="scenario-checklist"',
    'id="remote-metadata"',
    'id="raw-evidence"',
    'id="screenshots"',
    'id="narrative"',
    'id="claims"',
    'id="pr-specific-focus"',
    'id="cleanup"',
  ];
  const positions = {
    prFocus: htmlPosition(html, 'id="pull-request-focus"'),
    findings: htmlPosition(html, 'id="findings-first"'),
    failures: html.indexOf('<h3>Failures</h3>'),
    inconclusive: html.indexOf('<h3>Inconclusive</h3>'),
    passing: html.indexOf('<summary>Passing Checks'),
  };
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const nonDynamicScenarios = Object.entries(state.scenarios || {}).filter(([key]) => !DYNAMIC_SCENARIOS.has(key));
  const nonDynamicCounts = nonDynamicScenarios.reduce((counts, [, scenario]) => {
    counts[scenario.status] = (counts[scenario.status] || 0) + 1;
    return counts;
  }, {});
  return {
    anchors: Object.fromEntries(anchors.map((anchor) => [anchor, html.includes(anchor)])),
    order: {
      prFocusBeforeFindings: positions.prFocus >= 0 && positions.findings > positions.prFocus,
      findingsBeforeFailures: positions.findings >= 0 && positions.failures > positions.findings,
      failuresBeforeInconclusive: positions.failures >= 0 && positions.inconclusive > positions.failures,
      inconclusiveBeforePassing: positions.inconclusive >= 0 && positions.passing > positions.inconclusive,
    },
    nonDynamicScenarioCounts: nonDynamicCounts,
    visualAssertions: (state.visualAssertions || []).map((item) => ({
      scenarioKey: item.scenarioKey,
      status: item.status,
      screenshots: (item.screenshots || []).map((shot) => ({ label: shot.label, status: shot.status })),
    })),
    duplicateIds,
    evidenceStrengthCounts: Object.values(state.v2?.scenarioContracts || {}).reduce((counts, item) => {
      if (DYNAMIC_SCENARIOS.has(item.id)) return counts;
      counts[item.evidenceStrength] = (counts[item.evidenceStrength] || 0) + 1;
      return counts;
    }, {}),
  };
}

function scenarioContracts(state) {
  const out = {};
  for (const [key, item] of Object.entries(state.v2?.scenarioContracts || {})) {
    if (DYNAMIC_SCENARIOS.has(key)) {
      out[key] = { id: item.id, label: item.label, dynamic: true };
      continue;
    }
    out[key] = {
      id: item.id,
      label: item.label,
      status: item.status,
      legacyEvidenceGrade: item.legacyEvidenceGrade,
      evidenceStrength: item.evidenceStrength,
      evidenceStrengthReason: normalizeText(item.evidenceStrengthReason),
      assertionTypes: item.assertionTypes,
      failureClass: item.failureClass,
      failureClassReason: normalizeText(item.failureClassReason),
      accessibilityRisk: item.accessibilityRisk,
      accessibilityRiskReason: normalizeText(item.accessibilityRiskReason),
      visualAssertionStatus: item.visualAssertionStatus,
      proof: normalizeText(item.proof),
      limitation: normalizeText(item.limitation),
    };
  }
  return out;
}

function artifactLinks(state) {
  const normalizeArtifact = (item) => ({
    label: item.label,
    path: item.path,
  });
  return {
    screenshots: (state.screenshots || []).map(normalizeArtifact).sort((a, b) => a.label.localeCompare(b.label)),
    textSnapshots: (state.textSnapshots || []).map(normalizeArtifact).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function compareJson(name, actual, expectedFile, actualDir) {
  const expected = readJson(expectedFile);
  const actualStable = stable(actual);
  const expectedStable = stable(expected);
  const actualText = JSON.stringify(actualStable, null, 2);
  const expectedText = JSON.stringify(expectedStable, null, 2);
  if (actualText !== expectedText) {
    const actualOut = path.join(actualDir, `${path.basename(expectedFile)}.actual`);
    writeJson(actualOut, actualStable);
    throw new Error(`${name} changed. Wrote actual snapshot to ${actualOut}`);
  }
}

function cleanupAdversarialFixtureFile() {
  if (!existsSync(ADVERSARIAL_FIXTURE_FILE)) return;
  const content = readFileSync(ADVERSARIAL_FIXTURE_FILE, 'utf8');
  if (content !== ADVERSARIAL_FIXTURE_CONTENT) {
    throw new Error(`Refusing to delete unexpected file at ${ADVERSARIAL_FIXTURE_FILE}`);
  }
  rmSync(ADVERSARIAL_FIXTURE_FILE, { force: true });
}

function runRenderExisting(runDir) {
  run('node', ['tools/computer-use-e2e/run-remote-cua.mjs', 'render-existing', '--run-dir', runDir]);
  const indexPath = path.join(runDir, 'index.html');
  const regeneratedPath = path.join(runDir, 'state.regenerated.json');
  if (!existsSync(indexPath)) throw new Error(`render-existing did not create ${indexPath}`);
  if (!existsSync(regeneratedPath)) throw new Error(`render-existing did not create ${regeneratedPath}`);
  const state = readJson(regeneratedPath);
  if (state.regeneratedFrom !== 'state.json') throw new Error(`Expected regeneratedFrom=state.json, got ${state.regeneratedFrom}`);
  if (!state.regeneratedAt) throw new Error('state.regenerated.json is missing regeneratedAt');
  return state;
}

function runAdversarial(baseRun, root) {
  cleanupAdversarialFixtureFile();
  const outRoot = path.join(root, 'adversarial');
  rmSync(outRoot, { recursive: true, force: true });
  try {
    run('node', ['tools/computer-use-e2e/run-adversarial.mjs', '--base-run', baseRun], {
      env: { ...process.env, NIXMAC_E2E_ADVERSARIAL_OUT_ROOT: outRoot },
    });
  } finally {
    cleanupAdversarialFixtureFile();
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(command ? 0 : 1);
  }
  if (!['run', 'update-fixtures'].includes(command)) {
    usage();
    process.exit(1);
  }
  if (command === 'update-fixtures' && !args.includes('--allow-rewrite')) {
    throw new Error('update-fixtures rewrites preservation baselines; pass --allow-rewrite after reviewing the intended contract change.');
  }

  const releaseLock = acquireLock();
  try {
    assertFfmpeg();
    const { root, runDir } = buildFixtureRun(argValue(args, '--work-dir'));
    const state = runRenderExisting(runDir);
    const snapshots = {
      report: reportSignature(runDir, state),
      contracts: scenarioContracts(state),
      artifacts: artifactLinks(state),
    };

    if (command === 'update-fixtures') {
      writeJson(EXPECTED_REPORT, snapshots.report);
      writeJson(EXPECTED_CONTRACTS, snapshots.contracts);
      writeJson(EXPECTED_ARTIFACTS, snapshots.artifacts);
      runAdversarial(runDir, root);
      console.log(`Updated preservation snapshots in ${path.relative(REPO_ROOT, FIXTURE_DIR)}`);
      return;
    }

    compareJson('report signature', snapshots.report, EXPECTED_REPORT, root);
    compareJson('scenario contracts', snapshots.contracts, EXPECTED_CONTRACTS, root);
    compareJson('artifact links', snapshots.artifacts, EXPECTED_ARTIFACTS, root);
    runAdversarial(runDir, root);
    console.log(`Preservation harness passed: ${runDir}`);
  } finally {
    releaseLock();
  }
}

main();
