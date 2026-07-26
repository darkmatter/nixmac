# Product Proof Operations Runbook

This file is the operator playbook for the nixmac Product Proof lane. The policy
contract lives in `README.md` under Productization Policy; do not copy or fork
that policy here. If the policy and this playbook conflict, update this playbook
to match `README.md`.

The lane is still local/advisory evidence until the promotion checklist in
`README.md` is met. Local summaries help operators see readiness, but they are
not branch-protection truth.

## Roles

Authoritative role definitions live in `README.md` under Accountability roles.
This playbook assumes the Product Proof owner, DXU operator, Release approver,
and PR author/reviewer have been identified from that policy section.

When an owner is unclear, the release approver must name the accountable owner
in the override or release record before treating Product Proof as satisfied.

## Local CuaDriver Attempt

Use the local CuaDriver entrypoint on static transition runners and ephemeral
macOS workers. Before invoking it:

1. Create a unique evidence run directory and a separate disposable staging
   directory with the same basename.
1. Extract one exact-SHA app artifact into that staging directory as
   `nixmac.app`; resolve the resulting path to its canonical absolute path.
1. Provision a per-run disposable nixmac config and set
   `NIXMAC_E2E_DISPOSABLE_CONFIG=true`.
1. Pass the full 40-character source SHA in
   `NIXMAC_E2E_APP_ARTIFACT_SHA`, the canonical bundle path in
   `NIXMAC_E2E_APP_PATH`, and the pinned CLI in
   `NIXMAC_CUA_DRIVER_BINARY`.
1. Clear all legacy remote SSH/SCP and Codex WebSocket environment variables;
   the local preflight rejects them.
1. Leave `NIXMAC_CUA_DRIVER_SOCKET` unset unless the workflow has reserved an
   absent, owned, run-specific short socket path. Never pass an existing socket
   and never attach to a daemon from another attempt.

The runner verifies the staged bundle ID and digest before UI actions, prepares
the exact target, rechecks the bundle identity/digest before its first state
capture, refuses a pre-existing same-bundle process, and delegates target/daemon
teardown only to the owning CuaDriver instance. A preflight, launch,
target-binding, or cleanup error is a failed attempt; do not retry by killing
an unowned process.

The local lane does not call SSH/SCP, copy the report to another machine, or
open a personal browser. If report inspection is later made binding, provision
an isolated same-run browser profile and treat it as another owned resource.

Before admitting a new worker, run the bounded launch, Settings, and report
smoke with the same preflight environment described above:

```bash
node tests/e2e/computer-use/run-cua-driver.mjs smoke --run-dir \
  artifacts/computer-use-remote/<run-id>
```

Retain the generated PASS or structured infrastructure-blocker report. Smoke
mode does not generate video or publish anything to Buzz or GitHub.

## Centaur Dispatch Service

Centaur dispatches `.github/workflows/computer-use-e2e-centaur.yml` only from
the repository default branch. The workflow accepts one full merged SHA, one
durable logical job/attempt, one suite version, one pre-resolved build run and
artifact ID/digest, one attestation nonce, and one backend. It does not accept a
harness ref. It never comments on a PR, calls Buzz, or records raw whole-session
video.

Both Mac jobs use the protected GitHub environment
`nixmac-e2e-production`. Configure that environment's deployment branch policy
to selected branches and allow only `main`; do not allow tags. Store the static
host SSH key and known-hosts data in that environment, together with the
expected host/user/local-hostname and pinned image-digest configuration. The
workflow's default-branch condition is defense in depth: the protected
environment is the enforcement boundary that prevents a non-main dispatch from
receiving production Mac credentials. Live repository environment settings
remain an external qualification requirement and must be checked before
production promotion.

The Linux preflight binds the default-branch harness and exact app separately.
It queries the pre-resolved artifact ID, verifies its build run, source SHA,
name, expiry, and archive digest, and downloads it once. The selected macOS
runner independently hashes the extracted app bundle with the canonical
CuaDriver tree hash before execution. This bounded controller step runs before
either macOS job can be allocated. Missing or expired build evidence terminates
as `BUILD_UNAVAILABLE`; identity or digest mismatches terminate as
`ARTIFACT_INVALID`.

Main pushes can overlap and the normal build concurrency may cancel an older
push. Centaur therefore uses the idempotent exact-SHA backfill in `build.yaml`:

1. Query successful `Build macOS App` runs and non-expired
   `nixmac-macos-app-e2e` artifacts for the merged SHA.
1. If none exists, create the deterministic private branch
   `automation/nixmac-e2e-backfill/<merged-sha>` at that exact merged SHA using
   the Centaur GitHub App installation token. This is only valid for merges at
   or after the E2E suite activation commit, so the target revision contains
   the backfill workflow contract.
1. Dispatch `build.yaml` with `ref` set to that deterministic branch,
   `e2e_backfill=true`, and `e2e_merge_sha` set to the same SHA. GitHub's
   workflow-dispatch API accepts a branch or tag, not a raw commit SHA.
1. The workflow proves the SHA is in default-branch history. Same-SHA
   backfills serialize without cancellation and re-check for an already
   successful artifact before allocating the macOS builder. When a queued
   duplicate finds an existing artifact, the ARC job downloads it by exact
   run/artifact ID and republishes the same preserved app payload into the
   newer run. Bind Centaur to the artifact ID and digest returned by the
   successful run, since a republished artifact has its own GitHub archive
   digest. Every successful backfill run therefore remains independently
   discoverable and has exactly one `nixmac-macos-app-e2e` artifact.
1. After the build reaches a terminal state and Centaur has persisted its run,
   artifact, and digest result, delete only the exact deterministic branch if
   it still points to the requested merged SHA. A pre-existing or moved ref is
   never overwritten or deleted.
1. Poll for a bounded interval in Centaur. If no successful exact-SHA artifact
   appears, record `BUILD_UNAVAILABLE` and do not dispatch or retry a Mac job
   indefinitely.

`cilicon_tart` runs on the ephemeral
`[self-hosted, macOS, nixmac-e2e]` pool. `static_ssh` is the transition/DR lane:
it runs on the one-capacity
`[self-hosted, linux, nixmac-e2e-static-controller]` queue and deliberately has
no GitHub concurrency group. Centaur must verify exactly one online static
controller before dispatch. The static controller acquires the host lease
before inventory, staging, process, or UI work; only the owner token can release
it. Live foreign owners wait for a bounded interval. Stale, ambiguous, or
unverifiable ownership quarantines the host and is never stolen.

The deployed runner images are an explicit toolchain contract, not a mutable
host assumption. ARC controller/publisher images must provide `gh`, `git`,
`jq`, `node`, `python3`, `ffmpeg`, `ffprobe`, `shasum`, and `unzip`; the
ephemeral Mac image must provide `ditto`, `jq`, `node`, `python3`, `ffmpeg`,
`ffprobe`, and `shasum`; the static controller adds `ssh`, `scp`, and `tar`.
Each job probes its own contract before consuming evidence or mutating a Mac.
The evidence producer and verifier both use the resolved
`NIXMAC_E2E_FFMPEG_PATH`, so one attempt cannot silently switch binaries.

### Tart/Cilicon activation gate

The ephemeral Tart/Cilicon lane is disabled. As observed on 2026-07-26, PR #604
is still open and its image workflow and Packer template are not on `main`.
`ops/images/nixmac-e2e-runner.contract.json` records this dependency boundary
without inventing image or CuaDriver pins. Before allocating the ephemeral job,
the ARC preflight validates that trusted checked-in contract and requires its
activation state to exactly match the repository-level Actions variable
`NIXMAC_E2E_CILICON_PROMOTION_STATE`. A variable cannot enable a disabled or
incomplete checked-in contract.

The variable must be repository-level because the ARC preflight evaluates it
before a protected-environment Mac job can be allocated. Treat repository and
organization Actions-variable write access as part of the production control
plane: audit who can change it, check that an organization-level value cannot
unexpectedly supply it, and retain the protected `nixmac-e2e-production`
environment as the independent main-only credential boundary.

There are two non-interchangeable qualified states. Ten consecutive absolute-
gate jobs can set `shadow-qualified-v1` and authorize only dispatches with
`qualification_tier=shadow`. Shadow runs collect private qualification evidence;
they do not authorize production publication. Only the 50-job-or-30-day
percentage window can set `production-qualified-v1` and authorize
`qualification_tier=production`. The checked-in contract, requested tier, and
repository variable must all agree.

After PR #604 lands, activate the lane only through this sequence:

1. Derive a small E2E image layer from #604's Packer, Tart, pinned Cirrus
   Tahoe-base, GHCR, isolated-builder, Xcode-verification, and secret-scan
   primitives. Do not copy or fork the full Xcode recipe.
1. Publish and consume the E2E image only by immutable `@sha256` reference.
   Pin the CuaDriver artifact, executable, and app-tree digests, CLI/app version,
   bundle ID, signing identity, Team ID, app path, app-owned executable, and CLI
   symlink.
   On every VM boot, the host attestor writes
   `/var/db/nixmac-e2e/runtime-observation.json`. The workflow verifies its
   Ed25519 signature and freshness, binds the actually observed image digest,
   host/cycle/runner, CuaDriver hashes/signature/bundle identity, and TCC target,
   then independently hashes and code-sign verifies the installed app. The
   CuaDriver adapter's live permission probe remains the final TCC admission
   check.
1. Build without repository credentials, provider keys, signing keys, or user
   data. Use a dedicated non-personal test user and verify every required
   media/report tool.
1. On both first boot and an aged reboot, prove a logged-in Aqua session,
   Accessibility, Screen Recording, and CuaDriver smoke. TCC must target the
   pinned `CuaDriver.app` identity, never the raw CLI. If grants do not survive
   cloning, require a supported MDM/bootstrap mechanism before promotion.
1. Deploy a dedicated capacity-one host cycle wrapper and lifecycle attestor.
   Every attempt gets one fresh VM. The trusted workflow supplies the job,
   Centaur attempt, nonce, GitHub run/run-attempt, and qualified attestor/sink
   policy. The verified host observation supplies the actual runner, image
   digest, host ID, cycle ID, and exact clone path. The lifecycle request records
   those sources separately before asking the host to destroy that exact cycle.
1. The host must wait for the exact runner to deregister and the exact clone to
   disappear, reject a second matching clone, and emit one nonce-bound
   `destroyed` attestation. On any timeout or ambiguity it instead creates
   `/var/db/nixmac-e2e-quarantined`, stops new cycles, and emits a
   `quarantined` attestation with the reason and marker. A quarantine proves
   containment, not successful teardown or promotion eligibility.
   Lifecycle acceptance also requires the request's expected host and cycle,
   the qualified Ed25519 attestor, and an independently authenticated
   repository/ref/path/commit/blob read from the protected sink. Centaur must
   atomically consume that lifecycle key through its durable consumption ledger;
   an omitted ledger, replay, stale attestation, or stale sink observation is a
   hard failure.
1. Create the protected, secret-free
   `darkmatter/nixmac-e2e-attestations` sink. Give the host one sink-only GitHub
   App identity with only Contents write on that sink and no installation on
   `darkmatter/nixmac`. Use a different GitHub App identity with only
   Administration read on `darkmatter/nixmac` to check runner inventory. Record
   both App and installation IDs. Never place either private key in the VM image
   or repository.
1. Register only `[self-hosted, macOS,nixmac-e2e]`; do not share the build
   fleet's `nixmac-mac` lease domain. Prove one complete VM cycle, runner
   deregistration, exact clone destruction, wrapper restart recovery,
   two-cycle serialization, and quarantine admission blocking.
1. Run private shadow traffic with no Check or Buzz publication. Centaur must
   consume each sink attestation once and must not publish PASS until canonical
   evidence and lifecycle identity both verify.
1. Meet the absolute gates: no missed merges, duplicate terminal publications,
   identity/digest mismatches, unclassified failures, cleanup failures,
   destruction failures, or attestation failures; every publication has a
   verified report; and the latest ten exact-SHA product-passing jobs are
   consecutive destroyed attempts. A quarantine resets this streak and counts
   as a teardown failure during absolute qualification.
1. After at least 50 jobs or 30 days, also prove 98% terminal without human
   intervention, 95% starting within 15 minutes when capacity exists, fewer
   than 2% infrastructure-inconclusive, and 100% of attempts destroyed or
   explicitly quarantined. Only then set the repository promotion variable.

Size the dedicated pool from observed arrivals and cycle time:

```text
dedicated_hosts >= max(
  2,
  ceil(peak_jobs_per_hour * p95_cycle_minutes / 60 * 1.5) + 1
)
```

Promotion also requires p95 start latency under 15 minutes with one host
quarantined. Rollback selects the last qualified immutable image digest; it
never falls back to a mutable tag. Code review and local tests cannot qualify
the external image, TCC grants, host teardown, GitHub App permissions, sink
protection, runner inventory, or measured capacity, so they must not be used as
production-readiness evidence.

Before enabling the first `static_ssh` dispatch after the lease workflow lands:

1. Query all queued and active runs of `computer-use-e2e.yml`,
   `peekaboo-e2e.yml`, and `e2e.yml`.
1. Drain every run whose workflow revision predates the shared-lease revision.
1. Record the drained run IDs and lease revision in the readiness ledger.
1. Refuse static traffic while any pre-lease run remains queued or active.

The static controller inventories the host before and after, stages only unique
attempt-owned paths, copies evidence back, removes only those paths, releases
the lease, writes the authoritative cleanup and host-lease sidecars, and then
creates and verifies the manifest. Nothing mutates the evidence tree after
manifest verification. Task 6's single attempt writer records
`PROVISIONING → READY → RUNNING → UPLOADING → VERIFYING`, followed by exactly
one of `SUCCEEDED`, `FAILED`, or `ABORTED`; the workflow does not maintain a
second lifecycle. The canonical cleanup sidecar proves every exact path and
target/daemon process disposition; the remote runner transfers those exact
process identities in an attempt-owned handoff outside the evidence tree before
the controller removes staging. The controller cleanup-probe HMAC binds the
normalized cleanup digest to repository, job, attempt, and host using the
trusted lease owner token. The host-lease sidecar separately proves the same run
identity, owner-matched acquisition/release hashes, and monotonic lease
timestamps. Cleanup, inventory, or lease-release ambiguity creates both the
durable Centaur backend quarantine and the host quarantine marker.
Before checkout or any operation that can fail, the controller initializes
`static-controller/terminal-disposition.json` and retains it in the diagnostics
artifact with `CONTROLLER_STARTED`. Lease acquisition replaces that disposition
with exactly one of `LEASE_ACQUIRED`, `LEASE_BUSY`, `LEASE_QUARANTINED`, or
`INFRASTRUCTURE_FAILURE`; Centaur uses that durable record instead of parsing
workflow logs. The result job always uploads a small `terminal-contract.json`.
If cancellation, runner loss, or the absence of that terminal artifact prevents
the workflow from writing its own final disposition, Task 10 must use the
authenticated GitHub run/job API to synthesize the attempt as `ABORTED`. It
must never infer a product failure or `CANCELLED` from missing evidence alone.

### Audited static-host recovery

Recovery is manual and two-phase. First inspect the host lease:

```bash
ops/runner/macincloud-host-lease.sh status \
  --ssh-dest "$REMOTE_USER@$REMOTE_HOST" \
  --ssh-key "$SSH_KEY" \
  --known-hosts "$KNOWN_HOSTS"
```

Copy the exact digest from the `OCCUPIED`, `AMBIGUOUS`, or marker-only
`QUARANTINED` status output. An ambiguous digest binds the bounded direct-file
snapshot after its orphaned heartbeat is stopped; a marker-only digest binds
the quarantine record left after an owner-matched release. Recover only with an
operator reason:

```bash
ops/runner/macincloud-host-lease.sh recover \
  --ssh-dest "$REMOTE_USER@$REMOTE_HOST" \
  --ssh-key "$SSH_KEY" \
  --known-hosts "$KNOWN_HOSTS" \
  --observed-lease-digest "$LEASE_DIGEST" \
  --operator-reason "ticket and verified recovery reason"
```

For an occupied lease, recovery refuses a changed digest, an active owning
GitHub run, or an unverifiable owner. Ambiguous and marker-only recovery are
allowed only through this explicit digest-and-reason path because live owner
metadata is absent by definition. Every mode refuses while nixmac or CuaDriver
is active, snapshots every bounded regular lease file plus quarantine metadata
into the recovery audit directory, and removes only the validated direct files;
none uses a generic recursive delete. Then attach that proof to a separate
audited Centaur operation that clears durable backend quarantine. Reimaging the
host or losing the host marker does not clear Centaur state.

The canonical Actions artifact is retained for 90 days and exposes the artifact
ID/digest to Centaur. The deterministic gh-pages report lives at
`computer-use-e2e/jobs/<url-encoded-job-id>/attempt-<attempt>/`, but it is a
mutable convenience copy, not canonical evidence. Before promotion to a
required merge gate, copy verified evidence to versioned immutable object
storage for at least 365 days and test restoration. Expired evidence must be
reported as expired, not silently replaced by gh-pages.

Each backend uploads exactly one manifest-bound canonical evidence root.
Controller diagnostics and terminal contracts use separate artifacts and are
not mixed into that root. The gh-pages publisher has no replace-pending
concurrency queue: it fetches the latest branch and retries an optimistic
commit/push race up to five times so every completed attempt gets a publication
opportunity.

## Daily Operator Check

1. Inspect the latest local evidence summary:

   ```bash
   node tests/e2e/computer-use/summarize-runs.mjs \
     --root artifacts/computer-use-remote \
     --format markdown \
     --out artifacts/computer-use-summary/product-proof-summary.md
   ```

1. Read `promotionReadiness` as local telemetry only. It answers whether the
   preserved evidence is trending toward promotion, not whether branch
   protection is satisfied.

1. Check the latest real workflow run path, verdict, scenario counts,
   screenshots, text snapshots, video status, and duration.

1. If the latest run is no-touch unavailable, inspect readiness JSON and workflow
   logs before retrying. Do not mark it green manually.

1. If a run touched the Mac and then missed required evidence, treat it as
   product/evidence failure, not infra-only override.

## Singleton Mac Capacity

The remote GUI lane depends on one interactive Mac. Keep the remote job
concurrency serialized until the team has a real host pool and per-host state
isolation. GitHub-hosted prepare work may run outside that lane, but anything
that performs SSH readiness, app staging, app-driving Computer Use, tunnel
setup, or remote cleanup belongs in the serialized remote job.

- Stale first-attempt PR runs should skip before secrets, SSH, app staging,
  tunnel setup, or cleanup during prepare, and should be rechecked again at the
  start of the remote job before remote work begins.
- Operator reruns and manual dispatches are triage evidence when they are not
  current PR head.
- Do not run ad hoc manual GUI sessions on DXU during a queued Product Proof
  workflow.
- If queue time becomes the bottleneck, add hosts and host-pool routing before
  making concurrency per PR.
- The prepared app handoff artifact is retained for 3 days. Treat queues that
  approach that age as an operator incident; the remote job cannot safely consume
  an expired app artifact.
- Keep report publication independent from the DXU lane. The Centaur publisher
  fetches the latest `gh-pages` state and retries push races instead of using a
  replace-pending concurrency queue.

Track these locally or in the release issue before required-gate promotion:

- queued run count and p95 wait;
- p50/p95 remote runtime;
- no-touch unavailable count and recent cause;
- cleanup failures;
- host identity mismatch or app-server unavailable incidents.

## Host Rotation

Host rotation is required when DXU is reassigned, replaced, compromised, or too
noisy for reliable Product Proof.

1. Product Proof owner names the target host and expected `LocalHostName`.

1. DXU operator captures the SSH host key from a trusted network and updates the
   repository secret containing known hosts.

1. Set or update `NIXMAC_E2E_REMOTE_HOST`, `NIXMAC_E2E_REMOTE_USER`,
   `NIXMAC_E2E_REMOTE_SSH_KEY`, and `NIXMAC_E2E_REMOTE_LOCAL_HOSTNAME`.

1. Run readiness only before any full Product Proof run:

   ```bash
   node tests/e2e/computer-use/check-remote.mjs \
     --host <fqdn-or-ip> \
     --user <user> \
     --key <key-path> \
     --known-hosts <known-hosts-path> \
     --expected-local-hostname <local-hostname> \
     --check-codex-binary \
     --json artifacts/computer-use-remote/readiness/remote-readiness.json
   ```

1. Verify TCP, SSH identity, expected local hostname, Codex binary, app-server
   readiness when required, and macOS version.

1. Run one advisory Product Proof pass and confirm the report shows the new host
   metadata, app metadata, cleanup state, and evidence video.

1. Preserve the readiness JSON with the run artifact. Do not publish raw
   readiness JSON to public report hosting.

## Evidence Policy

Authoritative evidence requirements live in `README.md`. Operationally, treat
the screenshot-compilation video as the current reviewer scanning artifact and
do not remove the underlying screenshot/text contracts when adding new evidence
media.

Continuous full-session video is not implemented and is not the current required
evidence policy. Revisit it when one of these becomes true:

- screenshot reels fail to explain important reviewer questions;
- branch-protection promotion requires stronger temporal proof;
- a host pool makes continuous capture cheap and reliable;
- a recurring incident needs before/after footage that screenshots cannot show.

If continuous recording is added, it must preserve the existing screenshot/text
contracts rather than replacing them.

## Override Lifecycle

Use the override template and allowed classes in `README.md`. The playbook is:

1. Confirm the run is infra-only and no app state was touched, or that the
   touched state is fully restored and the failure class is still eligible.
1. Attach the Product Proof run URL, report or artifact URL, readiness evidence,
   affected SHA, retry plan, expiry/review-after date, owner, and role.
1. Release approver records the decision outside the workflow. The workflow
   result remains honest.
1. Product Proof owner follows up before expiry. Expired override records are
   not reusable.

Use `README.md` as the source of truth for classes that must not use infra-only
override. Do not restate the prohibition list here; it must stay in one policy
home.

## Maintenance Cadence

Weekly:

- run `summarize-runs.mjs` and record the real workflow streak, latest SHA
  clean count, no-touch count, and evidence volume;
- review waivers in `coverage-manifest.json` for expired review dates;
- verify the latest report still renders video, visual proof, coverage drift,
  PR focus, and remote metadata sections;
- run the preservation harness locally before any large runner refactor.

Monthly:

- rerun remote readiness and compare expected host identity;
- rotate or revalidate pinned known-host material when the host changes;
- review queue/runtime metrics against singleton capacity;
- confirm the DXU operator and Product Proof owner are still correct;
- inspect whether continuous recording has become a requirement.

Before promotion:

- require enough fresh same-SHA workflow evidence, not just copied local
  artifacts;
- verify stale queue behavior with a no-touch skip;
- verify the infra-only override process with a real record;
- verify host rotation has an owner and tested checklist;
- verify the summary output says release/high-risk and required-gate readiness
  from current evidence, with local-only disclaimers intact.
