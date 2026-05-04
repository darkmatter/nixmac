import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PEEKABOO_E2E_SCENARIO_KEYS = Object.freeze({
  macos_descriptor_prompt_smoke: 'peekabooDescriptorPromptSmoke',
  macos_provider_evolve_full_smoke: 'peekabooProviderEvolveFullSmoke',
  'nix-install': 'peekabooNixInstall',
});

export const DEFAULT_PEEKABOO_SCENARIO = 'macos_descriptor_prompt_smoke';

export function listPeekabooScenarios({ e2eRoot }) {
  const scenariosDir = path.join(e2eRoot, 'scenarios');
  return readdirSync(scenariosDir)
    .filter((entry) => entry.endsWith('.sh'))
    .map((entry) => entry.replace(/\.sh$/, ''))
    .sort();
}

export function isDestructivePeekabooScenario(scenario) {
  return scenario === 'nix-install';
}

export function buildPeekabooRunPlan({
  repoRoot,
  runDir,
  scenario = DEFAULT_PEEKABOO_SCENARIO,
  noRecord = false,
  noCleanup = true,
  allowDestructive = false,
  env = process.env,
}) {
  const e2eRoot = path.join(repoRoot, 'tests/e2e');
  const runScript = path.join(e2eRoot, 'run.sh');
  const scenarioFile = path.join(e2eRoot, 'scenarios', `${scenario}.sh`);
  const screenshotDir = path.join(runDir, 'screenshots');
  const videoDir = path.join(runDir, 'video');
  const reportRoot = path.join(runDir, 'e2e-report');
  const logFile = path.join(runDir, 'peekaboo-e2e.log');
  const videoFile = path.join(videoDir, 'peekaboo-e2e.mp4');
  const resultsFile = logFile.replace(/\.log$/, '-results.json');
  const reportFile = path.join(reportRoot, scenario, 'e2e-report.json');

  if (!existsSync(runScript)) throw new Error(`Peekaboo E2E runner not found: ${runScript}`);
  if (!existsSync(path.join(e2eRoot, 'lib', 'peekaboo.sh'))) {
    throw new Error(`Peekaboo driver not found: ${path.join(e2eRoot, 'lib', 'peekaboo.sh')}`);
  }
  if (!existsSync(scenarioFile)) throw new Error(`Peekaboo E2E scenario not found: ${scenarioFile}`);
  if (isDestructivePeekabooScenario(scenario) && !allowDestructive) {
    throw new Error(
      `${scenario} is destructive: it can uninstall/reinstall system Nix. Re-run with --allow-destructive only on a disposable runner.`,
    );
  }

  const args = [runScript, scenario, '--json'];
  if (noRecord) args.push('--no-record');
  if (noCleanup) args.push('--no-cleanup');

  return {
    command: 'bash',
    args,
    cwd: repoRoot,
    scenario,
    runScript,
    scenarioFile,
    screenshotDir,
    videoDir,
    reportRoot,
    logFile,
    videoFile,
    resultsFile,
    reportFile,
    env: {
      ...env,
      PATH: `/opt/homebrew/bin:${env.PATH ?? ''}`,
      E2E_SCREENSHOT_DIR: screenshotDir,
      E2E_PEEKABOO_CAPTURE_DIR: path.join(runDir, 'peekaboo-captures'),
      E2E_ARTIFACT_ROOT: reportRoot,
      E2E_LANE: 'peekaboo-local',
      E2E_RUNNER_KIND: 'peekaboo-local',
      E2E_LOG_FILE: logFile,
      E2E_VIDEO_FILE: videoFile,
      E2E_JSON: '1',
      E2E_RECORD: noRecord ? '0' : (env.E2E_RECORD ?? '1'),
      E2E_CLEANUP_NIX: noCleanup ? '0' : (env.E2E_CLEANUP_NIX ?? '1'),
    },
  };
}

function parseJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function artifactEntries(dirPath, runDir) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry))
    .sort()
    .map((entry) => {
      const fullPath = path.join(dirPath, entry);
      const fileStat = statSync(fullPath);
      return {
        label: entry.replace(/\.[^.]+$/, ''),
        path: path.relative(runDir, fullPath),
        capturedAt: new Date(fileStat.mtimeMs).toISOString(),
        note: 'Captured by Peekaboo runner.',
        bytes: fileStat.size,
      };
    });
}

function reportProofEntries(report, runDir) {
  const proofRoot = path.join(runDir, 'e2e-report');
  return (report?.proof ?? [])
    .filter((entry) => entry.kind === 'screenshot' && entry.path)
    .map((entry) => {
      const fullPath = path.join(proofRoot, entry.path);
      const fileStat = existsSync(fullPath) ? statSync(fullPath) : null;
      return {
        label: entry.caption ?? path.basename(entry.path),
        path: path.relative(runDir, fullPath),
        capturedAt: new Date(fileStat?.mtimeMs ?? Date.now()).toISOString(),
        note: entry.isFailureProof ? 'Failure proof from Peekaboo report.' : 'Proof from Peekaboo report.',
        bytes: fileStat?.size ?? 0,
      };
    });
}

function runPreflight(plan) {
  const appPath = plan.env.NIXMAC_APP_PATH ?? '/Applications/nixmac.app';
  const script = `
	set -uo pipefail
	export PATH="/opt/homebrew/bin:$PATH"
	status=0
	if command -v peekaboo; then
	  echo "Peekaboo CLI: Found"
	else
	  echo "Peekaboo CLI: Missing" >&2
	  status=1
	fi
	if command -v jq; then
	  echo "jq: Found"
	else
	  echo "jq: Missing" >&2
	  status=1
	fi
	if [ "${plan.env.E2E_RECORD}" = "1" ]; then
	  if command -v ffmpeg; then
	    echo "ffmpeg: Found"
	  else
	    echo "ffmpeg: Missing" >&2
	    status=1
	  fi
	  if command -v ffprobe; then
	    echo "ffprobe: Found"
	  else
	    echo "ffprobe: Missing" >&2
	    status=1
	  fi
	fi
	if [ -d "${appPath}" ]; then
	  echo "nixmac app: Found at ${appPath}"
	else
	  echo "nixmac app: Missing at ${appPath}" >&2
	  status=1
	fi
	if command -v peekaboo >/dev/null 2>&1; then
	  peekaboo permissions || status=1
	  bridge_status="$(peekaboo bridge status --verbose 2>&1)"
	  printf '%s\n' "$bridge_status"
	  if printf '%s\n' "$bridge_status" | grep -qE "Selected: remote (gui|onDemand)"; then
	    echo "Peekaboo Bridge: Connected"
	  else
	    echo "Peekaboo Bridge: Not Connected" >&2
	    status=1
	  fi
	fi
	exit "$status"
	`;
  const result = spawnSync('bash', ['-lc', script], {
    cwd: plan.cwd,
    env: plan.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const hasScreenRecording = /Screen Recording .*:\s*Granted/i.test(output);
  const hasAccessibility = /Accessibility .*:\s*Granted/i.test(output);
  const hasPeekaboo = /Peekaboo CLI:\s*Found/i.test(output);
  const hasJq = /jq:\s*Found/i.test(output);
  const hasApp = /nixmac app:\s*Found/i.test(output);
  const hasBridge = /Peekaboo Bridge:\s*Connected/i.test(output);
  const hasRecordingTools =
    plan.env.E2E_RECORD !== '1' || (/ffmpeg:\s*Found/i.test(output) && /ffprobe:\s*Found/i.test(output));
  const ok =
    result.status === 0 && hasPeekaboo && hasJq && hasApp && hasRecordingTools && hasScreenRecording && hasAccessibility && hasBridge;
  return {
    ok,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output,
    missing: [
      hasScreenRecording ? null : 'Screen Recording',
      hasAccessibility ? null : 'Accessibility',
      hasPeekaboo ? null : 'Peekaboo CLI',
      hasJq ? null : 'jq',
      hasRecordingTools ? null : 'ffmpeg/ffprobe',
      hasApp ? null : 'nixmac app',
      hasBridge ? null : 'Peekaboo Bridge',
    ].filter(Boolean),
  };
}

export async function runPeekabooScenario(plan) {
  await mkdir(plan.screenshotDir, { recursive: true });
  await mkdir(plan.videoDir, { recursive: true });
  await mkdir(plan.reportRoot, { recursive: true });

  const stdoutPath = path.join(path.dirname(plan.logFile), 'peekaboo-e2e.stdout.txt');
  const stderrPath = path.join(path.dirname(plan.logFile), 'peekaboo-e2e.stderr.txt');
  const preflightPath = path.join(path.dirname(plan.logFile), 'peekaboo-preflight.txt');

  const preflight = runPreflight(plan);
  await writeFile(preflightPath, preflight.output, 'utf8');
  if (!preflight.ok) {
    await writeFile(stdoutPath, preflight.stdout, 'utf8');
    await writeFile(stderrPath, preflight.stderr, 'utf8');
    return {
      scenario: plan.scenario,
      success: false,
      status: preflight.status,
      signal: null,
      error: `Peekaboo preflight failed${preflight.missing.length > 0 ? `: missing ${preflight.missing.join(', ')}` : ''}`,
      infraFailure: true,
      results: null,
      report: null,
      artifacts: {
        logFile: null,
        stdout: path.relative(path.dirname(plan.logFile), stdoutPath),
        stderr: path.relative(path.dirname(plan.logFile), stderrPath),
        preflight: path.relative(path.dirname(plan.logFile), preflightPath),
        resultsFile: null,
        reportFile: null,
        videoFile: null,
        screenshots: [],
      },
    };
  }

  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  await writeFile(stdoutPath, result.stdout ?? '', 'utf8');
  await writeFile(stderrPath, result.stderr ?? '', 'utf8');

  const results = parseJsonIfExists(plan.resultsFile);
  const report = parseJsonIfExists(plan.reportFile);
  const screenshots = [
    ...artifactEntries(plan.screenshotDir, path.dirname(plan.logFile)),
    ...reportProofEntries(report, path.dirname(plan.logFile)),
  ];
  const videoExists = existsSync(plan.videoFile);
  const reportVideoPath = report?.proof?.find((entry) => entry.kind === 'video' && entry.path)?.path;
  const reportVideoFile = reportVideoPath ? path.join(plan.reportRoot, reportVideoPath) : null;
  const hasEvidence = Boolean(results || report);

  return {
    scenario: plan.scenario,
    success:
      result.status === 0 &&
      hasEvidence &&
      results?.success !== false &&
      report?.status !== 'failed' &&
      report?.status !== 'infra_failed',
    status: result.status ?? 1,
    signal: result.signal ?? null,
    error: result.error ? String(result.error) : '',
    infraFailure: report?.status === 'infra_failed',
    results,
    report,
    artifacts: {
      logFile: path.relative(path.dirname(plan.logFile), plan.logFile),
      stdout: path.relative(path.dirname(plan.logFile), stdoutPath),
      stderr: path.relative(path.dirname(plan.logFile), stderrPath),
      preflight: path.relative(path.dirname(plan.logFile), preflightPath),
      resultsFile: existsSync(plan.resultsFile) ? path.relative(path.dirname(plan.logFile), plan.resultsFile) : null,
      reportFile: existsSync(plan.reportFile) ? path.relative(path.dirname(plan.logFile), plan.reportFile) : null,
      videoFile: videoExists
        ? path.relative(path.dirname(plan.logFile), plan.videoFile)
        : reportVideoFile && existsSync(reportVideoFile)
          ? path.relative(path.dirname(plan.logFile), reportVideoFile)
          : null,
      screenshots,
    },
  };
}

function legacyPhaseStatusToClaimStatus(status) {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  return 'inconclusive';
}

function reportPhaseStatusToClaimStatus(status) {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  return 'inconclusive';
}

export function applyPeekabooResultToState(state, peekabooResult) {
  const scenarioKey = PEEKABOO_E2E_SCENARIO_KEYS[peekabooResult.scenario] ?? 'peekabooDescriptorPromptSmoke';
  const scenarioState = state.scenarios[scenarioKey] ?? {
    label: `Peekaboo scenario: ${peekabooResult.scenario}`,
    status: 'inconclusive',
    notes: [],
  };

  scenarioState.status = peekabooResult.infraFailure ? 'inconclusive' : peekabooResult.success ? 'pass' : 'fail';
  if (peekabooResult.infraFailure) {
    scenarioState.notes.push(`Peekaboo infrastructure preflight failed; see ${peekabooResult.artifacts.preflight}.`);
  }
  scenarioState.notes.push(
    peekabooResult.results
      ? `Peekaboo runner exited ${peekabooResult.status}; parsed ${peekabooResult.results.phases?.length ?? 0} legacy phase result(s).`
      : 'Legacy JSON result file was not produced.',
  );
  if (peekabooResult.report) {
    scenarioState.notes.push(
      `Parsed structured report ${peekabooResult.artifacts.reportFile} with status ${peekabooResult.report.status}.`,
    );
  }
  state.scenarios[scenarioKey] = scenarioState;

  for (const [key, item] of Object.entries(state.scenarios)) {
    if (key !== scenarioKey && item.status === 'inconclusive') {
      item.status = 'not_required';
      item.notes.push(`Not required for Peekaboo ${peekabooResult.scenario} run.`);
    }
  }

  const reportPhases = peekabooResult.report?.phases ?? [];
  for (const phase of reportPhases) {
    state.claims.push({
      claim: `Peekaboo ${peekabooResult.scenario}: ${phase.name}`,
      status: reportPhaseStatusToClaimStatus(phase.status),
      evidence: `Recorded by tests/e2e/run.sh; see ${peekabooResult.artifacts.reportFile}.`,
    });
  }

  if (reportPhases.length === 0) {
    const phases = peekabooResult.results?.phases ?? [];
    for (const phase of phases) {
      state.claims.push({
        claim: `Peekaboo ${peekabooResult.scenario} phase ${phase.phase}: ${phase.message}`,
        status: legacyPhaseStatusToClaimStatus(phase.status),
        evidence: `Recorded by tests/e2e/run.sh; see ${peekabooResult.artifacts.logFile ?? peekabooResult.artifacts.preflight}.`,
      });
    }
    if (phases.length === 0) {
      state.claims.push({
        claim: `Peekaboo ${peekabooResult.scenario} completed with parseable phase evidence`,
        status: peekabooResult.infraFailure ? 'inconclusive' : peekabooResult.results || peekabooResult.report ? 'pass' : 'fail',
        evidence: peekabooResult.artifacts.reportFile ?? peekabooResult.artifacts.resultsFile ?? peekabooResult.artifacts.preflight,
      });
    }
  }

  state.screenshots.push(...peekabooResult.artifacts.screenshots);
  state.video = peekabooResult.artifacts.videoFile
    ? { path: peekabooResult.artifacts.videoFile, label: 'Peekaboo screen recording' }
    : state.video;
  state.narrative.push({
    ts: new Date().toISOString(),
    text: `Ran Peekaboo scenario ${peekabooResult.scenario}. Results: ${peekabooResult.artifacts.reportFile ?? peekabooResult.artifacts.resultsFile ?? 'missing'}.`,
  });
  if (peekabooResult.error) {
    state.failures.push(`Peekaboo runner error: ${peekabooResult.error}`);
  }
  return state;
}

export function peekabooRunnerSelfTest({ repoRoot }) {
  const e2eRoot = path.join(repoRoot, 'tests/e2e');
  const scenarios = listPeekabooScenarios({ e2eRoot });
  assert.ok(scenarios.includes('nix-install'), 'Peekaboo scenario discovery should find nix-install');
  assert.ok(
    scenarios.includes(DEFAULT_PEEKABOO_SCENARIO),
    `Peekaboo scenario discovery should find ${DEFAULT_PEEKABOO_SCENARIO}`,
  );
  assert.ok(
    scenarios.includes('macos_provider_evolve_full_smoke'),
    'Peekaboo scenario discovery should find provider evolve smoke',
  );

  const plan = buildPeekabooRunPlan({
    repoRoot,
    runDir: path.join(repoRoot, 'artifacts/computer-use-local/self-test'),
    scenario: DEFAULT_PEEKABOO_SCENARIO,
    noRecord: true,
    env: {},
  });
  assert.equal(plan.resultsFile.endsWith('peekaboo-e2e-results.json'), true, 'legacy JSON path derives from E2E_LOG_FILE');
  assert.equal(plan.reportFile.endsWith(`${DEFAULT_PEEKABOO_SCENARIO}/e2e-report.json`), true, 'report path lives under runDir');
  assert.equal(plan.env.E2E_CLEANUP_NIX, '0', 'Peekaboo local Product Proof runs should not uninstall Nix by default');
  assert.equal(plan.env.E2E_ARTIFACT_ROOT.endsWith('/e2e-report'), true, 'report root is scoped to runDir');
  assert.deepEqual(plan.args.slice(1), [DEFAULT_PEEKABOO_SCENARIO, '--json', '--no-record', '--no-cleanup']);

  assert.throws(
    () =>
      buildPeekabooRunPlan({
        repoRoot,
        runDir: path.join(repoRoot, 'artifacts/computer-use-local/self-test'),
        scenario: 'nix-install',
        env: {},
      }),
    /destructive/,
    'nix-install should require an explicit destructive opt-in',
  );

  const state = {
    scenarios: {
      launch: { label: 'Launch', status: 'inconclusive', notes: [] },
      peekabooDescriptorPromptSmoke: { label: 'Peekaboo smoke', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(state, {
    scenario: DEFAULT_PEEKABOO_SCENARIO,
    success: true,
    status: 0,
    error: '',
    results: null,
    report: {
      status: 'passed',
      phases: [{ name: 'Launch nixmac app', status: 'passed' }],
      proof: [],
    },
    artifacts: {
      logFile: 'peekaboo-e2e.log',
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: `e2e-report/${DEFAULT_PEEKABOO_SCENARIO}/e2e-report.json`,
      screenshots: [],
      videoFile: null,
    },
  });
  assert.equal(state.scenarios.peekabooDescriptorPromptSmoke.status, 'pass');
  assert.equal(state.scenarios.launch.status, 'not_required');
  assert.equal(state.claims.length, 1);

  const infraState = {
    scenarios: {
      launch: { label: 'Launch', status: 'inconclusive', notes: [] },
      peekabooDescriptorPromptSmoke: { label: 'Peekaboo smoke', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(infraState, {
    scenario: DEFAULT_PEEKABOO_SCENARIO,
    success: false,
    status: 1,
    error: 'Peekaboo preflight failed: missing Screen Recording, Accessibility',
    infraFailure: true,
    results: null,
    report: null,
    artifacts: {
      logFile: null,
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: null,
      screenshots: [],
      videoFile: null,
    },
  });
  assert.equal(infraState.scenarios.peekabooDescriptorPromptSmoke.status, 'inconclusive');
  assert.equal(infraState.claims.at(-1).status, 'inconclusive');
}
