# nixmac Computer Use E2E revival plan

Date: 2026-07-23

## Approval-ready summary

### Requested outcome

Restore a current, trustworthy nixmac Computer Use E2E result on a real macOS host. Completion requires a working HTML report whose screenshots and video are intelligible, chronologically accurate evidence of the exact nixmac app build being exercised. Both Codex and Claude must independently inspect the implementation and the resulting evidence.

### Approach

Use the existing Product Proof architecture on `origin/main` as the baseline and repair only failures observed in a fresh run. Keep the workflow manual and quiet while it is being requalified. Preserve a clean boundary between:

1. the vision-capable real-Mac runner that drives nixmac and creates evidence; and
1. Cooper's Buzz/GLM layer, which should poll, select work, and consume a text/JSON verdict without receiving screenshots or being asked to perform vision.

Do not replace the established runner with a speculative CuaDriver adapter before the current evidence path has been measured. If the current path cannot satisfy the acceptance contract, introduce the smallest isolated driver adapter or handoff needed, behind the existing report contract.

### Primary risk

A workflow can be green while proving the wrong thing: a stale build, fixture report, setup-failure page, unrelated screenshots, or an MP4 assembled from the same still screenshots. The acceptance gate therefore evaluates the downloaded artifact itself, not only the GitHub Actions conclusion. The qualifying video must be a continuous recording of the remote macOS GUI session; the current screenshot-compilation MP4 may remain as a secondary reviewer aid but does not satisfy the video gate.

### Validation

- exact-head macOS `.app` artifact
- real remote macOS launch and UI interaction
- passing machine-readable run state
- standalone HTML report opens and correctly references its evidence
- screenshots visibly show the real nixmac app and the claimed states
- a continuous remote-Mac screen recording decodes, is legible, and visibly preserves the tested state transitions
- artifact metadata binds run, build SHA, app bundle, scenarios, screenshots, and video
- Codex visual inspection followed by an independent Claude implementation/evidence review

### Not in scope

- re-enabling automatic PR triggers
- posting to Buzz or commenting on GitHub PRs during requalification
- rewriting the Product Proof framework
- merging the Buzz Tester, Seer, and vision driver into one agent
- claiming the Buzz/CuaDriver evaluation lane is production-ready without a real CuaDriver run

### Approval status

Pre-approved by Farhan's instruction to plan, run Claude review, execute, and run a second Claude review autonomously.

### First Claude review disposition

Claude/Fable reviewed this plan once at `xhigh` effort. Codex accepted all five findings and revised the plan: require continuous remote-Mac video instead of the existing screenshot reel; make patched-ref build/dispatch/cleanup explicit; bound remote attempts; mine existing logs before dispatch; and bind acceptance to the run's resolved SHA. No plan-review blockers remain after those changes.

## Evidence and intent

- `origin/main` is `e0e2ec67916ec1ebaae4deabb7f46f151bfc879c`.
- Build macOS App run `30058805193` succeeded for that exact SHA and produced the expected build lane.
- `.github/workflows/computer-use-e2e.yml` is manual-only. Manual runs upload evidence artifacts but neither publish to `gh-pages` nor comment on a PR.
- The current public runner uses Codex app-server Computer Use against a remote real Mac and already defines a report/state/screenshot/video contract.
- The July 22 nixmac sync described the desired end state as an agent that understands the change, runs the actual app on a rented Mac, tests the affected behavior, and returns video evidence.
- In Buzz, Cooper explicitly directed the experiment to use CuaDriver. The remote GUI daemon and permissions were eventually verified, but Tester/Seer failed when screenshots were routed to `glm-5.2-fp8`, which is not multimodal. Cooper's architectural correction was to give vision work to a dedicated vision-capable agent/model.

## Execution plan

### 1. Freeze a clean baseline

- Create a fresh worktree from the fetched `origin/main`; do not touch unrelated changes in the primary worktree.
- Record exact SHA, working-tree status, workflow configuration, available Actions secrets by name, and exact-head Build macOS App run/artifact metadata.
- Run the current syntax, workflow-contract, report, preservation, adversarial, and visual-proof self-tests named by the workflow and `tests/e2e/computer-use/README.md`.
- Read the most recent failing and successful workflow logs before spending a remote run. Treat them as diagnostic context only because they ran older workflow revisions.

Exit gate: the local harness is either clean or has a concrete, reproducible failure before any remote mutation.

### 2. Establish a current unchanged baseline

- Run the exact workflow-contract and prepare checks locally first. If a deterministic pre-remote failure is reproduced against the frozen `main` workflow, use that current local result plus the matching historical workflow logs as the unchanged baseline; do not spend a rented-Mac attempt on a workflow that cannot reach the remote job.
- Otherwise, dispatch `Computer Use E2E` manually on the `main` ref with no PR association. Record the run's resolved head SHA; if it moved from the frozen baseline, re-freeze the local baseline and verify that an exact-head successful build artifact exists before evaluating the run.
- Monitor prepare, remote, cleanup, artifact upload, and final-result jobs.
- Download the `computer-use-e2e-report` artifact even if the run fails. If an early failure prevents report creation, retain the job logs and classify from those instead of assuming an artifact exists.
- Classify the result as:
  - harness/application failure;
  - remote/DXU infrastructure failure;
  - build/artifact binding failure; or
  - valid passing evidence.

Exit gate: a concrete current-state baseline exists. Historical May/July artifacts and preservation fixtures do not count.

### 3. Repair only observed blockers

- Patch the smallest responsible surface in the isolated worktree.
- Keep driver behavior behind `tests/e2e/computer-use/drivers/`; do not grow future-driver behavior inside `transport.mjs`.
- Preserve cleanup, authenticated-admin restoration, exact-build binding, and failure-report behavior.
- Add or tighten a regression test before changing behavior.
- Do not change app product code unless the real run proves the app itself is the blocker.
- Replace the screenshot-only video gate with a true continuous recording of the remote GUI session. Start recording before the first app interaction, stop it after the last interaction but before cleanup, preserve the original MP4 in the report artifact, and record capture method, start/end times, duration, and run binding. Keep the screenshot reel clearly labeled as a secondary derived aid.
- If a patched workflow must run remotely, use one narrowly named temporary remote branch/ref only when local and static checks are green:
  - push with an explicit authenticated GitHub URL override without changing the intentionally disabled configured push URL;
  - manually dispatch `Build macOS App` on that ref and wait for a successful `nixmac-macos-app` artifact at the exact resolved SHA;
  - only then dispatch `Computer Use E2E` on the same ref and SHA;
  - remove the temporary remote ref after the qualifying evidence and final review are preserved.
    Do not open a PR, post comments, or enable automatic triggers.

Exit gate: local tests pass and the observed root cause is covered by a regression check.

### 4. Run a bounded qualification loop

Allow at most three real-Mac qualification attempts total. A deterministic local pre-remote failure does not consume a rented-Mac attempt; the first patched dispatch is attempt one. Do not repeat an identical external-infrastructure failure without a new reason to expect success. If the host, SSH/auth, remote Codex installation, screen-recording permission, provider credit, or another external dependency remains unavailable after the bounded attempts, stop in an explicit `blocked-on-external-infrastructure` state and hand back the exact failing step, logs, readiness evidence, cleanup result, and smallest required operator action. Never convert that state into a passing or infra-waived acceptance result.

Post-execution deviation (2026-07-24): the first three attempts each exposed a
different deterministic harness/runtime defect and none repeated an unchanged
external-infrastructure failure. Attempt three reached the real app and
Computer Use, then proved that bundle-ID targeting was ambiguous because DXU
retains several diagnostic copies of nixmac. Farhan's standing terminal
condition is to continue until the acceptance contract is actually met.
Therefore allow exactly one additional qualification attempt after adding a
regression contract that binds every Computer Use call to the per-run staged
`.app` path. This is a one-attempt exception, not an open retry loop; a further
material defect returns to explicit adjudication rather than another dispatch.

Second post-execution deviation (2026-07-24): the one-attempt exception reached
the exact staged app and produced a valid continuous recording, but it exposed a
product-level targeting defect: nixmac created its always-on-top 300x80 Preview
indicator as visible at startup, so app-scoped Computer Use selected that
auxiliary window instead of the main window. The same artifact also proved three
evidence-truthfulness defects: Computer Use JPEG bytes were stored under `.png`
names, Linux media verification inherited an incompatible Nix
`LD_LIBRARY_PATH`, and report inspection accepted a background Safari tab title
while the active document was blank. The coverage gate independently found a
manifest that had drifted since the June frontend/backend restructure.

These are distinct, now-reproduced implementation defects, not an unchanged
remote retry. The repair therefore starts the Preview indicator hidden, binds
image filenames and dimensions to actual bytes/media type, sanitizes media-tool
environment, requires active report-body evidence, and makes current-tree
coverage classification a self-test. One final exact-head build and real-Mac
qualification run is required because none of those visual/evidence properties
can be honestly accepted from the failed artifact. No further retry is
implicitly authorized: another material result must be adjudicated against the
acceptance contract before any new dispatch.

Third post-execution deviation (2026-07-24): the exact-head run at
`5f1cc1862` selected the correct staged main window and produced truthful JPEG
screenshots plus a valid continuous recording, but the main WebView stayed
blank and Safari timed out during report inspection. The downloaded recording
and remote unified logs adjudicated both symptoms as the same host-level
failure: nixmac and Safari successfully loaded their resources while
`com.apple.WebKit.GPU` became unresponsive and was terminated roughly every 15
seconds. The dedicated Mac had 22 days of uptime, 16 stale terminal sessions,
old Safari tabs, and persistent TCC dialogs. This is neither the repaired
Preview targeting defect nor an unchanged blind retry. Before one additional
qualification run, reset the dedicated host, verify its GUI/WebKit health, kill
stale Safari/WebKit helper processes in preflight, fail fast if the staged
nixmac launch logs another GPU-process hang, and replace AppleScript report
opening with a loopback HTTP server plus `open -a Safari`. This is the final
infrastructure-remediated attempt; the same failure after a clean host reset is
`blocked-on-external-infrastructure`.

Fourth post-execution deviation (2026-07-24): the clean-host exact-head run at
`3540a60b` proved the WebKit reset and fast-failure guard worked, launched the
correct staged signed app, and captured a valid continuous recording. That
recording exposed two new evidence blockers which app-scoped screenshots could
not reveal. First, macOS displayed a Documents-folder consent alert because
DXU's stored grant was tied to an obsolete app cdhash; the alert blocked the
real app throughout the run. The grant was repaired once through the real GUI
and is now stored against nixmac's Developer ID requirement, so future exact
signed builds can match it. Second, Safari reused the fixed loopback
`/index.html` URL and displayed a cached report from `5f1cc1862`; the runner
incorrectly accepted generic report-body markers without checking provenance.
The report artifact itself was current, but the browser-inspection claim was
false. Before requalification, give each report a run/head-specific browser
entrypoint and require the visible report body to contain the expected workflow
run ID and head SHA. This is an evidence-integrity repair after a distinct
host-consent failure, not a repetition of the prior WebKit failure. A new
exact-head build and real-Mac run remain mandatory; neither the manually
repaired host nor the uninspected current artifact can satisfy acceptance.

Fifth post-execution deviation (2026-07-24): the provenance-fixed exact-head
run at `eef225632` launched the correct signed app, passed remote readiness,
and produced a valid 36.5-second continuous recording plus a current-run
Safari inspection. It exposed two distinct harness-state defects. The workflow
still seeded legacy `settings.json`, while the current app reads
`global-preferences.json` and gates the product surface on the separate
`onboarding-state.json` completion latch; consequently the suite observed
onboarding step 3 instead of the configured product UI. The browser inspection
also ran before the wrapper attached the continuous recording, so its otherwise
current screenshot truthfully said the recording was unavailable even though
the final artifact later contained it. Before requalification, seed the typed
preferences and completed onboarding slices inside the already backed-up app
support directory, and add a post-attachment Computer Use inspection that
requires the visible report to show the current run/head and an available
continuous recording. Replace the earlier report-inspection screenshot so the
artifact cannot contain contradictory pre-attachment evidence. A stale
host-owned encrypted-volume dialog seen in the continuous recording must also
be dismissed before the staged app launches. These are current-schema and
evidence-sequencing repairs, not waivers of the real-app gate. A targeted
signed-app smoke then confirmed the typed fixture reaches the real product UI
and exposed a product navigation defect: when a clean config needs a rebuild,
the stepper presents an enabled "Go to Describe" control but the current-step
router ignores its override. Fix that truthful-control bug and have the runner
use the control to normalize a saved-update Review state back to the prompt
before starting the calibrated scenario.

Sixth post-execution deviation (2026-07-24): exact-head build
`30086340441` succeeded for `c0516af22`, and Computer Use run
`30087070174` proved the typed fixture and saved-update navigation fix on the
real signed app. The run then failed because the signed-out Give Feedback path
rendered an in-app "Sign in to send feedback" gate with an `OK` button, while
the generic runner cancellation matcher selected the macOS window's `close button` instead. The failed click left the modal over the app, making Report
Issue, suggestion cards, and the prompt unreachable and causing a cascade of
harness failures. The continuous recording and recording-aware final report
inspection both succeeded, making the root cause directly inspectable. Replace
the broad close matcher with an in-app dialog dismissal helper that prioritizes
`OK`, uses anchored button roles so it cannot select the system window control,
and verifies that the modal is absent before downstream scenarios continue.
Cover the signed-out feedback gate and window-close collision in the runner
self-test, then repeat the exact-head build and real-Mac qualification.

Seventh post-execution deviation (2026-07-24): the modal repair worked in
exact-head run `30088633253`: Computer Use selected the in-app `OK` control for
both signed-out feedback gates and returned to the prompt. The run then exposed
a managed-edit timing defect in the harness. Homebrew "Add to config" removed
the untracked badge and moved the prompt into a processing-only state, but the
runner allowed only 30 seconds for the provider-backed summary before treating
the edit as failed and restoring the disposable repo. That restoration
correctly produced a clean saved-update Review state; the runner then attempted
the remaining prompt scenarios without returning to Describe. Increase the
managed-edit wait to a bounded 90 seconds, and reuse the saved-update
Review-to-Describe normalization after each managed-edit path so cleanup cannot
poison unrelated downstream checks. Use the third and final bounded real-Mac
attempt for qualification.

Eighth post-execution deviation (2026-07-24): the third bounded run
`30090161104` used exact head
`cf3184f70fcd113081d23423db8b9c49c6c917a5` and exact-head successful Build
run `30089327985`. It launched the staged signed app, passed remote readiness,
captured a 267.05-second continuous 1280x720 recording, reached a real
provider-authored Homebrew change, completed Build & Test, visibly reached
Step 3, restored remote app support, and passed the independent
recording-aware HTML report inspection. The scenario verdict still failed.
The evidence identified three stale harness contracts: the provider wait
accepted Review while `Evolving...` and `Stop` were still visible; the summary
tab is now named `Semantic`; and Step 3 now requires `Keep Changes` before the
final `Commit`, with discard/undo behind `More change options`. The Homebrew
managed-edit action also persisted its git mutation but returned from its
spinner to Describe without entering Review in-process; the saved-update
Review appeared only after relaunch. Repair the selectors and predicates, make
that relaunch an explicitly reported recovery backed by disposable git state,
and remove the broken `storybook/` link rendered when Storybook is not
applicable. The three-attempt bound is exhausted, so these repairs are locally
verified and included in the final implementation/evidence review but are not
called qualified without a future exact-head real-Mac pass. Do not dispatch a
fourth run silently.

Ninth post-execution deviation (2026-07-24): the final independent
Claude/Fable implementation-and-evidence review found that the corrected
provider wait was followed by an unanchored `Build & Test` click. In the
recorded AX ordering, that matcher selected the preceding informational banner
instead of the button. It also found three default-off evolved-case waits that
retained the stale provider-ready predicate, a 20-second commit-message budget
shorter than measured provider latency, and an immediate post-discard verdict
that did not allow the rollback rebuild to finish. These safe local review
findings were applied with a banner-inclusive selector regression assertion,
then the local contract suites were rerun. This does not change the qualification
boundary: the post-review head still requires a future exact-head real-Mac pass
and the exhausted three-attempt bound still forbids silently dispatching
another run.

Post-review validation passed: runner self-test, workflow-contract self-test,
preservation harness, the 28-case adversarial replay against run `30090161104`,
`git diff --check`, targeted oxlint (zero errors, eight existing warnings), and
the full repository check (zero errors, 164 existing warnings).

Tenth post-execution deviation (2026-07-24): exact post-review head
`0e0e08551b08883fb61c176e9cf5b8a0c49729d1` produced successful signed Build
run `30093142572` and real-Mac run `30093946735`. The run passed the provider
Review, Semantic, Diff, Build & Test boundary, Step 3 Keep Changes and Commit,
clean committed git proof, History rollback, cleanup, screenshots, continuous
video, and recording-aware HTML inspection. Its only failing scenario was the
separate untracked Homebrew Add-to-config lifecycle. The raw git event proved
the product correctly wrote `.nixmac/homebrew/data.json`, which current product
code documents as the official managed source, while the runner accepted only
two legacy `.nix` paths. The runner had also deliberately navigated a prior
saved update back to Describe, so this managed mutation exposed an enabled
`Go to Review step` instead of auto-switching. Accept the current managed data
path, require disposable git proof before using that step, and retry the
managed-review navigation until the processing overlay clears. Preserve the
same exact-head build, real-app, continuous-video, report-inspection, and
cleanup gates on the next qualification run.

Eleventh post-execution deviation (2026-07-24): exact correction head
`6916988980be3994762da52febe6c0c2a3a7f789` produced successful signed Build
run `30095199539` and real-Mac run `30096331156`. The second run again passed
the full provider, Build & Test, Step 3 Commit, History rollback, visual,
continuous-video, and report-inspection lifecycle. Its isolated Homebrew
failure proved a narrower harness bug: the newly accepted
`.nixmac/homebrew/data.json` path appeared in `git diff --name-only` while the
managed edit was intentionally uncommitted, but the reusable Homebrew proof
helper read only committed `baseline..HEAD` paths. Consider both working-tree
and committed source paths; retain the post-Commit requirements for a changed
HEAD and clean worktree before accepting persistence.

Twelfth post-execution deviation (2026-07-24): exact correction head
`7fd11b908a214df3639f3268b5e5aa9bbfc019fa` produced successful signed Build
run `30097233291` and the first fully green real-Mac run `30098093726` with
27/27 scenarios passing. Independent artifact inspection confirmed the real
signed app, Homebrew and provider save/rollback lifecycles, 47 screenshots,
recording-aware Safari report inspection, and a qualifying continuous H.264
video. The final workflow timing metadata also proved CI-wrapper remote cleanup
completed successfully, but the regenerated executive summary still read only
the earlier runner-owned cleanup field and labeled remote restore
inconclusive. Derive remote-restore status from the final cleanup timing phase
when present so the uploaded HTML agrees with its own post-run evidence.

Thirteenth post-execution deviation (2026-07-24): exact report-correction head
`b9aa6818dec3a6dda335c2c8a0f62f37f23c8fa3` produced successful signed Build
run `30099233574`; real-Mac run `30100448301` confirmed the cleanup-summary fix
but failed after one transient SSH `connection refused` during the single
post-commit disposable-baseline snapshot. The initial snapshot and baseline
commit had succeeded, but the missing retry left the runner without
`remoteConfig`, so it correctly refused destructive confirmation and could not
restore through its git safety proof. Add bounded retries around both baseline
snapshots and fail fast if a build-confirm-enabled run cannot establish the
clean disposable baseline.

Fourteenth post-execution deviation (2026-07-24): exact baseline-retry head
`07c41c6fa70eaa25c60e7d6241de8a3e0f6f980e` produced successful signed Build
run `30101249841`. Real-Mac run `30102122413` established the retry-qualified
clean baseline and completed the entire untracked Homebrew Build, Commit, and
History-restore lifecycle. The next Computer Use click, submitting the
provider prompt, returned a one-off tool-level `remoteConnection` result even
though the prior and later Computer Use actions succeeded. The runner treated
that transient transport marker as a semantic click failure and skipped the
remaining provider lifecycle. Retry only the exact `remoteConnection` marker,
cap the click at three total attempts, preserve each retry in `events.json`,
and continue to fail immediately for ordinary stale, invalid, missing, or
non-clickable element responses.

For the final qualifying run, verify all of the following:

1. **Provenance**
   - workflow run and attempt IDs are recorded;
   - report records the exact tested head SHA and successful build run;
   - the staged app is the downloaded `.app`, not an installed fallback;
   - the report is from the qualifying run, not a copied fixture or historical directory.
1. **State**
   - `state.json` parses;
   - final verdict is `pass`;
   - every required scenario has a terminal passing state;
   - cleanup succeeds and remote state restoration is reported.
1. **Screenshots**
   - referenced files exist and decode;
   - report bindings match the screenshot files;
   - frames visibly contain the nixmac application;
   - labels/descriptions match the visible UI state;
   - text is legible at normal viewing size and no unrelated or stale desktop is presented as proof.
1. **Video**
   - the primary MP4 is a continuous capture of the remote Mac GUI, not an ffmpeg concat/slideshow of stored screenshots;
   - capture begins before the first tested app interaction and ends after the final tested app interaction;
   - capture metadata, duration, and timestamps overlap the scenario/action timeline and bind it to the same workflow run;
   - the MP4 decodes, has non-zero duration, and contains sustained motion/non-duplicate frames between evidence checkpoints;
   - sampled beginning, transition, and ending frames visibly show the real nixmac app and the relevant state changes in chronological order;
   - text and controls needed to understand the transitions are legible at normal viewing size;
   - video content matches the same app/run represented by the screenshots;
   - any screenshot-compilation video is labeled `derived screenshot reel` and cannot satisfy this gate.
1. **HTML**
   - `index.html` opens from the downloaded artifact through a local HTTP server;
   - assets resolve without console/network failures;
   - scenario status, screenshots, video, provenance, and failure details render accurately;
   - Codex inspects the rendered report using real Computer Use, not a throwaway automation browser.

Any setup-only/inconclusive report, broken asset link, unintelligible image, screenshot-only reel presented as primary video, non-decoding recording, stale evidence, or mismatched claim fails the gate regardless of workflow color.

### 5. Preserve Cooper's intended agent boundary

- Treat the vision-capable Mac driver as the authority for pixels and interaction.
- Treat GLM as a text-only poller/orchestrator: PR metadata in; concise scenario request out; machine-readable verdict, timestamps, links, and failure text back in.
- Confirm the qualifying artifact already exposes a stable text/JSON handoff (`state.json` plus report metadata). If a concrete field needed by the Buzz poller is absent, add only that small deterministic output and test it.
- Do not send screenshots to GLM and do not let GLM self-report visual success.
- Keep Cooper's CuaDriver experiment as a separate adapter/evaluation lane. Reuse the report contract; do not conflate “Product Proof is restored” with “Buzz/CuaDriver automation is complete.”
- Recommend CuaDriver promotion only after it produces the same required artifact contract on representative merged changes without manual rescue.

### 6. Independent final review

- Freeze the implementation diff, test outputs, qualifying workflow URL/metadata, downloaded report, screenshot contact sheet, video probe/frame samples, and Codex's report-inspection notes.
- Run exactly one second autonomous Claude/Fable review focused on implementation correctness and whether the evidence genuinely satisfies every acceptance item.
- Independently adjudicate Claude's findings. Apply safe local fixes and re-run affected checks. A material evidence defect requires a new qualifying real-Mac run; it cannot be waived by prose.

## Deliverable

A concise handoff with:

- exact tested commit and Actions run;
- result and any code changes;
- local artifact/report paths;
- HTML, image, and video inspection results;
- Codex and Claude verdicts;
- an explicit statement of what is restored now versus what remains for the Buzz/CuaDriver automation lane.
