#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import process from 'node:process';

function writeOutput(name, value) {
  const line = `${name}=${String(value ?? '')}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

function ghApi(pathname) {
  const result = spawnSync('gh', ['api', pathname], { encoding: 'utf8' });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: result.stderr || result.stdout || `gh api exited ${result.status}` };
  try {
    return { ok: true, json: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function classifyStaleRun({ eventName, runAttempt, eventPayload = {}, currentPullRequest = null, apiError = '' }) {
  if (eventName !== 'pull_request') {
    return { stale: false, reason: 'not-pull-request', prNumber: '', eventHeadSha: '', currentHeadSha: '' };
  }
  if (String(runAttempt || '1') !== '1') {
    const pr = eventPayload.pull_request || {};
    return {
      stale: false,
      reason: 'operator-rerun',
      prNumber: pr.number || '',
      eventHeadSha: pr.head?.sha || '',
      currentHeadSha: currentPullRequest?.head?.sha || '',
    };
  }

  const pr = eventPayload.pull_request || {};
  const prNumber = pr.number || eventPayload.number || '';
  const eventHeadSha = pr.head?.sha || '';
  if (!prNumber || !eventHeadSha) {
    return { stale: false, reason: 'missing-event-pr-data', prNumber, eventHeadSha, currentHeadSha: '' };
  }
  if (!currentPullRequest) {
    return { stale: false, reason: apiError ? `api-uncertainty: ${apiError}` : 'api-uncertainty', prNumber, eventHeadSha, currentHeadSha: '' };
  }
  const currentHeadSha = currentPullRequest.head?.sha || '';
  if (currentPullRequest.merged === true) {
    return { stale: true, reason: 'pr-merged-while-queued', prNumber, eventHeadSha, currentHeadSha };
  }
  if (currentPullRequest.state === 'closed') {
    return { stale: true, reason: 'pr-closed-while-queued', prNumber, eventHeadSha, currentHeadSha };
  }
  if (!currentHeadSha) {
    return { stale: false, reason: 'api-uncertainty: missing current head sha', prNumber, eventHeadSha, currentHeadSha };
  }
  if (currentHeadSha !== eventHeadSha) {
    return { stale: true, reason: 'pr-head-superseded-while-queued', prNumber, eventHeadSha, currentHeadSha };
  }
  return { stale: false, reason: 'current-pr-head', prNumber, eventHeadSha, currentHeadSha };
}

function loadEventPayload(eventPath) {
  if (!eventPath || !existsSync(eventPath)) return {};
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

function runSelfTest() {
  const eventPayload = { pull_request: { number: 42, head: { sha: 'event-sha' } } };
  assert.deepEqual(
    classifyStaleRun({
      eventName: 'pull_request',
      runAttempt: '1',
      eventPayload,
      currentPullRequest: { state: 'open', merged: false, head: { sha: 'new-sha' } },
    }),
    {
      stale: true,
      reason: 'pr-head-superseded-while-queued',
      prNumber: 42,
      eventHeadSha: 'event-sha',
      currentHeadSha: 'new-sha',
    },
    'first-attempt PR run should be stale when the current PR head changed',
  );
  assert.equal(
    classifyStaleRun({
      eventName: 'pull_request',
      runAttempt: '1',
      eventPayload,
      currentPullRequest: { state: 'open', merged: false, head: { sha: 'event-sha' } },
    }).stale,
    false,
    'first-attempt PR run should not be stale when the current PR head still matches',
  );
  assert.equal(
    classifyStaleRun({
      eventName: 'pull_request',
      runAttempt: '2',
      eventPayload,
      currentPullRequest: { state: 'open', merged: false, head: { sha: 'new-sha' } },
    }).stale,
    false,
    'operator reruns should not auto-skip as stale',
  );
  assert.equal(
    classifyStaleRun({
      eventName: 'workflow_dispatch',
      runAttempt: '1',
      eventPayload,
      currentPullRequest: { state: 'open', merged: false, head: { sha: 'new-sha' } },
    }).stale,
    false,
    'workflow_dispatch runs should not auto-skip as stale',
  );
  assert.match(
    classifyStaleRun({ eventName: 'pull_request', runAttempt: '1', eventPayload, apiError: 'network unavailable' }).reason,
    /^api-uncertainty/,
    'API uncertainty should continue normal workflow with a reason',
  );
  assert.equal(
    classifyStaleRun({
      eventName: 'pull_request',
      runAttempt: '1',
      eventPayload,
      currentPullRequest: { state: 'closed', merged: false, head: { sha: 'event-sha' } },
    }).reason,
    'pr-closed-while-queued',
    'closed PRs should no-touch skip even when the head still matches',
  );
  assert.equal(
    classifyStaleRun({
      eventName: 'pull_request',
      runAttempt: '1',
      eventPayload,
      currentPullRequest: { state: 'closed', merged: true, head: { sha: 'event-sha' } },
    }).reason,
    'pr-merged-while-queued',
    'merged PRs should no-touch skip even when the head still matches',
  );
  console.log('Stale queued-run checker self-test passed.');
}

async function main() {
  let result = { stale: false, reason: 'not-checked', prNumber: '', eventHeadSha: '', currentHeadSha: '' };
  try {
    const eventPayload = loadEventPayload(process.env.GITHUB_EVENT_PATH);
    const eventName = process.env.GITHUB_EVENT_NAME || '';
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
    const prNumber = eventPayload.pull_request?.number || eventPayload.number || '';
    let currentPullRequest = null;
    let apiError = '';
    if (eventName === 'pull_request' && String(runAttempt) === '1' && prNumber && process.env.GITHUB_REPOSITORY) {
      const response = ghApi(`repos/${process.env.GITHUB_REPOSITORY}/pulls/${prNumber}`);
      if (response.ok) currentPullRequest = response.json;
      else apiError = response.error;
    }
    result = classifyStaleRun({ eventName, runAttempt, eventPayload, currentPullRequest, apiError });
  } catch (error) {
    result = {
      stale: false,
      reason: `api-uncertainty: ${error instanceof Error ? error.message : String(error)}`,
      prNumber: '',
      eventHeadSha: '',
      currentHeadSha: '',
    };
  }

  writeOutput('stale', result.stale ? 'true' : 'false');
  writeOutput('reason', result.reason);
  writeOutput('pr_number', result.prNumber);
  writeOutput('event_head_sha', result.eventHeadSha);
  writeOutput('current_head_sha', result.currentHeadSha);
}

if (process.argv[2] === 'self-test') {
  runSelfTest();
} else {
  main().catch((error) => {
    writeOutput('stale', 'false');
    writeOutput('reason', `api-uncertainty: ${error instanceof Error ? error.message : String(error)}`);
    writeOutput('pr_number', '');
    writeOutput('event_head_sha', '');
    writeOutput('current_head_sha', '');
  });
}
