#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_ROOT = path.join('artifacts', 'computer-use-remote');
const VALID_FORMATS = new Set(['json', 'markdown']);
const VERDICTS = ['pass', 'fail', 'inconclusive'];

function usage() {
  return `Usage:
  node tools/computer-use-e2e/summarize-runs.mjs [--root <path>] [--format json|markdown] [--out <path>] [--limit <n>] [--include-identity] [--reveal-prompt]
  node tools/computer-use-e2e/summarize-runs.mjs self-test`;
}

function parseArgs(argv) {
  const options = {
    command: 'summarize',
    root: DEFAULT_ROOT,
    format: 'json',
    out: null,
    limit: 10,
    includeIdentity: false,
    revealPrompt: false,
  };
  const args = [...argv];
  if (args[0] === 'self-test') {
    options.command = args.shift();
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === '--root') options.root = requireValue(arg, args.shift());
    else if (arg === '--format') options.format = requireValue(arg, args.shift());
    else if (arg === '--out') options.out = requireValue(arg, args.shift());
    else if (arg === '--limit') options.limit = Number.parseInt(requireValue(arg, args.shift()), 10);
    else if (arg === '--include-identity') options.includeIdentity = true;
    else if (arg === '--reveal-prompt') options.revealPrompt = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  if (!VALID_FORMATS.has(options.format)) throw new Error(`Invalid --format ${options.format}`);
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('--limit must be a positive integer');
  return options;
}

function requireValue(name, value) {
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

async function findStateFiles(root) {
  const rootAbs = path.resolve(root);
  const stateFiles = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'readiness') continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === 'state.json') {
        stateFiles.push(fullPath);
      }
    }
  }
  if (!existsSync(rootAbs)) return [];
  await walk(rootAbs);
  return stateFiles.sort();
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function scenarioSource(state) {
  if (state?.v2?.scenarioContracts && typeof state.v2.scenarioContracts === 'object') {
    return { source: 'v2.scenarioContracts', scenarios: state.v2.scenarioContracts };
  }
  if (state?.scenarios && typeof state.scenarios === 'object') {
    return { source: 'state.scenarios', scenarios: state.scenarios };
  }
  return { source: 'unavailable', scenarios: null };
}

function statusCounts(scenarios) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, unknown: 0 };
  for (const item of Object.values(scenarios || {})) {
    const status = typeof item?.status === 'string' ? item.status : 'unknown';
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function videoStatus(state) {
  if (typeof state?.video === 'string') {
    const value = state.video.trim();
    if (value === 'available' || value === 'unavailable') return value;
    return /\.mp4$/i.test(value) || value.includes('/') ? 'available' : 'unavailable';
  }
  return state?.video?.status || 'unavailable';
}

function eventDurationMs(state, events) {
  const startedAtMs = Date.parse(state?.startedAt || '');
  if (!Number.isFinite(startedAtMs) || !Array.isArray(events) || events.length === 0) return null;
  const eventTimes = events.map((event) => Date.parse(event?.ts || '')).filter(Number.isFinite);
  if (!eventTimes.length) return null;
  const lastEventMs = Math.max(...eventTimes);
  if (lastEventMs <= startedAtMs) return null;
  return lastEventMs - startedAtMs;
}

function hashIdentity(remoteMachine) {
  const raw = [
    remoteMachine?.localHostName,
    remoteMachine?.hardwareModel,
    remoteMachine?.macosProductVersion,
    remoteMachine?.architecture,
  ]
    .filter(Boolean)
    .join('|');
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function remoteIdentity(state, includeIdentity) {
  const machine = state?.remoteMachine;
  if (!machine) return null;
  if (includeIdentity) {
    return {
      computerName: machine.computerName || null,
      hostname: machine.hostname || null,
      localHostName: machine.localHostName || null,
      consoleUser: machine.consoleUser || null,
      macosProductVersion: machine.macosProductVersion || null,
      macosBuildVersion: machine.macosBuildVersion || null,
      architecture: machine.architecture || null,
      hardwareModel: machine.hardwareModel || null,
    };
  }
  return {
    label: 'remote-mac',
    identityHash: hashIdentity(machine),
    macosProductVersion: machine.macosProductVersion || null,
    architecture: machine.architecture || null,
  };
}

function summarizePrompt(state, revealPrompt) {
  if (!state?.prompt) return null;
  if (revealPrompt) return state.prompt;
  return { redacted: true, length: String(state.prompt).length };
}

function classifyRun(relativeRunDir, state, parseError = null) {
  if (parseError) return { category: 'corrupt-json', countsForProduct: false, countsForGate: false, reason: parseError };
  const { scenarios } = scenarioSource(state);
  if (!state?.verdict || !scenarios) {
    return { category: 'pre-contract', countsForProduct: false, countsForGate: false, reason: 'missing verdict or scenario contracts' };
  }
  const firstSegment = relativeRunDir.split('/')[0] || '';
  if (/^(chunk\d|baseline-)/.test(firstSegment)) {
    return { category: 'render-fixture', countsForProduct: true, countsForGate: false, reason: 'local copied fixture or render validation directory' };
  }
  const isLiveWorkflow = /^live-pr\d+-[^/]+\/\d{4}-\d{2}-\d{2}T/.test(relativeRunDir);
  const noTouchUnavailable =
    state.verdict === 'inconclusive' &&
    (state.screenshots || []).length === 0 &&
    (state.textSnapshots || []).length === 0 &&
    videoStatus(state) !== 'available';
  if (noTouchUnavailable) {
    return { category: 'no-touch-unavailable', countsForProduct: true, countsForGate: false, reason: 'inconclusive report without app evidence artifacts' };
  }
  if (isLiveWorkflow) return { category: 'real-workflow', countsForProduct: true, countsForGate: true, reason: 'nested live PR workflow artifact' };
  return { category: 'local-validation', countsForProduct: true, countsForGate: false, reason: 'local or historical validation artifact' };
}

function isCleanRun(run) {
  return (
    run.verdict === 'pass' &&
    run.scenarioCounts.fail === 0 &&
    run.scenarioCounts.inconclusive === 0 &&
    run.scenarioCounts.unknown === 0 &&
    run.scenarioCounts.pass > 0 &&
    run.video.status === 'available'
  );
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 8) : null;
}

async function inspectStateFile(rootAbs, stateFile, options) {
  const relativeStatePath = path.relative(rootAbs, stateFile).replaceAll(path.sep, '/');
  const relativeRunDir = relativeStatePath.replace(/\/state\.json$/, '');
  const eventsPath = path.join(path.dirname(stateFile), 'events.json');
  try {
    const state = await readJson(stateFile);
    let events = [];
    if (existsSync(eventsPath)) {
      try {
        events = await readJson(eventsPath);
      } catch {
        events = [];
      }
    }
    const source = scenarioSource(state);
    const counts = statusCounts(source.scenarios);
    const classification = classifyRun(relativeRunDir, state);
    return {
      relativeRunDir,
      relativeStatePath,
      classification,
      verdict: state.verdict || state.status || 'unknown',
      startedAt: state.startedAt || null,
      sha: state.sha || null,
      pr: state.prFocus?.number ? String(state.prFocus.number) : null,
      scenarioSource: source.source,
      scenarioCounts: counts,
      scenarioTotal: Object.values(counts).reduce((sum, count) => sum + count, 0),
      evidence: {
        screenshots: Array.isArray(state.screenshots) ? state.screenshots.length : Array.isArray(state.shots) ? state.shots.length : 0,
        textSnapshots: Array.isArray(state.textSnapshots) ? state.textSnapshots.length : 0,
      },
      video: {
        status: videoStatus(state),
        frames: typeof state?.video === 'object' ? state.video.frames || null : null,
      },
      durationMs: eventDurationMs(state, events),
      remoteIdentity: remoteIdentity(state, options.includeIdentity),
      prompt: summarizePrompt(state, options.revealPrompt),
    };
  } catch (error) {
    return {
      relativeRunDir,
      relativeStatePath,
      classification: classifyRun(relativeRunDir, null, error instanceof Error ? error.message : String(error)),
      verdict: 'unknown',
      startedAt: null,
      sha: null,
      pr: null,
      scenarioSource: 'unavailable',
      scenarioCounts: { pass: 0, fail: 0, inconclusive: 0, unknown: 0 },
      scenarioTotal: 0,
      evidence: { screenshots: 0, textSnapshots: 0 },
      video: { status: 'unavailable', frames: null },
      durationMs: null,
      remoteIdentity: null,
      prompt: null,
    };
  }
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function stats(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return { min: 0, median: 0, max: 0, total: 0 };
  return {
    min: clean[0],
    median: clean[Math.floor((clean.length - 1) / 2)],
    max: clean[clean.length - 1],
    total: clean.reduce((sum, value) => sum + value, 0),
  };
}

function startedAtSortValue(run) {
  const value = Date.parse(run.startedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function buildGateEvidence(runs) {
  const realRuns = runs
    .filter((run) => run.classification.countsForGate)
    .sort((a, b) => startedAtSortValue(a) - startedAtSortValue(b) || a.relativeRunDir.localeCompare(b.relativeRunDir));
  const deduped = [];
  const seen = new Set();
  for (const run of realRuns) {
    const key = `${run.sha || 'unknown'}|${run.startedAt || 'unknown'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(run);
  }
  const streak = [];
  for (let index = deduped.length - 1; index >= 0; index -= 1) {
    if (!isCleanRun(deduped[index])) break;
    streak.unshift(deduped[index]);
  }
  const latest = deduped[deduped.length - 1] || null;
  const latestSha = latest?.sha || null;
  const latestShaCleanRuns = latestSha ? deduped.filter((run) => run.sha === latestSha && isCleanRun(run)).length : 0;
  return {
    statement: 'Local artifact summaries are presentation evidence only. They do not satisfy required branch protection or release-gate policy by themselves.',
    realWorkflowRuns: deduped.length,
    trailingCleanRealWorkflowRuns: streak.length,
    consecutiveCleanRealWorkflowRuns: streak.length,
    latestSha: shortSha(latestSha),
    latestShaCleanRuns,
    latestRealWorkflowRun: latest ? compactRun(latest) : null,
    countedRunPaths: deduped.map((run) => run.relativeRunDir),
    cleanStreakRunPaths: streak.map((run) => run.relativeRunDir),
  };
}

function compactRun(run) {
  return {
    path: run.relativeRunDir,
    startedAt: run.startedAt,
    verdict: run.verdict,
    sha: shortSha(run.sha),
    pr: run.pr,
    scenarios: run.scenarioCounts,
    screenshots: run.evidence.screenshots,
    textSnapshots: run.evidence.textSnapshots,
    video: run.video.status,
    durationSeconds: run.durationMs == null ? null : Math.max(1, Math.round(run.durationMs / 1000)),
    classification: run.classification.category,
  };
}

export async function summarizeRuns(options = {}) {
  const merged = {
    root: DEFAULT_ROOT,
    includeIdentity: false,
    revealPrompt: false,
    limit: 10,
    ...options,
  };
  const rootAbs = path.resolve(merged.root);
  const stateFiles = await findStateFiles(rootAbs);
  const runs = [];
  for (const stateFile of stateFiles) {
    runs.push(await inspectStateFile(rootAbs, stateFile, merged));
  }

  const productRuns = runs.filter((run) => run.classification.countsForProduct);
  const verdictCounts = countBy(productRuns, (run) => VERDICTS.includes(run.verdict) ? run.verdict : 'unknown');
  for (const verdict of [...VERDICTS, 'unknown']) verdictCounts[verdict] ||= 0;
  const classificationCounts = countBy(runs, (run) => run.classification.category);
  const duplicateGroups = countBy(
    productRuns.filter((run) => run.sha && run.startedAt),
    (run) => `${run.sha}|${run.startedAt}`,
  );
  for (const run of runs) {
    const duplicateKey = run.sha && run.startedAt ? `${run.sha}|${run.startedAt}` : null;
    run.duplicateMetadataGroupSize = duplicateKey ? duplicateGroups[duplicateKey] || 1 : 1;
  }

  const sortedRuns = [...runs].sort((a, b) => startedAtSortValue(b) - startedAtSortValue(a) || a.relativeRunDir.localeCompare(b.relativeRunDir));
  const realWorkflowRuns = runs.filter((run) => run.classification.countsForGate);
  return {
    generatedAt: new Date().toISOString(),
    root: path.relative(process.cwd(), rootAbs) || '.',
    redaction: {
      remoteIdentity: merged.includeIdentity ? 'included' : 'redacted',
      prompt: merged.revealPrompt ? 'included' : 'redacted',
      runDir: 'relative-path-only',
      processEnvKeys: 'omitted',
    },
    totals: {
      stateFiles: stateFiles.length,
      parsedRuns: runs.filter((run) => run.classification.category !== 'corrupt-json').length,
      productProofRuns: productRuns.length,
      realWorkflowRuns: runs.filter((run) => run.classification.countsForGate).length,
    },
    classificationCounts,
    verdictCounts,
    evidence: {
      screenshots: stats(productRuns.map((run) => run.evidence.screenshots)),
      textSnapshots: stats(productRuns.map((run) => run.evidence.textSnapshots)),
      videos: countBy(productRuns, (run) => run.video.status),
    },
    realWorkflowEvidence: {
      screenshots: stats(realWorkflowRuns.map((run) => run.evidence.screenshots)),
      textSnapshots: stats(realWorkflowRuns.map((run) => run.evidence.textSnapshots)),
      videos: countBy(realWorkflowRuns, (run) => run.video.status),
    },
    gateEvidence: buildGateEvidence(runs),
    latestRuns: sortedRuns.slice(0, merged.limit).map(compactRun),
    runs: sortedRuns.map((run) => ({
      ...compactRun(run),
      scenarioSource: run.scenarioSource,
      duplicateMetadataGroupSize: run.duplicateMetadataGroupSize,
      remoteIdentity: run.remoteIdentity,
      prompt: run.prompt,
      reason: run.classification.reason,
    })),
  };
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push('# nixmac Product Proof Local Summary');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Root: \`${summary.root}\``);
  lines.push('');
  lines.push(`> ${summary.gateEvidence.statement}`);
  lines.push('');
  lines.push('## Rollup');
  lines.push('');
  lines.push(`- State files discovered: ${summary.totals.stateFiles}`);
  lines.push(`- Product Proof contract runs: ${summary.totals.productProofRuns}`);
  lines.push(`- Real workflow runs counted for clean streak: ${summary.gateEvidence.realWorkflowRuns}`);
  lines.push(`- Trailing clean real workflow runs: ${summary.gateEvidence.trailingCleanRealWorkflowRuns}`);
  lines.push(`- Latest SHA clean runs: ${summary.gateEvidence.latestShaCleanRuns}${summary.gateEvidence.latestSha ? ` (${shortSha(summary.gateEvidence.latestSha)})` : ''}`);
  lines.push(`- Verdicts: ${VERDICTS.map((verdict) => `${verdict} ${summary.verdictCounts[verdict] || 0}`).join(' / ')}`);
  lines.push(`- Real workflow evidence: ${summary.realWorkflowEvidence.screenshots.total} screenshots, ${summary.realWorkflowEvidence.textSnapshots.total} text snapshots, ${summary.realWorkflowEvidence.videos.available || 0} videos available`);
  lines.push(`- All Product Proof evidence: ${summary.evidence.screenshots.total} screenshots, ${summary.evidence.textSnapshots.total} text snapshots, ${summary.evidence.videos.available || 0} videos available`);
  lines.push('');
  lines.push('## Classification');
  lines.push('');
  for (const [category, count] of Object.entries(summary.classificationCounts).sort()) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push('');
  lines.push('## Latest Real Workflow Run');
  lines.push('');
  if (summary.gateEvidence.latestRealWorkflowRun) {
    const run = summary.gateEvidence.latestRealWorkflowRun;
    lines.push(`- Path: \`${run.path}\``);
    lines.push(`- Started: ${run.startedAt || 'unavailable'}`);
    lines.push(`- Verdict: ${run.verdict}`);
    lines.push(`- Result: ${run.scenarios.pass} pass / ${run.scenarios.fail} fail / ${run.scenarios.inconclusive} inconclusive`);
    lines.push(`- Evidence: ${run.screenshots} screenshots, ${run.textSnapshots} text snapshots, video ${run.video}`);
    lines.push(`- Duration: ${run.durationSeconds == null ? 'unavailable' : `${run.durationSeconds}s`}`);
  } else {
    lines.push('No real workflow run found.');
  }
  lines.push('');
  lines.push('## Latest Runs');
  lines.push('');
  lines.push('| Started | Verdict | Class | PR | SHA | Scenarios | Evidence | Path |');
  lines.push('|---|---:|---|---:|---|---:|---:|---|');
  for (const run of summary.latestRuns) {
    lines.push(
      `| ${run.startedAt || 'unavailable'} | ${run.verdict} | ${run.classification} | ${run.pr || ''} | ${run.sha || ''} | ${run.scenarios.pass}/${run.scenarios.fail}/${run.scenarios.inconclusive} | ${run.screenshots} shots / ${run.textSnapshots} texts / ${run.video} | \`${run.path}\` |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeOutputIfNeeded(options, contents, rootAbs) {
  if (!options.out) return;
  const outAbs = path.resolve(options.out);
  if (outAbs === path.join(rootAbs, 'state.json') || outAbs.startsWith(`${rootAbs}${path.sep}`)) {
    throw new Error('--out must not write inside the discovery root');
  }
  if (path.basename(outAbs) === 'state.json') throw new Error('--out must not be named state.json');
  await mkdir(path.dirname(outAbs), { recursive: true });
  await writeFile(outAbs, contents, 'utf8');
}

function outputFor(summary, format) {
  if (format === 'markdown') return renderMarkdown(summary);
  return `${JSON.stringify(summary, null, 2)}\n`;
}

async function writeFixture(root, relativeRunDir, state, events = null) {
  const dir = path.join(root, relativeRunDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  if (events) await writeFile(path.join(dir, 'events.json'), `${JSON.stringify(events, null, 2)}\n`, 'utf8');
}

function fixtureState({ verdict, startedAt, sha, pass = 2, fail = 0, inconclusive = 0, screenshots = 3, texts = 3, video = 'available', remote = true }) {
  const scenarioContracts = {};
  let index = 0;
  for (const [status, count] of Object.entries({ pass, fail, inconclusive })) {
    for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
      scenarioContracts[`scenario-${index}`] = { status, label: `Scenario ${index}` };
      index += 1;
    }
  }
  return {
    verdict,
    startedAt,
    sha,
    prFocus: { number: '42' },
    v2: { scenarioContracts },
    screenshots: Array.from({ length: screenshots }, (_, itemIndex) => ({ path: `screenshots/${itemIndex}.png` })),
    textSnapshots: Array.from({ length: texts }, (_, itemIndex) => ({ path: `texts/${itemIndex}.txt` })),
    video: { status: video, frames: screenshots },
    prompt: 'Add a package to Homebrew.',
    ...(remote
      ? {
          remoteMachine: {
            computerName: 'DXU97120',
            hostname: 'DXU97120',
            localHostName: 'DXU97120',
            consoleUser: 'admin',
            macosProductVersion: '26.2',
            architecture: 'arm64',
            hardwareModel: 'VirtualMac2,1',
          },
        }
      : {}),
  };
}

async function runSelfTest() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nixmac-summary-self-test-'));
  try {
    await writeFixture(root, 'live-pr42-100-1/2026-05-02T010000000Z', fixtureState({ verdict: 'fail', startedAt: '2026-05-02T01:00:00.000Z', sha: 'sha-fail', pass: 1, fail: 1 }), [
      { ts: '2026-05-02T01:00:30.000Z', type: 'done' },
    ]);
    await writeFixture(
      root,
      'live-pr42-101-1/2026-05-02T020000000Z',
      fixtureState({ verdict: 'inconclusive', startedAt: '2026-05-02T02:00:00.000Z', sha: 'sha-inconclusive', pass: 0, inconclusive: 2, screenshots: 0, texts: 0, video: 'unavailable', remote: false }),
    );
    await writeFixture(root, 'live-pr42-102-1/2026-05-02T030000000Z', fixtureState({ verdict: 'pass', startedAt: '2026-05-02T03:00:00.000Z', sha: 'sha-pass-a' }), [
      { ts: '2026-05-02T03:04:00.000Z', type: 'done' },
    ]);
    await writeFixture(root, 'live-pr42-103-1/2026-05-02T040000000Z', fixtureState({ verdict: 'pass', startedAt: '2026-05-02T04:00:00.000Z', sha: 'sha-pass-b' }));
    await writeFixture(root, 'chunk3-render-baseline', fixtureState({ verdict: 'pass', startedAt: '2026-05-02T04:00:00.000Z', sha: 'sha-pass-b' }));
    await writeFixture(root, '2026-05-02T050000000Z', fixtureState({ verdict: 'pass', startedAt: '2026-05-02T05:00:00.000Z', sha: 'sha-local', remote: false }));
    await writeFixture(root, '2026-04-30T170340641Z-prompt-only', { status: 'pass', note: 'legacy prompt-only state', prompt: 'Legacy prompt' });
    await mkdir(path.join(root, 'bad-json'), { recursive: true });
    await writeFile(path.join(root, 'bad-json', 'state.json'), '{bad json', 'utf8');

    const summary = await summarizeRuns({ root, limit: 20 });
    assert.equal(summary.totals.stateFiles, 8);
    assert.equal(summary.classificationCounts['real-workflow'], 3);
    assert.equal(summary.classificationCounts['no-touch-unavailable'], 1);
    assert.equal(summary.classificationCounts['render-fixture'], 1);
    assert.equal(summary.classificationCounts['local-validation'], 1);
    assert.equal(summary.classificationCounts['pre-contract'], 1);
    assert.equal(summary.classificationCounts['corrupt-json'], 1);
    assert.equal(summary.gateEvidence.trailingCleanRealWorkflowRuns, 2);
    assert.equal(summary.gateEvidence.consecutiveCleanRealWorkflowRuns, 2);
    assert.equal(summary.gateEvidence.latestShaCleanRuns, 1);
    assert.equal(summary.realWorkflowEvidence.screenshots.total, 9);
    assert.equal(summary.runs.find((run) => run.path === 'chunk3-render-baseline').duplicateMetadataGroupSize, 2);
    assert.equal(summary.runs.some((run) => JSON.stringify(run).includes('DXU97120')), false);
    assert.equal(summary.runs.some((run) => JSON.stringify(run).includes('Add a package')), false);
    const markdown = renderMarkdown(summary);
    assert.match(markdown, /Trailing clean real workflow runs: 2/);
    assert.match(markdown, /Real workflow evidence: 9 screenshots/);
    assert.match(markdown, /render-fixture: 1/);
    process.stdout.write('summarize-runs self-test passed\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'self-test') {
    await runSelfTest();
    return;
  }
  const rootAbs = path.resolve(options.root);
  const summary = await summarizeRuns(options);
  const output = outputFor(summary, options.format);
  await writeOutputIfNeeded(options, output, rootAbs);
  process.stdout.write(output);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
