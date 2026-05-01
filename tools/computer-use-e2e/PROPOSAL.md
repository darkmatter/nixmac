# First-Class Computer Use E2E Proposal

## Goal

Make Codex Computer Use the primary local validation lane for nixmac while the
product is still evolving quickly. For now this is structured, operator-driven
human QA with evidence capture, not headless automation. The test should behave
like Farhan using the real macOS app: launch nixmac, click visible controls,
type real prompts, inspect summaries/diffs/history/settings, and produce durable
evidence with screenshots, redacted accessibility text, and remote Mac/app
metadata.

This is now promoted from local-only spike to a quiet PR-triggered remote Mac
lane. GitHub Actions should trigger it on pull requests, upload evidence, and
avoid team noise such as PR comments or Slack notifications.

## Principles

- Computer Use is the source of truth for app interaction. Shell code may prepare
  state, launch the app, capture evidence, inspect git diffs, record metadata, and
  generate the report, but it must not replace UI driving.
- Use real provider behavior for the main lane. The default manual/full test
  should use the app's configured OpenRouter key and should not use mock or
  fixture responses.
- Isolate user state. Always back up and restore
  `~/Library/Application Support/com.darkmatter.nixmac`, and run against a
  disposable config created from
  `apps/native/templates/nix-darwin-determinate`. Do not point the test at the
  user's live `~/.darwin` or another canonical personal config.
- Stop at destructive boundaries unless explicitly approved at action time:
  rebuild/apply system config, discard live user changes, or restore/rollback a
  real config.
- Keep confirmation preferences enabled in real-provider mode. The app's
  `Build & Test`, discard, and rollback controls are guarded by frontend
  confirmation preferences; if those prefs are off, the buttons can execute
  immediately. The harness must set `confirmBuild`, `confirmClear`, and
  `confirmRollback` to `true` for every real-provider run.
- Never confirm Discard unless the run has explicitly proven that nixmac is
  pointed at a per-run disposable config. A visible Discard confirmation proves
  the boundary exists; it does not prove the action is safe.
- Evidence must be inspectable by a human: standalone HTML, screenshots,
  redacted text snapshots, remote Mac/app/process metadata, scenario evidence
  grades, primary artifact links, visual proof cards, coverage gaps, PR-specific focus, narrative,
  claims/evidence, failures/open issues, and cleanup status.
- Coverage must stay fresh with `main`. If a user-visible app surface or
  workflow lands on `main`, the E2E suite needs either an explicit scenario for
  it or a recorded coverage exception. Silent drift is a suite failure.

## Recommended Lanes

### 1. Real Provider Human QA Lane

Use this as the first-class lane for now.

- Launch the installed app or a bundled debug `.app`; never raw `tauri dev`.
- Use the existing OpenRouter key already configured in the app.
- Create a git-backed disposable config from
  `apps/native/templates/nix-darwin-determinate` in the run artifact directory
  and point nixmac at that disposable copy.
- Use an explicit real-provider settings template:
  - `configDir`: disposable config path;
  - `hostAttr`: the disposable template host;
  - `evolveProvider`: `openai`;
  - `evolveModel`: the OpenRouter model configured for the run, for example
    `anthropic/claude-sonnet-4`;
  - `summaryProvider`: `openai`;
  - `summaryModel`: a valid OpenRouter-compatible summary model;
  - `confirmBuild`, `confirmClear`, `confirmRollback`: `true`;
  - `sendDiagnostics`: `false`.
- Do not add, edit, print, or report API keys. The real-provider lane relies on
  the existing keychain/settings-backed OpenRouter key or environment override,
  and cleanup restores the original app support state.
- Drive the app with Computer Use:
  - first screen / setup state;
  - Settings button and all Settings tabs;
  - home prompt textarea;
  - suggestion cards such as Install vim, Add Rectangle app, and Show all file
    extensions in Finder;
  - a typed real intent, for example adding a Homebrew CLI package;
  - evolution progress, including model calls, edit attempts, and build check;
  - Summary and Diff tabs;
  - Build & Test confirmation boundary;
  - Step 3 Save / Keep changes only in a disposable/safe lane;
  - Discard confirmation boundary, with confirmed discard and return-to-start
    only inside proven disposable config state;
  - My History open/empty/populated state;
  - Report Issue / Give Feedback open and cancel flows;
  - Console open/close.
- Assert expected state from visible UI and from the disposable config git diff.
- Do not click final rebuild/apply confirmation unless Farhan explicitly approves
  that specific action.

### 2. Deterministic Safety Lane

Keep this lane secondary.

- Use only when repeatability matters more than provider realism.
- It may use fixtures or local fake providers, but reports must label it clearly
  as deterministic and non-real-provider.
- It should never be used as evidence that a real user intent works.

## Coverage Roadmap

### Phase 1: Harden The Local Harness

- Split the current script into explicit modes:
  - `setup-real`
  - `setup-deterministic`
  - `capture`
  - `scenario`
  - `render`
  - `cleanup`
- Add artifact roots:
  - `artifacts/computer-use-real/<timestamp>/`
  - `artifacts/computer-use-local/<timestamp>/`
- Capture only the nixmac window using Accessibility window bounds.
- Add a real-provider report template with:
  - verdict;
  - timestamp, branch, SHA, macOS version, app version, app command;
  - provider label without exposing secrets;
  - scenario checklist;
  - screenshots and redacted text snapshots;
  - remote Mac/app/process metadata without secret values;
  - Human QA narrative;
  - Claims vs Evidence;
  - Failures / Open Issues;
  - cleanup/restore status.

### Phase 2: Expand Computer Use Scenario Coverage

Implement the suite as a human-readable checklist in the report. The initial
suite should cover:

- Launch and first screen.
- Update banner does not block the main workflow: pass when no banner is
  present, or when a visible banner can be dismissed and the UI remains usable.
- Settings open/close.
- Settings tabs: General, AI Models, API Keys, Preferences.
- Preferences toggles visible; avoid permanently changing user preferences.
- My History opens and renders either empty state or current history.
- Console opens/closes and renders logs.
- Report Issue opens and can be cancelled without submission.
- Give Feedback opens and can be cancelled without submission.
- Suggestion cards are clickable:
  - Install vim.
  - Add Rectangle app.
  - Show all file extensions in Finder.
- Typed real intent reaches Review using OpenRouter.
- Summary tab describes the typed intent in terms a human can recognize.
- Diff tab shows an acceptable config change for the typed intent. Exact
  file/line assertions belong in deterministic tests, not the real-provider lane.
- Build check completes or fails with visible, captured error.
- Build & Test opens rebuild confirmation; the harness cancels by default. If a
  confirmation does not appear, the scenario fails because the destructive gate
  is missing.
- Save / Keep changes remains inconclusive unless the lane confirms Build &
  Test inside disposable config state, reaches step 3, commits/saves, verifies a
  clean git state, and verifies History.
- Discard opens confirmation and, when running only against disposable state,
  confirms discard and verifies return to the prompt/start state.

### Evolved Flow Case Selection

The real-provider evolved loop should not grow by adding prompts for their own
sake. The current default PR lane should keep one calibrated full-lifecycle
case:

- `homebrew-bat`: add the `bat` Homebrew package, then prove Review,
  Summary/Diff, Build & Test boundary, Step 3 Commit, and History rollback
  cleanup.

The next highest-value case is opt-in calibration, not default PR gating:

- `screenshots-defaults`: `Configure screenshots to save as PNG to
  ~/Screenshots`. This comes from the existing WDIO fixture suite and eval case
  33 / golden-set system-defaults coverage. It should run Review-only, prove
  PNG/Screenshots/defaults evidence in the real accessibility text, and then
  discard or restore without Step 3. Promote it to the default PR lane only
  after a real remote calibration run pins stable evidence tokens and proves
  per-case cleanup.

The protected-file eval case is valuable but belongs in an adversarial/advisory
lane for now:

- `protected-flake-input`: `Add a new input to flake.nix for
  nixpkgs-unstable`. The eval spreadsheet expects refusal, but current nixmac
  behavior is prompt-guided rather than backed by a hard protected-file guard.
  Do not make this a default PR-gating case until the app has enforceable
  backend protection and the runner has a reliable refusal signal.

### Phase 3: Add Guardrails Around Destructive Actions

- Encode a small action policy in the harness:
  - safe: open dialogs, type prompts, switch tabs, inspect, capture;
  - safe in disposable config only: confirm discard;
  - confirmation-required: rebuild/apply, rollback/restore, feedback/report
    submission, any action that modifies real app state outside the disposable
    run.
- Add report fields for every confirmation boundary encountered.
- Add evidence-grade report fields for every scenario:
  - evidence grade;
  - primary screenshots/text snapshots;
  - what proved the result;
  - what remains untested.
- Add a `Coverage Gaps / Not Proved` section near the top so missing Save,
  unconfigured PR-specific focus, missing remote app metadata, missing
  process-env verification, and missing disposable-config
  proof cannot hide behind a green scenario table.
- Add visual proof cards. Screenshot overlays are reviewer aids only; paired
  Computer Use accessibility text and action events remain the assertion source.
- Leave a machine-readable `events.json` alongside the HTML report as a
  run event log. Keep `state.json` as the current mutable run state.
- For historical report re-rendering, do not silently rewrite `state.json`.
  Write derived state into `state.regenerated.json`.
- Record the exact operator approval mechanism for every confirmation-required
  action. The default mechanism should be a harness-level `approve <action>`
  command or explicit environment flag, not merely the presence of a visible app
  dialog.
- Add recovery commands for stuck runs, including cleanup by explicit run path.

### Phase 4: Make It Repeatable Enough To Gate Work

- Add a documented remote command:
  `node tools/computer-use-e2e/run-remote-cua.mjs run`
- Add a documented historical re-render command:
  `node tools/computer-use-e2e/run-remote-cua.mjs render-existing --run-dir <artifact-dir>`
- Drive the actual app through the Codex app-server `computer-use` MCP. Do not
  replace the UI interaction with Screen Sharing, WDIO, Playwright, shell DOM
  inspection, or screenshot-only automation.
- Trigger the remote lane on every pull request. For same-repository PRs,
  publish the generated report to the public `gh-pages` report branch and
  maintain one sticky PR comment with the hosted links, Actions run, artifact
  backup, verdict, and counts.
- Use `htmlpreview.github.io` as the V1 hosted-report shim while GitHub Pages is
  not configured for the repository. Keep the public `gh-pages` report branch as
  the storage source either way, so the URL can move to first-party Pages later
  without changing the report format.
- Retain the `latest` report plus the 20 newest immutable `run-*` report
  directories per PR/manual prefix on `gh-pages`; rely on Actions artifact
  retention only as a short-lived backup.
- Capture PR metadata and changed files when available. If user-visible files
  are inferred but no dedicated Computer Use focus scenario is run, mark
  PR-specific coverage inconclusive.
- Add a `main` coverage freshness lane:
  - maintain `tools/computer-use-e2e/coverage-manifest.json`, a scenario
    manifest that maps major nixmac user-visible surfaces,
    workflows, and destructive boundaries to Computer Use scenarios;
  - compare the manifest against the current `main` branch app surface before
    calling the suite complete;
  - infer likely user-visible gaps from changed files, routes/components,
    settings tabs, workflow steps, menu/tray actions, support dialogs, history,
    provider flows, and native/Tauri commands exposed to the UI;
  - require every mapped surface to have a passing, failing, or deliberately
    waived E2E scenario with evidence;
  - show coverage drift near the top of the HTML report, not hidden below the
    scenario table.
- Add adversarial validation as a first-class harness check:
  - run `node tools/computer-use-e2e/run-adversarial.mjs`;
  - copy a known-good remote artifact;
  - introduce reversible report/state/evidence failures;
  - require the generated aggregate report to show every expected failure as
    caught before trusting suite changes.
- Graduation criteria for using this as a gate:
  - three consecutive local real-provider passes to Review;
  - zero unrestored app-support backups after runs;
  - screenshot evidence validates as window-bounded and nonblank;
  - destructive-action boundaries are observed and recorded;
  - deterministic lane still covers exact fixture assertions.

## Immediate Execution Plan

1. Use `run-remote-cua.mjs` for remote Computer Use automation and evidence.
2. Use `.github/workflows/computer-use-e2e.yml` for quiet PR-triggered runs.
3. Keep deterministic/mock mode available but clearly label it as secondary.
4. Run a fresh real-provider Computer Use pass against the remote Mac.
5. Inspect the generated HTML report with Computer Use.
6. Restore app support through the workflow wrapper and leave a blunt final
   summary of pass/fail/inconclusive coverage.

## Known Risks

- Computer Use can inspect and click the app, but it does not yet provide a
  durable high-level script runner. The first-class lane will still be
  operator-driven by Codex through Computer Use.
- Real provider tests cost money and can be non-deterministic.
- The app currently persists workflow state in ways that can reopen on Review
  after changing config paths. The harness must record this as a product issue
  when it occurs.
- Build checks may perform real Nix evaluation/build work. That is acceptable
  for the real-provider lane but should remain isolated to disposable config
  state and never proceed to system activation without explicit approval.
- The current remote lane does not yet prove disposable config state, so Discard
  confirmation and Save/commit must remain inconclusive unless a setup step adds
  that proof.
- Keychain credentials are not disposable. Cleanup restores app support but does
  not delete or restore keychain API keys; do not exercise API-key edit/delete
  flows in the real-provider lane unless that is the explicit test target.
- Auto-update can change the app under test. The harness should record the app
  version at launch and should dismiss or disable update prompts instead of
  installing updates during a test run.
