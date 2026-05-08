export const timingSchemaVersion = 1;

const knownStatuses = new Set(['success', 'failure', 'skipped', 'in_progress', 'pending', 'unavailable', 'unknown']);

export function nowIso() {
  return new Date().toISOString();
}

export function durationMsBetween(startedAt, endedAt) {
  const start = Date.parse(startedAt || '');
  const end = Date.parse(endedAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function normalizeTimingPhase(input = {}) {
  const id = String(input.id || input.key || '').trim();
  if (!id) return null;
  const startedAt = input.startedAt || input.start || null;
  const endedAt = input.endedAt || input.end || null;
  const computedDurationMs = durationMsBetween(startedAt, endedAt);
  const hasExplicitDuration = input.durationMs !== undefined && input.durationMs !== null && input.durationMs !== '';
  const numericDuration = Number(input.durationMs);
  const durationMs = hasExplicitDuration && Number.isFinite(numericDuration) && numericDuration >= 0 ? Math.round(numericDuration) : computedDurationMs;
  const status = knownStatuses.has(input.status) ? input.status : input.status ? 'unknown' : endedAt ? 'success' : 'unknown';
  return {
    id,
    label: String(input.label || id),
    category: String(input.category || 'e2e'),
    status,
    observable: normalizeBoolean(input.observable, status !== 'unavailable'),
    source: String(input.source || 'runner'),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
    ...(input.note ? { note: String(input.note) } : {}),
  };
}

export function normalizeTimingState(input = {}) {
  const phases = Array.isArray(input.phases) ? input.phases.map(normalizeTimingPhase).filter(Boolean) : [];
  return {
    version: Number(input.version) || timingSchemaVersion,
    generatedAt: input.generatedAt || nowIso(),
    note:
      input.note ||
      'Timing phases are best-effort telemetry from the GitHub workflow and Computer Use runner. Unobservable phases are reported explicitly instead of inferred.',
    phases,
  };
}

export function ensureTimingState(state) {
  state.timing = normalizeTimingState(state.timing || {});
  return state.timing;
}

export function recordTimingPhase(state, phaseInput) {
  const timing = ensureTimingState(state);
  const phase = normalizeTimingPhase(phaseInput);
  if (!phase) return null;
  const index = timing.phases.findIndex((item) => item.id === phase.id);
  if (index >= 0) timing.phases[index] = { ...timing.phases[index], ...phase };
  else timing.phases.push(phase);
  timing.generatedAt = nowIso();
  return phase;
}

export function mergeTimingMetadata(state, metadata, { source = 'workflow' } = {}) {
  const timing = ensureTimingState(state);
  const incoming = normalizeTimingState(metadata);
  for (const phase of incoming.phases) {
    recordTimingPhase(state, { ...phase, source: phase.source || source });
  }
  timing.note = incoming.note || timing.note;
  timing.generatedAt = nowIso();
  return timing;
}

export function phaseSortKey(phase) {
  const start = Date.parse(phase.startedAt || '');
  return Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER;
}

export function sortedTimingPhases(timing) {
  return normalizeTimingState(timing).phases.toSorted((a, b) => phaseSortKey(a) - phaseSortKey(b));
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(Number(durationMs))) return 'not recorded';
  const ms = Math.max(0, Math.round(Number(durationMs)));
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function timingTotals(timing) {
  const phases = sortedTimingPhases(timing);
  const observed = phases.filter((phase) => Number.isFinite(Number(phase.durationMs)));
  const totalObservedMs = observed.reduce((total, phase) => total + Number(phase.durationMs), 0);
  return {
    phaseCount: phases.length,
    observedCount: observed.length,
    unavailableCount: phases.filter((phase) => phase.status === 'unavailable' || phase.observable === false).length,
    totalObservedMs,
  };
}

export function renderTimingMarkdown(timing, { title = 'Timing Breakdown' } = {}) {
  const phases = sortedTimingPhases(timing);
  const totals = timingTotals(timing);
  const lines = [
    `### ${title}`,
    '',
    `Observed total: \`${formatDuration(totals.totalObservedMs)}\` across \`${totals.observedCount}/${totals.phaseCount}\` phases.`,
    '',
    '| Phase | Status | Duration | Source | Note |',
    '|---|---:|---:|---|---|',
  ];
  for (const phase of phases) {
    lines.push(
      `| ${phase.label} | \`${phase.status}\` | \`${formatDuration(phase.durationMs)}\` | ${phase.source || 'unknown'} | ${String(phase.note || '').replaceAll('|', '\\|')} |`,
    );
  }
  if (!phases.length) lines.push('| No timing phases recorded. | `unavailable` | `not recorded` | unknown | Timing metadata was not present. |');
  return `${lines.join('\n')}\n`;
}
