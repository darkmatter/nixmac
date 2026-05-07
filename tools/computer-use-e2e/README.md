# nixmac Product Proof Gate

Local and remote Product Proof harnesses for validating whether Codex Computer
Use can drive the real nixmac macOS app like a human QA tester.

The first-class lane now uses Codex app-server on a Mac that has GUI access to
nixmac. It drives the app through the `computer-use` MCP, records evidence
metadata, captures Computer Use screenshots and redacted text snapshots, records
remote Mac/app/process metadata, and renders a standalone HTML report.

Computer Use is required for the actual app interaction and final report
inspection. Shell is used for setup, launch, backup/restore, artifact movement,
metadata capture, and HTML generation only.

The product contract is reviewer evidence, not a narrow green CI run. A Product
Proof report must make uncertainty visible: missing proof, low-signal evidence,
stale coverage, expired waivers, remote-infra blockers, and provider failures
must fail or downgrade the run instead of being hidden behind a passing check.

## Remote Computer Use Lane

This is the PR-ready lane. Start Codex app-server on the target Mac and tunnel
it locally:

```bash
ssh -N -L 18790:127.0.0.1:18790 admin@REMOTE-MAC
```

Then run:

```bash
NIXMAC_COMPUTER_USE_WS=ws://127.0.0.1:18790 \
NIXMAC_COMPUTER_USE_APP=com.darkmatter.nixmac \
NIXMAC_E2E_REMOTE_SSH_DEST=admin@REMOTE-MAC \
NIXMAC_E2E_SSH_KEY=/path/to/key \
NIXMAC_E2E_SSH_KNOWN_HOSTS=/path/to/known_hosts \
node tools/computer-use-e2e/run-remote-cua.mjs run
```

Predicate and click-result guards can be checked without a remote Mac:

```bash
node tools/computer-use-e2e/run-remote-cua.mjs self-test
```

The runner:

- builds and publishes a per-run Storybook preview for PRs that touch frontend
  UI files, then links changed files to direct Storybook story URLs in the
  report so reviewers can inspect affected UI states before reading native
  evidence;
- captures screenshots from `get_app_state`, not Screen Sharing;
- captures API Keys screenshots only when raw accessibility text confirms no
  unmasked key-like secret is present; Console image artifacts are still
  omitted while retaining redacted accessibility text snapshots;
- compiles safe-to-store screenshots into `video/computer-use-evidence.mp4` and
  embeds that video near the top of the report for fast reviewer scanning;
- treats non-sensitive required screenshots as binding corroborating evidence:
  missing, corrupt, blank, occluded, or low-signal screenshot regions can fail
  the owning scenario and the final verdict;
- drives visible UI through Computer Use clicks and settable accessibility
  fields;
- treats explicit Computer Use click-tool failures as failed interactions
  instead of continuing from a stale snapshot;
- tests launch, Settings tabs, History, Console, Feedback, Report Issue,
  suggestion cards, real prompt submission, Review/Summary/Diff/Build boundary,
  guarded Step 3 commit/save, History restore cleanup, and guarded Discard
  boundary when reachable;
- conditionally saves visible untracked macOS customization and Homebrew item
  chips, commits them through Step 3, then restores the disposable baseline;
- requires Homebrew chip commits to touch a supported Homebrew source file
  (`modules/darwin/homebrew.nix` or `flake-modules/darwin.nix`) rather than only
  proving that some committed change occurred;
- keeps the default PR lane to one calibrated full-lifecycle evolved prompt
  (`homebrew-bat`) and exposes additional eval-derived evolved cases through
  `NIXMAC_E2E_EXTRA_EVOLVED_CASES` after calibration;
- confirms Build & Test only when `NIXMAC_E2E_DISPOSABLE_CONFIG=true`,
  `NIXMAC_E2E_ALLOW_BUILD_CONFIRM=true`, and a disposable baseline git commit
  has been prepared;
- when Build & Test is confirmed, reaches Step 3, commits the generated change,
  verifies the disposable repo HEAD changed with a clean worktree, then uses
  History restore to return the disposable config to baseline content;
- does not confirm Discard unless `NIXMAC_E2E_DISPOSABLE_CONFIG=true` and
  `NIXMAC_E2E_ALLOW_DISCARD_CONFIRM=true` are both set by a setup step that has
  proven the app is using a per-run disposable config;
- marks provider-blocked paths bluntly, for example OpenRouter billing/credits
  failures;
- renders coverage gaps, PR-specific focus, evidence grades, primary artifact
  links, and visual proof cards with screenshot callouts plus text excerpts;
- copies the generated report back to the remote Mac and uses Computer Use to
  inspect it in a browser when `NIXMAC_E2E_REMOTE_SSH_DEST` is set;
- writes `index.html`, `state.json`, `events.json`, screenshots, text
  snapshots, a screenshot-compilation video, and remote metadata under
  `artifacts/computer-use-remote/<timestamp>/`.
- exits non-zero when the final report verdict is `fail` or `inconclusive`
  unless `NIXMAC_E2E_STRICT_VERDICT=false` is set. For PRs, keep the check
  non-blocking through branch protection rather than by forcing a green result.

Direct Homebrew import is revalidated at apply time. The backend intersects the
UI-submitted diff with a fresh Homebrew/config scan and writes only items that
are still missing, using the current config source rather than trusting a stale
submitted source. Stale no-longer-missing items are silently dropped for this
phase; the existing post-apply refetch refreshes the chip state.

Planned next coverage feature: the suite should stay fresh with `main`. That
means maintaining a scenario manifest for every major user-visible nixmac
surface/workflow on `main`, then reporting coverage drift when a surface has no
Computer Use scenario or explicit waiver. PR-specific focus is additive; it does
not replace the baseline `main` coverage check.

The evidence layer remains inside this Product Proof lane and does not modify
core nixmac app code. Its durable contract is the runner-owned scenario catalog,
coverage manifest, derived `state.v2.scenarioContracts`, and rendered report
sections rather than a separate proposal doc.

The modularization and preservation contracts for this toolchain live in
`tools/computer-use-e2e/ARCHITECTURE.md`. Use that document as the review gate
before moving code out of `run-remote-cua.mjs`; module extraction should not
start until the preservation harness it describes exists and is green.

Run the preservation harness locally with:

```bash
node tools/computer-use-e2e/preservation-harness.mjs run
```

Summarize already-collected local evidence without touching GitHub, DXU, SSH, or
provider APIs with:

```bash
node tools/computer-use-e2e/summarize-runs.mjs \
  --root artifacts/computer-use-remote \
  --format markdown \
  --out artifacts/computer-use-summary/product-proof-summary.md
```

The summary CLI is a presentation and operator-review aid, not gate
satisfaction. It counts only nested `live-pr*/<timestamp>` workflow bundles
toward the real clean-run streak, labels copied render/adversarial fixtures as
non-gate evidence, redacts remote identity and prompts by default, and reports
relative artifact paths only. Required branch protection still depends on fresh
same-SHA workflow evidence and the promotion policy below.

Operational playbooks for host rotation, singleton capacity, evidence policy,
override lifecycle, and maintenance cadence live in `OPERATIONS.md`. This README
remains the policy contract; the operations runbook should link here rather than
forking policy text.

The scenario catalog lives in `scenario-catalog.mjs` so reviewers can inspect
scenario labels, proof metadata, assertion hints, and optional evolved cases
without reading the full runner. Adding a scenario usually means updating that
catalog, mapping user-visible source coverage in `coverage-manifest.json`, and
adding runner executor logic only when the scenario needs new Computer Use
actions. The runner self-test enforces that every catalog-referenced scenario
key is either a default scenario, an optional evolved-case scenario, or an
explicit adversarial-only fixture.

The coverage freshness manifest lives at:

```bash
tools/computer-use-e2e/coverage-manifest.json
```

The manifest is evaluated during report rendering and appears near the top of
the HTML report as Main Coverage Freshness.

## PR Workflow

`.github/workflows/computer-use-e2e.yml` triggers on every pull request and
`workflow_dispatch`. On same-repository pull requests, it publishes the generated
report to the `gh-pages` report branch and upserts one sticky PR comment with
the verdict, counts, public hosted `index.html`, Actions run, and artifact
backup. The workflow does not send Slack or other team
notifications.

For PRs that touch component/story files under `apps/native/src/components/**`,
the prepare job also builds Storybook, uploads the static preview, and publishes
it next to the Product Proof report under `storybook/`. The report's Storybook
Preview section maps changed UI files to direct `?path=/story/...` URLs when a
matching story exists, and the sticky PR comment includes compact Storybook
quick links for the changed files. When the changed-file set is UI-only and has
no native/runtime or unknown files, native Computer Use is skipped by policy and
Storybook becomes the required proof lane. Runtime/native or unknown file
changes still run native Computer Use. Missing stories fail only when the
planner can confidently identify a changed UI file with no inspectable nearby
story; helper/style advisory gaps are listed without creating noisy false-red
native gates.

The V1 public report URL uses `htmlpreview.github.io` to render the HTML stored
on the public `gh-pages` report branch. The repository Pages API currently
returns `404`, so first-party GitHub Pages hosting is not configured for this
repo. If Pages is enabled later, the report URL can move to the first-party
Pages URL without changing the runner output format.

The workflow keeps the `latest` report plus the 20 newest immutable `run-*`
directories for each PR/manual report prefix on `gh-pages`. GitHub Actions
artifact backups are retained separately for 14 days.

Immutable report links are not permanent archive links. Once a PR/manual prefix
has more than 20 `run-*` directories, older published runs are pruned from
`gh-pages`; use the Actions artifact backup during its retention window or copy
important evidence into a durable project artifact.

The workflow is split into prepare, remote, publish, and final-result jobs.
Prepare handles GitHub-hosted validation, PR metadata, stale/no-secret
no-touch reports, and PR-built app artifact packaging without holding the DXU
remote-machine lane. The remote job is still serialized through
`computer-use-e2e-dxu-remote`; do not make that concurrency per PR while the
suite depends on a singleton interactive Mac, because overlapping runs can race
on app state, launchd environment, Authorization Services policy, and the Codex
app-server port.

Before this becomes broad required branch protection, the operator policy must
skip stale non-tip commits after queueing so one noisy PR cannot burn the
singleton Mac for obsolete commits. The workflow checks for stale queued PR runs
during prepare and repeats the check at the start of the serialized remote job,
immediately before SSH/readiness, app staging, tunnel setup, app-driving, or
cleanup can touch the remote Mac.

Report publishing is a separate serialized lane,
`computer-use-e2e-gh-pages-publish`. Keep `gh-pages` publishing in that lane
unless the workflow grows an explicit fetch/rebase/retry equivalent, because the
publisher rewrites each PR prefix's `latest` pointer and prunes old `run-*`
directories.

If this workflow becomes a required check, branch protection should require the
workflow-level result or the `Computer Use E2E Result` job. Do not require only
`Remote Computer Use E2E`: stale, no-secret, and prepare setup-failure runs can
intentionally skip that job, and the final result job is the source of truth for
whether the split workflow should be green or red.

Local run summaries generated by `summarize-runs.mjs` are useful for watching
clean-run streaks and evidence volume over time, but they are intentionally not
authoritative gate state. They can include copied fixtures, old local validation
runs, or manually preserved reports; reviewers must use the classification field
before citing a run as release or branch-protection evidence.

## Productization Policy

The current Product Proof lane is advisory beta infrastructure: it should run on
same-repository pull requests, publish the report, and keep check results honest.
It should not be required branch protection until queue behavior, infra failure
rate, and waiver debt are boring enough to support that responsibility.

Phase progression:

- Advisory beta: every same-repository PR gets either a Product Proof report or
  an explicit no-touch inconclusive report. `fail` and `inconclusive` remain
  honest check results.
- Release gate: release cuts and high-risk app-facing PRs require a fresh
  Product Proof pass or a documented infra-only inconclusive override.
- Required PR gate: broad branch-protection adoption requires current-head
  adversarial replay, acceptable queue/runtime metrics, managed waivers with no
  expired reviews, and a tested override process for infra-only inconclusive
  runs.

Accountability roles:

- Product Proof owner: owns gate semantics, promotion policy, managed waivers,
  and report truthfulness. Resolve the current owner from this README until a
  dedicated operator runbook names a replacement; if unclear, the Release
  approver must name the Product Proof owner in the override record.
- DXU operator: owns remote Mac availability, expected host identity, pinned SSH
  host keys, Authorization Services policy mutation/restore behavior, remote
  cleanup, and host rotation. Default resolver: the teammate who owns the
  MacinCloud/DXU credentials for the run.
- Release approver: owns accepting or rejecting an infra-only override for a
  release cut or high-risk app-facing PR. Resolve the approver from the
  branch-protection bypass actor or required reviewer for that change, and record
  that person in the override record.
- PR author/reviewer: owns reading the Product Proof report and not treating
  no-touch or infra-inconclusive results as product proof.

Infra-inconclusive override is a human release policy, not a hidden CI bypass.
Do not make the workflow green when the report says `fail` or `inconclusive`.
For Phase B, the Release approver applies the override outside the workflow, for
example by admin/bypass merge after posting the override record. The workflow
check itself stays honest.

Store override records as PR comments with the fixed marker
`<!-- nixmac-product-proof-override -->` until a durable waiver store exists.
For release-cut overrides without a PR, store the same record in the release
tracking issue or release PR. An override record must include:

- owner and role;
- timestamp;
- PR or release identifier;
- affected commit SHA;
- Product Proof run URL;
- report URL or artifact URL;
- classification;
- evidence that the issue is remote-infra-only;
- why the result is not app/product risk;
- retry plan or follow-up issue;
- expiry or review-after date.

Template:

```markdown
<!-- nixmac-product-proof-override -->
- owner:
- role:
- timestamp:
- PR or release:
- affected commit:
- Product Proof run:
- report or artifact:
- classification:
- evidence:
- why not app/product risk:
- retry or follow-up:
- expires or review-after:
```

Allowed infra-only override classes:

- `missing-secrets`: repository or environment secrets are absent.
- `remote-unreachable`: DXU/MacinCloud cannot be reached before app state is
  touched.
- `remote-identity-mismatch`: host identity does not match the configured
  expected Mac.
- `provider-preflight-blocked`: provider health or billing blocks proof before
  the app path is tested.
- `operator-disabled`: the Product Proof owner or DXU operator intentionally
  disables the remote lane with a dated reason.

These no-touch classes may legitimately have no screenshots or video because
the workflow did not touch app state. That is different from a run that touched
the Mac and then failed to capture required evidence; missing required evidence
after app interaction is not an infra-only override.

Do not use the infra-only override path for app scenario failures, coverage
drift without an accepted waiver, provider failures after the product path is
under test, secret leak risk, cleanup failure touching persistent state, or
missing required screenshot/video evidence after touching app state.

`stale-queued-run` is a no-touch workflow auto-skip, not an infra-only override
class. First-attempt PR runs skip when the queued event head no longer matches
the current PR head, or when the PR closed/merged while queued. API uncertainty
does not skip. The superseding PR tip must get its own Product Proof run.

Operator-initiated reruns and `workflow_dispatch` runs on stale or non-tip
commits are triage evidence, not release-gate satisfaction. A successful stale
or triage run on an obsolete SHA does not satisfy required branch protection for
the current PR tip SHA.

Fork pull requests do not receive the secret-backed remote lane. The publish and
PR-comment steps are intentionally limited to same-repository PRs because the
workflow needs remote SSH credentials and provider credentials. If nixmac starts
accepting external fork PRs, fork/no-secret runs need a separate non-blocking
classification instead of sharing infra-inconclusive semantics. Fork/no-secret
classification is not an infra-only override.

Promotion checklist:

- Stay advisory beta until no-touch classes are structured, stale queued runs do
  not consume DXU time, override records are discoverable, and managed waivers
  are reviewed.
- Promote release/high-risk app-facing PR gate only after the team accepts the
  screenshot-reel evidence policy or continuous recording is implemented, and
  after the lane has enough consecutive current-head clean passes to trust
  retry/override behavior.
- Promote broad required PR gate only after singleton capacity, queue p95,
  cleanup reliability, owner coverage, host rotation, and infra-only override
  practice are measured and boring.

MacinCloud/DXU ownership is part of the product, not a workflow footnote. The
operator runbook must track the host, pinned SSH key material, host rotation
procedure, Authorization Services policy mutation/restore behavior, monthly cost,
and who owns restoring the lane when DXU is unreachable or reassigned.

Before touching remote app state, the workflow checks for the matching
successful `Build macOS App` run for the same commit, downloads the
`nixmac-macos-app` artifact, and stages that app bundle under a per-run `/tmp`
directory on DXU for the duration of the test.
That same-head build gate runs after the stale-run check and before remote
secrets, SSH preparation, DXU readiness, app staging, tunnel setup, or cleanup.
If no usable successful app artifact exists for the exact PR head SHA at the
gate, the workflow renders a build-gate unavailable report and fails before
remote setup; generic setup-failure reports are reserved for failures after this
gate passes.
The default gate is intentionally fast (`1` attempt) while this workflow is
serialized by the DXU remote concurrency group: a fresh PR push can therefore
produce a build-gate unavailable report before `build.yaml` finishes. Re-run the
workflow after the same-head build succeeds, or use workflow dispatch
`build_artifact_attempts` / repo variable `NIXMAC_E2E_BUILD_ARTIFACT_ATTEMPTS`
when the operator intentionally wants the gate to wait longer before remote
setup.
The build artifact must preserve hidden files because Tauri bundles resources
under dot-prefixed directories; stripping those files invalidates the app
signature and can leave LaunchServices wedged on a broken `/Applications`
bundle.
The workflow intentionally does not repair or replace the persistent DXU
`/Applications/nixmac.app` bundle.

Required repository secrets for the real remote lane:

- `NIXMAC_E2E_REMOTE_HOST`
- `NIXMAC_E2E_REMOTE_USER`
- `NIXMAC_E2E_REMOTE_SSH_KEY`
- `NIXMAC_E2E_REMOTE_KNOWN_HOSTS`
- `NIXMAC_E2E_OPENROUTER_API_KEY`

The GitHub-hosted runner installs `ffmpeg` before running the suite. The report
renderer uses it to reject blank or corrupt screenshot artifacts, run
deterministic signal checks on broad required screenshot regions, and generate
the screenshot-compilation evidence video.

`NIXMAC_E2E_REMOTE_HOST` must be a resolvable FQDN or stable IP address, not
the Mac's local hostname. For the current DXU MacinCloud lane, use
`dxu97120.macincloud.com` or `38.79.97.120`; the machine identity is checked
separately by requiring the remote `LocalHostName` to be `DXU97120`. If the
target Mac changes, set repository variable `NIXMAC_E2E_REMOTE_LOCAL_HOSTNAME`
to the new expected local hostname.

`NIXMAC_E2E_REMOTE_KNOWN_HOSTS` must contain the pinned SSH host key entry for
`NIXMAC_E2E_REMOTE_HOST`, for example from a trusted-network capture of:

```bash
ssh-keyscan dxu97120.macincloud.com
```

Optional evolved-case calibration:

```bash
NIXMAC_E2E_EXTRA_EVOLVED_CASES=screenshots-defaults,inline-question-font \
  node tools/computer-use-e2e/run-remote-cua.mjs run
```

The default PR lane intentionally runs only the calibrated `homebrew-bat` case
through Step 3 and rollback. The `screenshots-defaults` case comes from the WDIO
fixture suite and eval corpus case 33, but stays opt-in until its Review/Diff
accessibility-text evidence is calibrated on the real remote app. The
`inline-question-font` case targets the historical inline `ask_user`
deadlock/race class: it waits for the question UI, answers through
question-scoped controls, and requires progress past `Waiting for next event...`
into Review evidence. It stays opt-in until repeated DXU runs prove the provider
reliably takes the question path; if the provider reaches Review without asking,
the case is inconclusive, not a Product Proof failure. The
`protected-flake-input` eval case stays in the adversarial/advisory backlog until
nixmac has hard backend protected-file enforcement; the current app has
prompt-level guidance, not a reliable PR-gating refusal signal.

Do not generate known_hosts inside the workflow. The workflow sends provider
credentials and runs privileged cleanup on the remote Mac, so SSH host
authenticity must be checked before any remote secret is copied.

Remote connectivity can be checked without running the full suite:

```bash
node tools/computer-use-e2e/check-remote.mjs \
  --host dxu97120.macincloud.com \
  --user admin \
  --key ~/.ssh/nixmac_e2e_ci \
  --known-hosts ~/.ssh/known_hosts \
  --expected-local-hostname DXU97120 \
  --check-codex-binary \
  --json artifacts/computer-use-remote/readiness/remote-readiness.json
```

The readiness JSON is the operator-facing health artifact for DXU. Keep it in
the GitHub Actions artifact backup with the E2E evidence. Do not copy it into
the public `gh-pages` report as-is: it records readiness state rather than raw
secrets, but `host`, `user`, and remote identity fields are derived from
repository secrets and the remote Mac. Top-level fields are:

- `ok`: whether all readiness checks passed.
- `checkedAt`, `host`, `port`, `user`, and `expectedLocalHostname`.
- `checks`: ordered check results with `name`, `status`, and `message`.
- `passes` and `failures`: compact message lists for report summaries.
- `remoteIdentity`: hostname, local hostname, user, and macOS version when SSH
  identity collection succeeds.

If DXU is unavailable, do not treat local-only render checks or adversarial
replay as a live remote pass. Continue useful local work, but the CI lane should
render an unavailable Product Proof report with an `inconclusive` verdict and the
readiness failure summary when available. If no readiness JSON exists because a
non-readiness setup step failed, keep the generic setup-failure note and point
reviewers to workflow logs.

During the remote lane, the workflow also backs up the DXU macOS
Authorization Services policy for `system.privilege.admin`, temporarily writes
that policy to `allow`, and restores the original policy in cleanup. This is
what lets nixmac's real `osascript ... with administrator privileges`
activation path run unattended during the disposable E2E run. The SSH user must
therefore support `sudo -n security authorizationdb ...`. The workflow refuses
to start if the pre-run policy is not at the expected authenticated baseline,
and cleanup fails the check if the policy cannot be restored and read back.

The disposable remote config also disables
`security.pam.services.sudo_local.enable`. On DXU MacinCloud, the real
AppleScript activation path can otherwise hang inside nix-darwin while creating
`/etc/pam.d/sudo_local`. This is a CI-fixture adjustment only; the source
template remains unchanged. The coverage manifest records this as an explicit
waiver so reports do not silently imply the production sudo-local activation
path is covered.

The OpenRouter key is copied to a per-run remote `/tmp` file only long enough
to seed the GUI launchd environment. Start and cleanup both remove that file,
and cleanup fails the check if `OPENROUTER_API_KEY` remains in launchd after the
run. The report never prints the key value.

The remote fixture also overwrites provider/model settings in the backed-up app
support directory before launch so runs do not inherit stale DXU state:
`evolveProvider=openai`, `evolveModel=anthropic/claude-sonnet-4.6`,
`summaryProvider=openai`, and `summaryModel=openai/gpt-4o-mini`.

The PR-built macOS app artifact is also staged under a per-run `/tmp`
directory and launched from that exact staged `.app` bundle. The workflow
removes the staged bundle in cleanup and intentionally does not repair or
replace the persistent `/Applications/nixmac.app` installation on DXU.

If any required remote secret is missing, including the OpenRouter provider
key, the workflow still triggers and uploads an inconclusive HTML report
without touching app state.

## Usage

### Real Provider Lane

### Peekaboo Local Lane

This is the fast local comparison lane for development. It reuses the
`tests/e2e` Peekaboo runner and renders the result into the local Product Proof
evidence report. The bridge backs up nixmac Application Support before running
because the macOS scenarios intentionally seed settings for deterministic app
state.

```bash
node tools/computer-use-e2e/run-local.mjs run-peekaboo
```

By default this runs `tests/e2e/scenarios/macos_descriptor_prompt_smoke.sh`, a
non-destructive smoke scenario that launches the app, reaches the descriptor
prompt through accessibility metadata, types an intent, and verifies the
expected local provider-validation block. It writes:

- `artifacts/computer-use-local/<timestamp>/index.html`;
- `state.json` and `events.json`;
- `peekaboo-e2e.log`, `peekaboo-e2e-results.json`, stdout/stderr captures;
- `e2e-report/<scenario>/e2e-report.json`;
- Peekaboo screenshots under `screenshots/`;
- `video/peekaboo-e2e.mp4` when recording is enabled and ffmpeg/Terminal screen
  recording are available.

Useful variants:

```bash
node tools/computer-use-e2e/run-local.mjs run-peekaboo macos_descriptor_prompt_smoke --no-record
node tools/computer-use-e2e/run-local.mjs run-peekaboo macos_core_product_proof --no-record
node tools/computer-use-e2e/run-local.mjs run-peekaboo macos_provider_evolve_full_smoke --no-record
node tools/computer-use-e2e/run-local.mjs run-peekaboo-suite --no-record
NIXMAC_APP_PATH=/path/to/nixmac.app node tools/computer-use-e2e/run-local.mjs run-peekaboo
```

Use a debug/dev nixmac build for the mocked-system flag, solid-capture window,
WebView load watchdog, and opt-in opaque-window debug flag; release builds ignore
those Rust debug-only gates and will take the slower real system-check path.

Developers can run the same Peekaboo suite on a MacInCloud host from their own
machine when the host already has this checkout, Peekaboo, TCC permissions, and
a runnable nixmac app:

```bash
node tools/computer-use-e2e/run-local.mjs run-peekaboo-macincloud \
  --ssh-dest admin@dxu97120.macincloud.com \
  --identity-file ~/.ssh/nixmac_e2e_ci \
  --repo-dir /Users/admin/nixmac-peekaboo-local-e2e \
  --app-path /Users/admin/nixmac-e2e-current.app \
  --no-record \
  --allow-cleanup
```

For a focused remote scenario, add `--scenario macos_core_product_proof`.
Equivalent environment variables are `NIXMAC_E2E_MACINCLOUD_SSH_DEST`,
`NIXMAC_E2E_MACINCLOUD_SSH_KEY`, `NIXMAC_E2E_MACINCLOUD_REPO_DIR`, and
`NIXMAC_E2E_MACINCLOUD_APP_PATH`. Omitting `--scenario` runs the full suite;
running `run-peekaboo-suite` directly executes on the developer's current Mac.

`macos_core_product_proof` expands the local lane beyond the descriptor smoke:
it covers launch, settings tabs, API-key redaction, history, console text,
feedback/report surfaces, typed intent, provider-validation guardrails, and
artifact-quality checks. `macos_provider_evolve_full_smoke` covers the
provider-backed Review, Build & Test, Save, and History restore path against a
local OpenAI-compatible HTTP stub. The suite command runs both, writes a
Peekaboo-specific coverage map, and keeps those `peekaboo*` results separate
from the shared Computer Use scenario keys unless a lane satisfies the same
evidence contract.

The historical `nix-install` scenario is intentionally not the default. It can
uninstall/reinstall system Nix and should only run on a disposable runner:

```bash
node tools/computer-use-e2e/run-local.mjs run-peekaboo nix-install --allow-destructive
```

The bridge fails fast before GUI driving if Peekaboo, jq, `/Applications/nixmac.app`,
or required TCC permissions are missing. On DXU, grant Screen Recording and
Accessibility through the remote console before expecting a full run to pass.
Each Peekaboo run also clears stale launchctl E2E flags and removes leftover
`nixmac-e2e-system-mock-bin` PATH segments before preflight so a killed prior
run cannot keep the mock activation shim alive for the next login-session app.
If a run is killed hard and you want to recover the session manually, run:

```bash
launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM
launchctl unsetenv NIXMAC_E2E_SOLID_CAPTURE
launchctl unsetenv NIXMAC_E2E_OPAQUE_WINDOW
launchctl unsetenv NIXMAC_E2E_WEBVIEW_WATCHDOG
launchctl unsetenv NIXMAC_RECORD_COMPLETIONS
launchctl unsetenv NIXMAC_COMPLETION_LOG_DIR
launchctl unsetenv OPENAI_API_KEY
launchctl unsetenv OPENROUTER_API_KEY
launchctl unsetenv VLLM_API_KEY
launchctl unsetenv ANTHROPIC_API_KEY
launchctl getenv PATH | tr ':' '\n' | grep -v nixmac-e2e-system-mock-bin | paste -sd ':' -
```

If the final command prints a cleaned PATH, apply it with
`launchctl setenv PATH "<cleaned-path>"`; if it prints nothing, use
`launchctl unsetenv PATH`.

MacInCloud operator notes:

- Keep an active Screen Sharing session attached for the duration of the run.
  Without an attached display session, WebKit can remain accessible to AX while
  screenshots capture as black or white; the `screenshot-signal.json` gate will
  fail those runs instead of accepting hollow visual proof.
- Allow the nixmac Documents-folder consent prompt once on the host when it
  appears.
- The Peekaboo scenarios use `NIXMAC_E2E_SOLID_CAPTURE=1` by default so the
  debug app keeps nixmac's normal overlay-titlebar UI while giving MacInCloud a
  solid dark WebView backing instead of a transparent window that can show host
  apps underneath.
- The Peekaboo scenarios keep the E2E WebView load watchdog enabled by default
  through `NIXMAC_E2E_WEBVIEW_WATCHDOG=1`; stalled initial WebView loads request
  one reload and are logged into the scenario diagnostics.
- `NIXMAC_E2E_OPAQUE_WINDOW=1` is an opt-in debug escape hatch for remote
  capture investigation. It uses an opaque, visible-titlebar window and forces a
  dark WebView backing color so screenshots stay visually close to nixmac's
  black app chrome instead of showing WebView/macOS light gray through
  translucent app surfaces. Default Product Proof runs clear stale opaque-mode
  launch state and uses solid capture instead.

The remote Codex app-server lane remains the PR/Product Proof production lane.
The Peekaboo lane is isolated local evidence so the team can compare driver
approaches without changing the remote workflow contract.

### Real Provider Local Lane

This lane uses the real app and the app's existing
OpenRouter-compatible credential, but points nixmac at a disposable config
created from `apps/native/templates/nix-darwin-determinate`.

```bash
node tools/computer-use-e2e/run-local.mjs setup-real
open -n /Applications/nixmac.app
```

The setup command:

- quits any running `com.darkmatter.nixmac` instance before touching state;
- backs up `~/Library/Application Support/com.darkmatter.nixmac` outside the repo
  under `~/Library/Caches/com.darkmatter.nixmac/computer-use-real-backups/`;
- keeps the app's credential storage intact;
- creates a disposable git-backed nix config from the same template WDIO uses;
- writes settings pointing at that disposable config;
- forces `confirmBuild`, `confirmClear`, and `confirmRollback` to `true` so
  destructive UI actions show confirmation boundaries.

Use Computer Use to interact with the app. Shell helpers may capture evidence
and inspect the disposable git diff, but must not replace UI interaction.

### Deterministic Lane

From the repo root:

```bash
node tools/computer-use-e2e/run-local.mjs setup-deterministic
```

The setup command:

- quits any running `com.darkmatter.nixmac` instance before touching state;
- backs up `~/Library/Application Support/com.darkmatter.nixmac` outside the repo
  under `~/Library/Caches/com.darkmatter.nixmac/computer-use-e2e-backups/`;
- creates a clean disposable app support directory;
- creates a disposable git-backed nix config from the same template WDIO uses;
- starts a local OpenAI-compatible mock provider seeded from
  `apps/native/e2e-tauri/tests/data/add-font.jsonl`;
- writes nixmac settings pointing at the disposable config and mock provider.

Then build and launch the real app as a debug `.app` bundle:

```bash
cd apps/native
VITE_NIXMAC_SKIP_PERMISSIONS=true ./node_modules/.bin/tauri build \
  --debug \
  --bundles app \
  --no-sign \
  --config src-tauri/tauri.conf.dev.json
open -n ../../target/debug/bundle/macos/nixmac.app
```

The package script `bun -F native desktop:dev` currently sets `TAURI_CONFIG=dev`,
which this work observed being parsed as JSON by the Tauri build. Use the
explicit `--config` form until that script is fixed.

The raw `tauri dev` launch path is also not currently usable with Codex
Computer Use: it launches `target/debug/nixmac` directly, and macOS
Accessibility reports that running process without a live bundle identifier.
Computer Use times out against that raw process. Launching the bundled debug
app makes `com.darkmatter.nixmac` visible to Computer Use and exposes the
window tree.

Use Codex Computer Use to drive the app. After each major visible step, capture
evidence:

```bash
node tools/computer-use-e2e/run-local.mjs capture "01-launch" \
  --note "Computer Use observed the first screen and prompt input."

node tools/computer-use-e2e/run-local.mjs scenario launch pass \
  --note "App launched and first screen was usable."
```

If you use a different launch command, update the report metadata:

```bash
node tools/computer-use-e2e/run-local.mjs app-command "..."
```

When done:

```bash
node tools/computer-use-e2e/run-local.mjs render
node tools/computer-use-e2e/run-local.mjs cleanup
```

Cleanup restores the original app support directory from the full off-repo
backup, then removes that backup. If no support directory existed before setup,
cleanup removes the disposable one. You can clean up an explicit stuck run with:

```bash
NIXMAC_COMPUTER_USE_RUN_DIR=/path/to/run \
  node tools/computer-use-e2e/run-local.mjs cleanup
```

## Report Contents

The report opens with PR focus when PR metadata is present, then a findings-first
triage section: failures first, inconclusive checks second, and passing checks
collapsed last. It also includes verdict, timestamp, branch, SHA, macOS version,
mode, app command, provider label, grouped scenario checklist, evidence grades,
binding visual assertion results, primary artifact links, coverage gaps,
PR-specific focus, screenshot proof cards, remote Mac/app/process metadata,
human QA narrative, claims versus evidence, failures/open issues, confirmation
boundaries, and cleanup/restore status. Machine-readable
`state.json` and `events.json` files sit next to the report.

Once the coverage freshness feature is implemented, the report should also show
baseline `main` coverage drift near the top: unmapped user-visible surfaces,
scenario waivers, and any PR-specific additions that need focused visual proof.

For historical report re-rendering, use:

```bash
node tools/computer-use-e2e/run-remote-cua.mjs render-existing \
  --run-dir artifacts/computer-use-remote/<timestamp>
```

This writes a derived `state.regenerated.json` and updates `index.html` without
silently rewriting the original `state.json`.

Generated reports are ignored by git.

## Adversarial Validation

Use the adversarial runner to test the E2E/reporting suite itself:

```bash
node tools/computer-use-e2e/run-adversarial.mjs
```

The adversarial runner requires `ffmpeg`, because fixtures generate blank
screenshots and re-run deterministic screenshot signal checks.

It copies the newest local `artifacts/computer-use-remote/<timestamp>` baseline
that contains `state.json`, introduces reversible fixture failures, then
re-renders each case through `run-remote-cua.mjs render-existing`. On a clean
checkout, first run or download a baseline report, or pass one explicitly:

```bash
node tools/computer-use-e2e/run-adversarial.mjs \
  --base-run artifacts/computer-use-remote/<timestamp>
```

The aggregate report lands under:

```bash
artifacts/computer-use-adversarial/<timestamp>/index.html
```

The current adversarial suite covers twenty-eight cases: API Keys blank render,
settings mismatch, provider credential failure, provider timeout, missing build
boundary, commit no-op, rollback no-op, activation admin-auth blockers, corrupt
artifacts, blank screenshots that fail owning scenarios, PR report priority,
main coverage drift, zero-byte image/text evidence,
findings ordering, sensitive screenshot leakage, stale verdicts, missing report
inspection proof, unmapped PR-visible files, missing remote metadata, and
missing rollback proof, plus V2 evidence-strength, failure-taxonomy,
accessibility-risk, annotation-geometry, visual assertion calibration, and
secret-masking violations.
