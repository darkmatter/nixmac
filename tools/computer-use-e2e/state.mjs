import path from 'node:path';
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { redact } from './redaction.mjs';

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
