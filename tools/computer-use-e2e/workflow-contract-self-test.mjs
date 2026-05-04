#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/computer-use-e2e.yml');
const workflow = readFileSync(workflowPath, 'utf8');

function section(startPattern, endPattern = null) {
  const start = workflow.search(startPattern);
  assert.notEqual(start, -1, `missing section matching ${startPattern}`);
  if (!endPattern) return workflow.slice(start);
  const rest = workflow.slice(start + 1);
  const relativeEnd = rest.search(endPattern);
  assert.notEqual(relativeEnd, -1, `missing end section matching ${endPattern}`);
  return workflow.slice(start, start + 1 + relativeEnd);
}

const prepare = section(/^  prepare:$/m, /^  remote-computer-use:$/m);
const remote = section(/^  remote-computer-use:$/m, /^  publish-report:$/m);
const publish = section(/^  publish-report:$/m, /^  e2e-result:$/m);
const result = section(/^  e2e-result:$/m);

assert.equal(/^concurrency:/m.test(workflow), false, 'workflow must not serialize prepare under top-level concurrency');

assert.match(remote, /\n    needs: prepare\n/, 'remote job must depend on prepare');
assert.match(remote, /\n    if: needs\.prepare\.outputs\.remote_ready == 'true'\n/, 'remote job must only acquire the DXU lane after prepare marks it ready');
assert.match(remote, /concurrency:\n\s+group: computer-use-e2e-dxu-remote\n\s+cancel-in-progress: false/, 'remote job must keep the singleton DXU lock');
assert.match(publish, /concurrency:\n\s+group: computer-use-e2e-gh-pages-publish\n\s+cancel-in-progress: false/, 'publish job must serialize gh-pages writes');

assert.equal(/Preflight remote Mac/.test(prepare), false, 'prepare must not run remote readiness');
assert.equal(/--key ~\/\.ssh\/nixmac-e2e/.test(prepare), false, 'prepare must not use the remote SSH key for readiness');
assert.equal(/--known-hosts ~\/\.ssh\/known_hosts/.test(prepare), false, 'prepare must not use remote known_hosts for readiness');
assert.equal(/\n\s+ssh\s/.test(prepare), false, 'prepare must not open SSH sessions');
assert.equal(/\n\s+scp\s/.test(prepare), false, 'prepare must not copy to the remote Mac');

const staleRecheckIndex = remote.indexOf('Check stale queued PR run before remote work');
const prepareSshIndex = remote.indexOf('Prepare SSH');
assert.ok(staleRecheckIndex >= 0, 'remote job must recheck stale queued PR runs');
assert.ok(prepareSshIndex >= 0, 'remote job must prepare SSH after stale recheck');
assert.ok(staleRecheckIndex < prepareSshIndex, 'stale recheck must happen before SSH or remote work');
assert.match(
  remote,
  /printf '%s\\n' \/flake\.lock \/result > "\$config_tmp\/config\/\.gitignore"/,
  'remote disposable config must ignore generated flake.lock and result artifacts before launch',
);

assert.match(prepare, /Render app artifact setup failure report/, 'prepare must render a setup-failure report when app artifact packaging fails');
assert.match(result, /setup_failed="\$\{\{ needs\.prepare\.outputs\.setup_failed \}\}"/, 'final result job must observe prepare setup failures');
assert.match(result, /Prepare produced a setup-failure report; failing the result job/, 'setup failures must keep the check result honest');

assert.match(publish, /git -C "\$site_dir" fetch --depth=1 origin gh-pages/, 'publisher must fetch gh-pages under the serialized publish lane');
assert.match(publish, /git -C "\$site_dir" push -q origin gh-pages/, 'publisher must push gh-pages only from the serialized publish lane');

console.log('Computer Use workflow contract self-test passed.');
