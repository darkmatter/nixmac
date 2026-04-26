import path from 'node:path';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '../../..');
const ARTIFACT_ROOT = path.join(E2E_TAURI_DIR, 'artifacts');
const REPLAY_COMMANDS = Object.freeze({
  auto_evolve_basic_package: 'bun run test:wdio:basic-prompts',
  discard_and_restore_state: 'bun run test:wdio:discard',
  feedback_report_issue: 'bun run test:wdio:feedback-report',
  history_navigation: 'bun run test:wdio:history-navigation',
  manual_evolve_existing_changes: 'bun run test:wdio:modify',
  onboarding_existing_repo: 'bun run test:wdio:onboarding',
  provider_failure_recovery: 'bun run test:wdio:provider-failure',
  provider_validation_blocks_prompt: 'bun run test:wdio:provider-validation',
  prompt_keyboard_and_suggestions: 'bun run test:wdio:prompt-keyboard',
  question_answer_followup: 'bun run test:wdio:question-answer',
  settings_controls_persistence: 'bun run test:wdio:settings-controls',
  settings_provider_change: 'bun run test:wdio:smoke',
  tauri_wdio_all: 'bun run test:wdio',
});

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function gitOutput(args, fallback = null) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: path.resolve(E2E_TAURI_DIR, '../../..'),
    });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

function firstEnvValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export async function createE2eReportContext({ scenario, lane = 'tauri-wdio' }) {
  const artifactDir = path.join(ARTIFACT_ROOT, sanitizeSegment(scenario));
  await mkdir(artifactDir, { recursive: true });

  let startedAt = nowIso();
  try {
    const metadata = JSON.parse(await readFile(path.join(artifactDir, 'run.json'), 'utf-8'));
    if (typeof metadata.startedAt === 'string') {
      startedAt = metadata.startedAt;
    }
  } catch {
    await writeFile(
      path.join(artifactDir, 'run.json'),
      `${JSON.stringify({ lane, scenario, startedAt }, null, 2)}\n`,
      'utf-8',
    );
  }

  return {
    scenario,
    lane,
    artifactDir,
    phaseLogPath: path.join(artifactDir, 'phases.jsonl'),
    limitationsPath: path.join(artifactDir, 'capture-limitations.jsonl'),
    startedAt,
  };
}

export async function resetE2eReportContext({ scenario, lane = 'tauri-wdio' }) {
  const artifactDir = path.join(ARTIFACT_ROOT, sanitizeSegment(scenario));
  const startedAt = nowIso();
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'run.json'),
    `${JSON.stringify({ lane, scenario, startedAt }, null, 2)}\n`,
    'utf-8',
  );
}

export async function recordE2ePhase(context, phase) {
  await appendFile(context.phaseLogPath, `${JSON.stringify(phase)}\n`, 'utf-8');
}

export async function recordE2eCaptureLimitation(context, limitation) {
  const value = String(limitation ?? '').trim();
  if (!value) {
    return;
  }

  await appendFile(context.limitationsPath, `${JSON.stringify(value)}\n`, 'utf-8');
}

export async function readE2ePhases(context) {
  try {
    const raw = await readFile(context.phaseLogPath, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function readE2eCaptureLimitations(context) {
  try {
    const raw = await readFile(context.limitationsPath, 'utf-8');
    return [
      ...new Set(
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .map((value) => String(value).trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

function reportPathFor(proofPath) {
  if (!proofPath) {
    return null;
  }

  if (path.isAbsolute(proofPath)) {
    return path.relative(ARTIFACT_ROOT, proofPath).split(path.sep).join('/');
  }

  return proofPath.split(path.sep).join('/');
}

function normalizeProofEntry(entry) {
  const proofPath = reportPathFor(entry.path);
  return {
    ...entry,
    path: proofPath,
    url: null,
    thumbnailUrl: null,
  };
}

function normalizePhase(phase) {
  return {
    ...phase,
    proof: (phase.proof ?? []).map(normalizeProofEntry),
  };
}

export async function writeE2eReport(context, { exitCode = 0 } = {}) {
  const finishedAt = nowIso();
  const phases = (await readE2ePhases(context)).map(normalizePhase);
  const captureLimitations = await readE2eCaptureLimitations(context);
  const proof = phases.flatMap((phase) => phase.proof ?? []);
  const firstFailure = phases.find((phase) => phase.status !== 'passed');
  const failureProof = proof.find((entry) => entry.isFailureProof);
  const failureVideo = firstFailure
    ? proof.find((entry) => entry.kind === 'video' && entry.phase === firstFailure.name) ??
      proof.find((entry) => entry.kind === 'video') ??
      null
    : null;
  const primaryProof =
    failureProof ??
    failureVideo ??
    proof.find((entry) => entry.kind === 'video' && entry.isPrimary) ??
    proof.find((entry) => entry.isPrimary) ??
    proof[0] ??
    null;
  const startedMs = Date.parse(context.startedAt);
  const finishedMs = Date.parse(finishedAt);
  const status =
    phases.length === 0
      ? 'infra_failed'
      : firstFailure?.status === 'infra_failed'
        ? 'infra_failed'
        : exitCode === 0 && !firstFailure
          ? 'passed'
          : 'failed';

  const report = {
    schemaVersion: 1,
    repo: process.env.GITHUB_REPOSITORY ?? 'darkmatter/nixmac',
    prNumber: process.env.GITHUB_PR_NUMBER ? Number(process.env.GITHUB_PR_NUMBER) : null,
    headSha:
      firstEnvValue('E2E_HEAD_SHA', 'COMMIT_SHA', 'GITHUB_SHA') ??
      (await gitOutput(['rev-parse', 'HEAD'], 'unknown')),
    baseSha: firstEnvValue('E2E_BASE_SHA', 'GITHUB_BASE_SHA'),
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ? Number(process.env.GITHUB_RUN_ATTEMPT) : null,
    lane: context.lane,
    scenario: context.scenario,
    runnerId: process.env.RUNNER_NAME ?? 'local',
    runnerKind: process.env.RUNNER_ENVIRONMENT ?? 'local',
    startedAt: context.startedAt,
    finishedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs) ? finishedMs - startedMs : 0,
    status,
    htmlReportUrl: null,
    primaryProofUrl: primaryProof?.path ?? null,
    failureProofUrl: failureProof?.path ?? null,
    failureScreenshotUrl:
      failureProof?.kind === 'screenshot' ? failureProof.path : null,
    failureVideoUrl: failureVideo?.path ?? null,
    failureTimestampMs: failureProof?.timestampMs ?? failureVideo?.timestampMs ?? null,
    replayCommand: REPLAY_COMMANDS[context.scenario] ?? `bun run test:wdio -- ${context.scenario}`,
    localReproCommand:
      REPLAY_COMMANDS[context.scenario] ?? `bun run test:wdio -- ${context.scenario}`,
    captureLimitations,
    phases,
    proof,
  };

  await writeFile(
    path.join(context.artifactDir, 'e2e-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf-8',
  );

  return report;
}
