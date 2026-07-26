# Scalable Computer Use E2E Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:dm-subagent-driven-development (if subagents available) or superpowers:dm-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Buzz-mediated, single-Mac CuaDriver request with a quiet, durable Centaur workflow that dispatches an exact-SHA GitHub Actions run onto a dedicated macOS E2E pool and publishes only a verified terminal result.

**Architecture:** The nixmac repository remains the source of test truth: it gains a real driver seam, a CuaDriver adapter, an on-Mac runner, and a signed-by-digest evidence manifest. Centaur detects/reconciles merged PRs, dispatches and watches a dedicated GitHub Actions workflow, downloads and verifies the immutable Actions artifact, applies retry policy, and publishes one terminal GitHub Check and Buzz message. GitHub/Cilicon owns ephemeral Tart VM scheduling; the current MacinCloud lane remains the single-concurrency transition/DR backend until the PR #604-derived E2E image and pool qualify.

**Tech Stack:** Node.js ESM, CuaDriver CLI/MCP daemon, GitHub Actions and API, Python 3.11 Centaur workflows/tools, Tart/Cilicon, `unittest`, existing nixmac preservation/adversarial harnesses, `jq`, `ffmpeg`.

---

## Repositories And Worktrees

- nixmac worktree:
  `/Users/farhankhalaf/Code/nixmac-e2e-production`
- nixmac branch:
  `codex/e2e-production-foundation`
- nixmac base:
  `origin/main` at `2e0a987b800e45d7444057e1ad54d1d570b8ac41`
- Centaur overlay worktree:
  `/tmp/centaur-overlay-nixmac-e2e-production`
- Centaur overlay branch:
  `codex/nixmac-e2e-production-foundation`
- Centaur overlay base:
  `origin/main` at `b10ff0cf551a757d43cd0c319f7bf5e4dfd6e61f`

Do not add the unrelated `.beads/.gitignore` change present in the nixmac
worktree to any commit.

## File Map

### nixmac

- `tests/e2e/computer-use/drivers/runtime-contract.mjs` — normalized runtime
  driver methods and result validation used by every transport.
- `tests/e2e/computer-use/drivers/codex-app-server.mjs` — current Codex
  app-server wrapped behind the runtime contract.
- `tests/e2e/computer-use/drivers/cua-driver.mjs` — CuaDriver process/daemon
  adapter, app/window targeting, state/action normalization, and teardown.
- `tests/e2e/computer-use/drivers/driver-self-test.mjs` — local contract tests
  with no remote Mac.
- `tests/e2e/computer-use/fixtures/cua-driver/*.json` — sanitized raw CLI
  responses for deterministic adapter tests.
- `tests/e2e/computer-use/scenario-driver.mjs` — shared capture, click, value,
  wait, redaction, and evidence helpers operating on the runtime contract.
- `tests/e2e/computer-use/run-remote-cua.mjs` — stable CLI, changed only to
  inject the wrapped Codex driver and call shared scenario-driver helpers.
- `tests/e2e/computer-use/run-cua-driver.mjs` — on-Mac CuaDriver entrypoint.
- `tests/e2e/computer-use/cli.mjs` — stable command routing plus driver-neutral
  usage metadata.
- `tests/e2e/computer-use/evidence-manifest.mjs` — required-file inventory,
  SHA-256 generation, manifest validation, and immutable archive verification.
- `tests/e2e/computer-use/evidence-manifest-self-test.mjs` — manifest
  fail-closed tests.
- `tests/e2e/computer-use/run-metadata.mjs` — pre-UI identity files and
  post-run cleanup/attempt records consumed by the manifest.
- `.github/workflows/computer-use-e2e-centaur.yml` — manual API-dispatch
  workflow for one trusted harness revision and one exact-SHA app artifact.
- `.github/workflows/cilicon-lifecycle-attestation.yml` — accepts a
  host-authenticated post-destruction event and preserves a queryable
  attestation artifact.
- `tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs` — static
  workflow safety and artifact-binding assertions.
- `ops/runner/cilicon-e2e-cycle-wrapper.sh` — host-side supervisor that gives
  each one-VM Cilicon cycle a unique host-owned mount and clone identity.
- `ops/runner/cilicon-e2e-lifecycle-attestor.sh` — host-side VM-path/runner
  disappearance check and fail-closed quarantine sentinel.
- `ops/runner/com.darkmatter.nixmac-e2e-cycle.plist` — launchd service for the
  cycle wrapper and attestor.
- `tests/e2e/computer-use/README.md` and `OPERATIONS.md` — operator contract,
  backend policy, evidence storage, rollback, and qualification procedure.

### Centaur overlay

- `tools/github_e2e/client.py` — narrow GitHub API client for workflow
  dispatch, run/job inspection, artifact download metadata, Check Run
  publication, and runner deregistration checks.
- `tools/github_e2e/evidence.py` — independent Python verifier for the
  immutable nixmac manifest/archive and its cross-language golden fixtures.
- `tools/github_e2e/cli.py`, `__init__.py`, `pyproject.toml` — Centaur tool
  package and host/secret allowlist.
- `tools/buzz_e2e_result/client.py`, `cli.py`, `__init__.py`,
  `pyproject.toml` — separate result-only Buzz tool and same-host secret
  boundary; the legacy request tool remains untouched for rollback.
- `workflows/nixmac_e2e_merged_prs/workflow.py` — durable cursor, job/attempt
  state, Actions dispatch/reconciliation, retry, evidence verification handoff,
  and terminal publication.
- `workflows/tests/test_github_e2e_tool.py` — HTTP/client validation tests.
- `workflows/tests/test_nixmac_e2e_merged_prs.py` — coordinator, cursor,
  lifecycle, replay, retry, and terminal-publication tests.
- `workflows/tests/test_buzz_e2e_result_tool.py` — result payload and
  result-webhook boundary tests.
- `workflows/nixmac_e2e_merged_prs/README.md` — deployment variables,
  credential scope, shadow rollout, and rollback.
- `workflows/nixmac_e2e_merged_prs/buzz-workflow.yaml` — retained as rollback
  only until the direct path qualifies; no new request messages in production.

## Milestone A: Canonical Driver Seam

### Task 1: Define The Runtime Driver Contract

**Files:**
- Create: `tests/e2e/computer-use/drivers/runtime-contract.mjs`
- Create: `tests/e2e/computer-use/drivers/driver-self-test.mjs`
- Modify: `tests/e2e/computer-use/drivers/contract.mjs`
- Modify: `tests/e2e/computer-use/run-remote-cua.mjs`

- [ ] **Step 1: Write failing runtime-contract tests**

Test these exact requirements:

```js
const requiredMethods = [
  "connect",
  "prepareTarget",
  "visibleState",
  "click",
  "setValue",
  "close",
];

const state = normalizeVisibleState({
  text: "# Window\n[element_index 7] button Keep Changes",
  imageBase64: "aGVsbG8=",
  target: { pid: 101, windowId: 202, snapshotId: "turn-1" },
});

assert.equal(state.text.includes("Keep Changes"), true);
assert.equal(state.imageBase64, "aGVsbG8=");
assert.deepEqual(state.target, {
  pid: 101,
  windowId: 202,
  snapshotId: "turn-1",
});
assert.throws(() => validateRuntimeDriver({}), /connect/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-contract.mjs`.

- [ ] **Step 3: Implement the normalized contract**

Export:

```js
export const runtimeDriverMethods = Object.freeze([
  "connect",
  "prepareTarget",
  "visibleState",
  "click",
  "setValue",
  "close",
]);

export function normalizeVisibleState({
  text = "",
  imageBase64 = "",
  target = null,
  metadata = {},
} = {}) {
  if (typeof text !== "string") throw new TypeError("visible state text must be a string");
  if (typeof imageBase64 !== "string")
    throw new TypeError("visible state imageBase64 must be a string");
  return Object.freeze({
    text,
    imageBase64,
    target: target ? Object.freeze({ ...target }) : null,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function normalizeActionResult({ ok, text = "", isError = false } = {}) {
  return Object.freeze({
    ok: ok === true && isError !== true,
    text: String(text || ""),
    isError: isError === true,
  });
}

export function validateRuntimeDriver(driver) {
  const missing = runtimeDriverMethods.filter(
    (method) => typeof driver?.[method] !== "function",
  );
  if (missing.length) throw new TypeError(`Runtime driver missing: ${missing.join(", ")}`);
  return driver;
}
```

`prepareTarget({ appBundleId, appPath })` is a no-op assertion for the existing
Codex transport because its workflow already launched the app. The CuaDriver
transport launches the staged exact-SHA app and returns its pid/window target.

- [ ] **Step 4: Add `cua-element-index` validation**

Require integer `elementIndex`, integer `pid`, integer `windowId`, and non-empty
`snapshotId`. Keep existing built-in address kinds unchanged; register the new
kind through the existing explicit adapter extension hook.

- [ ] **Step 5: Run contract and existing runner self-tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/computer-use/drivers/runtime-contract.mjs \
  tests/e2e/computer-use/drivers/driver-self-test.mjs \
  tests/e2e/computer-use/drivers/contract.mjs \
  tests/e2e/computer-use/run-remote-cua.mjs
git commit -m "test(e2e): define runtime driver contract"
```

### Task 2: Wrap The Existing Codex Transport

**Files:**
- Create: `tests/e2e/computer-use/drivers/codex-app-server.mjs`
- Modify: `tests/e2e/computer-use/transport.mjs`
- Modify: `tests/e2e/computer-use/drivers/driver-self-test.mjs`

- [ ] **Step 1: Write a failing adapter test**

Use the existing mock WebSocket and assert:

```js
const driver = new CodexAppServerDriver("ws://mock", {
  WebSocketImpl: MockWebSocket,
});
await driver.connect();
await driver.prepareTarget({ appBundleId: "com.darkmatter.nixmac" });
const state = await driver.visibleState({ app: "com.darkmatter.nixmac" });
assert.equal(state.text, "mock AX");
assert.equal(state.imageBase64, "mock-image");
const clicked = await driver.click({ app: "com.darkmatter.nixmac", elementIndex: 7 });
assert.equal(clicked.ok, true);
driver.close();
```

- [ ] **Step 2: Verify the test fails**

Expected: `CodexAppServerDriver is not defined`.

- [ ] **Step 3: Implement the wrapper**

`CodexAppServerDriver` must:

- own an `AppServerClient`;
- implement `prepareTarget` as a no-op assertion that an app bundle ID exists;
- map `visibleState` to `get_app_state`;
- map `click` to `click`;
- map `setValue` to `set_value`;
- normalize all responses through `runtime-contract.mjs`;
- expose `codexAppServerDriverDescriptor`;
- preserve the current initialize/thread policy exactly.

- [ ] **Step 4: Run tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: PASS with the same JSON-RPC order assertions as before.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/computer-use/drivers/codex-app-server.mjs \
  tests/e2e/computer-use/transport.mjs \
  tests/e2e/computer-use/drivers/driver-self-test.mjs
git commit -m "refactor(e2e): wrap Codex transport"
```

### Task 3: Extract Driver-Neutral Scenario Helpers

**Files:**
- Create: `tests/e2e/computer-use/scenario-driver.mjs`
- Modify: `tests/e2e/computer-use/run-remote-cua.mjs`
- Modify: `tests/e2e/computer-use/drivers/driver-self-test.mjs`

- [ ] **Step 1: Write failing helper tests**

Test:

- sensitive API-key state writes redacted text but no PNG;
- a normal state writes text and image;
- element lookup feeds `driver.click`;
- action failure returns `false` and records a failure event;
- set-value passes the resolved element address;
- wait polls until the supplied predicate passes.

Use an in-memory fake driver:

```js
const fake = {
  states: [normalState],
  clicks: [],
  async visibleState() { return this.states.shift(); },
  async click(input) {
    this.clicks.push(input);
    return { ok: true, text: "clicked", isError: false };
  },
};
```

- [ ] **Step 2: Verify the new test fails**

Expected: missing `scenario-driver.mjs`.

- [ ] **Step 3: Move the helpers without behavior changes**

Move and dependency-inject:

- `captureState`
- `clickByPattern`
- `clickElementIndex`
- `setValueByPattern`
- `setValueElementIndex`
- `waitFor`

The module accepts callbacks for `addEvent`, `saveState`, `addNarrative`,
`redact`, `containsUnmaskedSecret`, and `pngDimensions` so it remains
deterministic and does not create circular imports.

- [ ] **Step 4: Inject the Codex driver**

Replace:

```js
const client = new AppServerClient(options.ws);
```

with:

```js
const driver = validateRuntimeDriver(
  new CodexAppServerDriver(options.ws),
);
```

Pass `driver` through all extracted helpers and browser-report inspection.

- [ ] **Step 5: Verify no raw `client.tool` calls remain in scenario code**

Run:

```bash
rg -n 'client\.tool|new AppServerClient' \
  tests/e2e/computer-use/run-remote-cua.mjs \
  tests/e2e/computer-use/scenario-driver.mjs
```

Expected: no matches.

- [ ] **Step 6: Run preservation gates**

Run:

```bash
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/preservation-harness.mjs run
node tests/e2e/computer-use/run-adversarial.mjs
```

Expected: all PASS; preservation signatures unchanged.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/computer-use/scenario-driver.mjs \
  tests/e2e/computer-use/run-remote-cua.mjs \
  tests/e2e/computer-use/drivers/driver-self-test.mjs
git commit -m "refactor(e2e): inject computer-use driver"
```

## Milestone B: CuaDriver Runtime

### Task 4: Implement The CuaDriver CLI Adapter

**Files:**
- Create: `tests/e2e/computer-use/drivers/cua-driver.mjs`
- Create: `tests/e2e/computer-use/fixtures/cua-driver/list-apps.json`
- Create: `tests/e2e/computer-use/fixtures/cua-driver/list-windows.json`
- Create: `tests/e2e/computer-use/fixtures/cua-driver/window-state.json`
- Create: `tests/e2e/computer-use/fixtures/cua-driver/action-success.json`
- Create: `tests/e2e/computer-use/fixtures/cua-driver/action-error.json`
- Modify: `tests/e2e/computer-use/drivers/driver-self-test.mjs`

- [ ] **Step 1: Capture and sanitize real raw response fixtures**

Use the installed static-Mac CuaDriver with `--raw --compact --no-daemon`.
Replace live pids, window IDs, paths, titles, and any user text with stable
fixture values. Do not include the remote host, usernames, keys, or secrets.

- [ ] **Step 2: Write failing adapter tests**

Cover:

- CLI argv uses no shell;
- daemon socket is run-specific;
- `prepareTarget` launches the staged app through `launch_app`;
- returned bundle ID resolves to the expected running pid;
- on-screen window selection is deterministic;
- `get_window_state` text and image normalize correctly;
- the snapshot ID changes after each visible-state call;
- stale element addresses are rejected before a click;
- click/set-value map to CuaDriver integer element indices;
- `isError: true` maps to `ok: false`;
- close calls `stop --socket` only for a daemon the adapter started.

- [ ] **Step 3: Implement a process runner**

Use `spawn` with argv arrays:

```js
async function runCua(binary, args, { input, timeoutMs = 90_000 } = {}) {
  // No shell. Collect bounded stdout/stderr. Kill on timeout.
}
```

Parse only raw MCP result objects shaped as:

```js
{
  content: [{ type: "text", text: "..." }, { type: "image", data: "..." }],
  structuredContent: {},
  isError: false,
}
```

- [ ] **Step 4: Implement connection and targeting**

`connect()` must:

1. run `--version`;
2. start `serve --socket <run-socket>`;
3. poll `status --socket <run-socket>`;
4. call `check_permissions`;
5. fail unless Accessibility and Screen Recording are granted.

`prepareTarget({ appBundleId, appPath })` must:

1. prove `appPath` exists and its bundle ID equals `appBundleId`;
2. prove the workflow placed the exact staged bundle at the run-specific
   canonical app path and no other process for that bundle ID is running;
3. call `launch_app` with the bundle ID;
4. reject a returned pid of zero or a mismatched bundle ID;
5. query the launched pid's executable path without AppleScript and require its
   canonical path to be inside `appPath/Contents/MacOS/`;
6. recompute the running bundle digest and require it to equal the preflight
   digest;
7. use returned windows or call `list_windows`;
8. select one on-screen current-Space layer-0 window deterministically;
9. retain pid/window/app-path identity for every later state/action.

- [ ] **Step 5: Implement normalized UI methods**

`visibleState()` calls:

```text
call get_window_state
{"pid":<pid>,"window_id":<windowId>,"screenshot_out_file":<tempPng>}
--raw --compact --socket <runSocket>
```

It returns text, base64-encoded PNG bytes read from `tempPng`, and:

```js
{ pid, windowId, snapshotId: `${pid}:${windowId}:${turnId}` }
```

`click()` and `setValue()` reject addresses whose target differs from the most
recent snapshot and then invoke `click` or `set_value`.

- [ ] **Step 6: Run tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: PASS without a remote Mac.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/computer-use/drivers/cua-driver.mjs \
  tests/e2e/computer-use/drivers/driver-self-test.mjs \
  tests/e2e/computer-use/fixtures/cua-driver
git commit -m "feat(e2e): add CuaDriver adapter"
```

### Task 5: Add The On-Mac Runner

**Files:**
- Create: `tests/e2e/computer-use/run-cua-driver.mjs`
- Modify: `tests/e2e/computer-use/run-remote-cua.mjs`
- Modify: `tests/e2e/computer-use/cli.mjs`
- Modify: `tests/e2e/computer-use/README.md`
- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- [ ] **Step 1: Extract `runSuite` as an injected function**

Export:

```js
export async function runSuiteWithDriver(args, {
  createDriver,
  executionTopology,
} = {}) {}
```

The existing `run` command calls it with `CodexAppServerDriver` and
`executionTopology: "remote-codex-app-server"`.

- [ ] **Step 2: Write the CuaDriver entrypoint**

The new entrypoint calls the same function with:

```js
createDriver: (options) => new CuaDriver({
  binary: process.env.NIXMAC_CUA_DRIVER_BINARY || "cua-driver",
  socketPath: process.env.NIXMAC_CUA_DRIVER_SOCKET,
  appBundleId: options.app,
  runDir: options.runDir,
}),
executionTopology: "local-cua-driver",
```

- [ ] **Step 3: Make topology-specific steps explicit**

For local CuaDriver:

- skip SSH baseline/report-copy helpers;
- require `NIXMAC_E2E_DISPOSABLE_CONFIG=true`;
- require `NIXMAC_E2E_APP_ARTIFACT_SHA`;
- require `NIXMAC_E2E_APP_PATH`, verify its bundle ID/digest, and call
  `driver.prepareTarget(...)` before the first visible-state capture;
- require the workflow to stop any existing process with the same bundle ID,
  stage the tested bundle at a run-specific canonical path, and verify the
  launched pid's executable path remains under that exact bundle;
- inspect the HTML report locally in a non-personal isolated browser only if
  report inspection remains a required scenario.

- [ ] **Step 4: Add CLI contract tests**

Assert `run-cua-driver.mjs self-test` is local-only and never invokes
`ssh`, `scp`, or a WebSocket.

- [ ] **Step 5: Run local gates**

Run:

```bash
node tests/e2e/computer-use/run-cua-driver.mjs self-test
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/preservation-harness.mjs run
```

Expected: PASS.

- [ ] **Step 6: Run one static-Mac smoke test**

Stage a disposable exact-SHA app and config on the existing fallback Mac. Run
only launch, Settings, and report-render smoke scenarios first. Require:

- before/after AX state;
- safe screenshots;
- exact app digest;
- clean owned paths;
- no raw whole-run video;
- no Buzz or GitHub publication.

Expected: terminal PASS or a classified infrastructure blocker with retained
evidence; never an unclassified failure.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/computer-use/run-cua-driver.mjs \
  tests/e2e/computer-use/run-remote-cua.mjs \
  tests/e2e/computer-use/cli.mjs \
  tests/e2e/computer-use/README.md \
  tests/e2e/computer-use/OPERATIONS.md
git commit -m "feat(e2e): add local CuaDriver runner"
```

### Task 6: Add A Fail-Closed Evidence Manifest

**Files:**
- Create: `tests/e2e/computer-use/evidence-manifest.mjs`
- Create: `tests/e2e/computer-use/evidence-manifest-self-test.mjs`
- Create: `tests/e2e/computer-use/run-metadata.mjs`
- Modify: `tests/e2e/computer-use/run-remote-cua.mjs`
- Modify: `tests/e2e/computer-use/run-cua-driver.mjs`
- Modify: `tests/e2e/computer-use/report.mjs`

- [ ] **Step 1: Write failing manifest tests**

Cover:

- stable relative-path ordering;
- SHA-256 for every required file;
- refusal of absolute paths, `..`, symlinks, missing files, empty required
  files, duplicate paths, and digest mismatch;
- required identity fields;
- all required identity sidecars exist before manifest generation;
- preflight refuses to begin UI actions if app, artifact, harness, suite,
  runner, image, or permission identity is missing;
- cleanup and attempt sidecars are finalized before manifest generation;
- video points only to the curated safe-frame reel.

- [ ] **Step 2: Write identity sidecars before UI actions**

`writeRunPreflight(...)` creates:

```text
runner/identity.json
runner/permissions.json
artifact/source.json
attempt.json
```

Required values come from validated workflow inputs and live probes:

```js
{
  jobId,
  mergeSha,
  suiteVersion,
  harnessSha,
  actionsRunId,
  actionsJobId,
  runnerName,
  runnerBackend,
  runnerImageDigest,
  buildRunId,
  artifactId,
  artifactDigest,
  appBundlePath,
  appBundleDigest,
  cuaDriverCliVersion,
  cuaDriverAppVersion,
  accessibilityGranted,
  screenRecordingGranted,
}
```

`assertRunPreflight(...)` runs before `driver.prepareTarget`. It recomputes the
app-bundle digest and fails closed on a missing/empty/mismatched field.

- [ ] **Step 3: Finalize cleanup and attempt sidecars**

In `finally`, stop CuaDriver and the app, restore/remove owned paths, and write:

```text
runner/cleanup.json
attempt.json
```

`runner/cleanup.json` contains attempted/restored/clean booleans, owned paths,
remaining processes, and a failure reason. Never mark cleanup clean by default.

- [ ] **Step 4: Define manifest version 1**

```js
{
  version: 1,
  job: { id, repo, mergeSha, suiteVersion },
  attempt: { number, actionsRunId, actionsJobId },
  harness: { sha },
  app: { artifactId, artifactDigest, bundleDigest },
  runner: { backend, name, imageDigest },
  cuaDriver: { cliVersion, appBundleVersion, captureMode },
  verdict,
  files: [{ path, sha256, bytes }],
}
```

- [ ] **Step 5: Generate after final render and cleanup**

Generate `manifest.json` only after `state.json`, `events.json`, `index.html`,
safe screenshots/text, safe-frame video, every identity sidecar, and final
cleanup are complete. Then verify the manifest from disk before the runner
exits.

Support two explicit finalization modes:

- `local-finalize` for an ephemeral on-Mac job: local cleanup is the complete
  cleanup boundary, so the runner writes cleanup, creates, and verifies the
  final manifest.
- `controller-finalize` for `static_ssh`: the remote runner writes evidence and
  attempt data but no final `manifest.json`. After copy-back, the ARC controller
  performs remote staging/config/process cleanup, writes the only final
  `runner/cleanup.json` into the local evidence tree, then runs the trusted
  `evidence-manifest.mjs create` and `verify` commands. Nothing may mutate the
  evidence tree after that verification except zip packaging.

- [ ] **Step 6: Run tests**

Run:

```bash
node tests/e2e/computer-use/evidence-manifest-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/preservation-harness.mjs run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/computer-use/evidence-manifest.mjs \
  tests/e2e/computer-use/evidence-manifest-self-test.mjs \
  tests/e2e/computer-use/run-metadata.mjs \
  tests/e2e/computer-use/run-remote-cua.mjs \
  tests/e2e/computer-use/run-cua-driver.mjs \
  tests/e2e/computer-use/report.mjs
git commit -m "feat(e2e): bind immutable evidence manifest"
```

## Milestone C: GitHub Actions Execution

### Task 7: Add The Centaur-Dispatch Workflow

**Files:**
- Create: `.github/workflows/computer-use-e2e-centaur.yml`
- Create: `tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs`
- Modify: `tests/e2e/computer-use/workflow-contract-self-test.mjs`
- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- [ ] **Step 1: Repair and freeze the inherited workflow contract**

Run the existing contract test before changing the new workflow:

```bash
node tests/e2e/computer-use/workflow-contract-self-test.mjs
```

Expected at the pinned base: FAIL because the ARC migration renamed the
existing remote concurrency group from `computer-use-e2e-dxu-remote` to
`nixmac-macincloud-e2e-remote` without updating the assertion. Update only
that stale assertion, confirm the current workflow still has one remote lock,
and rerun to PASS. This is a baseline repair, not a behavior change.

- [ ] **Step 2: Write a failing workflow contract test**

Assert:

- trigger is `workflow_dispatch` only;
- full SHA, logical job ID, build run ID, app artifact ID, and artifact digest
  inputs are required;
- `run-name` contains the exact logical job ID and attempt;
- permissions are least-privilege;
- workflow definition comes from the default branch;
- app artifact is downloaded by the pre-resolved artifact ID and verified
  against the supplied source run/SHA/digest;
- primary job uses `[self-hosted, macOS, nixmac-e2e]`;
- static fallback has a distinct Linux controller job on the dedicated
  one-capacity `nixmac-e2e-static-controller` runner queue and does not use a
  GitHub concurrency group;
- static fallback performs strict SSH, before/after inventory, cleanup, and
  quarantine;
- `run-cua-driver.mjs` is the UI entrypoint;
- artifact upload uses the repository-standard `actions/upload-artifact@v7`;
- a serialized report job publishes the verified report at a deterministic URL;
- `if: always()` uploads diagnostics;
- no PR comment, Buzz call, or raw video capture occurs in this workflow.

- [ ] **Step 3: Verify the test fails**

Expected: missing workflow file.

- [ ] **Step 4: Create the manual-only workflow**

Inputs:

```yaml
run-name: nixmac-e2e / ${{ inputs.job_id }} / attempt ${{ inputs.attempt }} / nonce ${{ inputs.attestation_nonce }}

workflow_dispatch:
  inputs:
    merge_sha: { required: true, type: string }
    job_id: { required: true, type: string }
    attempt: { required: true, type: number }
    suite_version: { required: true, type: string }
    build_run_id: { required: true, type: string }
    app_artifact_id: { required: true, type: string }
    app_artifact_digest: { required: true, type: string }
    attestation_nonce: { required: true, type: string }
    backend:
      required: true
      type: choice
      options: [cilicon_tart, static_ssh]
```

The ephemeral job uses
`concurrency.group: computer-use-e2e-${{ inputs.job_id }}` with
`cancel-in-progress: false`.

The static job has no `concurrency` key. It runs on a dedicated
`nixmac-e2e-static-controller` Linux runner queue whose deployment is
hard-limited to one runner. GitHub therefore queues every burst item instead of
keeping only one pending item and cancelling the rest. Before enabling the
static backend, provision and verify that one-capacity queue; a second online
runner with the label is a fail-closed readiness error.

- [ ] **Step 5: Bind the trusted harness and tested app separately**

- checkout the default-branch harness revision that contains the workflow;
- download exactly `inputs.app_artifact_id` from `inputs.build_run_id`;
- verify its GitHub metadata source SHA equals `inputs.merge_sha`;
- verify the archive digest equals `inputs.app_artifact_digest`;
- never execute scripts from the tested merge;
- compute the extracted app-bundle digest;
- write and assert every Task 6 preflight identity sidecar before UI work.

- [ ] **Step 6: Implement both backend jobs**

`cilicon_tart` runs `run-cua-driver.mjs` directly on
`[self-hosted, macOS, nixmac-e2e]`.

`static_ssh` runs on the dedicated one-capacity Linux controller queue and
reuses the current workflow's strict known-hosts/key handling to:

1. assert exactly one online runner has the
   `nixmac-e2e-static-controller` label;
2. stage the exact app archive and harness into unique run roots;
3. inventory owned processes/paths before the run;
4. invoke the on-Mac CuaDriver runner through SSH;
5. copy evidence back;
6. restore/remove owned state in `if: always()`;
7. compare after inventory;
8. write the controller-owned final `runner/cleanup.json` into the copied
   evidence tree;
9. create and verify the final manifest on the controller after cleanup;
10. package the now-immutable tree without further mutation;
11. create a quarantine marker and fail infrastructure readiness if cleanup is
   not clean.

- [ ] **Step 7: Upload canonical evidence**

Artifact name:

```text
nixmac-computer-use-e2e-<job-id>-attempt-<attempt>
```

Set an explicit retention period and surface artifact ID/digest in job outputs
where GitHub exposes them.

- [ ] **Step 8: Publish the verified report**

After manifest verification, a Linux/ARC job downloads the artifact and uses
the existing serialized gh-pages publisher under:

```text
computer-use-e2e/jobs/<job-id>/attempt-<attempt>/
```

The deterministic report URL is recorded in the workflow summary and Centaur
job record. The Actions artifact, not gh-pages, remains canonical.

- [ ] **Step 9: Run workflow static tests**

Run:

```bash
node tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs
node tests/e2e/computer-use/workflow-contract-self-test.mjs
actionlint .github/workflows/computer-use-e2e-centaur.yml
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add .github/workflows/computer-use-e2e-centaur.yml \
  tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs \
  tests/e2e/computer-use/workflow-contract-self-test.mjs \
  tests/e2e/computer-use/OPERATIONS.md
git commit -m "ci(e2e): add Centaur-dispatch workflow"
```

- [ ] **Step 11: Land the trusted harness before live dispatch**

Open the nixmac foundation PR only after the driver, evidence, and workflow
reviews are green. The workflow must be merged to `main` before GitHub will
accept `workflow_dispatch`, and production dispatch remains pinned to
`ref=main`. Do not add a branch-ref escape hatch that would let an untrusted
tested branch define the harness.

## Milestone D: Durable Centaur Orchestration

### Task 8: Add A Narrow GitHub E2E Tool

**Files:**
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/client.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/cli.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/__init__.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/evidence.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/fixtures/*`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/github_e2e/pyproject.toml`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_github_e2e_tool.py`

- [ ] **Step 1: Write failing client tests with a fake HTTP transport**

Test:

- allow only `darkmatter/nixmac`;
- allow only `.github/workflows/computer-use-e2e-centaur.yml`;
- validate full lowercase SHA and bounded job ID;
- find one successful `Build macOS App` run for the exact SHA and one exact app
  artifact, returning run ID, artifact ID, and artifact digest;
- dispatch with an explicit `ref=main`;
- make dispatch replay-safe: search through a bounded visibility window for an
  existing run with the exact job ID, attempt, and nonce before dispatch;
- after dispatch, resolve every exact match, choose the earliest `created_at`
  run as canonical, and cancel later duplicates;
- inspect run/jobs without trusting workflow conclusion as test verdict;
- list one exact artifact name and reject zero/multiple matches;
- create/update one Check Run with the job ID as `external_id`;
- download and independently verify the immutable evidence zip;
- never expose injected authorization headers.

- [ ] **Step 2: Implement the client**

Public methods:

```python
ensure_workflow_run(...)
find_exact_sha_app_artifact(...)
find_workflow_run(...)
get_workflow_run(...)
list_jobs(...)
cancel_workflow_run(...)
get_artifact(...)
download_artifact(...)
create_or_update_check(...)
runner_deregistered(...)
find_lifecycle_attestation(...)
verify_evidence_archive(...)
```

All requests use `api.github.com`, API version `2022-11-28`, bounded timeouts,
and typed/validated dictionaries.

- [ ] **Step 3: Implement the independent archive verifier**

`evidence.py`:

- rejects zip-slip paths, symlinks, duplicate entries, oversized files, and
  decompression bombs;
- parses `manifest.json`;
- enforces manifest version and identity schema;
- hashes every listed file;
- requires all identity sidecars and safe-frame video;
- returns only normalized verdict/counts/report path/failure class;
- shares golden valid/invalid archives with the Node verifier so both
  implementations must accept/reject the same cases.

- [ ] **Step 4: Declare narrow Centaur capabilities**

`pyproject.toml`:

```toml
[tool.centaur]
module = "client.py"
hosts = ["api.github.com"]
secrets = [{
  type = "http",
  name = "NIXMAC_E2E_GITHUB_TOKEN",
  mode = "inject",
  inject_header = "Authorization",
  hosts = ["api.github.com"]
}]
```

The deployed credential needs Actions read/write, Checks write, Contents read,
and repository Administration read on `darkmatter/nixmac`. Administration is
read-only and is required solely to verify the dedicated self-hosted runner
inventory and deregistration; no runner mutation is allowed by the tool.

- [ ] **Step 5: Run tests**

Run:

```bash
python -m unittest workflows.tests.test_github_e2e_tool -v
```

Expected: PASS with no network.

- [ ] **Step 6: Commit in the overlay worktree**

```bash
git add tools/github_e2e workflows/tests/test_github_e2e_tool.py
git commit -m "feat(e2e): add scoped GitHub Actions tool"
```

### Task 9: Make Reconciliation Lossless With The Child Ledger

**Files:**
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

- [ ] **Step 1: Write failing reconciliation tests**

Cover:

- schedule is every 15 minutes;
- pagination reads every merged PR in the 30-day repair window;
- automatic candidates must be at or after the deployed suite version's
  immutable `suite_activated_at` timestamp;
- oldest merge dispatches first;
- every candidate reaches `ctx.start_workflow`, even when more than the former
  `max_prs` cap merge between ticks;
- child idempotency reports duplicates without starting a second execution;
- malformed/future/unmerged rows remain excluded;
- an outage older than 30 days requires an explicit private backfill rather
  than an implicit public replay.
- changing `suite_version` cannot enqueue older merges from the repair window;
  those require an explicit private backfill.

- [ ] **Step 2: Replace newest-N slicing**

Paginate and return every valid candidate in the bounded repair window,
oldest-first, then exclude merges before `suite_activated_at`. Remove the
candidate slice entirely. Do not let already-created children consume or hide
any candidate.

- [ ] **Step 3: Use the existing durable child ledger**

The cross-scheduler-run delivery ledger is the Centaur child-workflow
idempotency key:

```text
nixmac-e2e:darkmatter/nixmac:<sha>:<suite-version>
```

Run the 30-day scan every 15 minutes. Alert if a scheduler tick has not
succeeded for 30 minutes. A private manual backfill accepts an explicit date
range and keeps publication disabled.

Set `suite_version` and `suite_activated_at` together in the deployed schedule
input. The activation timestamp is fixed for that suite version and validated
as ISO-8601 UTC; changing it after activation is a configuration error.

- [ ] **Step 4: Run tests**

Run:

```bash
python -m unittest workflows.tests.test_nixmac_e2e_merged_prs -v
```

Expected: PASS including a synthetic seven-merge burst in one interval, with
all seven passed to `start_workflow` and duplicates reported as `created=false`.

- [ ] **Step 5: Commit**

```bash
git add workflows/nixmac_e2e_merged_prs/workflow.py \
  workflows/tests/test_nixmac_e2e_merged_prs.py \
  workflows/nixmac_e2e_merged_prs/README.md
git commit -m "fix(e2e): make merge detection lossless"
```

### Task 10: Implement Job And Attempt Reconciliation

**Files:**
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`

- [ ] **Step 1: Write failing lifecycle tests**

Script fake contexts for:

- no exact-SHA build artifact yet (`WAITING_ARTIFACT`, no E2E dispatch);
- exact-SHA build artifact becomes ready;
- first E2E dispatch with build run/artifact identity;
- replay after GitHub accepted dispatch but before the Centaur checkpoint;
- delayed run visibility followed by deterministic duplicate cancellation;
- waiting on a queued Actions run;
- successful run with missing artifact;
- verified PASS artifact;
- product FAIL with one confirmation attempt;
- infrastructure failure with one fresh attempt;
- terminal INCONCLUSIVE after retry;
- cancellation;
- no supersession for merged-SHA jobs;
- lifecycle attestation timeout;
- report publisher missing the deterministic report URL;
- replay after publication.

- [ ] **Step 2: Add explicit job and attempt records**

The child result contains:

```python
{
    "job": {
        "id": job_id,
        "state": "PASS",
        "merge_sha": sha,
        "suite_version": suite_version,
        "build_run_id": 111,
        "app_artifact_id": 222,
        "app_artifact_digest": "sha256:app-artifact",
        "report_url": "https://darkmatter.github.io/nixmac/...",
    },
    "attempts": [{
        "number": 1,
        "actions_run_id": 123,
        "actions_job_id": 456,
        "runner_name": "nixmac-e2e-...",
        "artifact_id": 789,
        "artifact_digest": "sha256:...",
        "failure_class": "",
        "attestation_nonce": "64-lowercase-hex-characters",
        "lifecycle_attestation": "destroyed",
    }],
}
```

- [ ] **Step 3: Make every external effect a named durable step**

Named steps:

```text
resolve-build-artifact-poll-<p>
create-attestation-nonce-<n>
ensure-run-attempt-<n>
resolve-run-<n>
inspect-run-<n>-poll-<p>
download-artifact-<n>
verify-evidence-<n>
attest-runner-<n>
resolve-report-url-<n>
publish-check
publish-buzz
```

Use `ctx.sleep(...)` between polls. Do not use a long blocking sleep.

`create-attestation-nonce-<n>` uses `secrets.token_hex(32)` inside `ctx.step`,
stores the exact nonce in the attempt record, and passes it with the attempt
number to the trusted workflow. Retries always receive a different nonce.

`ensure-run-attempt-<n>` calls `ensure_workflow_run`: search first for the exact
job/attempt/nonce through a bounded GitHub visibility window, dispatch only
when still absent, then resolve all exact matches. The earliest `created_at`
run is canonical and every later duplicate is cancelled through a named,
replay-safe step. A crash after GitHub accepts dispatch therefore reattaches to
the accepted run instead of blindly dispatching again.

- [ ] **Step 4: Implement verdict truth**

Before dispatch, poll `find_exact_sha_app_artifact` through a named durable
step. Keep the job in `WAITING_ARTIFACT` and allocate no Mac until a successful
build run and exact artifact ID/digest exist. Pass those values into the
workflow inputs.

After the workflow run, download the Actions artifact and call the independent
`github_e2e.verify_evidence_archive` implementation. Require the deterministic
gh-pages report URL from Task 7 before publication. Map:

- valid `state.verdict=pass` + lifecycle attested -> PASS;
- valid product fail -> FAIL;
- harness/provider/credential/runner failures -> retry or INCONCLUSIVE;
- missing/invalid artifact -> infrastructure failure, never PASS.

For `cilicon_tart`, lifecycle attestation is the signed post-destruction
artifact from Task 12 plus GitHub runner deregistration. For `static_ssh`, it is
the verified clean `runner/cleanup.json`; static runs never claim `destroyed`.
Centaur accepts the attestation only when job ID, attempt number, runner name,
image digest, and nonce exactly match the attempt record and no earlier attempt
has consumed that nonce.

- [ ] **Step 5: Run tests**

Run:

```bash
python -m unittest workflows.tests.test_nixmac_e2e_merged_prs -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workflows/nixmac_e2e_merged_prs/workflow.py \
  workflows/tests/test_nixmac_e2e_merged_prs.py
git commit -m "feat(e2e): reconcile durable test attempts"
```

### Task 11: Publish One Terminal Result

**Files:**
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/client.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/cli.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/__init__.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/pyproject.toml`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_buzz_e2e_result_tool.py`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/buzz-result-workflow.yaml`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

- [ ] **Step 1: Write failing publication tests**

Require:

- one Check Run keyed by logical job ID;
- one Buzz message after terminal verification only;
- no start/retry/heartbeat messages;
- replay returns the stored publication;
- manual/private backfills publish neither;
- Buzz message is at most one concise line plus report URL;
- no host, runner username, secret name, or raw failure payload appears.

- [ ] **Step 2: Add a result-only Buzz method**

```python
publish_test_result(
    repo,
    pr_number,
    merge_sha,
    verdict,
    passed,
    total,
    failure_class,
    report_url,
    job_id,
)
```

Validate every field before posting. Implement this in the separate
`buzz_e2e_result` tool package. Keep the existing `buzz_e2e` request tool
unchanged for rollback and never call it from the new production child path.

Create and deploy a separate result-only Buzz webhook from
`buzz-result-workflow.yaml`. It accepts only the validated terminal payload and
posts one message to `#nixmac-e2e` as Farhan's Ear. Give the Centaur tool a
distinct injected `BUZZ_E2E_RESULT_WEBHOOK_SECRET` in
`tools/buzz_e2e_result/pyproject.toml`; do not place two same-host/header
secrets in one tool or reuse the legacy request webhook.

- [ ] **Step 3: Publish GitHub Check first, Buzz second**

If GitHub publication succeeds and Buzz fails, replay only the missing Buzz
step. The result remains terminal but publication health alerts.

- [ ] **Step 4: Run tests**

Run:

```bash
python -m unittest \
  workflows.tests.test_buzz_e2e_result_tool \
  workflows.tests.test_nixmac_e2e_merged_prs -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/buzz_e2e_result \
  workflows/tests/test_buzz_e2e_result_tool.py \
  workflows/nixmac_e2e_merged_prs
git commit -m "feat(e2e): publish terminal test results"
```

## Milestone E: Runner Image And Qualification

### Task 12: Add The E2E Image Layer After PR #604 Lands

**Files:**
- Create: `ops/images/nixmac-e2e-runner-tahoe.pkr.hcl`
- Create: `ops/runner/cilicon-e2e-cycle-wrapper.sh`
- Create: `ops/runner/cilicon-e2e-lifecycle-attestor.sh`
- Create: `ops/runner/com.darkmatter.nixmac-e2e-cycle.plist`
- Create: `.github/workflows/cilicon-lifecycle-attestation.yml`
- Create: `tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs`
- Modify: `.github/workflows/macos-ci-image.yaml`
- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- [ ] **Step 1: Rebase this branch on the main commit containing PR #604**

Do not cherry-pick or edit PR #604. Resolve only small, explicit conflicts.

- [ ] **Step 2: Write image contract checks**

Verify:

- base image reference is immutable;
- CuaDriver artifact URL, checksum, CLI version, and app-bundle version are
  pinned;
- no secrets enter Packer;
- dedicated test user exists;
- evidence root permissions are correct;
- ffmpeg is present;
- TCC checks fail closed;
- secret scan runs before push.

- [ ] **Step 3: Build the E2E layer**

Derive from the same base/image conventions as PR #604; do not duplicate the
full Xcode installation recipe.

- [ ] **Step 4: Qualify first boot and aged boot**

On a dedicated image builder:

1. boot a fresh clone;
2. verify logged-in Aqua session;
3. verify Accessibility and Screen Recording;
4. run CuaDriver smoke;
5. stop and age/reboot the image;
6. repeat permissions and smoke;
7. destroy the clone;
8. record image digest and proof.

- [ ] **Step 5: Implement host-side destruction attestation**

Install `cilicon-e2e-lifecycle-attestor.sh` on every dedicated E2E host. It
receives the logical job ID, attempt number, attestation nonce, runner name,
expected VM clone path, and image digest from the
`cilicon-e2e-cycle-wrapper.sh` added by this task; this is new host
infrastructure, not an assumed upstream Cilicon hook.

Each dedicated host runs the wrapper as
`com.darkmatter.nixmac-e2e-cycle` under launchd with capacity one. For every
cycle the wrapper:

1. refuses to start when the quarantine sentinel exists;
2. creates a unique host-owned cycle directory and `directoryMount`;
3. snapshots Tart/Cilicon inventory, starts one Cilicon cycle with the pinned
   image/config, and resolves the one new clone path;
4. records the clone path, runner name, image digest, and cycle ID outside the
   guest;
5. supervises Cilicon until the GitHub job exits; and
6. invokes the attestor before permitting another cycle.

Before UI execution, the trusted workflow writes an
`attestation-request.json` containing those exact values into a host-only
Cilicon `directoryMount`. The host daemon atomically claims that request and
persists it outside the VM before teardown. The tested app cannot choose the
job ID, attempt, or nonce; they originate in the checkpointed Centaur attempt.

After the GitHub job exits the host attestor must:

1. wait for the ephemeral runner to deregister;
2. wait for the exact VM clone path to disappear;
3. verify no matching VM remains in the host inventory;
4. emit a nonce-bound JSON attestation with host ID, image digest, job ID,
   attempt number, runner name, nonce, destroyed timestamp, and result;
5. POST a scoped `repository_dispatch` event authenticated by a dedicated
   GitHub App;
6. create `/var/db/nixmac-e2e-quarantined` and stop new E2E cycles if any check
   times out or fails.

`cilicon-lifecycle-attestation.yml` validates the allowlisted event shape,
writes an immutable artifact named
`nixmac-e2e-lifecycle-<job-id>-attempt-<attempt>`, and exposes a `run-name`
Centaur can resolve. The workflow preserves the nonce but does not decide
whether it is expected; Centaur compares it with the checkpointed attempt
record and consumes it once. The workflow never runs repository code from the
tested SHA.

Provision the dedicated GitHub App before private qualification. It may emit
only the lifecycle `repository_dispatch` event and read the E2E runner
inventory. Record its installation ID and injected secret names in
`OPERATIONS.md`; never put keys in the image or repository. If the app or
required repository Administration-read permission is unavailable, hold
ephemeral promotion and continue with the static transition lane.

- [ ] **Step 6: Write lifecycle contract tests**

Test success, missing clone path identity, timeout, forged job ID, replayed
nonce, mismatched attempt number, GitHub runner still present, and quarantine
behavior. Also test wrapper restart recovery, two-cycle serialization, and a
second matching clone path as a fail-closed ambiguity. A PASS job without this attestation must remain
infrastructure-inconclusive.

- [ ] **Step 7: Register a dedicated `nixmac-e2e` Cilicon pool**

Do not share the `nixmac-mac` build label. Verify a clean one-job VM cycle and
runner deregistration. Configure the lifecycle attestor and confirm the
quarantine sentinel prevents the pool wrapper from starting another cycle.

- [ ] **Step 8: Run workflow dispatch in private mode**

Expected:

- exact-SHA app artifact;
- on-Mac CuaDriver suite;
- valid immutable evidence artifact;
- verified safe-frame reel;
- no public Check or Buzz message;
- VM destroyed/deregistered with a downloaded, verified lifecycle artifact.

- [ ] **Step 9: Commit**

```bash
git add ops/images/nixmac-e2e-runner-tahoe.pkr.hcl \
  ops/runner/cilicon-e2e-cycle-wrapper.sh \
  ops/runner/cilicon-e2e-lifecycle-attestor.sh \
  ops/runner/com.darkmatter.nixmac-e2e-cycle.plist \
  .github/workflows/cilicon-lifecycle-attestation.yml \
  .github/workflows/macos-ci-image.yaml \
  tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs \
  tests/e2e/computer-use/OPERATIONS.md
git commit -m "ci(e2e): add dedicated Tart runner image"
```

### Task 13: Shadow Rollout And Promotion

**Files:**
- Modify: `tests/e2e/computer-use/OPERATIONS.md`
- Create: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/observability.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`
- Modify: `/tmp/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

- [ ] **Step 1: Deploy with automatic publication disabled**

Set separate flags:

```text
CENTAUR_NIXMAC_E2E_ENABLED=1
CENTAUR_NIXMAC_E2E_PUBLISH_CHECKS=0
CENTAUR_NIXMAC_E2E_PUBLISH_BUZZ=0
```

- [ ] **Step 2: Add production observability**

Keep the 15-minute poll as the complete correctness path for v1. A merged-PR
webhook is a later latency optimization, not a production prerequisite; do not
add one until Centaur exposes a typed, signature-validated inbound trigger.

Implement a tested event schema in `observability.py` and emit
queue/build-wait/provision/run/upload/verify/attestation/publication timings,
reconciler heartbeats, oldest-job age, and classified failure counts through
`ctx.log`. Configure the production deployment's alert sink for:

- no successful reconciler for 30 minutes;
- oldest queued or build-waiting job over 30 minutes;
- repeated TCC/image failures;
- missing evidence/report;
- cleanup, destruction, or attestation failure;
- terminal job missing a configured publication.

Record the deployed alert rule IDs and one synthetic-fire proof in the
workflow README. If Centaur has no supported alert sink at deployment time,
hold publication/promotion; do not substitute Buzz heartbeat noise.

- [ ] **Step 3: Run ten consecutive merged-SHA shadow jobs**

Require:

- zero missed merges;
- zero duplicate jobs/publications;
- zero identity/digest mismatches;
- zero unclassified failures;
- every result links to a verified artifact;
- every ephemeral attempt has destruction/deregistration attestation;
- product failures remain product failures after confirmation.

- [ ] **Step 4: Enable the GitHub Check**

Keep it non-required. Observe at least 50 jobs or 30 days.

- [ ] **Step 5: Enable one terminal Buzz result**

Post only PASS/FAIL/INCONCLUSIVE with counts and the verified report URL.

- [ ] **Step 6: Make Tart/Cilicon primary and MacinCloud DR-only**

Retain the current workflow as manual rollback. Do not delete it during
qualification.

- [ ] **Step 7: Run final verification**

nixmac:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/evidence-manifest-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/run-cua-driver.mjs self-test
node tests/e2e/computer-use/preservation-harness.mjs run
node tests/e2e/computer-use/run-adversarial.mjs
node tests/e2e/computer-use/workflow-contract-self-test.mjs
node tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs
node tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs
actionlint .github/workflows/computer-use-e2e-centaur.yml
actionlint .github/workflows/cilicon-lifecycle-attestation.yml
```

Centaur overlay:

```bash
python -m unittest \
  workflows.tests.test_github_e2e_tool \
  workflows.tests.test_buzz_e2e_result_tool \
  workflows.tests.test_nixmac_e2e_merged_prs -v
```

Expected: all PASS.

- [ ] **Step 8: Produce the final readiness ledger**

For every design requirement, record:

- implementation file/line;
- automated test;
- live evidence run/artifact ID;
- current status;
- remaining blocker, if any.

No requirement is marked production-ready from code review alone.
