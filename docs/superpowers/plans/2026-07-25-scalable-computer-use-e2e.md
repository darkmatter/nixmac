# Scalable Computer Use E2E Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:dm-subagent-driven-development (if subagents available) or superpowers:dm-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Buzz-mediated, single-Mac CuaDriver request with a quiet,
durable Centaur workflow that dispatches an exact-SHA GitHub Actions run onto
a horizontally scalable macOS E2E pool and publishes only a verified terminal
result.

**Architecture:** The nixmac repository remains the source of test truth: it
gains a real driver seam, a CuaDriver adapter, an on-Mac runner, and a
signed-by-digest evidence manifest. Centaur first detects/reconciles merged PRs
in post-merge shadow/advisory mode, dispatches and watches a dedicated GitHub
Actions workflow, downloads and verifies the immutable Actions artifact,
applies retry policy, and publishes one terminal GitHub Check and Buzz message.
GitHub/Cilicon owns ephemeral Tart VM scheduling; the current MacinCloud lane
remains the single-concurrency transition/DR backend until the PR #604-derived
E2E image and pool qualify. A required merge-queue gate is a separate
promotion after the ephemeral pool, evidence retention, and candidate-code
isolation are qualified; the initial production release never claims to block
merges.

**Tech Stack:** Node.js ESM, CuaDriver CLI/MCP daemon, GitHub Actions and API, Python 3.11 Centaur workflows/tools, Tart/Cilicon, `unittest`, existing nixmac preservation/adversarial harnesses, `jq`, `ffmpeg`.

______________________________________________________________________

## Repositories And Worktrees

- nixmac worktree:
  `/Users/farhankhalaf/Code/nixmac-e2e-production`
- nixmac branch:
  `codex/e2e-production-foundation`
- nixmac base:
  `origin/main` at `2e0a987b800e45d7444057e1ad54d1d570b8ac41`
- Centaur overlay worktree:
  `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production`
- Centaur overlay branch:
  `codex/nixmac-e2e-production-foundation`
- Centaur overlay base:
  `origin/main` at `b10ff0cf551a757d43cd0c319f7bf5e4dfd6e61f`
- lifecycle-attestation sink worktree, provisioned before Task 12:
  `/Users/farhankhalaf/Code/nixmac-e2e-attestations`
- lifecycle-attestation sink repository:
  `darkmatter/nixmac-e2e-attestations`

Before Task 8, move the existing overlay worktree out of `/tmp` with
`git worktree move` and verify the parent repository registration. Do not
leave a multi-week implementation or unpushed commits in a volatile temp path.

Do not add the unrelated `.beads/.gitignore` change present in the nixmac
worktree to any commit.

## Current Execution Baseline

This plan remains the complete target, but execution is already in progress.
Do not repeat completed steps literally:

- Task 1 runtime-driver contract is complete through `468073685`.
- Task 2 Codex transport wrapper is complete through `80ffde2a2`.
- The inherited report-inspection baseline is repaired at `3cd27b39f`.
- Coverage ownership/freshness is fail-closed through `2816f9403`.
- The shared MacinCloud concurrency contract is structural, adversarially
  tested across all three legacy workflows, and automatically gated on
  `pull_request` and `merge_group` through `b90a8c8bb`.
- Task 3, the driver-neutral `scenario-driver.mjs` extraction, is complete at
  `660e6be47`, with state/action binding hardening at `14f706c5a` and explicit
  authority-failure mutation coverage at `b1895b446`.
- Task 4, the pinned CuaDriver CLI/app-bundle adapter, is the next planned
  feature slice.

The task bodies below remain the implementation and acceptance record.
Completed tasks are retained for traceability; their commits and fresh test
evidence, not unchecked historical TDD prose, are authoritative.

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
- `.github/workflows/computer-use-e2e-merge-gate.yml` — later
  default-branch-owned `merge_group` entrypoint; absent from the initial
  post-merge rollout and enabled only after Task 13 promotion.
- `darkmatter/nixmac-e2e-attestations/.github/workflows/cilicon-lifecycle-attestation.yml`
  — protected, secret-free sink workflow that accepts a host-authenticated
  post-destruction event and preserves a queryable attestation artifact
  outside the nixmac repository.
- `tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs` — static
  workflow safety and artifact-binding assertions.
- `tests/e2e/computer-use/merge-gate-contract-self-test.mjs` — proves the later
  required check is merge-group-SHA bound, ephemeral-only, and fail-closed.
- `ops/runner/macincloud-host-lease.sh` — atomic owner-token lease shared by
  every legacy and Centaur job that drives the transition/DR MacinCloud host.
- `tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs` — proves
  lease ordering, owner-only release, stale-owner quarantine, and automatic
  wiring across all four Mac-driving jobs.
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

- [x] **Step 1: Write failing runtime-contract tests**

Test these exact requirements:

```js
const requiredMethods = ["connect", "prepareTarget", "visibleState", "click", "setValue", "close"];

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

- [x] **Step 2: Run the test and verify it fails**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-contract.mjs`.

- [x] **Step 3: Implement the normalized contract**

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
  const missing = runtimeDriverMethods.filter((method) => typeof driver?.[method] !== "function");
  if (missing.length) throw new TypeError(`Runtime driver missing: ${missing.join(", ")}`);
  return driver;
}
```

`prepareTarget({ appBundleId, appPath })` is a no-op assertion for the existing
Codex transport because its workflow already launched the app. The CuaDriver
transport launches the staged exact-SHA app and returns its pid/window target.

- [x] **Step 4: Add `cua-element-index` validation**

Require integer `elementIndex`, integer `pid`, integer `windowId`, and non-empty
`snapshotId`. Keep existing built-in address kinds unchanged; register the new
kind through the existing explicit adapter extension hook.

- [x] **Step 5: Run contract and existing runner self-tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: both PASS.

- [x] **Step 6: Commit**

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

- [x] **Step 1: Write a failing adapter test**

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

- [x] **Step 2: Verify the test fails**

Expected: `CodexAppServerDriver is not defined`.

- [x] **Step 3: Implement the wrapper**

`CodexAppServerDriver` must:

- own an `AppServerClient`;

- implement `prepareTarget` as a no-op assertion that an app bundle ID exists;

- map `visibleState` to `get_app_state`;

- map `click` to `click`;

- map `setValue` to `set_value`;

- normalize all responses through `runtime-contract.mjs`;

- expose `codexAppServerDriverDescriptor`;

- preserve the current initialize/thread policy exactly.

- [x] **Step 4: Run tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: PASS with the same JSON-RPC order assertions as before.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Write failing helper tests**

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
  async visibleState() {
    return this.states.shift();
  },
  async click(input) {
    this.clicks.push(input);
    return { ok: true, text: "clicked", isError: false };
  },
};
```

- [x] **Step 2: Verify the new test fails**

Expected: missing `scenario-driver.mjs`.

- [x] **Step 3: Move the helpers without behavior changes**

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

- [x] **Step 4: Inject the Codex driver**

Replace:

```js
const client = new AppServerClient(options.ws);
```

with:

```js
const driver = validateRuntimeDriver(new CodexAppServerDriver(options.ws));
```

Pass `driver` through all extracted helpers and browser-report inspection.

- [x] **Step 5: Verify no raw `client.tool` calls remain in scenario code**

Run:

```bash
rg -n 'client\.tool|new AppServerClient' \
  tests/e2e/computer-use/run-remote-cua.mjs \
  tests/e2e/computer-use/scenario-driver.mjs
```

Expected: no matches.

- [x] **Step 6: Run preservation gates**

Run:

```bash
node tests/e2e/computer-use/run-remote-cua.mjs self-test
node tests/e2e/computer-use/preservation-harness.mjs run
node tests/e2e/computer-use/run-adversarial.mjs
```

Expected: all PASS; preservation signatures unchanged.

- [x] **Step 7: Commit**

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

- Create: `tests/e2e/computer-use/fixtures/cua-driver/click-success.json`

- Create: `tests/e2e/computer-use/fixtures/cua-driver/set-value-success.txt`

- Create: `tests/e2e/computer-use/fixtures/cua-driver/action-success.json`

- Create: `tests/e2e/computer-use/fixtures/cua-driver/action-error.json`

- Create: `tests/e2e/computer-use/fixtures/cua-driver/metadata.json`

- Modify: `tests/e2e/computer-use/drivers/driver-self-test.mjs`

- [x] **Step 1: Create provenance-labeled, source-grounded response fixtures**

Use the pinned CuaDriver 0.12.6 `call <tool> <json> --socket <socket>` surface.
That release does not support `--raw`, `--compact`, or `--no-daemon`: the CLI
prints `structuredContent` JSON directly when present and otherwise prints
successful text content; it exits nonzero with stderr on daemon/tool failure.
Use distinct source-derived direct-click JSON and direct-`set_value` plaintext
fixtures. Retain the sanitized historical raw MCP envelope separately for
compatibility and do not relabel it as current CLI stdout. Replace pids, window
IDs, paths, titles, and any user text with stable fixture values. Do not include
the remote host, usernames, keys, or secrets, and do not claim a live capture
when a fixture was derived from pinned source.
Record the exact CLI version, `CuaDriver.app` bundle version/digest, supported
daemon launch mode, research date, and per-fixture provenance in sanitized
fixture metadata. The adapter and image qualification must use the same pinned
release and launch mode. Pin the CLI itself by byte SHA-256, full codesign
digest, Developer ID, and Team ID; resolving a command name or symlink is not
an identity proof.

- [x] **Step 2: Write failing adapter tests**

Cover:

- CLI argv uses no shell;

- daemon socket is run-specific;

- the daemon is launched through the installed `CuaDriver.app` responsibility
  chain, never by directly spawning raw `cua-driver serve`;

- `prepareTarget` launches the staged app through `launch_app`;

- returned bundle ID resolves to the expected running pid;

- on-screen window selection is deterministic;

- `get_window_state` text and image normalize correctly;

- the snapshot ID changes after each visible-state call;

- stale element addresses are rejected before a click;

- click/set-value map to CuaDriver integer element indices;

- direct `click` requires exact structured success evidence and explicitly
  soft-fails `effect:"suspected_noop"`;

- direct plaintext is accepted only for pinned macOS `set_value`, only for
  source-derived success families containing the requested integer element
  index;

- `isError: true`, empty objects, unknown envelopes, and semantic soft errors
  map to failure;

- every pinned direct response rejects unknown keys at both the top level and
  every nested source/app/window/bounds/element object;

- stdout/stderr overflow, nonzero exit/stderr, and timeout whole-process-group
  SIGTERM-to-SIGKILL escalation are deterministic, including a descendant
  that holds inherited pipes after the leader stops producing events;

- OS-derived Unix-socket ownership rejects missing, ambiguous, or mismatched
  daemon peers before `check_permissions`, even when that RPC's `source`
  self-attests correctly;

- launch produces exactly one new daemon process instance, persists its PID,
  high-resolution birth time, and executable before post-launch verification,
  binds its `NSRunningApplication` executable/launch date, validates that
  provisional instance before any status probe, reconciles the snapshots even
  when `open` errors after launch acceptance, and brackets every RPC by that
  same instance and socket device/inode;

- delayed target readiness, post-launch failure cleanup, same-app PID reuse
  refusal, atomic application-instance swap refusal, post-termination exit
  confirmation, pre-stop daemon peer replacement refusal, post-stop
  PID-plus-listener-plus-socket confirmation, and target/daemon cleanup retries;

- streamed deterministic bundle hashing rejects a symlink/non-directory root,
  child symlinks, excess file counts, excess per-file or total bytes, and
  oversized sparse files; traversal and reads are descriptor-relative with
  `O_NOFOLLOW`, and every reopened directory component must retain its
  device/inode across rename/replacement probes; the bounded helper preserves
  the existing digest contract, while full bundle attestation is cached per
  exact process for normal UI polls and refreshed at teardown and failure
  diagnosis;

- inline screenshot MIME/base64 validation, encoded and decoded limits,
  same-UID filesystem-substitution rejection, header-only PNG, corrupt IDAT,
  bytes after the zlib end marker, forbidden text/profile metadata chunks, and
  valid PNG;

- close calls `stop --socket` only after re-resolving the exact signed daemon
  PID and executable the adapter started, clears ownership only after both that
  process and listener are gone, and retains each failed owned-resource cleanup
  independently for retry.

- [x] **Step 3: Implement a process runner**

Use `spawn` with argv arrays:

```js
async function runCua(binary, args, { timeoutMs = 90_000 } = {}) {
  // No shell. Collect bounded output in a dedicated POSIX process group.
  // Close pipes, terminate the group, and reject by timeout plus kill grace.
}
```

Parse direct structured JSON against the invoked tool's pinned schema. Pinned
macOS 0.12.6 `set_value` is the only plaintext exception: accept only the
source-defined successful text families bound to the requested
`element_index`. `click` always requires its exact structured success schema.
For compatibility with sanitized historical captures only, a bounded parser
may also unwrap an exact raw MCP result object shaped as:

```js
{
  content: [{ type: "text", text: "..." }, { type: "image", data: "..." }],
  structuredContent: {},
  isError: false,
}
```

Reject unknown or extended envelope/content keys, `isError: true`,
missing/non-object `structuredContent`, trailing non-JSON output, empty
objects, semantic soft errors, or direct JSON that is not the expected
tool-specific object. Validate the historical envelope's structured payload
against its own exact compatibility schema rather than the current direct
stdout schema. The process exit code/stderr remains the authority for current
0.12.6 CLI tool failures.

- [x] **Step 4: Implement connection and targeting**

`connect()` must:

1. resolve the configured CLI once to a canonical absolute regular executable,
   verify its byte SHA-256, full codesign digest, Developer ID, Team ID, and
   exact `--version` output against fixture metadata, then use only that path;
1. read and verify the installed `CuaDriver.app` bundle identity;
1. reject attach mode: pinned 0.12.6 accepts unauthenticated line-delimited
   JSON on each fresh Unix-stream connection and exposes no peer credential or
   authentication mechanism;
1. require the owned socket path to be absent and no longer than 103 UTF-8
   bytes, then snapshot process instances for the verified daemon executable;
1. start the standalone app-owned daemon with exact argv
   `open -n -g <verified-app-path> --args serve --socket <run-socket>`;
1. regardless of whether `open` succeeds or errors, reconcile the pre-launch
   snapshot with a post-call snapshot; retain one unique candidate, but
   aggregate launch and cleanup uncertainty for zero or multiple candidates;
1. require exactly one new signed daemon PID/birth-time/executable instance
   before polling `status --socket <run-socket>`;
1. bind that instance to one `NSRunningApplication` executable and
   microsecond launch date while bracketing the lookup with `libproc`;
1. canonicalize the Unix socket and run
   `/usr/sbin/lsof -nP -Fpcn -a -U <socket>`;
1. require exactly one `cua-driver` PID holding the exact canonical socket,
   resolve that PID's high-resolution process birth time and executable
   through `/usr/bin/python3` plus macOS `libproc`, and require it to match the
   provisional instance;
1. bind that process instance plus socket device/inode, then reverify the
   enclosing bundle identity, digest, and Developer ID signature;
1. call `check_permissions`;
1. fail unless Accessibility and Screen Recording are granted;
1. treat `check_permissions.source` only as corroboration, requiring its
   canonical executable to match the OS-derived socket owner.

Directly spawning raw `cua-driver serve` outside `CuaDriver.app` is prohibited:
upstream documents that mode as unsupported for stable macOS TCC attribution.
The static and ephemeral images grant Accessibility and Screen Recording to
the pinned `CuaDriver.app` bundle identity. Until upstream supplies an
authenticated transport, the adapter supports owned-only fallback. Before and
after every `call` RPC it re-proves the exact socket device/inode, listener
PID/birth-time/executable against the full bundle attestation cached for that
exact process; output from an in-flight rebind is discarded. Full hashing and
codesign verification recur at clean teardown and any operation/continuity
failure. `close()` may stop only the exact daemon process instance this adapter
started. Provisional cleanup uses a single JXA lookup that verifies executable
and launch date and calls `terminate` on that same `NSRunningApplication`
object; it never falls back to PID-only signaling. A missing listener while
that instance remains alive or any replacement listener/socket fails closed
without deleting or stopping the replacement. A zero-exit `stop` is not
cleanup proof: bounded polling must show no listener, the exact process absent
or reused, and the socket path absent.
The adapter never unlinks a residual socket path because `lstat` plus `unlink`
cannot atomically exclude a same-UID replacement. A stale path remains an
owned cleanup failure for Task 6 controller quarantine or ephemeral-host
disposal. Startup and cleanup failures are aggregated.

`prepareTarget({ appBundleId, appPath })` must:

1. prove `appPath` exists and its bundle ID equals `appBundleId`;
1. prove the workflow placed the exact staged bundle at the run-specific
   canonical app path and no other process for that bundle ID is running;
1. resolve the staged bundle's exact main executable and snapshot its
   high-resolution process instances before launch;
1. call `launch_app` with the bundle ID;
1. after success or RPC error, poll the same executable and require exactly one
   new PID/birth-time/executable instance;
1. persist that provisional instance before parsing or trusting the response,
   canonicalizing the returned executable, or reverifying the bundle;
1. reject a returned pid of zero, a mismatched bundle ID, or a response PID
   different from the provisionally captured instance;
1. require the captured executable's canonical path to equal the pre-launch
   executable inside `appPath/Contents/MacOS/`;
1. recompute the running bundle digest and require it to equal the preflight
   digest;
1. poll `list_apps` and `list_windows` under a bounded readiness deadline;
1. select one on-screen current-Space layer-0 window deterministically:
   prefer explicit `on_current_space=true`, reject explicit false, and for
   pinned macOS 0.12.6 only accept null as an `is_on_screen=true` fallback
   because upstream emits null for every window; record which proof path was
   used and break ties by frontmost `z_index`, then stable window ID;
1. retain pid/birth-time/executable/window/app-path identity and re-prove the
   process instance before and after every visible-state, click, and set-value
   RPC, discarding output if it changed in flight;
1. on later preparation failure or close, refresh the full bundle attestation,
   compare the current PID/birth-time/executable with the provisionally owned
   instance, then atomically verify executable plus launch date and invoke
   `forceTerminate` on that same `NSRunningApplication` object; poll until the
   exact instance is absent or reused, never signal a replacement, and never
   clear ownership on termination-request success alone.

- [x] **Step 5: Implement normalized UI methods**

`visibleState()` calls:

```text
call get_window_state
{"pid":<pid>,"window_id":<windowId>}
--socket <runSocket>
```

It accepts only `screenshot_mime_type:"image/png"` plus canonical inline
`screenshot_png_b64`, rejects any filesystem screenshot handoff, and returns
text, normalized base64 PNG bytes, and:

```js
{ pid, windowId, snapshotId: `${pid}:${windowId}:${turnId}` }
```

The subprocess stdout cap is the maximum canonical base64 size plus 1 MiB of
JSON overhead. The adapter enforces both encoded and decoded image limits and
requires a complete qualified non-interlaced 8-bit RGB/RGBA PNG: valid chunk
bounds/order and CRC, sane IHDR, a hard decoded-byte ceiling before IDAT
inflation, complete consumption of the concatenated IDAT zlib stream, the
expected scanline length, IEND, and no bytes after IEND. It also rejects
`tEXt`, `zTXt`, `iTXt`, and `iCCP` so screenshot evidence is pixel-only.

`click()` and `setValue()` reject addresses whose target differs from the most
recent snapshot and then invoke `click` or `set_value`.

- [x] **Step 6: Run tests**

Run:

```bash
node tests/e2e/computer-use/drivers/driver-self-test.mjs
node tests/e2e/computer-use/run-remote-cua.mjs self-test
```

Expected: PASS without a remote Mac.

- [x] **Step 7: Commit**

```bash
git add tests/e2e/computer-use/drivers/cua-driver.mjs \
  tests/e2e/computer-use/drivers/driver-self-test.mjs \
  tests/e2e/computer-use/fixtures/cua-driver
git commit -m "fix(e2e): close CuaDriver ownership races"
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
export async function runSuiteWithDriver(args, { createDriver, executionTopology } = {}) {}
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

`binary` is the pinned CLI executable, `socketPath` is an owned daemon socket,
and `appBundleId` is the default target bundle. Screenshots remain inline and
never use `runDir` scratch paths. When `socketPath` is omitted, the owned socket
remains under the short `socketDirectory`/system-temp path, respecting the
103-byte macOS Unix-socket path limit. `attachSocket` is rejected until the
upstream transport can authenticate its peer. The constructor rejects unknown
and conflicting options instead of silently ignoring entrypoint configuration.

- [ ] **Step 3: Make topology-specific steps explicit**

For local CuaDriver:

- skip SSH baseline/report-copy helpers;

- require `NIXMAC_E2E_DISPOSABLE_CONFIG=true`;

- require `NIXMAC_E2E_APP_ARTIFACT_SHA`;

- require `NIXMAC_E2E_APP_PATH`, verify its bundle ID/digest, and call
  `driver.prepareTarget(...)` before the first visible-state capture;

- fail closed if any pre-existing process has the same bundle ID; never kill a
  process not launched by the current attempt;

- stage the tested bundle at a run-specific canonical path, record the launched
  pid, verify that pid's executable path remains under the exact bundle, and
  permit cleanup to terminate only that recorded pid;

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
runner/host-lease.json   # required for static_ssh
attempt.json
```

`runner/cleanup.json` contains attempted/restored/clean booleans, owned paths,
remaining processes, and a failure reason. Never mark cleanup clean by default.
For `static_ssh`, `runner/host-lease.json` records a hash of the owner token,
acquired/released booleans, acquisition/release timestamps, the last heartbeat,
and any wait/quarantine reason. It must prove owner-matched release before a
static artifact can pass.

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
  performs remote staging/config/process cleanup, releases the host lease only
  on an owner-token match, writes the only final `runner/cleanup.json` and
  `runner/host-lease.json` into the local evidence tree, then runs the trusted
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

- Create: `ops/runner/macincloud-host-lease.sh`

- Create: `tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs`

- Modify: `.github/workflows/computer-use-e2e.yml`

- Modify: `.github/workflows/peekaboo-e2e.yml`

- Modify: `.github/workflows/e2e.yml`

- Modify: `.github/workflows/build.yaml`

- Modify: `tests/e2e/computer-use/workflow-contract-self-test.mjs`

- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- [x] **Step 1: Repair and freeze the inherited workflow contract**

The inherited lock assertion was repaired, replaced with structural YAML
parsing, expanded across the three current Mac-driving workflows, and wired
into the existing automatic PR/merge-group validation job. The baseline is
complete through `b90a8c8bb`.

Retain that shared GitHub group across the three legacy workflows as defense in
depth. The new `static_ssh` job does not join it because GitHub keeps at most
one pending group member and may replace older pending work. Cross-lane safety
is added in this task through a separate atomic MacinCloud host lease honored
by all four Mac-driving jobs and automatically contract-tested on PRs and
merge-group candidates.

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

- primary and static backend jobs have mutually exclusive explicit `if:`
  predicates derived only from the validated `backend` choice, so a skipped
  backend cannot acquire runner capacity or a concurrency group;

- primary job uses `[self-hosted, macOS, nixmac-e2e]`;

- static fallback has a distinct Linux controller job on the dedicated
  one-capacity `nixmac-e2e-static-controller` runner queue and has no GitHub
  concurrency group;

- the three legacy Mac-driving jobs and the new static job invoke the same
  host-lease helper before any Mac-side inventory, process, or UI action;

- lease acquisition/release is owner-token checked, live foreign owners wait,
  and stale/ambiguous owners quarantine rather than auto-steal;

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
hard-limited to one runner. GitHub therefore queues Centaur static bursts
without the one-pending replacement semantics of a concurrency group.
Centaur's ledger remains the delivery source of truth. Before enabling the
static backend, provision the one-capacity queue and have the scoped
`github_e2e.assert_static_controller_pool(...)` pre-dispatch check verify
exactly one online runner with the label; the workflow's default
`GITHUB_TOKEN` is not used for Administration-read inventory. A second online
runner is a fail-closed readiness error.

The one-capacity static queue is a transition/DR lane, not the scale target.
Centaur keeps jobs in its own durable queue until the controller is expected
to start them within GitHub's 24-hour self-hosted-runner queue limit; it does
not churn expired GitHub runs. Record arrival rate, p50/p95 end-to-end cycle
time, queue age, and backend utilization from the first shadow job. Before
making Cilicon primary, size capacity to:

```text
dedicated_hosts >= max(
  2,
  ceil(peak_jobs_per_hour * p95_cycle_minutes / 60 * 1.5) + 1
)
```

The `1.5` factor absorbs bursts and the `+1` is host-failure headroom. Promotion
still requires p95 start latency under 15 minutes with one host quarantined.

After the lease-enabled workflow definitions merge, query all three legacy
workflows and drain every run started from a pre-lease workflow revision before
the first Centaur `static_ssh` dispatch. Record the drained run IDs and lease
revision in the readiness ledger; enabling static traffic while any pre-lease
run is queued or active is prohibited.

- [ ] **Step 5: Bind the trusted harness and tested app separately**

- checkout the default-branch harness revision that contains the workflow;

- download exactly `inputs.app_artifact_id` from `inputs.build_run_id`;

- verify its GitHub metadata source SHA equals `inputs.merge_sha`;

- verify the archive digest equals `inputs.app_artifact_digest`;

- never execute code obtained from the tested app artifact or a tested-SHA
  checkout; the trusted default-branch harness may include the already-reviewed
  merge by design;

- compute the extracted app-bundle digest;

- write and assert every Task 6 preflight identity sidecar before UI work.

- [ ] **Step 6: Implement both backend jobs**

`cilicon_tart` runs `run-cua-driver.mjs` directly on
`[self-hosted, macOS, nixmac-e2e]`.

`static_ssh` runs on the dedicated one-capacity Linux controller queue and
reuses the current workflow's strict known-hosts/key handling to:

1. acquire the atomic MacinCloud host lease before any Mac-side inventory,
   process, or UI action, using an owner token bound to repository, workflow
   run, logical job, attempt, and nonce;
1. write a bounded heartbeat while the lease is held; wait on a live foreign
   owner, return `LEASE_BUSY` on bounded-wait expiry, and quarantine on stale,
   ambiguous, or unverifiable ownership rather than stealing it;
1. inventory owned processes/paths before the run and fail closed if a
   pre-existing nixmac process exists;
1. stage the exact app archive and harness into unique run roots;
1. invoke the on-Mac CuaDriver runner through SSH;
1. copy evidence back;
1. restore/remove only attempt-owned state in `if: always()`;
1. compare after inventory;
1. release the lease only after cleanup and only when the owner token matches;
1. write the controller-owned final `runner/cleanup.json` and
   `runner/host-lease.json` into the copied
   evidence tree;
1. create and verify the final manifest on the controller after cleanup and
   lease release;
1. package the now-immutable tree without further mutation;
1. create a quarantine marker, set durable Centaur backend quarantine, and
   fail infrastructure readiness if cleanup or lease ownership is not clean;
   provider reimage or loss of the host marker never clears Centaur state.

Document and test the recovery path in `OPERATIONS.md`.
`macincloud-host-lease.sh recover` requires the exact observed lease digest and
an operator reason, refuses recovery while any nixmac process or owning GitHub
run is active, snapshots the old lease/quarantine metadata into an audit log,
then clears only the validated lease directory and quarantine marker. A
separate audited Centaur step clears durable backend quarantine only after the
host recovery proof is attached. Recovery is never automatic and never a
generic recursive delete.

- [ ] **Step 7: Upload canonical evidence**

Artifact name:

```text
nixmac-computer-use-e2e-<job-id>-attempt-<attempt>
```

Set an explicit retention period and surface artifact ID/digest in job outputs
where GitHub exposes them.

Use `retention-days: 90` for the initial post-merge service and record
`evidence_expires_at` in the Check, Buzz result, and Centaur ledger. The
Actions artifact is canonical only inside that declared window. Before a
required merge gate is enabled, promote each independently verified zip to
versioned immutable object storage with at least 365 days of retention, record
its URI/version/digest in Centaur, and verify a restore path. A stale Check must
say that evidence expired; the mutable gh-pages copy never silently becomes
canonical.

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
node tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs
node tests/e2e/computer-use/workflow-contract-self-test.mjs
actionlint .github/workflows/computer-use-e2e-centaur.yml
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add .github/workflows/computer-use-e2e-centaur.yml \
  .github/workflows/computer-use-e2e.yml \
  .github/workflows/peekaboo-e2e.yml \
  .github/workflows/e2e.yml \
  .github/workflows/build.yaml \
  ops/runner/macincloud-host-lease.sh \
  tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs \
  tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs \
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

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/client.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/cli.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/__init__.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/evidence.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/fixtures/*`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/github_e2e/pyproject.toml`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_github_e2e_tool.py`

- [ ] **Step 1: Write failing client tests with a fake HTTP transport**

Test:

- allow only `darkmatter/nixmac`;

- allow only `.github/workflows/computer-use-e2e-centaur.yml`;

- validate full lowercase SHA and bounded job ID;

- list all successful `Build macOS App` runs for the exact SHA and select the
  latest deterministically by `created_at`, then run ID;

- within that selected run require one exact app artifact, returning run ID,
  artifact ID, and non-null artifact digest;

- classify a missing/null artifact digest as fail-closed infrastructure
  failure rather than dispatching an empty digest;

- dispatch with an explicit `ref=main`;

- make dispatch replay-safe: search through a bounded visibility window for an
  existing run with the exact job ID, attempt, and nonce before dispatch;

- after dispatch, resolve every exact match, choose the earliest `created_at`
  run as canonical, and cancel later duplicates;

- inspect run/jobs without trusting workflow conclusion as test verdict;

- list one exact artifact name and reject zero/multiple matches;

- assert the dedicated static controller pool has exactly one online runner
  with the allowlisted label before a `static_ssh` dispatch;

- create/update one Check Run with the job ID as `external_id`;

- download and independently verify the immutable evidence zip;

- follow only the validated GitHub artifact redirect, drop the API
  `Authorization` header on the redirected request, refresh an expired
  one-minute URL once, and reject off-allowlist hosts or redirect chains;

- never expose injected authorization headers.

- [ ] **Step 2: Implement the client**

Public methods:

```python
list_merged_prs(...)
ensure_workflow_run(...)
find_exact_sha_app_artifact(...)
find_workflow_run(...)
get_workflow_run(...)
list_jobs(...)
assert_static_controller_pool(...)
cancel_workflow_run(...)
get_artifact(...)
download_artifact(...)
create_or_update_check(...)
runner_deregistered(...)
find_lifecycle_attestation(...)
verify_evidence_archive(...)
```

All requests use `api.github.com`, API version `2022-11-28`, bounded timeouts,
the injected scoped token, rate-limit-aware backoff, and typed/validated
dictionaries. Add an authenticated `list_merged_prs(...)` method so workflow
code never performs unauthenticated GitHub pagination itself.

- [ ] **Step 3: Implement the independent archive verifier**

`evidence.py`:

- rejects zip-slip paths, symlinks, duplicate entries, oversized files, and
  decompression bombs;

- parses `manifest.json`;

- enforces manifest version and identity schema;

- hashes every listed file;

- requires all identity sidecars and safe-frame video;

- when `runner.backend == "static_ssh"`, requires
  `runner/host-lease.json` and verifies acquisition, owner-token hash
  consistency, heartbeat metadata, owner-matched release, and no quarantine
  disposition;

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

The Actions artifact endpoint returns a short-lived `302` download URL on a
GitHub-controlled artifact/blob domain. The HTTP client must follow exactly
one validated HTTPS redirect, strip `Authorization` before leaving
`api.github.com`, enforce the documented GitHub Actions artifact-host suffixes,
and reject every other redirect. Extend the Centaur capability declaration
with the provider-supported form of those artifact hosts. If the platform
cannot safely express that allowlist, route the download through a scoped
server-side GitHub integration instead; do not weaken global egress policy.
An integration test against a real private artifact must prove redirect,
header stripping, one-minute URL refresh, and retry behavior before Task 10.

The deployed credential needs Actions read/write, Checks write, Contents read,
Pull requests read, and repository Administration read on
`darkmatter/nixmac`. Administration is read-only and is required solely to
verify the dedicated self-hosted runner inventory and deregistration; no
runner mutation is allowed by the tool.

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

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

- [ ] **Step 1: Write failing reconciliation tests**

Cover:

- schedule is every 15 minutes;

- authenticated pagination reads every merged PR in the 30-day repair window;

- the workflow reaches GitHub only through the narrow `github_e2e` tool;

- rate-limit exhaustion and repeated 403/429 responses back off, surface a
  classified infrastructure alert, and do not advance delivery state;

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

Call the authenticated `github_e2e.list_merged_prs(...)` method. Paginate and
return every valid candidate in the bounded repair window, oldest-first, then
exclude merges before `suite_activated_at`. Remove the candidate slice
entirely. Do not let already-created children consume or hide any candidate,
and do not retain the coordinator's current unauthenticated direct fetch.

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
Record GitHub rate-limit headers in structured, secret-free logs and use
bounded exponential backoff with jitter; a rate-limit failure never advances a
cursor or marks a candidate delivered.

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

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`

- [ ] **Step 1: Write failing lifecycle tests**

Script fake contexts for:

- no exact-SHA build artifact yet (`WAITING_ARTIFACT`, no E2E dispatch);

- exact-SHA build artifact becomes ready;

- multiple queued `static_ssh` jobs all remain represented in the durable
  ledger while the one-capacity controller queue serializes execution;

- a live foreign MacinCloud lease waits without consuming attempt or retry;

- bounded wait expiry with a still-live foreign owner returns `LEASE_BUSY`,
  records the completed dispatch as scheduling-only, increments the physical
  dispatch number, mints a fresh nonce, leaves the logical job `QUEUED`, and
  re-dispatches with backoff without consuming runtime retry;

- `LEASE_BUSY` re-dispatch never reattaches to the completed busy run because
  attempt/dispatch identity and nonce are both fresh;

- a stale, ambiguous, or owner-mismatched lease quarantines the static backend
  and produces infrastructure INCONCLUSIVE, never product failure;

- first E2E dispatch with build run/artifact identity;

- replay after GitHub accepted dispatch but before the Centaur checkpoint;

- delayed run visibility followed by deterministic duplicate cancellation;

- waiting on a queued Actions run;

- successful run with missing artifact;

- verified PASS artifact;

- product FAIL with one confirmation attempt;

- product FAIL followed by confirmation PASS remains terminal FAIL with
  `failure_class=FLAKY_PRODUCT`;

- product FAIL followed by confirmation FAIL remains terminal FAIL with
  `failure_class=CONFIRMED_PRODUCT_FAIL`;

- infrastructure failure with one fresh attempt;

- terminal INCONCLUSIVE after retry;

- GitHub-side cancellation after execution starts records attempt `ABORTED`
  and follows the infrastructure retry path;

- runner-lost cancellation records attempt `ABORTED`;

- explicit operator cancellation of the logical Centaur job records terminal
  `CANCELLED` with an audit reason and does not retry;

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
        "counts_against_retry": True,
        "attestation_nonce": "64-lowercase-hex-characters",
        "lifecycle_attestation": "destroyed",
    }],
}
```

Reserve terminal job state `CANCELLED` for an explicit operator action against
the logical Centaur job. GitHub-side cancellation, runner loss, and provider
cancellation are attempt-level `ABORTED` infrastructure outcomes; retry them
within policy and resolve exhaustion as `INCONCLUSIVE`, never `CANCELLED`. A
live foreign host lease is queue wait, not a runtime retry. If its bounded wait
expires, classify the physical dispatch `LEASE_BUSY`, set
`counts_against_retry=false`, allocate the next dispatch number and a fresh
nonce, and requeue oldest-first with backoff. It never reuses the completed
busy run's attempt/nonce identity or resolves the logical job terminally.
Queue-age alerts escalate prolonged contention. A stale or unverifiable lease
is fail-closed infrastructure quarantine and never permits Mac-side process or
UI work.

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
- initial product fail + confirmation pass -> FAIL with
  `failure_class=FLAKY_PRODUCT`; a nondeterministic product/UI contract is a
  product defect and retry never erases the first verified failure;
- initial product fail + confirmation fail -> FAIL with
  `failure_class=CONFIRMED_PRODUCT_FAIL`;
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

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/client.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/cli.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/__init__.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/tools/buzz_e2e_result/pyproject.toml`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_buzz_e2e_result_tool.py`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/buzz-result-workflow.yaml`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

- [ ] **Step 1: Write failing publication tests**

Require:

- one Check Run keyed by logical job ID;

- one Buzz message after terminal verification only;

- no start/retry/heartbeat messages;

- replay returns the stored publication;

- replay after the Buzz POST succeeds but before the Centaur checkpoint does
  not create a second message;

- two POSTs with the same logical `job_id` return the same stored webhook
  result;

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

The webhook keeps a durable idempotency record keyed by logical `job_id`.
After the first successful post, a replay validates the same immutable payload
and returns the stored result without posting again; a conflicting payload for
the same key fails closed. This webhook-side boundary closes the crash window
between a successful POST and Centaur step-checkpoint persistence.

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

- Create in the dedicated `darkmatter/nixmac-e2e-attestations` sink repository:
  `.github/workflows/cilicon-lifecycle-attestation.yml`

- Create: `tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs`

- Modify: `.github/workflows/macos-ci-image.yaml`

- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- [ ] **Step 1: Rebase this branch on the main commit containing PR #604**

Do not cherry-pick or edit PR #604. Resolve only small, explicit conflicts.

- [ ] **Step 2: Write image contract checks**

Verify:

- base image reference is immutable;

- CuaDriver artifact URL, checksum, CLI version, app-bundle version, bundle ID,
  code-signing identity, and supported standalone launch mode are pinned;

- no secrets enter Packer;

- dedicated test user exists;

- evidence root permissions are correct;

- ffmpeg is present;

- Accessibility and Screen Recording are granted to the pinned
  `CuaDriver.app` bundle identity, never to a raw CLI executable, and TCC
  checks fail closed;

- secret scan runs before push.

- [ ] **Step 3: Build the E2E layer**

Derive from the same base/image conventions as PR #604; do not duplicate the
full Xcode installation recipe.

- [ ] **Step 4: Qualify first boot and aged boot**

On a dedicated image builder:

1. boot a fresh clone;
1. verify logged-in Aqua session;
1. verify Accessibility and Screen Recording belong to the pinned
   `CuaDriver.app` identity;
1. launch the app-owned daemon and run CuaDriver smoke;
1. stop and age/reboot the image;
1. repeat permissions and smoke;
1. destroy the clone;
1. record image digest and proof.

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
1. creates a unique host-owned cycle directory and `directoryMount`;
1. snapshots Tart/Cilicon inventory, starts one Cilicon cycle with the pinned
   image/config, and resolves the one new clone path;
1. records the clone path, runner name, image digest, and cycle ID outside the
   guest;
1. supervises Cilicon until the GitHub job exits; and
1. invokes the attestor before permitting another cycle.

Before UI execution, the trusted workflow writes an
`attestation-request.json` containing those exact values into a host-only
Cilicon `directoryMount`. The host daemon atomically claims that request and
persists it outside the VM before teardown. The tested app cannot choose the
job ID, attempt, or nonce; they originate in the checkpointed Centaur attempt.

After the GitHub job exits the host attestor must:

1. wait for the ephemeral runner to deregister;
1. wait for the exact VM clone path to disappear;
1. verify no matching VM remains in the host inventory;
1. emit a nonce-bound JSON attestation with host ID, image digest, job ID,
   attempt number, runner name, nonce, destroyed timestamp, and result;
1. POST a scoped `repository_dispatch` event to the dedicated
   `darkmatter/nixmac-e2e-attestations` sink repository with a GitHub App
   installed only on that sink;
1. create `/var/db/nixmac-e2e-quarantined` and stop new E2E cycles if any check
   times out or fails.

The protected, secret-free sink workflow
`cilicon-lifecycle-attestation.yml` validates the allowlisted event shape and
writes an immutable artifact named
`nixmac-e2e-lifecycle-<job-id>-attempt-<attempt>`, and exposes a `run-name`
Centaur can resolve. The workflow preserves the nonce but does not decide
whether it is expected; Centaur compares it with the checkpointed attempt
record and consumes it once. The workflow never runs repository code from the
tested SHA. Centaur reads the sink repository with its control-plane
credential and treats the sink artifact as input to the same independent
nonce/job/attempt/image verification.

Provision two deliberately separate credentials before private qualification:

1. a sink-only GitHub App with Contents write on
   `darkmatter/nixmac-e2e-attestations`, used only to emit the lifecycle
   `repository_dispatch`; it has no installation or permission on
   `darkmatter/nixmac`;
1. an inventory-only GitHub App with repository Administration read on
   `darkmatter/nixmac`, used only to prove runner deregistration; it has no
   Contents, Actions, or Checks write permission.

GitHub cannot scope `repository_dispatch` more narrowly than Contents write,
so the plan never places that grant on an E2E host for `darkmatter/nixmac`.
The sink repository holds no secrets, has protected default branch/workflow
files, and contains no code that can mutate nixmac. Record both installation
IDs and injected secret names in `OPERATIONS.md`; never put keys in the guest
image or repository. If either app or permission split is unavailable, hold
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
  .github/workflows/macos-ci-image.yaml \
  tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs \
  tests/e2e/computer-use/OPERATIONS.md
git commit -m "ci(e2e): add dedicated Tart runner image"

git -C /Users/farhankhalaf/Code/nixmac-e2e-attestations add \
  .github/workflows/cilicon-lifecycle-attestation.yml
git -C /Users/farhankhalaf/Code/nixmac-e2e-attestations commit \
  -m "ci: accept scoped nixmac lifecycle attestations"
```

### Task 13: Shadow Rollout And Promotion

**Files:**

- Modify: `tests/e2e/computer-use/OPERATIONS.md`

- Create during Step 7 only: `.github/workflows/computer-use-e2e-merge-gate.yml`

- Create during Step 7 only:
  `tests/e2e/computer-use/merge-gate-contract-self-test.mjs`

- Create: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/observability.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/workflow.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/tests/test_nixmac_e2e_merged_prs.py`

- Modify: `/Users/farhankhalaf/Code/centaur-overlay-nixmac-e2e-production/workflows/nixmac_e2e_merged_prs/README.md`

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
static host-lease wait/acquire/release/quarantine events, reconciler
heartbeats, oldest-job age, and classified failure counts through `ctx.log`.
Configure the production deployment's alert sink for:

- no successful reconciler for 30 minutes;
- oldest queued or build-waiting job over 30 minutes;
- repeated TCC/image failures;
- stale, ambiguous, or owner-mismatched static host lease;
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

- an induced overlap between a legacy MacinCloud workflow and a Centaur
  `static_ssh` job never drives the host concurrently: the atomic host lease
  preserves the active owner, the waiter remains queued without consuming a
  retry, owner-mismatch release fails, and neither lane kills a process it does
  not own;

- product FAIL then PASS is published as FAIL/`FLAKY_PRODUCT`, while product
  FAIL then FAIL is published as FAIL/`CONFIRMED_PRODUCT_FAIL`.

- [ ] **Step 4: Enable the GitHub Check**

Keep it explicitly non-required and post-merge. Observe at least 50 jobs or
30 days. This is the initial production scope, not a merge gate.

- [ ] **Step 5: Enable one terminal Buzz result**

Post only PASS/FAIL/INCONCLUSIVE with counts and the verified report URL.

- [ ] **Step 6: Make Tart/Cilicon primary and MacinCloud DR-only**

Retain the current workflow as manual rollback. Do not delete it during
qualification.

- [ ] **Step 7: Qualify a separate required merge-queue gate**

Do not start this promotion until Step 4's observation window is green,
Cilicon is primary with the capacity formula satisfied under one-host
quarantine, and immutable 365-day evidence storage is live. The static backend
is prohibited for required checks.

Add a default-branch-owned `merge_group` entrypoint that binds the candidate
merge-group SHA to the exact Build artifact and dispatches the same trusted
harness onto a freshly cloned ephemeral VM. It must:

- publish the required Check on the merge-group SHA, never the already-merged
  PR SHA;
- run no workflow or harness code from the candidate artifact;
- expose no long-lived repository/provider credential to the guest;
- destroy or quarantine the VM before the Check becomes terminal;
- treat PASS as the only merge-satisfying conclusion;
- block on product FAIL, `FLAKY_PRODUCT`, INCONCLUSIVE, missing evidence, or
  missing destruction attestation;
- run non-required against merge groups for at least 20 candidates with zero
  false PASS, duplicate publication, identity mismatch, or unclassified
  outcome before branch-protection promotion.

Record the required-check name and branch-protection/ruleset change in the
readiness ledger. Until this step is complete, describe the service only as
post-merge verification-and-detect, not a required merge gate.

- [ ] **Step 8: Run final verification**

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
node tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs
node tests/e2e/computer-use/cilicon-lifecycle-contract-self-test.mjs
node tests/e2e/computer-use/merge-gate-contract-self-test.mjs
actionlint .github/workflows/computer-use-e2e-centaur.yml
actionlint .github/workflows/computer-use-e2e-merge-gate.yml
actionlint \
  /Users/farhankhalaf/Code/nixmac-e2e-attestations/.github/workflows/cilicon-lifecycle-attestation.yml
```

Centaur overlay:

```bash
python -m unittest \
  workflows.tests.test_github_e2e_tool \
  workflows.tests.test_buzz_e2e_result_tool \
  workflows.tests.test_nixmac_e2e_merged_prs -v
```

Expected: all PASS.

- [ ] **Step 9: Produce the final readiness ledger**

For every design requirement, record:

- implementation file/line;
- automated test;
- live evidence run/artifact ID;
- current status;
- remaining blocker, if any.

No requirement is marked production-ready from code review alone.
