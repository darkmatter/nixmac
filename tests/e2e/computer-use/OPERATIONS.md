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
- Keep report publishing serialized separately from the DXU lane unless the
  `gh-pages` publisher adds explicit fetch/rebase/retry safety.

Track these locally or in the release issue before required-gate promotion:

- queued run count and p95 wait;
- p50/p95 remote runtime;
- no-touch unavailable count and recent cause;
- cleanup failures;
- host identity mismatch or app-server unavailable incidents.

## Bounded CuaDriver Smoke

For transport or harness triage against an existing artifact run directory:

```bash
node tests/e2e/computer-use/run-cua-driver.mjs smoke --run-dir <artifact-run-dir>
```

The bounded smoke must launch the exact app, reach Settings General, and render
the local report. Use the full scenario suite for product qualification.

## Centaur Merged-SHA Lane

`.github/workflows/computer-use-e2e-centaur.yml` is the post-merge production
entrypoint. Centaur owns scheduling, bounded retries, and terminal-result
consumption. The nixmac workflow owns exact-artifact verification, Mac
execution, cleanup, evidence sealing, private publication, and one terminal
contract.

The current backend is the static Mac transition lane:

- a successful push to `main` publishes `nixmac-macos-app-e2e` from
  `.github/workflows/build.yaml`;
- Centaur resolves the build run, artifact ID, and GitHub artifact digest for
  that exact merged SHA before dispatch;
- the workflow rejects artifacts not produced by a `main` push in this
  repository and does not create branches or request rebuilds;
- the Linux controller acquires the owner-token-bound MacinCloud lease before
  SSH, app staging, or CuaDriver work;
- cleanup and owner-matched lease release must succeed before evidence is
  sealed;
- production evidence is written to the private immutable evidence store;
- the terminal contract is always uploaded as
  `nixmac-computer-use-e2e-terminal-<job>-attempt-<n>`.

Required configuration:

- runner labels `arc` and `nixmac-e2e-static-controller`;
- a protected `nixmac-e2e-production` environment limited to the default
  branch;
- `NIXMAC_E2E_REMOTE_HOST`, `NIXMAC_E2E_REMOTE_USER`,
  `NIXMAC_E2E_REMOTE_SSH_KEY`, and `NIXMAC_E2E_REMOTE_KNOWN_HOSTS` secrets;
- `NIXMAC_E2E_STATIC_IMAGE_DIGEST` set to the independently qualified static
  host image digest;
- a protected `nixmac-e2e-evidence-writer` environment with the R2 endpoint,
  access key, secret key, and retention configuration consumed by
  `publish-private-evidence.mjs`.

`BUILD_UNAVAILABLE` is a terminal preflight result, not permission to rebuild
or substitute another artifact. Cancellation or runner loss without a
workflow-owned terminal artifact must be synthesized by Centaur from the
GitHub run/job API as `ABORTED`.

This transition lane serializes access through the host lease. A pooled
ephemeral Mac provider should be introduced in a separate provider-owned
change; it must preserve this artifact, evidence, cleanup, and terminal
contract rather than changing the coordinator protocol.

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
