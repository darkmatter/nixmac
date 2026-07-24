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
