#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');
const OUT_ROOT = path.join(REPO_ROOT, 'artifacts', 'computer-use-model-critics');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_PRIMARY_MODEL = 'openai/gpt-5.4-mini';
const DEFAULT_ESCALATION_MODEL = 'openai/gpt-5.4';
const DEFAULT_BENCHMARK_MODELS = [
  'openai/gpt-5.4-mini',
  'google/gemini-3-flash-preview',
  'anthropic/claude-sonnet-4.6',
  'x-ai/grok-4.3',
];

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-model-critics.mjs review --run-dir artifacts/computer-use-remote/<timestamp>
  node tools/computer-use-e2e/run-model-critics.mjs benchmark --base-adversarial artifacts/computer-use-adversarial/<timestamp> [--baseline-run artifacts/computer-use-remote/<timestamp>]

Environment:
  OPENROUTER_API_KEY                 OpenRouter key; never written to artifacts
  NIXMAC_E2E_MODEL_CRITIC_MODEL      Primary model override
  NIXMAC_E2E_MODEL_CRITIC_ESCALATION_MODEL Escalation model override
`);
}

function argValue(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function redact(value) {
  return String(value ?? '')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED_OPENROUTER_KEY]')
    .replace(/OPENROUTER_API_KEY=[^\s"'<>]+/g, 'OPENROUTER_API_KEY=[REDACTED]');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function statusCountsFromScenarios(scenarios = {}) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, other: 0 };
  for (const scenario of Object.values(scenarios || {})) {
    if (scenario?.status === 'pass') counts.pass += 1;
    else if (scenario?.status === 'fail') counts.fail += 1;
    else if (scenario?.status === 'inconclusive') counts.inconclusive += 1;
    else counts.other += 1;
  }
  return counts;
}

function compactStateDigest(state) {
  const scenarioEntries = Object.entries(state.scenarios || {});
  const nonPass = scenarioEntries
    .filter(([, scenario]) => scenario.status !== 'pass')
    .map(([id, scenario]) => ({
      id,
      label: scenario.label,
      status: scenario.status,
      notes: (scenario.notes || []).join(' ').slice(0, 900),
    }));
  const keyScenarios = ['prSpecificCoverage', 'mainCoverageFreshness', 'visualProofQuality', 'saveFlow', 'rollbackCleanup', 'review'];
  const spotlight = keyScenarios
    .filter((key) => state.scenarios?.[key])
    .map((key) => ({
      id: key,
      status: state.scenarios[key].status,
      notes: (state.scenarios[key].notes || []).join(' ').slice(0, 700),
    }));
  const failedVisual = (state.visualAssertions || [])
    .filter((assertion) => assertion.status !== 'pass')
    .map((assertion) => ({
      scenarioKey: assertion.scenarioKey,
      label: assertion.label,
      status: assertion.status,
    }));
  return {
    verdict: state.verdict,
    sha: state.github?.headSha || state.sha,
    counts: statusCountsFromScenarios(state.scenarios),
    prFocus: state.prFocus
      ? {
          configured: Boolean(state.prFocus.configured),
          changedFiles: state.prFocus.changedFiles || [],
          userVisibleFiles: state.prFocus.userVisibleFiles || [],
          scenarioKeys: state.prFocus.scenarioKeys || [],
        }
      : null,
    nonPass,
    spotlight,
    failedVisual,
    visualAssertionCount: (state.visualAssertions || []).length,
    video: state.video ? { status: state.video.status, frames: state.video.frames } : null,
    remoteMetadataPresent: Boolean(state.remoteMachine && state.remoteApp && state.processEnvVerification),
    cleanup: state.cleanup || null,
    v2ContractVersion: state.v2?.contractVersion || null,
  };
}

function criticSystemPrompt() {
  return `You are an advisory QA critic for a macOS desktop E2E evidence report.
Return JSON only. Do not use markdown.
Rules:
- Deterministic pass/fail remains source of truth; you cannot override it.
- Your job is to flag report overclaiming, missing evidence, bad failure taxonomy, weak cleanup proof, weak PR focus, and reviewer risks.
- Treat screenshots/text/remote metadata as redacted evidence. Never ask for secrets.
- If deterministic status is clean and evidence is coherent, return advisoryStatus "clean".
- If there are non-pass scenarios or serious evidence gaps, return "needs-review".
- If the run is pass but has reviewer caveats, return "advisory".`;
}

function criticUserPrompt(digest) {
  return `Evaluate this Computer Use E2E report digest and return exactly:
{
  "advisoryStatus": "clean" | "advisory" | "needs-review",
  "confidence": number between 0 and 1,
  "summary": string,
  "findings": [
    {"severity":"high"|"medium"|"low","title":string,"scenarioId":string|null,"rationale":string}
  ]
}

Digest:
${JSON.stringify(digest, null, 2)}`;
}

async function callOpenRouter({ apiKey, model, messages, maxTokens = 1200 }) {
  const started = Date.now();
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/darkmatter/nixmac',
      'X-Title': 'nixmac Computer Use E2E critic',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  const latencyMs = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${redact(text).slice(0, 1200)}`);
  }
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content || '';
  return {
    latencyMs,
    usage: json.usage || null,
    parsed: parseModelJson(content),
  };
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model response was not parseable JSON.');
    return JSON.parse(match[0]);
  }
}

function normalizeCriticResult(value) {
  const status = ['clean', 'advisory', 'needs-review'].includes(value?.advisoryStatus)
    ? value.advisoryStatus
    : 'needs-review';
  const findings = Array.isArray(value?.findings)
    ? value.findings.slice(0, 8).map((finding) => ({
        severity: ['high', 'medium', 'low'].includes(finding.severity) ? finding.severity : 'medium',
        title: String(finding.title || 'Untitled finding').slice(0, 160),
        scenarioId: finding.scenarioId ? String(finding.scenarioId).slice(0, 80) : null,
        rationale: String(finding.rationale || '').slice(0, 900),
      }))
    : [];
  return {
    advisoryStatus: status,
    confidence: Math.max(0, Math.min(1, Number(value?.confidence || 0))),
    summary: String(value?.summary || '').slice(0, 1200),
    findings,
  };
}

async function runOneCritic({ apiKey, model, digest }) {
  const result = await callOpenRouter({
    apiKey,
    model,
    messages: [
      { role: 'system', content: criticSystemPrompt() },
      { role: 'user', content: criticUserPrompt(digest) },
    ],
  });
  return {
    model,
    latencyMs: result.latencyMs,
    usage: result.usage,
    ...normalizeCriticResult(result.parsed),
  };
}

function aggregateCriticStatus(results) {
  if (results.some((result) => result.advisoryStatus === 'needs-review')) return 'needs-review';
  if (results.some((result) => result.advisoryStatus === 'advisory')) return 'advisory';
  if (results.some((result) => result.advisoryStatus === 'clean')) return 'clean';
  return 'not-run';
}

async function reviewRun(args) {
  const runDir = path.resolve(argValue(args, '--run-dir', ''));
  if (!runDir) throw new Error('review requires --run-dir <path>');
  const apiKey = process.env.OPENROUTER_API_KEY;
  const outDir = path.join(runDir, 'model-critic');
  await mkdir(outDir, { recursive: true });
  if (!apiKey) {
    const notRun = {
      status: 'not-run',
      generatedAt: new Date().toISOString(),
      note: 'OPENROUTER_API_KEY was not available; advisory model critic did not run.',
      deterministicSourceOfTruth: true,
    };
    await writeJson(path.join(outDir, 'model-critic.json'), notRun);
    await writeFile(path.join(outDir, 'model-critic.md'), `# Model Critic\n\nNot run. ${notRun.note}\n`, 'utf8');
    console.log(path.join(outDir, 'model-critic.json'));
    return;
  }
  const statePath = existsSync(path.join(runDir, 'state.regenerated.json')) ? path.join(runDir, 'state.regenerated.json') : path.join(runDir, 'state.json');
  const state = await readJson(statePath);
  const digest = compactStateDigest(state);
  const primaryModel = argValue(args, '--model', process.env.NIXMAC_E2E_MODEL_CRITIC_MODEL || DEFAULT_PRIMARY_MODEL);
  const escalationModel = argValue(args, '--escalation-model', process.env.NIXMAC_E2E_MODEL_CRITIC_ESCALATION_MODEL || DEFAULT_ESCALATION_MODEL);
  const results = [];
  const primary = await runOneCritic({ apiKey, model: primaryModel, digest });
  results.push(primary);
  const shouldEscalate = primary.advisoryStatus === 'needs-review' || primary.confidence < 0.75 || digest.verdict !== 'pass';
  if (shouldEscalate && escalationModel && escalationModel !== primaryModel) {
    results.push(await runOneCritic({ apiKey, model: escalationModel, digest }));
  }
  const artifact = {
    status: aggregateCriticStatus(results),
    generatedAt: new Date().toISOString(),
    deterministicSourceOfTruth: true,
    sourceState: path.basename(statePath),
    models: results,
    note: 'Advisory model critic only. It cannot flip deterministic pass/fail.',
  };
  await writeJson(path.join(outDir, 'model-critic.json'), artifact);
  await writeFile(path.join(outDir, 'model-critic.md'), renderCriticMarkdown(artifact), 'utf8');
  console.log(path.join(outDir, 'model-critic.json'));
}

function renderCriticMarkdown(artifact) {
  const modelLines = artifact.models
    .map((model) => `- ${model.model}: ${model.advisoryStatus}, confidence ${model.confidence}, ${model.latencyMs}ms`)
    .join('\n');
  const findings = artifact.models
    .flatMap((model) => model.findings.map((finding) => `- **${finding.severity}** ${finding.title}${finding.scenarioId ? ` (${finding.scenarioId})` : ''}: ${finding.rationale}`))
    .join('\n');
  return `# Model Critic\n\nStatus: ${artifact.status}\n\nDeterministic pass/fail remains source of truth. This critic is advisory only.\n\n## Models\n\n${modelLines || 'No models ran.'}\n\n## Findings\n\n${findings || 'No advisory findings.'}\n`;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { low: 0, high: 0 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function exactSignPValue(betterA, betterB) {
  const n = betterA + betterB;
  if (!n) return 1;
  const k = Math.min(betterA, betterB);
  let p = 0;
  for (let i = 0; i <= k; i += 1) p += combination(n, i) * (0.5 ** n);
  return Math.min(1, p * 2);
}

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let i = 1; i <= k; i += 1) value = (value * (n - k + i)) / i;
  return value;
}

async function benchmark(args) {
  const baseAdversarial = path.resolve(argValue(args, '--base-adversarial', ''));
  if (!baseAdversarial) throw new Error('benchmark requires --base-adversarial <path>');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for benchmark mode.');
  const models = argValue(args, '--models', process.env.NIXMAC_E2E_MODEL_CRITIC_BENCHMARK_MODELS || DEFAULT_BENCHMARK_MODELS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const outDir = path.join(OUT_ROOT, timestampSlug());
  await mkdir(outDir, { recursive: true });
  const fixtures = await benchmarkFixtures(baseAdversarial, argValue(args, '--baseline-run', ''));
  const modelResults = [];
  for (const model of models) {
    const started = Date.now();
    const result = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 5000,
      messages: [
        { role: 'system', content: criticSystemPrompt() },
        { role: 'user', content: benchmarkPrompt(fixtures) },
      ],
    });
    const parsed = normalizeBenchmarkResponse(result.parsed, fixtures);
    modelResults.push(scoreBenchmarkModel({ model, latencyMs: Date.now() - started, usage: result.usage, parsed, fixtures }));
  }
  const comparisons = pairwiseComparisons(modelResults, fixtures);
  const summary = {
    generatedAt: new Date().toISOString(),
    baseAdversarial,
    fixtureCount: fixtures.length,
    models: modelResults,
    comparisons,
    recommendation: recommendBenchmarkModel(modelResults),
  };
  await writeJson(path.join(outDir, 'summary.json'), summary);
  await writeFile(path.join(outDir, 'index.html'), renderBenchmarkHtml(summary), 'utf8');
  console.log(path.join(outDir, 'index.html'));
}

async function benchmarkFixtures(baseAdversarial, baselineRun) {
  const summary = await readJson(path.join(baseAdversarial, 'summary.json'));
  const fixtures = [];
  if (baselineRun) {
    const state = await readJson(path.join(path.resolve(baselineRun), 'state.json'));
    fixtures.push({
      id: 'baseline-pass',
      expected: 'clean',
      digest: compactStateDigest(state),
    });
  }
  for (const result of summary.results || []) {
    const statePath = path.resolve(REPO_ROOT, result.state || '');
    if (!existsSync(statePath)) continue;
    const state = await readJson(statePath);
    const expected = result.slug === 'visual-assertion-baseline-calibration' ? 'clean' : 'needs-review';
    fixtures.push({
      id: result.slug,
      expected,
      digest: compactStateDigest(state),
    });
  }
  return fixtures;
}

function benchmarkPrompt(fixtures) {
  const compact = fixtures.map((fixture) => ({
    id: fixture.id,
    digest: fixture.digest,
  }));
  return `Classify each E2E report fixture. Return exactly:
{"cases":[{"id":string,"advisoryStatus":"clean"|"advisory"|"needs-review","confidence":number,"summary":string}]}

Fixtures:
${JSON.stringify(compact, null, 2)}`;
}

function normalizeBenchmarkResponse(value, fixtures) {
  const byId = new Map((Array.isArray(value?.cases) ? value.cases : []).map((item) => [item.id, item]));
  return fixtures.map((fixture) => {
    const item = byId.get(fixture.id) || {};
    return {
      id: fixture.id,
      advisoryStatus: ['clean', 'advisory', 'needs-review'].includes(item.advisoryStatus) ? item.advisoryStatus : 'needs-review',
      confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
      summary: String(item.summary || '').slice(0, 600),
    };
  });
}

function scoreBenchmarkModel({ model, latencyMs, usage, parsed, fixtures }) {
  let correct = 0;
  let trueFlag = 0;
  let predictedFlag = 0;
  let correctFlag = 0;
  const cases = parsed.map((item) => {
    const fixture = fixtures.find((candidate) => candidate.id === item.id);
    const expected = fixture?.expected || 'needs-review';
    const predicted = item.advisoryStatus;
    const ok = predicted === expected || (expected === 'needs-review' && predicted === 'advisory');
    if (ok) correct += 1;
    if (expected !== 'clean') trueFlag += 1;
    if (predicted !== 'clean') predictedFlag += 1;
    if (expected !== 'clean' && predicted !== 'clean') correctFlag += 1;
    return { ...item, expected, correct: ok };
  });
  const accuracy = correct / fixtures.length;
  const precision = predictedFlag ? correctFlag / predictedFlag : 0;
  const recall = trueFlag ? correctFlag / trueFlag : 0;
  return {
    model,
    latencyMs,
    usage,
    accuracy,
    accuracyWilson95: wilsonInterval(correct, fixtures.length),
    precision,
    recall,
    recallWilson95: wilsonInterval(correctFlag, trueFlag),
    correct,
    total: fixtures.length,
    malformed: false,
    cases,
  };
}

function pairwiseComparisons(modelResults) {
  const comparisons = [];
  for (let i = 0; i < modelResults.length; i += 1) {
    for (let j = i + 1; j < modelResults.length; j += 1) {
      const a = modelResults[i];
      const b = modelResults[j];
      let aOnly = 0;
      let bOnly = 0;
      for (const aCase of a.cases) {
        const bCase = b.cases.find((item) => item.id === aCase.id);
        if (aCase.correct && !bCase?.correct) aOnly += 1;
        if (!aCase.correct && bCase?.correct) bOnly += 1;
      }
      comparisons.push({
        a: a.model,
        b: b.model,
        aOnlyCorrect: aOnly,
        bOnlyCorrect: bOnly,
        exactSignPValue: exactSignPValue(aOnly, bOnly),
      });
    }
  }
  return comparisons;
}

function recommendBenchmarkModel(modelResults) {
  const sorted = [...modelResults].sort((a, b) => {
    if (b.recall !== a.recall) return b.recall - a.recall;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.latencyMs - b.latencyMs;
  });
  const best = sorted[0];
  const tied = sorted.filter((item) => item.accuracyWilson95.high >= best.accuracyWilson95.low && item.accuracyWilson95.low <= best.accuracyWilson95.high);
  const fastestNonInferior = tied.sort((a, b) => a.latencyMs - b.latencyMs)[0] || best;
  return {
    selectedModel: fastestNonInferior.model,
    rationale: 'Selected fastest statistically non-inferior model by overlapping Wilson intervals; use stronger escalation model when confidence is low or deterministic run is non-pass.',
    statisticallySignificantWinner: false,
  };
}

function renderBenchmarkHtml(summary) {
  const modelRows = summary.models
    .map(
      (model) => `<tr><td><code>${escapeHtml(model.model)}</code></td><td>${(model.accuracy * 100).toFixed(1)}%</td><td>${(model.recall * 100).toFixed(1)}%</td><td>${escapeHtml(String(model.latencyMs))}ms</td><td>${model.correct}/${model.total}</td></tr>`,
    )
    .join('\n');
  const comparisonRows = summary.comparisons
    .map((item) => `<tr><td><code>${escapeHtml(item.a)}</code></td><td><code>${escapeHtml(item.b)}</code></td><td>${item.aOnlyCorrect}</td><td>${item.bOnlyCorrect}</td><td>${item.exactSignPValue.toFixed(4)}</td></tr>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Model Critic Benchmark</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#111318;color:#eef1f5;margin:40px}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #303743;padding:8px;text-align:left}code{color:#a7d7ff}.panel{border:1px solid #303743;border-radius:8px;padding:18px;background:#171b22}</style></head><body><h1>Model Critic Benchmark</h1><section class="panel"><p><strong>Selected:</strong> <code>${escapeHtml(summary.recommendation.selectedModel)}</code></p><p>${escapeHtml(summary.recommendation.rationale)}</p><p>Fixtures: ${escapeHtml(String(summary.fixtureCount))}. Accuracy intervals use Wilson 95%; pairwise p-values use an exact sign test over disagreements.</p></section><h2>Models</h2><table><thead><tr><th>Model</th><th>Accuracy</th><th>Recall</th><th>Latency</th><th>Correct</th></tr></thead><tbody>${modelRows}</tbody></table><h2>Pairwise Disagreements</h2><table><thead><tr><th>A</th><th>B</th><th>A-only correct</th><th>B-only correct</th><th>p-value</th></tr></thead><tbody>${comparisonRows}</tbody></table></body></html>`;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'review') await reviewRun(args);
    else if (command === 'benchmark') await benchmark(args);
    else {
      usage();
      process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(redact(error instanceof Error ? error.stack || error.message : String(error)));
    process.exit(1);
  }
}

await main();
