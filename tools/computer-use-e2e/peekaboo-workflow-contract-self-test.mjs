#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/peekaboo-e2e.yml');
const productProofPath = path.join(repoRoot, 'tests/e2e/lib/nixmac_product_proof.sh');
const peekabooRunnerPath = path.join(repoRoot, 'tools/computer-use-e2e/peekaboo-runner.mjs');
const workflow = readFileSync(workflowPath, 'utf8');
const productProof = readFileSync(productProofPath, 'utf8');
const peekabooRunner = readFileSync(peekabooRunnerPath, 'utf8');

function section(startPattern, endPattern = null) {
  const source = typeof startPattern === 'object' && startPattern.sourceText ? startPattern.sourceText : workflow;
  const pattern = typeof startPattern === 'object' && startPattern.pattern ? startPattern.pattern : startPattern;
  const start = source.search(pattern);
  assert.notEqual(start, -1, `missing section matching ${pattern}`);
  if (!endPattern) return source.slice(start);
  const rest = source.slice(start + 1);
  const relativeEnd = rest.search(endPattern);
  assert.notEqual(relativeEnd, -1, `missing end section matching ${endPattern}`);
  return source.slice(start, start + 1 + relativeEnd);
}

const trigger = section(/^on:$/m, /^permissions:$/m);
const proof = section(/^  peekaboo-product-proof:$/m, /^  publish-peekaboo-report:$/m);
const publish = section(/^  publish-peekaboo-report:$/m, /^  peekaboo-result:$/m);
const result = section(/^  peekaboo-result:$/m);
const launchEnv = section({ sourceText: productProof, pattern: /^nixmac_pp_set_e2e_launch_env\(\) \{$/m }, /^}$/m);
const cleanup = section({ sourceText: productProof, pattern: /^nixmac_pp_cleanup_common\(\) \{$/m }, /^}$/m);

assert.doesNotMatch(trigger, /^\s+branches:/m, 'Peekaboo workflow must run for stacked PR bases, not only main');
assert.match(workflow, /build_attempts:[\s\S]*default: '2'/, 'Peekaboo PR runs should default to two remote build attempts for transient MacInCloud build failures');
assert.match(publish, /permissions:[\s\S]*contents: write/, 'publish job must be able to publish gh-pages reports');
assert.match(publish, /permissions:[\s\S]*issues: write/, 'publish job must be able to create or update the sticky PR comment');
assert.match(publish, /permissions:[\s\S]*pull-requests: write/, 'publish job must declare PR write permission like the Computer Use report lane');
assert.match(proof, /permissions:\n\s+contents: read\n\s+actions: read/, 'proof job must run PR-controlled validation without write-scoped token permissions');
assert.match(
  workflow,
  /concurrency:\n\s+group: peekaboo-e2e-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n\s+cancel-in-progress: true/,
  'workflow must cancel stale same-PR Peekaboo runs before taking the remote lane',
);

assert.match(proof, /name: Checkout repository[\s\S]*persist-credentials: false/, 'proof job checkout must not persist the workflow token before running PR-controlled scripts');
assert.doesNotMatch(proof, /^    env:\n(?:      .+\n)*      NIXMAC_REMOTE_HOST_SECRET:/m, 'proof job must not expose remote secrets at job scope');
assert.match(proof, /name: Prepare SSH for MacInCloud[\s\S]*NIXMAC_REMOTE_HOST_SECRET:[\s\S]*secrets\.NIXMAC_E2E_REMOTE_HOST/, 'Prepare SSH step must support NIXMAC_E2E_REMOTE_HOST');
assert.match(proof, /name: Prepare SSH for MacInCloud[\s\S]*MAC_E2E_HOST_SECRET:[\s\S]*secrets\.MAC_E2E_HOST/, 'Prepare SSH step must support legacy MAC_E2E_HOST fallback');
assert.match(proof, /remote_host="\$\{NIXMAC_REMOTE_HOST_SECRET:-\$MAC_E2E_HOST_SECRET\}"/, 'proof job must adapt both remote secret families');
assert.match(proof, /ssh-keyscan -H "\$remote_host"/, 'proof job must generate known_hosts when a pinned known_hosts secret is absent');
assert.match(proof, /REPO_URL=\$repo_url_q/, 'remote checkout must fetch with the workflow token when the remote origin is missing or unauthenticated');
assert.match(proof, /rm -f "\$REPO_DIR\/artifacts\/computer-use-local\/\.current-run"/, 'remote setup must clear stale current-run before any build or suite attempt');
assert.match(proof, /stale_run="\$\(cat "\$REPO_DIR\/artifacts\/computer-use-local\/\.current-run"/, 'remote setup must capture stale current-run before clearing it');
assert.match(proof, /pkill -TERM -f 'tools\/computer-use-e2e\/run-local\\\.mjs run-peekaboo-suite/, 'remote setup must terminate stale Peekaboo suite processes left by cancelled runs');
assert.match(proof, /NIXMAC_COMPUTER_USE_RUN_DIR="\$stale_run" node tools\/computer-use-e2e\/run-local\.mjs cleanup/, 'remote setup must attempt cleanup for stale current-run state before new runs');
assert.match(proof, /git remote (?:set-url|add) origin "\$REPO_URL"/, 'remote checkout must install an authenticated origin before fetch');
assert.match(proof, /git remote set-url origin "\$PUBLIC_REPO_URL"/, 'remote checkout must remove the tokenized origin after fetch');
assert.match(proof, /git remote set-url origin "\$PUBLIC_REPO_URL"\n\s+unset REPO_URL\n\s+git checkout -B "\$PR_HEAD_REF"/, 'remote build must unset the tokenized repo URL before running PR-controlled code');
assert.match(proof, /git reset --hard[\s\S]*git fetch origin "\$PR_HEAD_REF"/, 'remote checkout must discard local edits before switching to the PR head');
assert.match(proof, /git fetch origin "\$PR_HEAD_REF"[\s\S]*git reset --hard "\$PR_HEAD_SHA"/, 'remote Mac must check out the exact PR head SHA');
assert.match(proof, /git clean -fdx[\s\S]*-e target/, 'remote cleanup must remove ignored stale env inputs while retaining the cargo workspace target directory');
assert.match(proof, /command -v bun[\s\S]*bun-v1\.3\.2[\s\S]*bun --version/, 'remote build must bootstrap the pinned Bun version when MacInCloud does not have bun on PATH');
assert.match(proof, /command -v cargo[\s\S]*sh\.rustup\.rs[\s\S]*cargo --version/, 'remote build must bootstrap Rust when MacInCloud does not have cargo on PATH');
assert.match(proof, /tauri build[\s\S]*--debug[\s\S]*--bundles app[\s\S]*--config src-tauri\/tauri\.conf\.dev\.json/, 'remote Mac must build the debug app bundle used by Peekaboo');
assert.match(proof, /cp -pR "\$built_app" "\$REMOTE_APP_PATH"[\s\S]*codesign --force --deep --sign - "\$REMOTE_APP_PATH"[\s\S]*codesign --verify --deep --strict --verbose=2 "\$REMOTE_APP_PATH"/, 'remote Mac must ad-hoc sign and verify the staged debug app bundle');
assert.match(proof, /name: Capture PR focus metadata[\s\S]*append_multiline_env "NIXMAC_E2E_PR_CHANGED_FILES"/, 'proof job must capture PR changed files for Peekaboo report focus');
assert.match(proof, /secret_scan_passed: \$\{\{ steps\.report-meta\.outputs\.secret_scan_passed \}\}/, 'proof job must expose whether the report secret scan passed');
assert.match(proof, /state_secret_scan_passed="\$\(jq -r '\(\.peekaboo\.secretScan\.status \/\/ "missing"\) == "passed"' "\$state_file"\)"/, 'report metadata must read the Peekaboo secret scan result from state.json');
assert.match(proof, /trusted-secret-scan\.json[\s\S]*secretPattern[\s\S]*trusted_secret_scan_passed/, 'workflow must independently re-scan the fetched report before public publishing');
assert.match(proof, /NIXMAC_APP_PATH=\$\(printf '%q' "\$REMOTE_APP_PATH"\)[\s\S]*run-peekaboo-suite --allow-cleanup/, 'Peekaboo run must use the freshly built PR app bundle');
assert.doesNotMatch(proof, /Run Peekaboo suite on MacInCloud[\s\S]*node tools\/computer-use-e2e\/run-local\.mjs run-peekaboo-macincloud/, 'proof job must not run PR-controlled local orchestration while the MacInCloud SSH key is present');
assert.match(proof, /--allow-cleanup/, 'Peekaboo suite must restore local app support state after the run');
assert.match(proof, /artifacts\/computer-use-local\/\.current-run/, 'workflow must fetch the suite report using the runner current-run contract');
assert.match(proof, /remote_artifact_root="\$\{PEEKABOO_REPO_DIR%\/\}\/artifacts\/computer-use-local"/, 'workflow must anchor fetched reports to the expected remote artifact root');
assert.match(proof, /remote_run_dir" != "\$remote_artifact_root"\/\*/, 'workflow must reject current-run paths outside the artifact root before rsync');
assert.match(proof, /remote_run_dir_physical="\$\(ssh[\s\S]*pwd -P/, 'workflow must verify the physical remote report path before rsyncing');
assert.match(proof, /name: Record CI report inspection proof[\s\S]*run-local\.mjs verify-report "\$FETCH_REPORT_DIR"[\s\S]*--method ci-static/, 'workflow must record reportInspection parity proof before metadata is collected');
assert.match(proof, /CI workflow inspected the rendered Peekaboo HTML report[\s\S]*PR #75 baseline parity coverage[\s\S]*evidence video\/storyboard/, 'CI report inspection notes must describe concrete report sections');
assert.match(proof, /name: Upload Peekaboo report artifact[\s\S]*name: peekaboo-e2e-report/, 'proof job must upload the HTML report artifact');
assert.doesNotMatch(proof, /sudo apt-get install/, 'proof job must not spend PR time installing media packages on the hosted runner');

assert.match(publish, /github\.event_name == 'pull_request'/, 'publish job must be gated to PR events');
assert.match(publish, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, 'publish job must be gated to same-repo PRs');
assert.match(publish, /needs\.peekaboo-product-proof\.outputs\.secret_scan_passed == 'true'/, 'public report publishing must be blocked unless the report secret scan passed');
assert.match(
  publish,
  /concurrency:\n\s+group: peekaboo-e2e-gh-pages-publish\n\s+cancel-in-progress: false/,
  'publish job must serialize gh-pages writes',
);
assert.match(publish, /REPORT_PREFIX:[\s\S]*needs\.peekaboo-product-proof\.outputs\.report_prefix/, 'publish job must use the report prefix from the proof job');
assert.match(proof, /report_prefix="peekaboo-e2e\/pr-\$\{\{ github\.event\.pull_request\.number \}\}"/, 'report prefix must publish under peekaboo-e2e/pr-N');
assert.match(publish, /git -C "\$site_dir" fetch --depth=1 origin gh-pages/, 'publisher must fetch gh-pages before writing');
assert.match(publish, /git -C "\$site_dir" push -q origin gh-pages/, 'publisher must push gh-pages from the serialized lane');
assert.match(publish, /sort -V -r/, 'publisher retention must version-sort numeric run IDs');
assert.match(publish, /RUN_ASSET_BASE_URL[\s\S]*<base href="\$ENV\{RUN_ASSET_BASE_URL\}">/, 'publisher must inject a base tag for hosted relative assets');
assert.match(publish, /<!-- nixmac-peekaboo-e2e-report -->/, 'PR comment must use a stable Peekaboo marker');
assert.match(publish, /gh api -X PATCH[\s\S]*issues\/comments/, 'comment step must update the existing sticky comment');
assert.match(publish, /gh api -X POST[\s\S]*issues\/\$\{PR_NUMBER\}\/comments/, 'comment step must create the sticky comment if missing');

assert.match(result, /setup_failed="\$\{\{ needs\.peekaboo-product-proof\.outputs\.setup_failed \}\}"/, 'result job must observe setup failures');
assert.match(result, /has_report="\$\{\{ needs\.peekaboo-product-proof\.outputs\.has_report \}\}"/, 'result job must require a generated report');
assert.match(result, /verdict="\$\{\{ needs\.peekaboo-product-proof\.outputs\.verdict \}\}"/, 'result job must observe the report verdict');
assert.match(result, /publish_result="\$\{\{ needs\.publish-peekaboo-report\.result \}\}"/, 'result job must observe report publishing');
assert.match(result, /secret_scan_passed="\$\{\{ needs\.peekaboo-product-proof\.outputs\.secret_scan_passed \}\}"/, 'result job must observe the report secret scan result');
assert.match(result, /secret scan did not pass; hosted publishing is intentionally blocked/, 'result job must fail clearly when secret scan blocks publishing');
assert.match(result, /cu_covered="\$\{\{ needs\.peekaboo-product-proof\.outputs\.cu_covered \}\}"/, 'result job must observe covered required Computer Use keys');
assert.match(result, /cu_covered" != "\$cu_required"/, 'result job must fail when required Computer Use parity coverage is incomplete');
assert.match(result, /verdict" != "pass"/, 'result job must fail non-pass reports');
assert.match(result, /publish job result was \$publish_result/, 'result job must fail PR runs when publishing fails');

assert.match(launchEnv, /export NIXMAC_SKIP_PERMISSIONS=1/, 'Product Proof launch env must skip macOS permission probes in E2E');
assert.match(launchEnv, /nixmac_pp_set_launch_env NIXMAC_SKIP_PERMISSIONS "\$NIXMAC_SKIP_PERMISSIONS"/, 'Product Proof launch env must propagate permission skipping through launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_SKIP_PERMISSIONS/, 'Product Proof cleanup must remove permission skipping from launchctl');
assert.match(peekabooRunner, /for key in [^\n]*NIXMAC_SKIP_PERMISSIONS/, 'runner preflight must clear stale permission-skip launchctl state');
assert.match(peekabooRunner, /launchctl asuser "\$uid" launchctl unsetenv "\$key"/, 'runner preflight must clear stale launchctl state in the GUI user domain');

const setKeys = [...launchEnv.matchAll(/nixmac_pp_set_launch_env ([A-Z0-9_]+)/g)].map((match) => match[1]);
const unsetKeys = new Set([...cleanup.matchAll(/nixmac_pp_unset_launch_env ([A-Z0-9_]+)/g)].map((match) => match[1]));
for (const key of setKeys) {
  assert.ok(unsetKeys.has(key), `Product Proof cleanup must unset ${key}`);
}

console.log('Peekaboo workflow contract self-test passed.');
