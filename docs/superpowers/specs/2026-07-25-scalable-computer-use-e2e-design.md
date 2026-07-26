# Scalable Computer Use E2E Design

**Status:** Draft for cross-model review
**Date:** 2026-07-25
**Owners:** nixmac / Centaur
**Decision:** Move the CuaDriver-based E2E lane from a Buzz-mediated request on a named Mac into a durable Centaur workflow backed by a dedicated, provider-neutral macOS runner pool.

## Executive Summary

The production path should be:

```text
GitHub merge event + reconciliation poll
  -> Centaur durable job
  -> exact-SHA build artifact
  -> dedicated GitHub Actions E2E workflow
  -> GitHub/Cilicon schedules one ephemeral Tart VM
  -> canonical nixmac scenario runner through CuaDriver
  -> immutable GitHub Actions evidence artifact
  -> terminal GitHub Check + one concise #nixmac-e2e result
  -> runner lifecycle attestation
```

This design reuses three foundations that already exist:

1. The nixmac repository owns the scenario catalog, safety policy, state schema,
   evidence contract, report renderer, and final verdict.
1. Centaur already provides durable steps, idempotent child workflows, and
   checkpointed external actions.
1. Cooper's open PR #604 establishes a Tart/Cilicon macOS fleet, runner
   selection, and a pinned custom-image pipeline.

The missing critical path is a production CuaDriver adapter that implements the
existing in-repo driver contract. We should not create a second scenario runner
or evidence format.

The execution transport is GitHub Actions: Centaur dispatches and reconciles a
dedicated workflow run, while GitHub and the Cilicon host loop own runner
scheduling and VM lifecycle. The first scalable runner backend should be a
dedicated E2E pool derived from PR #604's Tart/Cilicon image and fleet
primitives. MacinCloud remains a single-concurrency transition and
disaster-recovery lane. Orka remains an optional provider backend if the
existing fleet cannot satisfy measured capacity, isolation, or recovery
requirements.

## Goals

- Automatically test every merged nixmac PR at its exact merge SHA.
- Run without Farhan's daily-driver laptop, MBP-23, a Buzz agent, or a named
  human-owned Mac being part of the execution path.
- Scale horizontally by adding interchangeable macOS runner capacity.
- Preserve the existing Product Proof semantics and reviewer-facing report.
- Make retries, restarts, duplicate deliveries, and partial failures safe.
- Distinguish product failures from harness, provider, credential, and runner
  infrastructure failures.
- Publish one terminal result with an immutable evidence link.
- Make runner cleanliness, permissions, image identity, artifact identity, and
  cleanup machine-verifiable.
- Keep the current workflow available until the replacement is qualified.

## Non-Goals

- Rewriting the scenario catalog in Centaur prompts.
- Replacing the existing report with raw agent prose.
- Treating Buzz as a queue, state store, or execution transport.
- Making E2E a required merge gate in the first rollout.
- Reworking Cooper's PR #604 or coupling this work to its large branch.
- Selecting Orka before the existing Tart/Cilicon fleet is measured.
- Solving generic cross-product desktop testing before nixmac is production
  ready.

## Current State

### nixmac

The repository already contains:

- `tests/e2e/computer-use/scenario-catalog.mjs`
- `tests/e2e/computer-use/schemas.mjs`
- `tests/e2e/computer-use/state.mjs`
- `tests/e2e/computer-use/visual-proof.mjs`
- `tests/e2e/computer-use/report.mjs`
- `tests/e2e/computer-use/drivers/contract.mjs`
- the stable `run-remote-cua.mjs` CLI and preservation/adversarial harnesses
- `.github/workflows/computer-use-e2e.yml`
- the separate advisory Peekaboo lane in `peekaboo-runner.mjs` and
  `.github/workflows/peekaboo-e2e.yml`

The production transport is still Codex app-server Computer Use. The current
driver contract requires:

- connect
- visible state
- element lookup
- click
- set value
- screenshot proof
- text proof
- close

There is no CuaDriver implementation in the canonical harness.

The driver contract is currently a descriptor/validation layer, not an
injection seam. `run-remote-cua.mjs` constructs `AppServerClient` directly and
calls Codex-specific tools throughout the scenario flow. Adding CuaDriver first
requires preservation-gated extraction of a driver-neutral scenario runner.

Peekaboo remains an advisory coexisting lane during this project. It is not the
canonical evidence contract and CuaDriver will not be routed through it.
Deprecation or consolidation is a later decision after explicit coverage and
reliability comparison.

### Centaur

The deployed `nixmac_e2e_merged_prs` workflow:

- polls public GitHub metadata every 30 minutes;
- identifies recent merged PRs;
- creates exact-SHA child workflows with an idempotency key;
- sends one request through the `buzz_e2e` tool.

It does not own an E2E job lifecycle, execute the tester directly, wait for a
terminal result, or publish a canonical evidence result.

Centaur workflows can already call `ctx.agent_turn(...)` directly with the OMP
harness. The turn must be wrapped in `ctx.step(...)` because `agent_turn` alone
is not checkpointed.

### macOS capacity

PR #604 provides the direction we should join:

- runner routing between labeled self-hosted macOS capacity and Depot;
- a `nixmac-mac` fleet label;
- a custom verification pool;
- Packer + Tart image construction;
- a pinned Cirrus macOS Tahoe base image;
- Xcode verification and pre-push secret scanning;
- image publication to GHCR.

E2E needs a separate label and lease domain so an interactive UI job does not
silently compete with build jobs or inherit a build runner's dirty state.

The static MacinCloud host referenced by `NIXMAC_E2E_REMOTE_HOST` is useful for
transition and disaster recovery, but it is static, single-concurrency
infrastructure. It cannot meet the same destruction-based cleanliness
guarantees as an ephemeral Tart VM.

## Architecture

### Control Plane: Centaur

Centaur owns durable orchestration, not test truth.

Responsibilities:

- detect a merged PR through a GitHub event;
- reconcile missed events with a scheduled poll;
- create one logical job per `(repo, merge_sha, suite_version)`;
- wait for the exact-SHA app artifact;
- dispatch one dedicated GitHub Actions E2E workflow with an idempotent job ID;
- reconcile the resulting workflow run to a terminal state;
- persist attempt state, Actions run ID, runner identity, and artifact
  references;
- verify the downloaded Actions artifact and runner lifecycle attestation;
- retry infrastructure failures through a new workflow run and fresh runner;
- publish one terminal result;
- quarantine an image or host through an operator-visible infrastructure alert
  when lifecycle attestation fails.

Centaur does not drive the UI in the first production implementation. It must
never independently infer a pass from agent prose or a workflow conclusion.
The canonical `state.json`, evidence manifest, and report verifier decide the
test verdict.

### Execution Plane: Dedicated macOS E2E Pool

The primary backend is a dedicated Tart/Cilicon pool derived from PR #604.

Initial runner label:

```text
self-hosted, macOS, nixmac-e2e
```

The runner image should derive from the same pinned macOS/Xcode image source as
the build fleet, with an E2E-specific layer containing:

- CuaDriver at a pinned version and checksum;
- CuaDriver app bundle and CLI symlink;
- a dedicated non-personal test user;
- pre-created writable evidence roots;
- ffmpeg and report verification prerequisites;
- the GitHub runner/Cilicon runtime;
- no repository credentials, provider keys, signing keys, or user data.

TCC grants are a release artifact, not an informal setup step. Each image build
must test Accessibility and Screen Recording after first boot and after an aged
boot. Grants belong to the pinned `CuaDriver.app` bundle identity, never a raw
CLI executable. If grants cannot survive image cloning safely, a supported
MDM/bootstrap mechanism becomes a prerequisite for pool promotion.

No running warm VM is required initially. Cache the image on each host and
measure cold and cached boot times. Add warm capacity only if latency data
justifies the operational cost.

### Execution Transport And Runner Backends

Centaur uses GitHub's API as its execution transport:

```text
dispatch(job_spec) -> workflow_run_id
inspect(workflow_run_id) -> run + job + runner identity
collect(workflow_run_id, artifact_name) -> artifact ID + digest + archive
verify(job_id, archive) -> canonical verdict + manifest
attest(workflow_run_id, runner_name) -> lifecycle disposition
```

GitHub artifact downloads return a one-minute signed `302` URL outside
`api.github.com`. The narrow client follows only one validated HTTPS redirect
to an allowlisted GitHub Actions artifact/blob host, strips API authorization
before the redirected request, refreshes an expired URL once, and rejects all
other redirects. Centaur promotion is blocked until its capability/egress
layer can express that behavior or a scoped server-side GitHub integration
proxies the download safely.

The dedicated workflow accepts only a validated full SHA, logical job ID,
attempt number, suite version, and backend policy. It checks out the harness
from the trusted default branch, downloads the app artifact bound to the
requested SHA, and runs the app under test from that artifact. Untrusted,
unmerged code is not allowed to define the workflow or evidence verifier. In
the merged-SHA lane, already-reviewed code on `main` participates in the
harness by design; a future active-PR-head lane must retain the stricter
trusted-harness separation.

Runner backends are GitHub workflow execution modes:

1. `cilicon_tart` — primary, runs directly on
   `[self-hosted, macOS, nixmac-e2e]`.
1. `static_ssh` — transition/DR, runs a Linux control job on a dedicated
   one-capacity runner queue that stages and drives the secret-referenced
   MacinCloud host. Centaur's ledger remains the source of delivery truth; the
   one-capacity controller queue serializes every Centaur static job without a
   GitHub concurrency group that can replace older pending work.
1. `orka` — optional future GitHub runner backend if measurement supports it.

Cross-lane host safety comes from a separate atomic lease on the MacinCloud
host, not GitHub concurrency. Before any Mac-side inventory, process action,
or UI action, all four Mac-driving jobs—the three legacy workflows and the new
`static_ssh` job—must acquire the same run-owned lease directory through the
shared host-lease helper. Acquisition uses atomic `mkdir`; owner identity and a
heartbeat are written inside the lease; release succeeds only when the owner
token matches. A live foreign lease waits with bounded polling. A stale,
ambiguous, or unverifiable lease quarantines the host and fails infrastructure
readiness; it is never stolen automatically. The current legacy GitHub
concurrency group remains defense in depth for those workflows but is not the
cross-lane authority. Only an explicit operator action against the logical
Centaur job produces terminal `CANCELLED`. The static runner never kills a
pre-existing nixmac process: preflight fails closed and retries or quarantines,
and cleanup may terminate only the pid launched and recorded by the current
attempt.

GitHub/Cilicon, not Centaur, acquires and releases Tart VMs. Within the job, the
harness proves runner/image identity and owned-path cleanup. After the job, a
host-side cycle wrapper and attestor must prove that the ephemeral GitHub
runner deregistered and the Cilicon host loop deleted or quarantined its VM.
That wrapper is dedicated nixmac infrastructure supervised by launchd, not an
assumed upstream Cilicon hook. Centaur does not publish a terminal pass until
the evidence artifact and lifecycle attestation are both verified.

Provider-specific details must not enter the scenario catalog or report schema.

### Test Runtime: Canonical nixmac Harness

The first production runtime is deterministic code. Phase 0 first extracts a
real driver seam:

1. move driver-neutral scenario orchestration out of `run-remote-cua.mjs` into
   `scenario-driver.mjs`;
1. wrap the current `AppServerClient` as the first injected driver without
   changing behavior;
1. keep `run-remote-cua.mjs` as the stable off-Mac SSH/WebSocket entrypoint;
1. add `run-cua-driver.mjs` as an on-Mac entrypoint using a local Unix socket;
1. prove the refactor with the existing preservation and adversarial harnesses
   before adding CuaDriver behavior.

The on-Mac deterministic wrapper:

1. validates job, artifact, image, and runner identities;
1. creates a unique disposable config and evidence root;
1. starts CuaDriver's daemon on a run-specific Unix socket;
1. verifies Accessibility and Screen Recording;
1. launches the exact-SHA nixmac app;
1. passes a CuaDriver implementation of the canonical driver contract to the
   extracted scenario runner;
1. writes existing `state.json`, events, policy-safe screenshots, text
   evidence, and the safe-frame evidence reel;
1. renders the existing report;
1. validates required artifacts and redaction;
1. stops CuaDriver;
1. verifies filesystem and Git cleanup postconditions.

A future bounded agent may help recover from UI ambiguity, but it must use the
canonical scenario catalog and adapter and cannot author the final verdict.

### CuaDriver Adapter

Add an adapter under:

```text
tests/e2e/computer-use/drivers/cua-driver.mjs
```

The adapter targets the current CuaDriver CLI/daemon:

- `open -n -g <verified-app-bundle-path> --args serve --socket <run-socket>`
- `call check_permissions`
- `call launch_app`
- `call list_windows`
- `call get_window_state`
- `call click`
- `call set_value` or `type_text`
- `call set_recording`
- `call get_recording_state`
- `stop --socket <run-socket>`

Directly spawning raw `cua-driver serve` outside `CuaDriver.app` is prohibited:
upstream documents that mode as unsupported for stable macOS TCC attribution.
Fixture metadata, the adapter, and the runner image bind the same pinned CLI
version, app-bundle version/digest, and standalone app-owned launch mode.
CuaDriver 0.12.6 `call` prints `structuredContent` JSON directly when the tool
provides it, otherwise it prints successful text content. It supports
`--socket`; it does not expose the historical `--raw`, `--compact`, or
`--no-daemon` flags. Nonzero process status/stderr is the current CLI error
boundary. Direct JSON is validated against the invoked tool's pinned schema.
Pinned direct schemas reject additive keys at every top-level and nested
source/app/window/bounds/element object rather than accepting a forward-
extended response under 0.12.6 semantics.
Plaintext success is accepted only for pinned macOS `set_value`, using
source-derived success grammars bound to the requested integer element index.
`click` requires structured success evidence and treats
`effect:"suspected_noop"` as a semantic soft failure. A raw MCP envelope may be
unwrapped only as an exact, bounded compatibility input for sanitized
historical fixtures and is validated against an envelope-specific tool schema.
On macOS that pinned release also emits `on_current_space:null` and
`space_ids:null` for every `list_windows` record. Window selection therefore
requires `is_on_screen=true` and layer 0, rejects an explicit false
`on_current_space`, prefers explicit true when a future release supplies it,
and records when the pinned-version on-screen fallback was used.

The configured CLI is resolved once to a canonical absolute regular executable
and pinned by byte SHA-256, full codesign digest, Developer ID, Team ID, and
exact version output. The daemon is launched with the verified absolute app
path, never `open -a`. Before launch, the adapter snapshots process instances
for the verified daemon executable. Exactly one new PID,
microsecond-resolution birth time, and executable must appear and become the
provisionally owned instance before canonical-path, bundle-digest, or signature
verification. It also binds the corresponding `NSRunningApplication`
executable and high-resolution launch date while bracketing that lookup with
the `libproc` identity. That provisional instance must validate before the
first status probe. Because `/usr/bin/open` can report an error after launch
acceptance, the adapter always reconciles the before/after snapshots; a unique
candidate is retained for exact cleanup, while zero or multiple candidates
preserve explicit launch uncertainty and aggregate cleanup uncertainty.

After status becomes ready and before `check_permissions`, the adapter
canonicalizes the selected Unix socket, captures its device/inode, and runs
`/usr/sbin/lsof -nP -Fpcn -a -U <socket>`. Exactly one `cua-driver` PID must
hold the exact canonical socket. The adapter derives that PID's executable
and microsecond-resolution birth time through the Apple-signed
`/usr/bin/python3` system shim calling macOS `libproc`, requires it to match the
provisional process instance, binds that instance plus the socket device/inode,
and reverifies the bundle identity, content digest, and Developer ID signature.
Only then may it call `check_permissions`; that RPC's `source` is corroboration
only and must match the OS-derived executable.

Pinned 0.12.6 opens a fresh Unix stream for each unauthenticated,
line-delimited JSON request. It exposes neither transport authentication nor
peer credentials, and its caller-selected `session_id` is lifecycle state, not
authentication. Attach-to-existing mode is therefore disabled. Owned mode
first proves its socket path is absent, launches the app, and only then binds
the OS-derived owner. Before and after every `call` RPC, the adapter re-proves
the exact socket device/inode and listener PID/birth-time/executable against
the full bundle attestation cached for that exact process instance. Full
bundle hashing and codesign verification run at bind, clean teardown, and
operation/continuity failure diagnosis, rather than on every UI poll. If any
proof changes in flight, the response is discarded. Generated owned sockets
stay under the short system-temp `socketDirectory`; their absolute UTF-8 path
is capped at 103 bytes.

`close()` may send `stop --socket` only for the exact adapter-started process
instance after re-proving the socket inode and listener identity. A missing
listener while that process remains alive, an ambiguous listener, or a
replacement listener/socket fails closed without stopping or deleting the
replacement and retains ownership for retry. A zero-exit `stop` is not teardown
proof: bounded polling must confirm no listener, the exact process absent or
reused, and the socket path absent. The adapter never path-unlinks a residual
socket: `lstat` and `unlink` cannot form an atomic compare-and-delete, so a
same-UID process could replace the path between those operations. Any stale
socket remains an owned cleanup failure for Task 6 controller quarantine or
ephemeral-host disposal. Startup failures terminate only an unambiguous exact
provisional instance. Provisional cleanup never sends a PID-only signal: one
JXA operation obtains an `NSRunningApplication`, verifies its executable and
launch date, and invokes `terminate` on that same object. If that atomic
identity cannot be proved, direct signaling is declined and controller
quarantine remains required. Startup and cleanup errors are aggregated.

Before `launch_app`, the adapter resolves the staged bundle's exact main
executable and snapshots its process instances. After either a successful
response or an RPC error, it polls that executable and requires exactly one
new PID/birth-time/executable instance. That instance becomes provisionally
owned before response validation, executable canonicalization, or post-launch
bundle verification. Only then does it require the response PID/bundle ID to
match and promote the record. It polls
`list_apps` and `list_windows` under a bounded readiness deadline. Every
visible-state, click, and set-value RPC re-proves the process instance before
and after the request and discards an in-flight response if it changed. Any
later preparation failure and every `close()` attempt compare the current PID,
birth time, and executable directly with the provisionally owned instance
and refresh the full bundle attestation. Target cleanup also uses one atomic
JXA lookup/identity-check/`forceTerminate` call on the captured
`NSRunningApplication` object. Same-app PID reuse receives no action, and an
instance that cannot be atomically matched is never signaled. Ownership is
cleared only when the exact instance is absent or reused. Target and daemon
cleanup failures are aggregated but retained independently so later `close()`
calls retry only unfinished cleanup.

Element addresses use a new reviewed `cua-element-index` kind scoped to
`(pid, window_id, snapshot)`. The adapter must refresh visible state before
element-index actions because CuaDriver replaces the index map on the next
snapshot for that window.

Adapter response normalization must hide CLI/MCP transport details from the
scenario runner. It must expose:

- stable visible text;
- canonical inline PNG bytes from `get_window_state` with
  `screenshot_mime_type:"image/png"` and `screenshot_png_b64`;
- element lookup by canonical pattern;
- normalized action success/failure;
- driver/version/capture metadata;
- teardown status.

Filesystem screenshot paths are rejected, including same-UID substitution.
Bundle-tree hashing opens a non-symlink directory root and traverses only
descriptor-relative, `O_NOFOLLOW`-opened directories and files. It verifies
device/inode identity whenever a directory component is reopened, so a
same-UID rename or replacement can fail closed but cannot redirect the hash.
The helper preserves deterministic relative-path ordering, streams regular
file bytes, rejects symlinks and other non-regular entries, and enforces
explicit file-count, per-file-byte, total-byte, stdout, and deadline ceilings.
The subprocess runner creates a dedicated POSIX
process group; timeout or output overflow closes its pipes, signals the group
with `SIGTERM`, escalates the group with `SIGKILL`, and rejects at the bounded
timeout-plus-grace deadline even if a descendant holds inherited pipes and no
`close` event arrives.
The subprocess stdout cap is the maximum canonical base64 size plus 1 MiB of
JSON overhead; both encoded and decoded image sizes are bounded. Screenshot
decoding is pinned to qualified non-interlaced 8-bit RGB or RGBA PNGs and
validates chunk bounds/order and CRC, sane IHDR dimensions, a hard decoded-byte
ceiling before IDAT inflation, complete consumption of the concatenated IDAT
zlib stream, exact scanline length and filter bytes, IEND, and absence of bytes
after IEND. `tEXt`, `zTXt`, `iTXt`, and `iCCP` are forbidden so screenshot
evidence is pixel-only.

These capabilities were verified against the installed static-Mac CuaDriver:
`get_window_state` returns a native screenshot image in `som` mode,
`get_recording_state` is present, and `serve`/`call` accept a caller-selected
Unix socket. The runtime must still pin and record both CLI and app-bundle
versions because the existing installation reports them separately.

The CuaDriver adapter must pass the same contract and preservation tests as the
Codex transport before any remote pilot.

## Job And Attempt Lifecycle

The logical job and its physical attempts are separate records.

### Job states

```text
DETECTED
WAITING_ARTIFACT
QUEUED
ACTIVE
PASS | FAIL | INCONCLUSIVE | CANCELLED | SUPERSEDED
```

Job identity:

```text
darkmatter/nixmac:<full-merge-sha>:<suite-contract-version>
```

Merged-SHA jobs are never superseded by a newer merge; every detected merge
must reach a terminal result. `SUPERSEDED` is reserved for a future active-PR
head lane, where a newer head SHA replaces an older queued or running head.

### Attempt states

```text
PROVISIONING
READY
RUNNING
UPLOADING
VERIFYING
SUCCEEDED | FAILED | ABORTED
```

Each attempt records:

- job identity;
- attempt number;
- GitHub Actions workflow run and job identity;
- runner hostname/VM identity;
- image digest;
- app artifact digest and source Actions run;
- harness commit and suite contract version;
- CuaDriver version;
- start/end timestamps;
- normalized failure class;
- evidence object prefix;
- lifecycle attestation.
- static-host lease acquisition, heartbeat, owner-matched release, and
  quarantine disposition when `runner_backend=static_ssh`.

### Retry policy

- Harness or runner infrastructure failure: retry once on a fresh ephemeral
  runner.
- CuaDriver daemon/TCC failure: retry once after health classification, then
  quarantine the image/host if repeated.
- Provider/credential failure: do not report product failure.
- Product failure: confirm once on a fresh runner, but preserve the first
  verified failure. FAIL then PASS is terminal FAIL/`FLAKY_PRODUCT`; FAIL then
  FAIL is terminal FAIL/`CONFIRMED_PRODUCT_FAIL`.
- Inconclusive evidence: retry once only when the missing proof is plausibly
  transient.
- `LEASE_BUSY` after a bounded wait on a still-live foreign owner: record the
  completed dispatch as scheduling-only, increment the physical dispatch
  number, mint a new nonce, leave the logical job `QUEUED`, and re-dispatch
  oldest-first with backoff. It does not consume the runtime retry budget or
  resolve the job terminally; queue-age alerts escalate prolonged contention.
- GitHub-side, runner-side, or other external cancellation: stop the attempt,
  upload partial diagnostic evidence, record the attempt as `ABORTED`, and
  apply the infrastructure retry policy.
- Explicit operator cancellation of the logical Centaur job: stop the current
  attempt, upload partial diagnostics, and record terminal `CANCELLED` with an
  audit reason.
- Supersession: applies only to the future active-PR head lane; stop the attempt,
  upload diagnostics, and do not overwrite the newer head's terminal result.

At most one terminal publication is allowed per logical job. Replays must
return the already-published result. Automatic production detection enqueues
only newly merged SHAs under the currently deployed suite version; a suite
version bump does not backfill historical SHAs. Manual backfills default to
`publication_mode=private` and do not create a second Buzz message or overwrite
the production Check. Production v1 has no automated republication override;
any exceptional correction is a separate audited operator procedure outside
this workflow.

## Exact-SHA And Evidence Contract

Before UI actions, the runtime must prove:

- requested full merge SHA;
- successful build artifact produced for that SHA;
- downloaded artifact digest;
- app bundle digest;
- runner image digest;
- harness commit;
- suite contract version.

Required evidence bundle:

```text
manifest.json
state.json
events.json
index.html
screenshots/
texts/
video/computer-use-evidence.mp4
runner/identity.json
runner/permissions.json
runner/cleanup.json
runner/host-lease.json  # required when backend=static_ssh
artifact/source.json
attempt.json
```

`manifest.json` binds every required file by SHA-256 and records the logical job
and attempt identities. Publication fails closed if a required file is missing,
unreadable, empty where prohibited, or has an unexpected digest.
For `static_ssh`, both independent verifiers also require
`runner/host-lease.json` to prove acquisition, owner-token hash consistency,
heartbeat metadata, owner-matched release, and no quarantine disposition.

The evidence bundle is uploaded with the repository-standard
`actions/upload-artifact@v7` under a
job-and-attempt-specific name. The Actions artifact ID and artifact digest are
recorded in Centaur; the artifact is immutable for its retention period. The
control plane downloads and verifies that immutable archive independently
before publishing the result. The existing report publisher may copy the
verified `index.html` tree to its reviewer-facing site, but that mutable site is
not the canonical evidence object.

Initial post-merge artifacts use an explicit 90-day retention window and every
publication records the expiry timestamp. Before any required merge gate,
verified archives are promoted to versioned immutable object storage with at
least 365 days of retention. The mutable report site never becomes canonical
after the Actions artifact expires.

The required `computer-use-evidence.mp4` remains the current curated reel built
only from policy-safe screenshots. Raw whole-run video is not required and must
not be captured across sensitive settings/provider-key surfaces. CuaDriver
trajectory or experimental video recording may be enabled only for scenario
segments proven secret-free and is diagnostic, not canonical gate evidence.

## Static MacinCloud Certification

MacinCloud is not certified as ephemeral. Its promotion gate is separate:

- a durable Centaur ledger plus a dedicated Linux controller runner queue
  hard-limited to one, with no static-job GitHub concurrency group that can
  replace older pending work;
- one shared atomic MacinCloud host lease acquired by every legacy and Centaur
  Mac-driving job, with owner-token release, heartbeat, bounded waiting, and
  fail-closed quarantine for stale or ambiguous ownership;
- quarantine recorded both on the host and in Centaur's durable backend state;
  provider reimage or loss of the host marker never clears controller-side
  quarantine;
- per-run Unix socket, config root, app staging root, and evidence root;
- deterministic preflight and postflight cleanup;
- before/after inventory for app processes and owned filesystem paths;
- clean Git/config baseline verification;
- the same policy-safe screenshot and evidence-reel contract as the ephemeral
  lane;
- periodic provider reimage;
- quarantine after a cleanup, permission, or identity failure;
- destructive scenarios limited to disposable state proven by the harness.

The static lane may be a transition or DR provider. It does not satisfy an
ephemeral-destruction SLO.

## Publication

### GitHub

Create or update one named Check Run for the merge SHA:

```text
nixmac / Computer Use E2E
```

The Check summary contains:

- PASS, FAIL, or INCONCLUSIVE;
- scenario counts;
- failure class;
- exact SHA;
- evidence report URL;
- attempt count;
- runner provider and image digest.

PR comments are deferred until the lane is qualified and useful on active PR
heads. Merged-PR rollout should avoid retrospective PR noise.

### Buzz

Post exactly one terminal message in `#nixmac-e2e`:

```text
PASS — nixmac PR #<n> at <sha7> — <passed>/<total> scenarios — <report link>
```

Failures and inconclusive results add one short reason. No start, retry,
heartbeat, or status messages are posted.

The result webhook also deduplicates durably by logical `job_id`. Replaying a
successful POST after a Centaur checkpoint crash returns the stored result and
does not post a second message; Centaur-side step idempotency alone is not the
exactly-once boundary.

The display identity may remain **Farhan's Ear**. Internal services, workflow
names, principals, and idempotency keys use functional names.

## Detection And Reconciliation

The production v1 correctness path is the scheduled reconciliation poll. A
signature-validated GitHub merge webhook is an optional latency optimization
after Centaur exposes a typed inbound trigger; it is not required for
losslessness or initial promotion.

Reconciliation:

- scheduled poll every 15 minutes;
- use the scoped `NIXMAC_E2E_GITHUB_TOKEN` through the narrow `github_e2e`
  tool; the workflow itself does not issue unauthenticated GitHub API calls;
- paginate every merge in the bounded repair window instead of selecting only
  the newest N, with bounded timeouts, rate-limit-aware backoff, and a
  classified infrastructure alert when GitHub remains unavailable;
- enqueue oldest-first;
- the child-workflow idempotency key is the durable delivery ledger and
  prevents duplicates across scheduler runs;
- scan a 30-day repair window on every tick and alert after one missed
  reconciler interval; older outages require an explicit private backfill.

This eliminates the current burst-loss behavior where selecting only the newest
`max_prs` can permanently skip earlier merges inside a busy interval.

## Isolation And Security

- Dedicated test user and VM per concurrent E2E attempt when using Tart.
- No secrets baked into the image.
- Short-lived runtime credentials injected only after runner identity
  verification.
- Evidence redaction and secret scan before upload.
- No access to Farhan's browser profile, home directory, or personal apps.
- No reuse of build workspaces or user config.
- Network egress limited to GitHub artifacts, approved model/provider
  endpoints, Centaur, and evidence storage where feasible.
- The Cilicon host loop destroys the ephemeral runner after the attempt; failed
  deregistration or destruction attestation quarantines the host and fails
  infrastructure readiness.
- Host destruction events go to a protected, secret-free
  `darkmatter/nixmac-e2e-attestations` sink repository. The sink-only
  `repository_dispatch` app is not installed on nixmac; a separate
  Administration-read app checks nixmac runner inventory. No host credential
  can write nixmac repository contents.

## Observability

Metrics:

- jobs detected, queued, started, and terminal by verdict;
- detection lag;
- artifact wait time;
- queue wait;
- provision/boot time;
- run and upload time;
- attempt count;
- failure class;
- provider/image/CuaDriver version;
- cleanup/destroy success;
- static host-lease wait, acquisition, owner-matched release, and quarantine;
- evidence verification success;
- cost per attempt and per terminal job.

Structured logs include job and attempt IDs but no prompt, screenshot, or secret
contents.

Alerts:

- no reconciler success for 30 minutes;
- oldest queued job above 30 minutes;
- repeated TCC/permission failures on an image digest;
- stale, ambiguous, or owner-mismatched static host lease;
- runner destruction or static cleanup failure;
- evidence upload/verification failure;
- no terminal publication after a completed verified report.

## Service Objectives And Promotion Gates

Initial absolute gates:

- zero missing merged PRs in the qualification window;
- zero duplicate terminal publications;
- zero evidence bundles with identity/digest mismatch;
- zero unclassified failures;
- zero cleanup/destruction failures;
- every published result links to a verified report;
- ten consecutive exact-SHA qualification jobs complete successfully when the
  product itself passes.

Percentage targets become promotion criteria only after at least 50 jobs or 30
days:

- 98% of jobs receive a terminal result without human intervention;
- 95% start within 15 minutes when capacity is available;
- fewer than 2% remain infrastructure-inconclusive after retry;
- 100% of ephemeral attempts end destroyed or explicitly quarantined.

## Rollout

### Phase 0 — Canonical adapter

- Extract a driver-neutral scenario runner and inject the existing Codex
  transport without changing behavior.
- Add the on-Mac `run-cua-driver.mjs` execution mode.
- Implement and test the CuaDriver adapter in nixmac.
- Prove report/evidence equivalence locally and on MacinCloud.
- Keep existing workflows unchanged.

Exit: preservation, adversarial, adapter contract, and one real-Mac smoke suite
are green.

### Phase 1 — Durable Centaur job on static provider

- Replace Buzz dispatch with Centaur dispatch/reconciliation of a dedicated
  GitHub Actions workflow.
- Add job/attempt state, artifact wait, evidence verification, and terminal
  publication.
- Use MacinCloud with the static certification contract.
- Run shadow-only after merged PRs.

Exit: ten consecutive jobs, no missed merges, no duplicate terminal messages,
and cleanup contract green.

### Phase 2 — Dedicated Tart/Cilicon pool

- Build the E2E image as a small follow-up to PR #604's image primitives.
- Add the `nixmac-e2e` runner label and provider.
- Run shadow traffic on ephemeral VMs.
- Measure boot, queue, run, cleanup, reliability, and cost.

Exit: absolute gates green and destruction verified for every attempt.

### Phase 3 — Production default

- Make Tart/Cilicon primary and MacinCloud DR-only.
- Enable GitHub Check publication.
- Retain the old workflow behind a manual dispatch rollback path.

Exit: 50 jobs or 30 days meet percentage SLOs.

### Phase 4 — Capacity decision

- Add hosts to the Cilicon/Tart pool when measured queue demand requires it.
- Evaluate Orka only if the existing fleet cannot meet target isolation,
  recovery, or operational load.

Size capacity from observed peak arrivals and p95 cycle time:

```text
dedicated_hosts >= max(
  2,
  ceil(peak_jobs_per_hour * p95_cycle_minutes / 60 * 1.5) + 1
)
```

Promotion requires p95 start latency under 15 minutes with one host
quarantined. The static MacinCloud lane remains transition/DR capacity and is
never the horizontal scale target.

Orka constraints must be modeled explicitly: Apple Silicon supports at most two
running macOS VMs per physical node, and provider burst capacity is not
reactive autoscaling.

### Phase 5 — Optional required merge-queue gate

The first production release remains post-merge and non-required. A later
default-branch-owned `merge_group` entrypoint may become required only after
the ephemeral pool, capacity headroom, one-host quarantine behavior,
candidate-code isolation, and 365-day immutable evidence retention qualify. It
runs only on fresh ephemeral VMs, reports on the merge-group SHA, and treats
PASS as the only merge-satisfying conclusion; product FAIL,
`FLAKY_PRODUCT`, INCONCLUSIVE, missing evidence, or missing destruction
attestation all block.

## Rollback

- Centaur feature flag disables automatic E2E job creation.
- Provider policy can route back to static MacinCloud.
- Existing GitHub workflow remains manually dispatchable.
- Publication is idempotent; disabling execution cannot retract or duplicate a
  prior terminal result.
- Runner image promotion uses immutable digests; rollback selects the last
  qualified digest.

## Implementation Boundaries

### nixmac repository

Owns:

- CuaDriver adapter and tests;
- canonical scenario runner integration;
- job/evidence manifest schema and verifier;
- deterministic CLI used by remote runners;
- report rendering and verdict.

### Centaur overlay

Owns:

- event/poll detection and durable cursor;
- job and attempt state machine;
- artifact readiness;
- GitHub Actions dispatch and reconciliation;
- backend policy and lifecycle-attestation reconciliation;
- retry/cancel/supersession;
- evidence verification;
- GitHub/Buzz terminal publication.

### PR #604 dependency

Do not modify or stack this work onto PR #604. Build the adapter and Centaur
foundation independently. Once PR #604 lands, create a small E2E image/pool
change that reuses its Packer, Tart, GHCR, and fleet conventions.

## Open Decisions Resolved By Measurement

- Whether the E2E image should layer on the build image or share only a common
  base template.
- Whether zero warm VMs meet queue latency.
- How many dedicated E2E hosts are needed.
- Whether Orka provides enough additional value to justify a second
  virtualization control plane.
- When active-PR checks become reliable enough to gate merges.

None of these decisions block the canonical adapter or durable Centaur job
foundation.
