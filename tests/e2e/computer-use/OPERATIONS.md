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

The first production topology is a horizontally scalable pool of dedicated,
full-admin cloud Apple-silicon hosts running the capacity-one Tart/Cilicon
contract. The first paid qualification spike uses one AWS EC2 Mac Dedicated
Host because it is the fastest serious way to test Tart, Cilicon, TCC, and
host-rooted destruction without committing to a permanent provider. Production
provider selection remains open until AWS EC2 Mac, MacStadium bare-metal IaaS,
and an Orka-native backend have comparable lifecycle evidence, capacity data,
and real quotes. MacinCloud pay-as-you-go is ineligible because it lacks the
required administrative control; a dedicated plan is viable only if it passes
the same root access, stable host identity, networking, reimage, and support
requirements. MBP-23, personal Macs, and the shared build fleet are not
production capacity.

Before allocating the AWS spike, prefer an established account, request the
Mac Dedicated Host quota first, and confirm capacity and price. Start with
`mac2-m2.metal`; declare `mac2-m2pro.metal`, `mac-m4.metal`, and a second
qualified region as fallbacks rather than waiting inside a paid window. Use an
AWS-vended Tahoe image on at least 300 GB of encrypted gp3 storage provisioned
for 10,000 IOPS and 400 MiB/s. Budget one interactive first-login pass to
complete Setup Assistant, approve Local Network Privacy, and prove the
dedicated service user's auto-login and Aqua session after reboot. Do not use
stop, terminate, and relaunch as routine mid-window recovery because
Apple-silicon host scrubbing can consume hours; prefer in-place repair,
reclone, and reboot.

Orka is not a thin adapter over this substrate. The checked-in image is Tart
format, the lifecycle trust root is a customer-controlled host process, and the
current runner registration model is label based. An Orka backend therefore
needs an Orka-native image pipeline, runner scale-set controller, and
API-rooted observation/destruction proof. Test those assumptions with Orka
Desktop before provider commitment, then qualify Orka as a separate future
backend rather than weakening the Cilicon contract.

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
1. Publish the E2E image as a private package and consume it only by immutable
   `@sha256` reference. At installation and image rotation, a short-lived
   classic PAT scoped only to `read:packages` may authenticate one host-side
   `tart pull` through stdin; GitHub Container Registry CLI authentication does
   not accept a GitHub App installation token. Give the PAT a short expiration.
   Do not persist it or give it to Cilicon. After the pull, prove an
   unauthenticated clone from the complete digest cache and configure Cilicon
   against the direct local cache bundle, not an OCI URL. GitHub Container
   Registry creates new packages private by default and does not permit a
   public package to become private again, so the image workflow refuses to
   push when the namespace permits anonymous tag reads and proves the published
   digest still denies anonymous manifest reads immediately after publishing.
   The authenticated digest pull that follows independently proves authorized
   access.
   Pin the CuaDriver artifact, executable, and app-tree digests, CLI/app version,
   bundle ID, signing identity, Team ID, app path, app-owned executable, and CLI
   symlink.
   Record the image build timestamp and enforce a maximum qualified age of
   seven days. Rebuilding does not waive cold-boot, aged-boot, TCC, or smoke
   qualification. Image age is fixed at cycle admission, with five minutes of
   clock-skew tolerance; an expired image pauses new cycles without
   quarantining a healthy host, while an already-admitted cycle may finish. On
   every VM boot, the host attestor writes
   `/var/db/nixmac-e2e/runtime-observation.json`. The workflow verifies its
   Ed25519 signature and freshness, binds the actually observed image digest,
   host/cycle/runner, CuaDriver hashes/signature/bundle identity, and TCC target,
   then independently hashes and code-sign verifies the installed app.
   Immediately before UI execution, the workflow also requires
   `/usr/local/bin/cua-driver` to be a symlink whose realpath is exactly the
   signed `appExecutable`, and hashes the followed target against the signed
   `executableDigest`. The
   CuaDriver adapter's live permission probe remains the final TCC admission
   check.
1. Build without repository credentials, provider keys, signing keys, or user
   data. Use a dedicated non-personal test user and verify every required
   media/report tool.
1. On both first boot and an aged reboot, prove a logged-in Aqua session,
   Accessibility, Screen Recording, and CuaDriver smoke. TCC must target the
   pinned `CuaDriver.app` identity, never the raw CLI. PPPC/MDM may grant
   Accessibility, but it cannot silently grant Screen Recording; it can only
   permit a standard user to approve it. The provider/image combination must
   therefore prove that a one-time user-approved golden-image grant or the
   explicitly qualified system-TCC bootstrap survives cloning. If neither
   survives reliably, that provider/image combination is ineligible.
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
   The trusted Mac job constructs the request from immutable dispatch fields and
   the verified signed host observation, writes it once into the canonical
   host-mounted cycle directory, and uploads the same request as a 90-day Actions
   artifact. After that Mac job exits, the ARC lifecycle consumer downloads the
   request, authenticates as the dedicated sink-reader GitHub App, resolves the
   protected `attestations` data ref to one commit, verifies the configured
   writer-App status check, reads the exact path and Git blob back, and only then
   verifies the lifecycle signature and freshness. It atomically creates a consumption
   receipt through the HTTPS durable-storage adapter with `If-None-Match: *` and
   requires an exact durable readback before returning `destroyed` or
   `quarantined`. Production report publication and terminal `COMPLETE` require
   a consumed `destroyed` result; missing lifecycle data, store failure, and
   quarantine remain fail-closed.
1. Create the protected, secret-free
   `darkmatter/nixmac-e2e-attestations` sink as a **private** repository whose
   default branch is `main`. Seed `main` from the reviewed sink worktree before
   enabling any protection, then create the data branch once from that exact
   commit:

   ```bash
   GH_TOKEN=<one-time-repository-admin-token> \
     node scripts/bootstrap-attestations-branch.mjs bootstrap \
       --repository darkmatter/nixmac-e2e-attestations
   ```

   The bootstrap is idempotent only while `attestations` still equals `main`
   and refuses to reset a branch that has advanced. Create the protected
   environment `nixmac-e2e-attestation-writer` explicitly before adding any
   secret; restrict deployments to `main` only so GitHub cannot silently
   auto-create an unrestricted environment. Set repository variables
   `NIXMAC_E2E_ATTESTOR_PUBLIC_KEY_B64`, `NIXMAC_E2E_ATTESTOR_KEY_ID`,
   `NIXMAC_E2E_SINK_WRITER_APP_ID`, and
   `NIXMAC_E2E_SINK_WRITER_INSTALLATION_ID`, then add only
   `NIXMAC_E2E_SINK_WRITER_PRIVATE_KEY_B64` as the environment secret.

   Protect `main` with required pull requests, at least one approving
   CODEOWNER review, stale-review dismissal, conversation resolution, no force
   pushes or deletion, and the GitHub-Actions-owned `verify-sink-code` check.
   Protect `attestations` with linear history, enforced administrator rules, no
   force pushes or deletion, pushes restricted to the writer App, and the
   `verify-lifecycle-attestation` check pinned to that writer App ID. The writer
   has no bypass or push grant on `main`. Apply these rules only after the
   initial `main` seed and `attestations` bootstrap have both been read back.

   Give the host one sink-dispatch
   GitHub App identity with exactly Actions write and Contents read on that sink
   and no installation on `darkmatter/nixmac`. It may dispatch the verifier and
   confirm one persisted path, but it cannot mutate the sink. Store a different
   writer App with exactly Contents write and Checks write only in the sink's
   main-only protected environment. Record that writer App ID as
   `qualification.lifecycle.requiredStatusCheckAppId`; the consumer rejects a
   branch policy or check run from any other App.
   Use a third GitHub App identity with only Administration read on
   `darkmatter/nixmac` to check runner inventory.
   Provision a fourth, distinct lifecycle-consumer App on the sink with exactly
   Administration read, Checks read, and Contents read. Store its private key as
   the protected-environment secret
   `NIXMAC_E2E_LIFECYCLE_READER_PRIVATE_KEY`. Configure
   `NIXMAC_E2E_LIFECYCLE_STORE_URL` and
   `NIXMAC_E2E_LIFECYCLE_STORE_TOKEN` for the durable atomic-consumption service.
   Keep the host's fifth runner-provisioner App, with Administration write on
   `darkmatter/nixmac`, distinct from all of those identities. Create a sixth
   verdict-publisher App with exactly Checks write and Contents read on
   `darkmatter/nixmac`; only Centaur's protected secret store may hold its key.
   Pin the authoritative `Computer Use E2E` Check to that App ID and slug.
   Record all six App and installation IDs. Never place private keys in the VM
   image or repository, and never expose the verdict-publisher key to a host,
   guest, or Actions job.
   The checked-in contract remains disabled while an App or the durable store is
   absent; neither the workflow nor a test-only in-memory ledger is production storage.
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

### Implemented Cilicon substrate

The checked-in substrate for the sequence above is intentionally dormant while
the provider contract is `disabled`:

- `ops/images/nixmac-e2e-runner-tahoe.pkr.hcl` derives from the immutable
  digest produced by the existing Xcode image job. It installs the pinned
  CuaDriver 0.12.6 app, a dedicated `nixmac_e2e` user, required media tools,
  system-database app-bundle TCC grants, Homebrew login/launchd paths, completed
  Setup Assistant state, disabled screen lock, and the live boot qualifier. The
   image workflow runs the app-owned permission smoke on a first boot, scans
   before push, pulls by digest, waits fifteen minutes cold, and repeats the
   smoke on a second cold boot before moving the stable tag. Multi-day aging is
   an external scheduled qualification, not something this build claims to
   prove.
- `ops/runner/cilicon-e2e-cycle-wrapper.sh` holds one atomic lock per host,
  creates one canonical `/private/var/db` cycle directory and exact clone path,
  renders a digest-pinned Cilicon config, and refuses a second cycle until
  lifecycle attestation completes. A boot-persistent stale lock is reclaimed
  only when its recorded PID is not an owned live wrapper. On restart the
  wrapper resumes the one unambiguous cycle; any stale probe, failed resume, or
  multiple active directories quarantines the host.
- The immutable guest runs the baked qualifier before GitHub runner
  provisioning and writes `runtime-probe.json` to a narrow guest-writable
  exchange mount. Host state, Cilicon config, PID, logs, claimed requests, and
  signed lifecycle output remain outside that mount. The host
  validates those live app/TCC facts, adds the actual host/cycle/runner/image
  identity, signs `runtime-observation.json`, and only then lets the runner
  start. While idle, the guest reruns the live qualifier every fifteen minutes;
  the host signs each changed probe and the guest atomically installs the
  matching observation. Idleness never quarantines a healthy host, while a
  failed refresh blocks liveness and fails closed. A fresh `runner-busy.json`
  marker prevents image rotation from touching an executing job. An idle cycle
  whose image expires, whose deployed contract changes, or whose host has
   `/var/db/nixmac-e2e-drain` is terminated normally, its clone absence is proved
  twice, and it is archived as drained without creating a quarantine. Before
  termination, the runner-provisioner App atomically verifies that the exact
  runner is idle, deletes its registration, and proves it absent twice so no job
  can race the drain.
- The Mac job prepares its nonce-bound lifecycle request before testing, but
  does not signal teardown then. It first runs the test and uploads evidence,
  uploads the request for the independent ARC consumer, and publishes
  `attestation-request.json` into the host mount as its final step. This ordering
  prevents the host from destroying the VM before its durable request exists.
- Cilicon's `postRun` begins only after the Actions runner exits. It writes a
  cycle/runner-bound `runner-finished.json` marker and deliberately keeps the
  VM alive. A valid marker without a lifecycle request has a bounded
  fifteen-minute grace; after that the host fails closed instead of silently
  leaking capacity. Each VM boot also writes a unique generation marker, and a
  second generation under the same cycle identity is rejected.
  `ops/runner/cilicon-e2e-lifecycle-attestor.sh` then observes the
  exact runner absent twice before a root-built AppKit helper asks the exact
  Cilicon PID and exact config command to terminate normally. PID reuse or a
  mismatched command is quarantined and never killed. The liveness probe remains
  satisfied by the runner-finished marker while `postRun` blocks, preventing
  Cilicon from re-registering the runner during teardown. Normal termination
  triggers Cilicon's own clone cleanup;
  the host separately requires the exact clone namespace empty twice before it
  signs and dispatches an immutable `destroyed` payload. Timeout, forced
  containment, or ambiguity produces `quarantined`. Restart after a successful
  local write replays the byte-identical payload rather than resigning it.
- The GUI service account cannot write arbitrary `/var/db` paths. A narrowly
  sudo-authorized, root-owned `nixmac-e2e-mark-quarantine` helper accepts bounded
  JSON and can write only `/var/db/nixmac-e2e-quarantined`.
- The separate `darkmatter/nixmac-e2e-attestations` repository owns the
  workflow-dispatch receiver and signature verifier on protected `main`. A
  lifecycle identity maps to one immutable `lifecycle/<sha256>.json` path on the
  separate protected `attestations` data branch. Exact replay is idempotent;
  different bytes at the same path fail. Per-lifecycle concurrency permits
  unrelated attestations to progress independently. Each receiver creates a Git
  blob, tree, and commit without moving `attestations`, reads the exact bytes
  back, attaches `verify-lifecycle-attestation` from the dedicated writer App to
  that exact commit, and only then fast-forwards protected `attestations`. The
  host does not retire a cycle after the dispatch HTTP response: it polls the
  protected data branch for byte-identical content, redispatches replay-safely until confirmed, and
  uses bounded API retries so a transient fast-forward race cannot silently
  drop an attestation. The receiver also rebuilds and retries its compare-and-
  swap commit against a newer `attestations` head, so cross-path concurrency
  does not depend only on host redispatch. Non-404 lookup failures are fatal
  rather than treated as absence. Pull requests cannot add lifecycle files to
  the code branch and verify a bounded recent window from the data branch;
  daily scheduled and explicit manual audits verify all immutable history.
  Those audits use a separately authenticated checkout of the private data
  branch, require exactly one root and zero merge commits, and reject every
  post-bootstrap change that is not an added canonical lifecycle path.

Install a qualified dedicated host only after its contract contains real
image, key, App, sink, TCC, and capacity facts:

```bash
sudo bash ops/runner/install-cilicon-e2e-host.sh \
  --service-user <dedicated-aqua-user> \
  --runner-app-id <runner-provisioner-app-id> \
  --host-id <stable-host-id> \
  --contract <qualified-contract.json> \
  --attestor-key <host-ed25519-private-key.pem> \
  --runner-key <runner-provisioner-app.pem> \
  --inventory-key <inventory-read-app.pem> \
  --sink-key <sink-dispatch-app.pem> \
  --registry-username <classic-pat-owner> \
  --registry-token-file <temporary-root-owned-0600-token-file>
```

The installer verifies that the Ed25519 private key matches the contract,
requires three host-side RSA GitHub App keys, proves the digest-pinned GHCR image is
private, accepts its short-lived package-read token only from a root-owned
`0600` file, prewarms the service user's complete Tart OCI cache, and proves
that the immutable cached bundle is usable without credentials before starting
the first cycle. It checksum-pins Cilicon 2.4.2, compiles the exact-PID normal
termination helper with the Apple toolchain, installs capacity-one launchd
state with an absolute Node path and direct local image-cache root, gives
long-lived credentials only to the non-personal service user, bounds retained
cycle history and logs, and starts the LaunchAgent only inside that user's
logged-in Aqua session. Cilicon receives a local bundle path and never receives
registry credentials. Delete the caller-owned temporary token file immediately
after installation. Never copy host credentials into the Tart image.

Treat the one-host AWS run as qualification evidence, not a provider
commitment. Before choosing production capacity, record real quotes and compare
AWS EC2 Mac, MacStadium bare metal, an Orka-native backend, and GitHub-hosted
arm64 runners. GitHub-hosted runners remain useful for builds and cheap smoke
tests, but the authoritative Product Proof lane still requires a qualified
immutable image, persistent TCC identity, and independent destruction proof.
As a seed workload on 2026-07-27,
`origin/main` showed 99 PR-shaped commits over 30 days and a 90-day burst peak
of eight in one hour; replace that snapshot with Centaur arrival telemetry.

Size the dedicated pool in qualified execution slots, then convert slots to
hosts:

```text
required_slots =
  ceil(peak_jobs_per_hour * p95_cycle_minutes / 60 * 1.5)

dedicated_hosts =
  max(2, ceil(required_slots / qualified_slots_per_host) + 1)
```

The current Cilicon safety contract has
`qualified_slots_per_host = 1`. A future Orka backend may qualify up to two
VMs per node only after proving Computer Use timing and state isolation under
that concurrency.

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

After private shadow qualification, Centaur may publish exactly one terminal
message per durable job to `#nixmac-e2e`: merged SHA, PASS/FAIL/INFRA,
scenario count, duration, and the stable report link. GitHub Check remains the
authoritative verdict. Intermediate state, retries, and host-health chatter do
not go to Buzz.

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

## Cilicon Image and Host Rotation

Rotate the dedicated Cilicon fleet before the qualified image reaches seven
days:

1. Build, publish, and externally qualify the replacement digest. Do not update
   a host contract while its `runner-busy.json` marker is fresh.
1. Create root-owned `/var/db/nixmac-e2e-drain` on every host. Busy cycles finish
   their normal attested teardown; idle cycles terminate Cilicon normally,
   prove the exact clone namespace absent twice, and write
   `drained-cycle.json` without quarantining the host.
1. Wait until every host has no active cycle and the wrapper reports that drain
   admission is active. Verify the wrapper already deleted each exact idle
   runner registration with the runner-provisioner App and proved it absent
   twice; then remove the host-only `pending-drain-cleanup.json` marker. The
   wrapper will not register a replacement runner while that cleanup marker
   exists.
1. Install the newly qualified contract/image digest, prewarm its Tart cache,
   then remove the drain sentinel. The wrapper refuses stale image admission and
   starts one new cycle only after the replacement contract is valid.
1. Prove one full destroyed attempt per host before returning the pool to
   production traffic. A failed graceful drain or ambiguous clone absence is a
   quarantine, not an automatic bypass.

The same sequence rotates or replaces a cloud host. The fleet controller should
replace a quarantined host rather than treating manual SSH repair as normal
capacity management.

## Static Host Rotation

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

- rebuild and requalify the immutable runner image before its seven-day maximum
  age; a stale image fails admission rather than extending itself;
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
