import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createE2eReportContext,
  recordE2eCaptureLimitation,
  recordE2ePhase,
  writeE2eReport,
} from '../tests/wdio/helpers/e2e-report.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const SCENARIO = 'live_openrouter_evolve_smoke';
const EVOLVE_MODEL = process.env.NIXMAC_E2E_OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';
const SUMMARY_MODEL = process.env.NIXMAC_E2E_OPENROUTER_SUMMARY_MODEL || 'openai/gpt-4o-mini';
const REQUEST_TIMEOUT_MS = Number(process.env.NIXMAC_E2E_OPENROUTER_PREFLIGHT_TIMEOUT_MS ?? 30000);
const MIN_LIMIT_REMAINING = parseNonNegativeNumber(
  process.env.NIXMAC_E2E_OPENROUTER_MIN_LIMIT_REMAINING,
  1,
);

function nowIso() {
  return new Date().toISOString();
}

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNonNegativeNumber(value, defaultValue) {
  const raw = trimValue(value);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function maskKey(value) {
  const key = trimValue(value);
  if (!key) {
    return 'unset';
  }

  return `redacted:${key.slice(-6)}`;
}

function selectKey() {
  const dedicatedKey = trimValue(process.env.NIXMAC_E2E_OPENROUTER_API_KEY);
  const fallbackKey = trimValue(process.env.OPENROUTER_API_KEY);
  const requireDedicated =
    trimValue(process.env.NIXMAC_E2E_REQUIRE_DEDICATED_OPENROUTER_KEY) === '1';

  if (dedicatedKey) {
    return {
      key: dedicatedKey,
      source: 'NIXMAC_E2E_OPENROUTER_API_KEY',
      requireDedicated,
    };
  }

  if (!requireDedicated && fallbackKey) {
    return {
      key: fallbackKey,
      source: 'OPENROUTER_API_KEY',
      requireDedicated,
    };
  }

  return {
    key: '',
    source: requireDedicated
      ? 'NIXMAC_E2E_OPENROUTER_API_KEY required; OPENROUTER_API_KEY fallback disabled'
      : 'NIXMAC_E2E_OPENROUTER_API_KEY or OPENROUTER_API_KEY',
    requireDedicated,
  };
}

function safeErrorMessage(body) {
  const error = body?.error;
  const message =
    typeof error?.message === 'string'
      ? error.message
      : typeof body?.message === 'string'
        ? body.message
        : null;
  const code = error?.code ?? body?.code ?? null;

  if (message && code) {
    return `${message} (code ${code})`;
  }

  return message ?? JSON.stringify(body);
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writePreflightArtifact(context, details) {
  await mkdir(context.artifactDir, { recursive: true });
  const artifactPath = path.join(context.artifactDir, 'openrouter-preflight.json');
  await writeFile(artifactPath, `${JSON.stringify(details, null, 2)}\n`, 'utf-8');
  return path.relative(path.join(E2E_TAURI_DIR, 'artifacts'), artifactPath).split(path.sep).join('/');
}

async function checkCompletionModel({ model, headers }) {
  const result = await requestJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      max_tokens: 8,
      temperature: 0,
    }),
  });

  return {
    result,
    details: {
      httpStatus: result.status,
      model: result.body?.model ?? null,
      answer: result.body?.choices?.[0]?.message?.content ?? null,
      usage: result.body?.usage ?? null,
    },
  };
}

async function failPreflight(message, details, startedAt) {
  const context = await createE2eReportContext({ scenario: SCENARIO, lane: 'tauri-wdio' });
  const finishedAt = nowIso();
  const artifactPath = await writePreflightArtifact(context, {
    ...details,
    status: 'failed',
    message,
    finishedAt,
  });

  await recordE2eCaptureLimitation(context, 'provider_environment_failed');
  await recordE2eCaptureLimitation(context, 'live_provider_preflight_failed');
  await recordE2ePhase(context, {
    name: 'preflight live OpenRouter key and model',
    status: 'infra_failed',
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    assertions: ['Authenticate OpenRouter key and complete one tiny request against the live model'],
    proof: [
      {
        kind: 'log',
        path: artifactPath,
        url: null,
        thumbnailUrl: null,
        timestampMs: null,
        phase: 'preflight live OpenRouter key and model',
        caption: 'OpenRouter preflight diagnostic result',
        isPrimary: true,
        isFailureProof: true,
      },
    ],
    error: message,
  });
  await writeE2eReport(context, { exitCode: 1 });
  console.error(message);
  process.exit(1);
}

async function main() {
  const startedAt = nowIso();
  const selected = selectKey();
  const baseDetails = {
    schemaVersion: 1,
    scenario: SCENARIO,
    keySource: selected.source,
    keyFingerprint: maskKey(selected.key),
    evolveModel: EVOLVE_MODEL,
    summaryModel: SUMMARY_MODEL,
    requireDedicatedKey: selected.requireDedicated,
    minLimitRemaining: MIN_LIMIT_REMAINING,
    startedAt,
  };

  if (MIN_LIMIT_REMAINING === null) {
    await failPreflight(
      'NIXMAC_E2E_OPENROUTER_MIN_LIMIT_REMAINING must be a non-negative number.',
      baseDetails,
      startedAt,
    );
  }

  if (!selected.key) {
    await failPreflight(
      selected.requireDedicated
        ? 'Live OpenRouter scenario requires GitHub secret NIXMAC_E2E_OPENROUTER_API_KEY; generic OPENROUTER_API_KEY fallback is disabled for CI.'
        : 'Live OpenRouter scenario requires NIXMAC_E2E_OPENROUTER_API_KEY or OPENROUTER_API_KEY.',
      baseDetails,
      startedAt,
    );
  }

  const headers = {
    Authorization: `Bearer ${selected.key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/darkmatter/nixmac',
    'X-Title': 'nixmac-e2e-openrouter-preflight',
  };

  const authResult = await requestJson('https://openrouter.ai/api/v1/auth/key', {
    headers: { Authorization: `Bearer ${selected.key}` },
  });
  const authDetails = {
    httpStatus: authResult.status,
    usage: numberValue(authResult.body?.data?.usage),
    limit: numberValue(authResult.body?.data?.limit),
    limitRemaining: numberValue(authResult.body?.data?.limit_remaining),
    isFreeTier: authResult.body?.data?.is_free_tier ?? null,
  };

  if (!authResult.ok) {
    await failPreflight(
      `OpenRouter key auth preflight failed with HTTP ${authResult.status}: ${safeErrorMessage(
        authResult.body,
      )}`,
      {
        ...baseDetails,
        auth: authDetails,
      },
      startedAt,
    );
  }

  if (
    MIN_LIMIT_REMAINING > 0 &&
    authDetails.limitRemaining !== null &&
    authDetails.limitRemaining < MIN_LIMIT_REMAINING
  ) {
    await failPreflight(
      `OpenRouter key has ${authDetails.limitRemaining} limit remaining, below required minimum ${MIN_LIMIT_REMAINING}.`,
      {
        ...baseDetails,
        auth: authDetails,
      },
      startedAt,
    );
  }

  const { result: evolveCompletionResult, details: evolveCompletionDetails } =
    await checkCompletionModel({ model: EVOLVE_MODEL, headers });

  if (!evolveCompletionResult.ok) {
    await failPreflight(
      `OpenRouter live model preflight failed with HTTP ${
        evolveCompletionResult.status
      }: ${safeErrorMessage(evolveCompletionResult.body)}`,
      {
        ...baseDetails,
        auth: authDetails,
        evolveCompletion: evolveCompletionDetails,
      },
      startedAt,
    );
  }

  const { result: summaryCompletionResult, details: summaryCompletionDetails } =
    SUMMARY_MODEL === EVOLVE_MODEL
      ? { result: evolveCompletionResult, details: evolveCompletionDetails }
      : await checkCompletionModel({ model: SUMMARY_MODEL, headers });

  if (!summaryCompletionResult.ok) {
    await failPreflight(
      `OpenRouter summary model preflight failed with HTTP ${
        summaryCompletionResult.status
      }: ${safeErrorMessage(summaryCompletionResult.body)}`,
      {
        ...baseDetails,
        auth: authDetails,
        evolveCompletion: evolveCompletionDetails,
        summaryCompletion: summaryCompletionDetails,
      },
      startedAt,
    );
  }

  console.log(
    `OpenRouter preflight passed using ${selected.source} (${maskKey(
      selected.key,
    )}) with evolve=${EVOLVE_MODEL} summary=${SUMMARY_MODEL}`,
  );
}

main().catch(async (error) => {
  const message = `OpenRouter preflight crashed: ${
    error instanceof Error ? error.message : String(error)
  }`;
  await failPreflight(
    message,
    {
      schemaVersion: 1,
      scenario: SCENARIO,
      evolveModel: EVOLVE_MODEL,
      summaryModel: SUMMARY_MODEL,
      startedAt: nowIso(),
    },
    nowIso(),
  );
});
