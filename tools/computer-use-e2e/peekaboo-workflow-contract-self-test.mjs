#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/peekaboo-e2e.yml');
const productProofPath = path.join(repoRoot, 'tests/e2e/lib/nixmac_product_proof.sh');
const peekabooShellPath = path.join(repoRoot, 'tests/e2e/lib/peekaboo.sh');
const runnerShellPath = path.join(repoRoot, 'tests/e2e/lib/runner.sh');
const nixmacAdapterPath = path.join(repoRoot, 'tests/e2e/adapters/nixmac.sh');
const runLocalPath = path.join(repoRoot, 'tools/computer-use-e2e/run-local.mjs');
const peekabooRunnerPath = path.join(repoRoot, 'tools/computer-use-e2e/peekaboo-runner.mjs');
const permissionsPath = path.join(repoRoot, 'apps/native/src-tauri/src/system/permissions.rs');
const e2eRuntimePath = path.join(repoRoot, 'apps/native/src-tauri/src/e2e_runtime.rs');
const nativeMainPath = path.join(repoRoot, 'apps/native/src-tauri/src/main.rs');
const debugCommandsPath = path.join(repoRoot, 'apps/native/src-tauri/src/commands/debug.rs');
const nativeStorePath = path.join(repoRoot, 'apps/native/src-tauri/src/storage/store.rs');
const frontendMainPath = path.join(repoRoot, 'apps/native/src/main.tsx');
const frontendAppPath = path.join(repoRoot, 'apps/native/src/App.tsx');
const frontendWidgetPath = path.join(repoRoot, 'apps/native/src/components/widget/widget.tsx');
const frontendEditorPanelPath = path.join(repoRoot, 'apps/native/src/components/widget/overlays/editor-panel.tsx');
const frontendBootDiagnosticsPath = path.join(repoRoot, 'apps/native/src/lib/boot-diagnostics.ts');
const frontendDomSnapshotsPath = path.join(repoRoot, 'apps/native/src/e2e/dom-snapshots.ts');
const frontendBootHarnessPath = path.join(repoRoot, 'apps/native/src/e2e/boot-harness.ts');
const frontendSentryInitPath = path.join(repoRoot, 'apps/native/src/lib/sentry/init.ts');
const frontendSentrySanitizePath = path.join(repoRoot, 'apps/native/src/lib/sentry/sanitize.ts');
const frontendAppFatalFallbackPath = path.join(repoRoot, 'apps/native/src/components/widget/layout/AppFatalFallback.tsx');
const tauriApiPath = path.join(repoRoot, 'apps/native/src/ipc/api.ts');
const workflow = readFileSync(workflowPath, 'utf8');
const productProof = readFileSync(productProofPath, 'utf8');
const peekabooShell = readFileSync(peekabooShellPath, 'utf8');
const runnerShell = readFileSync(runnerShellPath, 'utf8');
const nixmacAdapter = readFileSync(nixmacAdapterPath, 'utf8');
const runLocal = readFileSync(runLocalPath, 'utf8');
const peekabooRunner = readFileSync(peekabooRunnerPath, 'utf8');
const permissions = readFileSync(permissionsPath, 'utf8');
const e2eRuntime = readFileSync(e2eRuntimePath, 'utf8');
const nativeMain = readFileSync(nativeMainPath, 'utf8');
const debugCommands = readFileSync(debugCommandsPath, 'utf8');
const nativeStore = readFileSync(nativeStorePath, 'utf8');
const frontendMain = readFileSync(frontendMainPath, 'utf8');
const frontendApp = readFileSync(frontendAppPath, 'utf8');
const frontendWidget = readFileSync(frontendWidgetPath, 'utf8');
const frontendEditorPanel = readFileSync(frontendEditorPanelPath, 'utf8');
const frontendBootDiagnostics = readFileSync(frontendBootDiagnosticsPath, 'utf8');
const frontendDomSnapshots = readFileSync(frontendDomSnapshotsPath, 'utf8');
const frontendBootHarness = readFileSync(frontendBootHarnessPath, 'utf8');
const frontendSentryInit = readFileSync(frontendSentryInitPath, 'utf8');
const frontendSentrySanitize = readFileSync(frontendSentrySanitizePath, 'utf8');
const frontendAppFatalFallback = readFileSync(frontendAppFatalFallbackPath, 'utf8');
const tauriApi = readFileSync(tauriApiPath, 'utf8');

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

function assertOrder(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing "${first}" while checking ${message}`);
  assert.notEqual(secondIndex, -1, `missing "${second}" while checking ${message}`);
  assert.ok(firstIndex < secondIndex, message);
}

const trigger = section(/^on:$/m, /^permissions:$/m);
const proof = section(/^  peekaboo-product-proof:$/m, /^  publish-peekaboo-report:$/m);
const publish = section(/^  publish-peekaboo-report:$/m, /^  peekaboo-result:$/m);
const result = section(/^  peekaboo-result:$/m);
const launchEnv = section({ sourceText: productProof, pattern: /^nixmac_pp_set_e2e_launch_env\(\) \{$/m }, /^}$/m);
const cleanup = section({ sourceText: productProof, pattern: /^nixmac_pp_cleanup_common\(\) \{$/m }, /^}$/m);
const frontendRenderApp = section({ sourceText: frontendMain, pattern: /^const renderApp = \(\) => \{$/m }, /^};$/m);
const nativeCaptureWindowSetup = section(
  { sourceText: nativeMain, pattern: /let e2e_opaque_window = e2e_opaque_window_enabled\(\);/ },
  /let main_window = main_window_builder\.build/,
);
const nativeSolidCaptureBranch = nativeCaptureWindowSetup.match(/if e2e_solid_capture \{[\s\S]*?\n\s+\}/)?.[0] ?? '';

assert.doesNotMatch(trigger, /^\s+branches:/m, 'Peekaboo workflow must run for stacked PR bases, not only main');
assert.match(trigger, /'package\.json'[\s\S]*'bun\.lock'[\s\S]*'Cargo\.toml'[\s\S]*'Cargo\.lock'[\s\S]*'flake\.nix'[\s\S]*'flake\.lock'[\s\S]*'devenv\.nix'[\s\S]*'devenv\.lock'/, 'Peekaboo workflow must run for root dependency, Nix, and devenv manifest/lockfile changes that affect the native app build');
assert.match(workflow, /build_attempts:[\s\S]*default: '2'/, 'Peekaboo PR runs should default to two remote build attempts for transient MacInCloud build failures');
assert.match(workflow, /remote_env_parts=\([\s\S]*"NIXMAC_E2E_OPAQUE_WINDOW=1"[\s\S]*\)[\s\S]*run-peekaboo-suite --allow-cleanup/, 'Peekaboo MacInCloud CI must opt into opaque E2E window capture without changing local Peekaboo defaults');
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
assert.match(proof, /ServerAliveInterval=15[\s\S]*run-peekaboo-suite --allow-cleanup/, 'long-running Peekaboo SSH run must use keepalives');
assert.match(proof, /trusted-secret-scan\.json[\s\S]*mktemp[\s\S]*secretPattern[\s\S]*github_pat_[\s\S]*lstatSync[\s\S]*isSymbolicLink\(\)[\s\S]*trusted_secret_scan_passed/, 'workflow must independently re-scan fetched report text artifacts before public publishing without following symlinks');
assert.match(proof, /scannedPaths[\s\S]*path\.relative\(root, full\)\.split\(path\.sep\)\.join\('\/'\)[\s\S]*secretPattern\.test\(relativePath\)[\s\S]*path:\$\{relativePath\}[\s\S]*isSymbolicLink\(\)/, 'trusted report scan must inspect artifact paths, including symlink names, before refusing to follow symlinks');
assert.match(proof, /function looksLikeTextFile\(full\)[\s\S]*subarray\(0, 8192\)[\s\S]*sample\.includes\(0\)[\s\S]*suspiciousControlBytes/, 'trusted report scan must sniff text-like files instead of relying only on a small extension allowlist');
assert.doesNotMatch(proof, /textExtPattern/, 'trusted report content scan must not skip extensionless or renamed text diagnostics');
assert.match(proof, /NIXMAC_APP_PATH=\$\(printf '%q' "\$REMOTE_APP_PATH"\)[\s\S]*run-peekaboo-suite --allow-cleanup/, 'Peekaboo run must use the freshly built PR app bundle');
assert.match(proof, /remote_env_parts=\([\s\S]*E2E_TERMINAL_CLEANUP_MODE=kill[\s\S]*E2E_HIDE_RECORDING_TERMINAL=1[\s\S]*E2E_CLOSE_RECORDING_TERMINAL=1/, 'MacInCloud remote runner must force stale recorder Terminal cleanup and keep recorder windows hidden/closed');
assert.doesNotMatch(proof, /Run Peekaboo suite on MacInCloud[\s\S]*node tools\/computer-use-e2e\/run-local\.mjs run-peekaboo-macincloud/, 'proof job must not run PR-controlled local orchestration while the MacInCloud SSH key is present');
assert.match(proof, /--allow-cleanup/, 'Peekaboo suite must restore local app support state after the run');
assert.match(proof, /artifacts\/computer-use-local\/\.current-run/, 'workflow must fetch the suite report using the runner current-run contract');
assert.match(proof, /remote_artifact_root="\$\{PEEKABOO_REPO_DIR%\/\}\/artifacts\/computer-use-local"/, 'workflow must anchor fetched reports to the expected remote artifact root');
assert.match(proof, /remote_run_dir" != "\$remote_artifact_root"\/\*/, 'workflow must reject current-run paths outside the artifact root before rsync');
assert.match(proof, /remote_run_dir_physical="\$\(ssh[\s\S]*pwd -P/, 'workflow must verify the physical remote report path before rsyncing');
assert.match(proof, /name: Record CI report inspection proof[\s\S]*run-local\.mjs verify-report "\$FETCH_REPORT_DIR"[\s\S]*--method ci-static/, 'workflow must record reportInspection parity proof before metadata is collected');
{
  const dropKeyIndex = proof.indexOf('name: Drop MacInCloud SSH key before local report processing');
  const verifyReportIndex = proof.indexOf('run-local.mjs verify-report "$FETCH_REPORT_DIR"');
  assert.notEqual(dropKeyIndex, -1, 'workflow must explicitly remove the MacInCloud SSH key before local report processing');
  assert.ok(dropKeyIndex < verifyReportIndex, 'workflow must remove the MacInCloud SSH key before running local report verification code');
}
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
assert.match(proof, /rsync_status="\$\(.*rsync[\s\S]*\)"|rsync_status="\$\?"/, 'fetch step must capture rsync status instead of blindly trusting transport success');
assert.match(proof, /usable partial report[\s\S]*state\.json[\s\S]*has_report=true/, 'fetch step must accept a partial MacInCloud report when state.json was transferred');
assert.match(proof, /if \[\[ ! -f "\$report_dir\/state\.json" \]\][\s\S]*if \[\[ "\$rsync_status" != "0" \]\][\s\S]*exit "\$rsync_status"[\s\S]*exit 1/, 'fetch step must fail when state.json is missing even if rsync exited cleanly');
assert.match(proof, /rsync_status: \$\{\{ steps\.report-meta\.outputs\.rsync_status \}\}/, 'proof job outputs must expose report fetch rsync status');
assert.match(proof, /FETCH_RSYNC_STATUS: \$\{\{ steps\.fetch-report\.outputs\.rsync_status \|\| '0' \}\}[\s\S]*echo "rsync_status=\$\{FETCH_RSYNC_STATUS:-0\}"/, 'report metadata must propagate rsync status for summaries and PR comments');
assert.match(proof, /Report fetch:[\s\S]*partial rsync status/, 'workflow summary must surface partial report fetches');
assert.match(publish, /RSYNC_STATUS: \$\{\{ needs\.peekaboo-product-proof\.outputs\.rsync_status \}\}[\s\S]*Report fetch:[\s\S]*partial rsync status/, 'PR comment must surface complete versus partial report fetch status');

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
assert.match(launchEnv, /export NIXMAC_E2E_SOLID_CAPTURE="\$\{NIXMAC_E2E_SOLID_CAPTURE:-1\}"/, 'Product Proof launch env must enable solid capture by default');
assert.match(launchEnv, /nixmac_pp_set_launch_env NIXMAC_E2E_SOLID_CAPTURE "\$NIXMAC_E2E_SOLID_CAPTURE"/, 'Product Proof launch env must propagate solid capture through launchctl');
assert.match(launchEnv, /export NIXMAC_E2E_OPAQUE_WINDOW="\$\{NIXMAC_E2E_OPAQUE_WINDOW:-0\}"/, 'Product Proof launch env must keep opaque capture opt-in by default');
assert.match(launchEnv, /if nixmac_pp_truthy "\$NIXMAC_E2E_OPAQUE_WINDOW"[\s\S]*nixmac_pp_set_launch_env NIXMAC_E2E_OPAQUE_WINDOW "\$NIXMAC_E2E_OPAQUE_WINDOW"[\s\S]*else[\s\S]*nixmac_pp_unset_launch_env NIXMAC_E2E_OPAQUE_WINDOW/, 'Product Proof launch env must only propagate opaque capture when explicitly enabled and clear stale launchctl state otherwise');
assert.match(launchEnv, /export NIXMAC_E2E_WEBVIEW_WATCHDOG="\$\{NIXMAC_E2E_WEBVIEW_WATCHDOG:-1\}"/, 'Product Proof launch env must enable the E2E WebView load watchdog independently of opaque capture');
assert.match(launchEnv, /nixmac_pp_set_launch_env NIXMAC_E2E_WEBVIEW_WATCHDOG "\$NIXMAC_E2E_WEBVIEW_WATCHDOG"/, 'Product Proof launch env must propagate the independent WebView watchdog through launchctl');
assert.match(launchEnv, /export NIXMAC_E2E_DIAGNOSTICS_DIR=/, 'Product Proof launch env must provide a diagnostics directory to the launched app');
assert.match(launchEnv, /export NIXMAC_LOGFILE="\$\{NIXMAC_E2E_DIAGNOSTICS_DIR\}\/nixmac-app\.log"/, 'Product Proof launch env must route app logs into scenario diagnostics');
assert.match(launchEnv, /export RUST_LOG="\$\{RUST_LOG:-debug\}"/, 'Product Proof launch env must request debug app logs for E2E diagnostics');
assert.match(launchEnv, /nixmac_pp_set_launch_env NIXMAC_E2E_DIAGNOSTICS_DIR "\$NIXMAC_E2E_DIAGNOSTICS_DIR"/, 'Product Proof launch env must propagate diagnostics dir through launchctl');
assert.match(launchEnv, /nixmac_pp_set_launch_env NIXMAC_LOGFILE "\$NIXMAC_LOGFILE"/, 'Product Proof launch env must propagate app logfile through launchctl');
assert.match(launchEnv, /nixmac_pp_set_launch_env RUST_LOG "\$RUST_LOG"/, 'Product Proof launch env must propagate debug log filter through launchctl');
assert.match(launchEnv, /nixmac_pp_clear_e2e_runtime[\s\S]*nixmac_pp_write_e2e_runtime/, 'Product Proof launch setup must clear stale runtime overrides before writing the current E2E runtime file');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_SKIP_PERMISSIONS/, 'Product Proof cleanup must remove permission skipping from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_E2E_SOLID_CAPTURE/, 'Product Proof cleanup must remove solid capture from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_E2E_OPAQUE_WINDOW/, 'Product Proof cleanup must remove opaque capture from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_E2E_WEBVIEW_WATCHDOG/, 'Product Proof cleanup must remove WebView watchdog from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_E2E_DIAGNOSTICS_DIR/, 'Product Proof cleanup must remove diagnostics dir from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env NIXMAC_LOGFILE/, 'Product Proof cleanup must remove app logfile from launchctl');
assert.match(cleanup, /nixmac_pp_unset_launch_env RUST_LOG/, 'Product Proof cleanup must remove debug log filter from launchctl');
assert.match(cleanup, /nixmac_pp_clear_e2e_runtime/, 'Product Proof cleanup must remove the debug E2E runtime file');
assert.match(productProof, /nixmac_pp_runtime_path\(\)[\s\S]*e2e-runtime\.json/, 'Product Proof runtime path must target the nixmac debug E2E runtime file');
assert.match(productProof, /nixmac_pp_write_e2e_runtime\(\)[\s\S]*expiresAtUnix[\s\S]*NIXMAC_E2E_SOLID_CAPTURE[\s\S]*NIXMAC_E2E_OPAQUE_WINDOW[\s\S]*NIXMAC_E2E_WEBVIEW_WATCHDOG[\s\S]*NIXMAC_SKIP_PERMISSIONS[\s\S]*NIXMAC_E2E_CONFIG_DIR[\s\S]*NIXMAC_E2E_DIAGNOSTICS_DIR[\s\S]*NIXMAC_LOGFILE[\s\S]*RUST_LOG[\s\S]*OPENAI_API_KEY/, 'Product Proof must write an expiring debug runtime override with launch, diagnostics, fixture, and provider keys');
assert.match(nativeMain, /crate::e2e_runtime::value\("NIXMAC_LOGFILE"\)/, 'Native app logging must read NIXMAC_LOGFILE through the E2E runtime file when launched via LaunchServices');
assert.match(nativeMain, /crate::e2e_runtime::value\("RUST_LOG"\)[\s\S]*EnvFilter::try_from_default_env/, 'Native app logging must read RUST_LOG through the E2E runtime file before falling back to process env/default filters');
assert.match(nativeMain, /on_page_load\(move[\s\S]*main webview page load[\s\S]*PageLoadEvent::Finished[\s\S]*store\(true, Ordering::SeqCst\)/, 'Native app must log main WebView page-load lifecycle and mark finished loads for E2E diagnostics');
assert.match(nativeMain, /fn e2e_solid_capture_enabled\(\) -> bool \{\n\s+cfg!\(debug_assertions\) && crate::e2e_runtime::enabled\("NIXMAC_E2E_SOLID_CAPTURE"\)/, 'Native app must expose an E2E-only solid capture gate');
assert.match(nativeMain, /document\.documentElement\.dataset\.nixmacE2eCapture = captureMode[\s\S]*html\[data-nixmac-e2e-capture="\$\{captureMode\}"\][\s\S]*requestAnimationFrame\(\(\) => \{\n\s+document\.documentElement\.dataset\.nixmacE2eCapturePaint = "raf";[\s\S]*"e2e-capture-paint-raf"/, 'Native app capture script must set matching capture selectors and breadcrumb the paint marker');
assert.match(nativeCaptureWindowSetup, /let e2e_solid_capture = e2e_solid_capture_enabled\(\);[\s\S]*let e2e_css_capture = e2e_solid_capture \|\| e2e_opaque_window[\s\S]*transparent\(!e2e_opaque_window\)/, 'Native app must keep default solid capture CSS-backed and transparent while limiting native opacity to opaque debug mode');
assert.match(nativeCaptureWindowSetup, /if e2e_opaque_window \{\n\s+main_window_builder = main_window_builder\s+\.background_color\(tauri::utils::config::Color\(10, 10, 10, 255\)\);[\s\S]*if e2e_css_capture \{\n\s+main_window_builder =\s+main_window_builder\.initialization_script\(E2E_CAPTURE_DARK_BACKGROUND_SCRIPT\);/, 'Native app must keep native dark background only in the opaque debug path while applying CSS capture for solid and opaque modes');
assert.match(nativeMain, /NIXMAC_E2E_OPAQUE_WINDOW native window diagnostics[\s\S]*isOpaque[\s\S]*alphaValue[\s\S]*hasShadow/, 'Native app must log native opaque-window diagnostics for MacInCloud capture debugging');
assert.match(nativeSolidCaptureBranch, /NIXMAC_E2E_SOLID_CAPTURE enabled/, 'Native app must keep an explicit solid-capture branch for diagnostics');
assert.doesNotMatch(nativeSolidCaptureBranch, /background_color\(tauri::utils::config::Color\(10, 10, 10, 255\)\)/, 'Native app must not apply native background_color from the default solid-capture path');
assert.match(nativeMain, /fn e2e_webview_watchdog_enabled\(\) -> bool \{\n\s+cfg!\(debug_assertions\) && crate::e2e_runtime::enabled\("NIXMAC_E2E_WEBVIEW_WATCHDOG"\)/, 'Native app must expose an E2E-only WebView watchdog gate independent of opaque capture');
assert.match(nativeMain, /let e2e_webview_watchdog = e2e_webview_watchdog_enabled\(\) \|\| e2e_opaque_window[\s\S]*if e2e_webview_watchdog \{[\s\S]*let watchdog_window[\s\S]*NIXMAC_E2E_WEBVIEW_WATCHDOG_SECS[\s\S]*unwrap_or\(12\)[\s\S]*Duration::from_secs\(watchdog_secs\)[\s\S]*main webview E2E load watchdog[\s\S]*run_on_main_thread[\s\S]*reload\(\)/, 'Native app must run the E2E-only main WebView load watchdog independently of opaque capture and request one reload when page load stalls');
assert.match(nativeMain, /fn e2e_request_webview_boot_probe[\s\S]*window\.localStorage\.getItem\(key\)[\s\S]*document\.documentElement\?\.dataset\?\.nixmacBootStage[\s\S]*invoke\("e2e_log_breadcrumb"[\s\S]*native webview boot probe[\s\S]*fn e2e_schedule_webview_boot_probe[\s\S]*run_on_main_thread/, 'Native app must provide a Rust-scheduled WebView boot probe that snapshots title, dataset, and localStorage into E2E breadcrumbs');
assert.match(nativeMain, /page-load-finished-plus-1s[\s\S]*page-load-finished-plus-5s[\s\S]*post-build-plus-2s[\s\S]*post-build-plus-10s[\s\S]*watchdog-before-reload/, 'Native app must probe WebView boot state after build, after page-load finish, and immediately before watchdog reload');
assert.match(nativeMain, /let e2e_page_load_boot_probe = e2e_webview_watchdog[\s\S]*if e2e_page_load_boot_probe \{[\s\S]*page-load-finished-plus-1s[\s\S]*page-load-finished-plus-5s/, 'Page-load WebView boot probes must be gated to active E2E watchdog sessions');
assert.match(nativeMain, /run_on_main_thread\(move \|\| \{\n\s+e2e_request_webview_boot_probe\(&reload_window, "watchdog-before-reload"\);[\s\S]*reload_window\.reload\(\)/, 'Watchdog pre-reload WebView boot probe must run on the main thread before requesting reload');
assert.match(nativeStore, /fn get_secret_pref[\s\S]*if e2e_mock_system_enabled\(\) \{[\s\S]*return get_string_pref_raw\(app, key\);[\s\S]*get_with_lazy_migration/, 'E2E mock-system mode must bypass keychain reads in UI preference secret lookups');
assert.match(debugCommands, /pub async fn e2e_log_breadcrumb[\s\S]*client_timestamp_unix_ms[\s\S]*NIXMAC_E2E_DIAGNOSTICS_DIR[\s\S]*nixmac-frontend-breadcrumbs\.jsonl/, 'Debug command must persist client-timestamped frontend boot breadcrumbs into E2E diagnostics');
assert.match(debugCommands, /pub async fn e2e_mark_boot_stage[\s\S]*get_webview_window\("main"\)[\s\S]*set_title\(&title\)[\s\S]*native boot stage marker/, 'Debug command must mirror E2E boot stages into the native window title for Peekaboo/window-list diagnostics');
assert.match(tauriApi, /logBreadcrumb:[\s\S]*clientTimestampUnixMs[\s\S]*invoke<OkResult>\("e2e_log_breadcrumb"/, 'Frontend API must expose timestamped debug breadcrumb logging through Tauri IPC');
assert.match(tauriApi, /markBootStage:[\s\S]*clientTimestampUnixMs[\s\S]*invoke<OkResult>\("e2e_mark_boot_stage"/, 'Frontend API must expose native E2E boot-stage marking through Tauri IPC');
assert.match(frontendBootDiagnostics, /export function markBootRenderStage[\s\S]*bootStageCleared[\s\S]*setBootStageDomMarker\(normalizedStage\)/, 'Frontend boot diagnostics must expose a render-safe boot stage marker that only mutates DOM/title');
assert.doesNotMatch(frontendBootDiagnostics, /export function markBootRenderStage[\s\S]*markNativeBootStage/, 'Render-safe boot stage markers must not invoke native IPC');
assert.match(frontendBootDiagnostics, /export function markBootStage[\s\S]*bootStageCleared[\s\S]*setStorageValue\("nixmac:e2e-boot-stage"[\s\S]*markNativeBootStage\(normalizedStage\)/, 'Frontend boot diagnostics must persist full boot stage markers from effect-safe call sites');
assert.match(frontendBootDiagnostics, /function markNativeBootStage\(stage: string\)[\s\S]*tauriAPI\.debug\.markBootStage\(stage, Date\.now\(\)\)/, 'Frontend boot diagnostics must mirror committed boot stages to the native debug command');
assert.match(frontendBootDiagnostics, /export function clearBootStage[\s\S]*document\.title = APP_TITLE[\s\S]*nixmac:e2e-boot-stage", "mounted"/, 'Frontend boot diagnostics must restore the normal window title after mount');
assert.match(frontendBootDiagnostics, /export function clearBootStage[\s\S]*markNativeBootStage\("mounted"\)/, 'Frontend boot diagnostics must clear the native title marker after App mount');
assert.match(frontendSentrySanitize, /export function sanitizeDiagnosticText[\s\S]*sanitizeString/, 'E2E DOM diagnostics text sanitizer must be exported from the shared sanitize module');
assert.match(frontendSentrySanitize, /EMAIL_PATTERN[\s\S]*BEARER_TOKEN_PATTERN[\s\S]*OPENAI_TOKEN_PATTERN[\s\S]*HOME_DIR_PATH_PATTERN/, 'Shared sanitize module must apply the secret-shaped text patterns used by both Sentry events and E2E diagnostics');
assert.match(frontendDomSnapshots, /import \{ sanitizeDiagnosticText \} from "@\/lib\/sentry\/sanitize"/, 'E2E DOM snapshots must consume sanitization from the shared sentry/sanitize module rather than a duplicate regex set');
assert.match(frontendDomSnapshots, /import \{ bootBreadcrumb \} from "@\/lib\/boot-diagnostics"/, 'E2E DOM snapshots must consume bootBreadcrumb from the split-out boot-diagnostics module');
assert.match(frontendDomSnapshots, /export function recordE2eDomSnapshot[\s\S]*storagePrefix[\s\S]*nixmac:e2e-dom-snapshot[\s\S]*document\.documentElement\.dataset\.nixmacE2eDomSnapshot[\s\S]*`\$\{storagePrefix\}:last`[\s\S]*E2E DOM snapshot \$\{label\} summary[\s\S]*E2E DOM snapshot \$\{label\} text[\s\S]*E2E DOM snapshot \$\{label\} html/, 'E2E DOM snapshots must persist bounded snapshots through both out-of-band DOM/localStorage state and breadcrumb artifacts');
assert.match(frontendDomSnapshots, /export function scheduleE2eDomSnapshots[\s\S]*count = 5[\s\S]*intervalMs = 2_000[\s\S]*emitted < count/, 'E2E DOM snapshots must schedule a bounded post-mount snapshot series and self-stop');
assert.match(frontendSentryInit, /PREFS_BOOT_TIMEOUT_MS = 8000[\s\S]*ui_get_prefs invoke start[\s\S]*success after timeout[\s\S]*Promise\.race\(\[prefsPromise, timeoutPromise\]\)/, 'Sentry init module must log prefs IPC progress with clear after-timeout labels');
assert.match(frontendMain, /markBootStage\("main-loaded"\)[\s\S]*markBootStage\("root-found"\)[\s\S]*markBootStage\("react-render-start"\)[\s\S]*markBootStage\("react-render-scheduled"\)/, 'Frontend boot must synchronously mark module, root, and render-scheduling stages');
assert.match(frontendApp, /markBootStage\("app-render"\)[\s\S]*markBootStage\("app-effect"\)[\s\S]*clearBootStage\(\)/, 'App must synchronously mark render/effect stages and clear the E2E title marker after mount');
assert.match(frontendWidget, /markBootRenderStage\("darwin-widget-render"\)[\s\S]*markBootStage\("darwin-widget-committed"\)/, 'DarwinWidget must mark render reach in the render body and commit the stage from an effect');
assert.match(frontendEditorPanel, /const LazyNixEditor = lazy\(async \(\) => \{[\s\S]*import\("@\/components\/kibo-ui\/nix-editor"\)[\s\S]*default: module\.NixEditor/, 'EditorPanel must lazy-load the Monaco-backed Nix editor only when a file is opened');
assert.doesNotMatch(frontendEditorPanel, /import \{ NixEditor \}/, 'EditorPanel must not import the Monaco-backed editor in the first app boot bundle');
assert.match(frontendBootHarness, /setInterval\(\(\) => \{[\s\S]*boot heartbeat[\s\S]*boot heartbeat upper bound reached[\s\S]*stopHeartbeat[\s\S]*boot heartbeat stopped[\s\S]*nixmac:app-mounted/, 'E2E boot harness must emit bounded heartbeat breadcrumbs until App mounted and record when the bound is reached');
assert.match(frontendSentryInit, /E2E_MODE = import\.meta\.env\.VITE_NIXMAC_E2E_MODE === "true"[\s\S]*Sentry init skipped for E2E boot[\s\S]*return;/, 'Sentry init module must use the build-time E2E mode flag to skip boot-time Sentry prefs IPC without adding another IPC gate');
assert.match(frontendMain, /import\.meta\.env\.VITE_NIXMAC_E2E_MODE === "true"[\s\S]*void import\("@\/e2e\/boot-harness"\)[\s\S]*attachBootHarness\(\{ rootElement \}\)/, 'Frontend main must conditionally dynamic-import the E2E boot harness so it is tree-shaken from production builds');
assert.match(frontendBootHarness, /APP_MOUNT_RELOAD_TIMEOUT_MS = 12000[\s\S]*APP_MOUNT_RELOAD_KEY[\s\S]*E2E app-mounted watchdog reloading[\s\S]*window\.location\.reload\(\)/, 'E2E boot harness must request one reload when the page loads but App never mounts');
assert.match(frontendBootHarness, /scheduleE2eDomSnapshots\("post-mount"\)[\s\S]*recordE2eDomSnapshot\("app-mounted-watchdog-before-reload"[\s\S]*nixmac:e2e-dom-snapshot:watchdog-pre-reload[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*window\.location\.reload\(\)[\s\S]*250/, 'E2E boot harness must capture post-mount DOM snapshots and a durable watchdog snapshot before forced reload');
assert.match(frontendMain, /const renderApp = \(\) => \{[\s\S]*markBootStage\("react-render-start"\)[\s\S]*Sentry\.ErrorBoundary[\s\S]*<App \/>[\s\S]*markBootStage\("react-render-scheduled"\)/, 'Frontend boot must render the app inside an error boundary, bracketed by the render-start and render-scheduled boot stages');
assert.match(frontendSentryInit, /startSentryInitOnce[\s\S]*render-error[\s\S]*render-fatal[\s\S]*Sentry init start requested[\s\S]*scheduleAfterPostMountFrame[\s\S]*initializeSentryAfterPostMountFrame\(\)/, 'Sentry init module must start preference-backed Sentry initialization only after App mounted, render error, render fatal, or the mount-timeout fallback requests it');
assert.match(frontendSentryInit, /export function captureRenderError[\s\S]*startSentryInitOnce\(reason\)[\s\S]*Sentry\.captureException\(error\)/, 'Sentry init module must export captureRenderError that lazily initializes Sentry and then captures the render error');
assert.match(frontendSentryInit, /SENTRY_MOUNT_TIMEOUT_MS = 5000[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*startSentryInitOnce\("mount-timeout"\)[\s\S]*SENTRY_MOUNT_TIMEOUT_MS/, 'Sentry init module must retain a production mount-timeout Sentry fallback for failed-render sessions without a long early-boot observability gap');
assert.match(frontendSentryInit, /export function attachSentry[\s\S]*window\.addEventListener\(\s*"nixmac:app-mounted"[\s\S]*startSentryInitOnce\("app-mounted"\)/, 'Sentry init module must register the app-mounted Sentry init trigger inside attachSentry');
assert.match(frontendMain, /import \{ attachSentry, captureRenderError \} from "@\/lib\/sentry\/init"/, 'Frontend main must consume Sentry attach + capture from the extracted module');
assertOrder(frontendMain, 'await attachSentry();', 'renderApp();', 'Frontend boot must await attachSentry before rendering so production blocks render on prefs+Sentry init (closing the pre-init render-error window)');
assertOrder(frontendMain, 'import("@/e2e/boot-harness")', 'renderApp();', 'Frontend boot must queue the harness dynamic import before rendering so the heartbeat-stop listener runs in time for the App mount event');
assert.doesNotMatch(frontendMain, /renderApp\(\);\s*void initializeSentry/, 'Frontend boot must not directly initialize preference-backed Sentry immediately after first render');
assert.doesNotMatch(frontendRenderApp, /\bawait\b/, 'Frontend renderApp must stay synchronous and never await prefs IPC before first render');
assert.match(frontendAppFatalFallback, /role="alert"/, 'App fatal fallback must use role="alert" for accessibility');
assert.match(frontendAppFatalFallback, /window\.location\.reload\(\)/, 'App fatal fallback must offer a Reload affordance');
assert.match(frontendAppFatalFallback, /window\.localStorage\.setItem\(\s*RECOVERY_STORAGE_KEY/, 'App fatal fallback must stash error details to localStorage for the post-reload recovery handoff');
assert.match(frontendBootHarness, /window\.addEventListener\("unhandledrejection"[\s\S]*window unhandled rejection/, 'E2E boot harness must capture top-level unhandled rejections');
assert.match(runnerShell, /E2E_TERMINAL_CLEANUP_MODE=kill recording_close_terminal_windows/, 'Runner preflight must kill stale recorder Terminal windows before each scenario');
assert.match(peekabooRunner, /for key in NIXMAC_E2E_MOCK_SYSTEM NIXMAC_E2E_SOLID_CAPTURE NIXMAC_E2E_OPAQUE_WINDOW NIXMAC_E2E_WEBVIEW_WATCHDOG NIXMAC_SKIP_PERMISSIONS/, 'Runner preflight must clear stale Peekaboo launchctl flags, including solid capture, opaque capture, and the independent WebView watchdog');
assert.match(e2eRuntime, /#\[cfg\(debug_assertions\)\][\s\S]*fn file_value[\s\S]*runtime\.schema_version != 1[\s\S]*runtime\.session_id\.trim\(\)\.is_empty\(\)[\s\S]*now_unix\(\)\? > runtime\.expires_at_unix/, 'Rust E2E runtime file reader must be debug-only and reject stale, malformed, or expired runtime files');
assert.match(e2eRuntime, /#\[cfg\(not\(debug_assertions\)\)\][\s\S]*fn file_value\(_name: &str\) -> Option<String>[\s\S]*None/, 'Release builds must ignore E2E runtime files');
assert.match(permissions, /fn check_desktop_access\(\) -> PermissionStatus \{\n\s+if e2e_skip_permissions_enabled\(\)[\s\S]{0,180}?dirs::home_dir/, 'Desktop permission check must honor E2E skip before touching the Desktop folder');
assert.match(permissions, /fn check_documents_access\(\) -> PermissionStatus \{\n\s+if e2e_skip_permissions_enabled\(\)[\s\S]{0,180}?dirs::home_dir/, 'Documents permission check must honor E2E skip before touching the Documents folder');
assert.match(permissions, /"desktop" => \{\n\s+if e2e_skip_permissions_enabled\(\)[\s\S]{0,520}?let home = dirs::home_dir/, 'Desktop permission request must return before filesystem writes when E2E skip is enabled');
assert.match(permissions, /"documents" => \{\n\s+if e2e_skip_permissions_enabled\(\)[\s\S]{0,560}?let home = dirs::home_dir/, 'Documents permission request must return before filesystem writes when E2E skip is enabled');
assert.match(peekabooRunner, /for key in [^\n]*NIXMAC_SKIP_PERMISSIONS/, 'runner preflight must clear stale permission-skip launchctl state');
assert.match(peekabooRunner, /launchctl asuser "\$uid" launchctl unsetenv "\$key"/, 'runner preflight must clear stale launchctl state in the GUI user domain');
assert.match(runLocal, /function getNixmacWindowInfo\(\)[\s\S]*set windowTitle to \(name of window 1\) as text[\s\S]*on error[\s\S]*set windowTitle to ""[\s\S]*return \{ region, title: titleLines\.join\('\\n'\)\.trim\(\) \}/, 'Peekaboo screenshot capture must persist the Accessibility window title as an automated boot-stage consumer without failing on missing titles');
assert.match(runLocal, /windowTitle: windowInfo\.title \|\| null[\s\S]*screenshot\.captured[\s\S]*windowTitle: windowInfo\.title \|\| null/, 'Peekaboo screenshot metadata and events must include the captured window title for report/debug inspection');
assert.match(runLocal, /Window title at capture:/, 'Peekaboo HTML report must surface captured window titles next to screenshot proof cards');
assert.match(peekabooRunner, /dedupeArtifactEntries[\s\S]*reportDiagnosticEntries[\s\S]*fileEntries\(plan\.diagnosticDir[\s\S]*Visual failure diagnostics captured[\s\S]*process-list[\s\S]*window-list[\s\S]*frontend breadcrumb/, 'Peekaboo runner must keep raw diagnostics alongside report diagnostics and summarize process/window/breadcrumb evidence on screenshot-signal failures');
assert.match(peekabooShell, /peekaboo_restore_active_app\(\)/, 'Peekaboo shell library must expose a generic active-app restoration helper');
assert.match(peekabooShell, /peekaboo_capture_app_diagnostics\(\)[\s\S]*window list --app "\$app" --json[\s\S]*<dead pid>[\s\S]*pgrep -x "\$app"[\s\S]*process-list\.json[\s\S]*image --mode screen/, 'Peekaboo diagnostics must capture valid app window, process, and screen evidence for visual failures');
assert.doesNotMatch(peekabooShell, /NIXMAC_(?:APP_NAME|BUNDLE_ID)/, 'Generic Peekaboo shell library must not depend on nixmac-specific app names or bundle IDs');
assert.match(peekabooShell, /peekaboo_recover_bridge\(\)[\s\S]*peekaboo_restore_active_app/, 'Peekaboo bridge recovery must restore the configured active app after remote bridge recovery');
assert.match(nixmacAdapter, /E2E_ACTIVE_APP_NAME="\$NIXMAC_APP_NAME"/, 'nixmac adapter must configure the generic active app target');
assert.match(nixmacAdapter, /E2E_ACTIVE_BUNDLE_ID="\$NIXMAC_BUNDLE_ID"/, 'nixmac adapter must configure the generic active bundle target');
assert.match(nixmacAdapter, /E2E_FAILURE_SCREENSHOT_APP="\$NIXMAC_APP_NAME"/, 'nixmac adapter must configure app-scoped failure screenshots');
assert.match(nixmacAdapter, /nixmac_clear_state\(\)[\s\S]*peekaboo_capture_app_diagnostics "\$NIXMAC_APP_NAME" "pre-clear"[\s\S]*app_quit "\$NIXMAC_APP_NAME"[\s\S]*rm -rf ~\/Library\/Application\\ Support/, 'nixmac clear-state must capture pre-clear process/window evidence before quitting and deleting app state');
assert.match(productProof, /nixmac_pp_wait_for_ready_app_shell\(\)/, 'Product Proof must provide a shared ready-shell gate');
assert.match(productProof, /nixmac_pp_elements_show_ready_shell\(\)[\s\S]*NIXMAC_PP_READY_SHELL_MIN_ELEMENTS[\s\S]*NIXMAC_PP_READY_SHELL_PATTERN/, 'ready-shell gate must require both element breadth and product markers');
assert.match(productProof, /nixmac_pp_screenshot_has_visual_signal\(\)[\s\S]*visual-proof\.mjs[\s\S]*pngSignalStats[\s\S]*probeCropForImage/, 'ready-shell gate must use the same screenshot signal helpers as the report scanner');
assert.match(productProof, /maxDarkChromeYAvg: 42/, 'ready-shell visual gate must enforce the same nixmac dark-capture upper bound as the report scanner');
assert.match(productProof, /nixmac_pp_wait_for_ready_app_shell\(\)[\s\S]*nixmac_pp_capture_ready_visual_signal/, 'ready-shell gate must require screenshot visual signal before launch passes');

const setKeys = [...launchEnv.matchAll(/nixmac_pp_set_launch_env ([A-Z0-9_]+)/g)].map((match) => match[1]);
const unsetKeys = new Set([...cleanup.matchAll(/nixmac_pp_unset_launch_env ([A-Z0-9_]+)/g)].map((match) => match[1]));
for (const key of setKeys) {
  assert.ok(unsetKeys.has(key), `Product Proof cleanup must unset ${key}`);
}

console.log('Peekaboo workflow contract self-test passed.');
