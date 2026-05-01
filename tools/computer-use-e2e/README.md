# Computer Use Local E2E Spike

Local/remote harnesses for validating whether Codex Computer Use can drive the
real nixmac macOS app like a human QA tester.

The first-class lane now uses Codex app-server on a Mac that has GUI access to
nixmac. It drives the app through the `computer-use` MCP, records evidence
metadata, captures Computer Use screenshots, assembles a 30 fps evidence video
from those screenshots, and renders a standalone HTML report.

Computer Use is required for the actual app interaction and final report
inspection. Shell is used for setup, launch, backup/restore, artifact movement,
and HTML/video generation only.

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
node tools/computer-use-e2e/run-remote-cua.mjs run
```

The runner:

- captures screenshots from `get_app_state`, not Screen Sharing;
- omits image artifacts for sensitive API Keys and Console captures while
  retaining redacted accessibility text snapshots;
- drives visible UI through Computer Use clicks and settable accessibility
  fields;
- tests launch, Settings tabs, History, Console, Feedback, Report Issue,
  suggestion cards, real prompt submission, Review/Summary/Diff/Build boundary,
  guarded Step 3 commit/save, History restore cleanup, and guarded Discard
  boundary when reachable;
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
  snapshots, and optional video under `artifacts/computer-use-remote/<timestamp>/`.
- exits non-zero when the final report verdict is `fail` or `inconclusive`
  unless `NIXMAC_E2E_STRICT_VERDICT=false` is set. For PRs, keep the check
  non-blocking through branch protection rather than by forcing a green result.

Planned next coverage feature: the suite should stay fresh with `main`. That
means maintaining a scenario manifest for every major user-visible nixmac
surface/workflow on `main`, then reporting coverage drift when a surface has no
Computer Use scenario or explicit waiver. PR-specific focus is additive; it does
not replace the baseline `main` coverage check.

The coverage freshness manifest lives at:

```bash
tools/computer-use-e2e/coverage-manifest.json
```

The manifest is evaluated during report rendering and appears near the top of
the HTML report as Main Coverage Freshness.

## PR Workflow

`.github/workflows/computer-use-e2e.yml` triggers on every pull request and
`workflow_dispatch`. It is intentionally quiet: no PR comments, no Slack, and no
team-visible automation beyond the GitHub check and uploaded artifact.

The workflow serializes all runs through one DXU remote-machine concurrency
group. Do not make concurrency per PR while the suite depends on a singleton
interactive Mac, because overlapping runs can race on app state, launchd
environment, Authorization Services policy, and the Codex app-server port.

Required repository secrets for the real remote lane:

- `NIXMAC_E2E_REMOTE_HOST`
- `NIXMAC_E2E_REMOTE_USER`
- `NIXMAC_E2E_REMOTE_SSH_KEY`
- `NIXMAC_E2E_OPENROUTER_API_KEY`

The GitHub-hosted runner installs `ffmpeg` before running the suite. The report
renderer uses it both to assemble the evidence reel and to reject blank or
corrupt screenshot artifacts.

`NIXMAC_E2E_REMOTE_HOST` must be a resolvable FQDN or stable IP address, not
the Mac's local hostname. For the current DXU MacinCloud lane, use
`dxu97120.macincloud.com` or `38.79.97.120`; the machine identity is checked
separately by requiring the remote `LocalHostName` to be `DXU97120`. If the
target Mac changes, set repository variable `NIXMAC_E2E_REMOTE_LOCAL_HOSTNAME`
to the new expected local hostname.

Remote connectivity can be checked without running the full suite:

```bash
node tools/computer-use-e2e/check-remote.mjs \
  --host dxu97120.macincloud.com \
  --user admin \
  --key ~/.ssh/nixmac_e2e_ci \
  --expected-local-hostname DXU97120 \
  --check-codex-binary \
  --check-app-path /Applications/nixmac.app
```

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

If any required remote secret is missing, including the OpenRouter provider
key, the workflow still triggers and uploads an inconclusive HTML report
without touching app state.

## Usage

### Real Provider Lane

This is the first-class local lane. It uses the real app and the app's existing
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

To record bounded video when the nixmac window is visible:

```bash
node tools/computer-use-e2e/run-local.mjs start-video --seconds 300
# drive the app with Computer Use
node tools/computer-use-e2e/run-local.mjs stop-video
```

The video helper records the nixmac window region reported by Accessibility
using macOS `screencapture -v`, then validates the output dimensions with
`ffprobe` before attaching it to the report. Skip video for sensitive views such
as API Keys and Console if auth metadata could be visible.

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
which this spike observed being parsed as JSON by the Tauri build. Use the
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
primary artifact links, coverage gaps, PR-specific focus, screenshot proof cards,
optional video, human QA narrative, claims versus evidence, failures/open issues,
confirmation boundaries, and cleanup/restore status. Machine-readable
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

The adversarial runner requires `ffmpeg`, because one fixture generates a
blank screenshot to verify visual-proof quality checks.

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

The current adversarial suite covers twenty-one cases: API Keys blank render,
settings mismatch, provider credential failure, provider timeout, missing build
boundary, commit no-op, rollback no-op, activation admin-auth blockers, corrupt
artifacts, blank screenshots, PR report priority, main coverage drift,
zero-byte image/text evidence,
findings ordering, sensitive screenshot leakage, stale verdicts, missing report
inspection proof, unmapped PR-visible files, unavailable video, and missing
rollback proof.
