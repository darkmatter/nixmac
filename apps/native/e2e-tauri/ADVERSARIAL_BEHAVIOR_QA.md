# nixmac E2E Adversarial Behavior QA

This file defines an intentionally adversarial behavior suite for the nixmac E2E
gate. The visual AVQ pass answered whether a human can trust the proof. This pass
answers whether the product flows do the right thing for different user types and
entry states.

## Execution Rules

- Start from the current E2E gate worktree state.
- Inject one behavior bug at a time using the exact mutation method in the table.
- Run the smallest relevant scenario first. When a probe targets a behavior the
  current suite does not exercise, run the nearest existing scenario and mark the
  result as **not exercised** rather than pretending the pass proves coverage.
- When a row lists a setup variant, apply that variant only for that probe so the
  mutated behavior is actually reachable. Without the setup variant, record a
  passing nearest-scenario result as **not exercised**.
- A mutation is **caught by the gate** only when the scenario `e2e-report.json`
  status is not `passed`, or the PR/workflow-facing summary explicitly names the
  behavior regression in user-actionable language.
- Mark a mutation as **missed** when the relevant scenario passes while the
  mutated behavior would be visible to a human QA tester entering that user state.
- Restore the mutation before moving to the next bug.
- Verify restoration before the next run by checking that only this Markdown/result
  log work remains changed beyond the pre-existing dirty E2E branch state.
- For Rust mutations, rebuild the WDIO Tauri binary with the mutation before the
  run, and rebuild again after restoration so stale binaries cannot create false
  caught/missed signals.
- Use this as a test of the gate, not as a critique of the product implementation.

## Bug Matrix

| ID | User type / entry state | Probe type | Behavior area | Injected bug | Exact mutation method | Setup variant | Human-observable behavior | Gate prediction | Primary scenario(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ABQ-01 | Returning configured user with Nix and a valid repo | Control | Startup routing | Valid configured users are routed back to setup instead of the prompt. | In `apps/native/src/components/widget/utils.ts`, change the final routing fallback from `return state.evolveState?.step ?? "begin";` to `return "setup";`. | None. | A returning user with saved config sees onboarding/setup instead of the main prompt. | Caught by timeout-shaped failure. Result log should note whether the final report names routing clearly or only says a prompt selector timed out. | `history_navigation`, `auto_evolve_basic_package` |
| ABQ-02 | New user connecting an existing nix-darwin repo | Gap probe | Onboarding persistence | Host selection updates only in memory and is not persisted to settings. | In `apps/native/src/hooks/use-darwin-config.ts`, change `await darwinAPI.config.setHostAttr(host);` in `saveHost` to `await darwinAPI.config.setHostAttr("");` while leaving `store.setHost(host)` unchanged. | None. | Onboarding appears to complete, but a restart or settings inspection loses the selected host. | Likely missed. The current onboarding scenario reaches the prompt but does not assert persisted `settings.json`. | `onboarding_existing_repo` |
| ABQ-03 | Settings-heavy user changing providers before first evolve | Gap probe | Provider/model persistence | Selecting a provider updates the UI field but persists the wrong provider/model. | In `apps/native/src/components/widget/settings/ai-models-tab.tsx`, in the Evolution Provider `onValueChange`, replace `evolveProvider: value` with `evolveProvider: "openai"` while leaving `evolveProviderField.handleChange(value)` intact. | None. | User selects vLLM/Ollama/CLI and sees it selected, but the next app launch/evolve uses OpenAI settings. | Likely missed. Current settings tests mutate URLs, keys, and numeric limits but do not change provider selects. | `settings_controls_persistence` |
| ABQ-04 | User with an invalid/missing AI provider configuration | Gap probe | Prompt safety | Missing provider configuration no longer blocks prompt submission. | In `apps/native/src/lib/ai-provider-validation.ts`, change the `provider === "vllm"` branch to always return `null`. | Seed settings with `evolveProvider: "vllm"`, `summaryProvider: "vllm"`, and blank `vllmApiBaseUrl` before opening the prompt. Without this setup variant, the existing prompt scenario uses a valid mock vLLM URL and does not reach the bug. | With vLLM selected and no base URL, the prompt looks runnable and submits into an avoidable provider failure instead of guiding the user to settings. | Likely missed without setup variant; should become catchable only after adding an invalid-provider behavior scenario. | `prompt_keyboard_and_suggestions` |
| ABQ-05 | Fast double-clicking user | Gap probe | Duplicate submit protection | An evolve can be started while another evolve is already in flight. | In `apps/native/src/components/widget/prompt-input.tsx`, remove `isLoading` from `sendDisabled`. | None. | Double-clicking send while another evolve is in flight starts concurrent AI runs or exhausts the mock response queue. This mutation does not test the Enter-key path because the textarea remains disabled while loading. | Likely missed. Current prompt flow submits once and does not try a second send-click during processing. | `prompt_keyboard_and_suggestions` |
| ABQ-06 | Returning user repeating a useful prompt | Gap probe | Prompt history behavior | Prompt history keeps duplicate entries instead of moving an existing prompt to the top. | In `apps/native/src-tauri/src/store.rs`, remove `history.retain(|p| p != prompt);` from `add_to_prompt_history`. | Rust mutation: rebuild the WDIO Tauri binary after injecting this change and again after restoring it. | Repeating the same prompt creates duplicate history chips, making history noisy and harder to reuse. | Likely missed. Current prompt-history assertion only checks that the submitted prompt exists once. | `prompt_keyboard_and_suggestions` |
| ABQ-07 | User with existing uncommitted/manual changes | Gap probe | Manual evolve preservation | Dirty-repo evolve skips the manual-resolution path and starts a normal evolve directly. | In `apps/native/src/components/widget/prompt-input.tsx`, remove the `if (needsResolution) { evolveFromManual(); }` block from `handleSubmit`. | Seed a dirty config repo at the prompt with `gitStatus.files.length > 0` and no active evolve state. The current manual evolve scenario starts from an existing evolve state, so it does not exercise this exact entry state. | A user with existing unsummarized changes can generate new changes without the app acknowledging or preserving the dirty-state workflow. | Likely missed by current coverage; should become catchable only after adding a dirty-prompt behavior scenario. | `manual_evolve_existing_changes` |
| ABQ-08 | User hitting an AI/server error | Gap probe | Failure recovery | Provider/model failures are swallowed without a visible, retryable app error. | In `apps/native/src/hooks/use-evolve.ts`, replace `useWidgetStore.getState().setError(msg);` in the `catch` block with `useWidgetStore.getState().setError(null);`. | Configure the mock vLLM queue to fail or exhaust before submit. Without this setup variant, existing evolve scenarios use successful mock responses and do not enter the `catch` block. | The flow returns to idle or hangs with no clear error message after the AI provider fails. | Likely missed without setup variant; should become catchable only after adding a provider-failure behavior scenario. | `auto_evolve_basic_package` |
| ABQ-09 | Privacy-conscious user opening feedback/report issue | Gap probe | Feedback cancel/reset | Canceling feedback leaves stale typed content in the next dialog open. | In `apps/native/src/components/widget/feedback-dialog.tsx`, remove the state-reset lines in `handleClose` that clear `feedbackText`, `expectedText`, `email`, and `relatedPrompt`. | Reopen the same header feedback flow after cancel to verify a clean draft. Reopening footer issue mode resets some share options through `feedbackTypeOverride`, so the text-field leak is the stable assertion target. | User cancels feedback, reopens it, and sees stale private text/email/prompt from the previous draft. | Likely missed. Current feedback scenario verifies the dialog closes, not that reopening starts clean. | `feedback_report_issue` |
| ABQ-10 | User restoring from history while local changes exist | Gap probe | History restore safety | History restore bypasses the uncommitted-changes confirmation path. | In `apps/native/src/hooks/use-history-restore.ts`, remove the `if ((gitStatus?.files?.length ?? 0) > 0) { onUncommittedChanges(); return; }` guard inside the restore request handler. | Seed a history item plus dirty git app state before invoking restore. Current history coverage is navigation-only and does not attempt restore. | A user with local changes can restore a prior history item without an explicit warning/confirmation. | Likely missed by current coverage; should become catchable only after adding a history-restore behavior scenario. | `history_navigation` |

## Result Log

Initial run artifacts: `/tmp/nixmac-abq-results-1/summary.json` and
`/tmp/nixmac-abq-results-1/<ID>/artifacts/`.

| ID | Scenario command | Gate result | Exercised by current suite? | Caught? | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| ABQ-01 | `bun run test:wdio:history-navigation` | `failed` | Yes | Yes | `/tmp/nixmac-abq-results-1/ABQ-01/artifacts/history_navigation/e2e-report.json` | Caught as a timeout waiting for the main prompt. This proves routing broke, but the failure is selector-shaped instead of user-actionable startup-routing language. |
| ABQ-02 | `bun run test:wdio:onboarding` | `failed` | Yes | Yes | `/tmp/nixmac-abq-results-1/ABQ-02/artifacts/onboarding_existing_repo/e2e-report.json` | Caught through the setup helper path. Needs a clearer persisted-settings assertion so the report says host persistence broke. |
| ABQ-03 | `bun run test:wdio:settings-controls` | `passed` | No | No | `/tmp/nixmac-abq-results-1/ABQ-03/artifacts/settings_controls_persistence/e2e-report.json` | True miss. The settings scenario changes keys, URLs, and numeric limits, but not provider selects. |
| ABQ-04 | `bun run test:wdio:prompt-keyboard` | `infra_failed` | No | Accidentally | `/tmp/nixmac-abq-results-1/ABQ-04/artifacts/prompt_keyboard_and_suggestions/e2e-report.json` | The invalid-provider state was not deliberately created. The run timed out/exhausted infra instead of asserting that prompt submission is blocked before network work. |
| ABQ-05 | `bun run test:wdio:prompt-keyboard` | `infra_failed` | No | Accidentally | `/tmp/nixmac-abq-results-1/ABQ-05/artifacts/prompt_keyboard_and_suggestions/e2e-report.json` | The double-submit behavior is not directly tested. This run exposed a real current-code weakness: the send button is not disabled while evolve is processing. |
| ABQ-06 | `bun run test:wdio:prompt-keyboard` | `passed` | No | No | `/tmp/nixmac-abq-results-1/ABQ-06/artifacts/prompt_keyboard_and_suggestions/e2e-report.json` | True miss. The existing prompt-history assertion only checks inclusion, not duplicate suppression. |
| ABQ-07 | `bun run test:wdio:modify` | build failed | No | No reliable signal | None | Mutation harness produced a compile/build failure before a scenario ran. Treat as unexercised, not a meaningful catch. |
| ABQ-08 | `bun run test:wdio:basic-prompts` | `passed` | No | No | `/tmp/nixmac-abq-results-1/ABQ-08/artifacts/auto_evolve_basic_package/e2e-report.json` | True miss. Existing evolve scenarios use successful mock responses and do not exercise provider/server failure recovery. |
| ABQ-09 | `bun run test:wdio:feedback-report` | `passed` | No | No | `/tmp/nixmac-abq-results-1/ABQ-09/artifacts/feedback_report_issue/e2e-report.json` | True miss. The feedback flow closes the dialog but does not reopen it to prove private draft text was cleared. |
| ABQ-10 | `bun run test:wdio:history-navigation` | `passed` | No | No | `/tmp/nixmac-abq-results-1/ABQ-10/artifacts/history_navigation/e2e-report.json` | True miss. History coverage is navigation-only; it does not attempt restore while local changes exist. |

## Fix Proposal

1. Tighten existing scenarios where the behavior already belongs:
   - `onboarding_existing_repo`: after host selection, assert `settings.json`
     persisted both `configDir` and `hostAttr` so ABQ-02 reports a clean
     onboarding persistence failure.
   - `settings_controls_persistence`: change provider selects and assert
     persisted provider/model values so ABQ-03 is directly exercised.
   - `feedback_report_issue`: cancel and reopen feedback, then assert
     feedback text, expected behavior, and email fields are empty so ABQ-09 is
     directly exercised.
   - `history_navigation`: seed a focused dirty git + restore history state
     through the E2E store helper,
     click a visible Restore action, and assert restore preview does not open
     while the uncommitted-change warning remains visible so ABQ-10 is directly
     exercised as a response-given-dirty-state guard.
2. Add focused behavior scenarios for states that need different setup:
   - `provider_validation_blocks_prompt`: starts with vLLM selected and no base
     URL; asserts the prompt shows the settings guidance and the send button
     stays disabled before any provider call can happen. This converts ABQ-04
     from an infra timeout into a direct behavioral assertion.
   - `provider_failure_recovery`: starts with a mock vLLM server that returns an
     explicit provider billing error; submits once and asserts the visible app
     error mentions the billing/credits issue. This exercises ABQ-08 without
     depending on long provider retry behavior from an exhausted queue.
3. Harden prompt submission itself:
   - Disable the send button during evolve processing and guard `useEvolve`
     against re-entry before awaiting prompt-history persistence. This fixes the
     real duplicate-submit weakness behind ABQ-05.
   - Extend `prompt_keyboard_and_suggestions` to attempt a rapid second send and
     to submit the same prompt twice, asserting one visible flow completes and
     prompt history contains only one copy. This covers ABQ-05 and ABQ-06.
4. Expand E2E helper APIs only where they express real user state:
   - Add field-value, provider-select, prompt-history-count, widget-error,
     dirty-git-status, provider-error-response, and focused widget-state probe
     helpers. Keep them scoped to tests; do not add production behavior
     branches.
5. Keep ABQ-07 documented as not reliably executed in this pass unless the new
   dirty-state helper can assert the manual-evolve path without stubbing the
   backend. Do not claim coverage if the UI cannot prove the behavior.

## Post-Fix Verification

Implementation branch artifacts:

- Proposal Claude review: completed before implementation. Accepted review
  changes were applied to this file before the initial mutation pass.
- Results/fix audit Claude review: attempted after the initial result log, but
  the Claude Code process produced no stdout/stderr for roughly 20 minutes and
  was killed. Local record: `.claude-review/behavior-results-review-unavailable.txt`.
- Implementation audit Claude review: completed after the local fixes. It found
  one blocking race where history coverage mixed an on-disk dirty repo with a
  synthetic restore history, plus one cleanup where the prompt submit guard read
  `isLoading` before its declaration. Both were fixed before push.

Local validation after the behavior fixes:

| Command | Result | Notes |
| --- | --- | --- |
| `bun run test:wdio:build` | passed | Rebuilt the E2E web bundle and Tauri test binary after app/test-helper changes. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:provider-validation` | passed | Covers ABQ-04 with blank vLLM base URL; send stays disabled and settings guidance is visible. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:provider-failure` | passed | Covers ABQ-08 with a deterministic mock provider 402 error; visible UI error mentions billing limit. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:onboarding` | passed | Covers ABQ-02 by asserting typed config dir and host are persisted to `settings.json`. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:settings-controls` | passed | Covers ABQ-03 by changing provider selects and asserting provider/model persistence. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:feedback-report` | passed | Covers ABQ-09 by canceling a private draft, reopening, and asserting text/email fields are empty. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:history-navigation` | passed | Covers ABQ-10 by seeding the dirty git + restore-history state, clicking Restore, and asserting restore preview does not open while restore is disabled. |
| `NIXMAC_E2E_VIDEO=0 bun run test:wdio:prompt-keyboard` | passed | Covers ABQ-05/ABQ-06 with rapid double submit protection and duplicate prompt-history suppression. |

Post-fix coverage status:

| ID | Status after fixes | Notes |
| --- | --- | --- |
| ABQ-01 | Covered by existing startup/prompt routing scenarios | Still likely reports as a selector/routing timeout rather than a high-level startup-routing explanation. |
| ABQ-02 | Covered | Onboarding now asserts persisted `configDir` and `hostAttr`. |
| ABQ-03 | Covered | Settings now changes provider selects and verifies persisted provider/model values. |
| ABQ-04 | Covered | New focused invalid-provider scenario blocks unsafe prompt submission before network work. |
| ABQ-05 | Product hardened; indirectly covered | Send is disabled/guarded during evolve processing; the scenario attempts rapid double submit. A direct guard assertion would require probing processing transitions, so this remains an indirect regression check. |
| ABQ-06 | Covered | Prompt scenario repeats the same prompt and asserts one history entry. |
| ABQ-07 | Still documented gap | Dirty-prompt/manual-resolution entry state still needs a cleaner direct assertion before claiming coverage. |
| ABQ-08 | Covered | New provider-failure scenario asserts visible app error on deterministic provider billing failure. |
| ABQ-09 | Covered | Feedback scenario proves cancel/reopen clears stale private draft fields. |
| ABQ-10 | Covered | History scenario proves the UI blocks restore preview when the app state says the repo has uncommitted files. It does not re-test backend dirty-state detection. |
