# nixmac E2E Historical Replay QA

This file defines an empirical replay pass for bugs and regression signals found
in recent nixmac Slack/GitHub history. The goal is to stop saying "the current
gate would probably catch this" and instead prove it by reintroducing one bug at
a time against the current branch.

## Execution Rules

- Start from the current `fkb/e2e-gate-test-pr` worktree state.
- Inject one historical bug at a time using the exact mutation method in the
  table below.
- Run the smallest relevant hosted WDIO scenario or Rust unit test first.
- Run hosted commands from `apps/native/` unless the command explicitly uses
  `bun -F native ...` from the repo root.
- Rebuild app source mutations before WDIO runs. The local WDIO service serves
  `apps/native/dist/`, so source mutations are not exercised until `dist/` is
  rebuilt.
- Count a bug as **caught** only when the scenario/test fails for the intended
  reason and the resulting `e2e-report.json`, test output, or failure text points
  to the broken behavior.
- Count a bug as **missed** when the relevant scenario/test passes while the
  mutated behavior is reachable and human-observable.
- Count a bug as **not exercised** when the nearest scenario passes but the setup
  never entered the historical state. Do not turn "not exercised" into a pass.
- Restore source after every mutation and verify the worktree is clean apart
  from this ledger and intentional implementation changes.
- For Rust mutations, rebuild the WDIO Tauri binary before the run and rebuild
  again after restoring source. Stale binaries invalidate the result.
- For lower-level historical bugs that are better covered by Rust unit tests,
  record them as unit replay evidence. Do not call them E2E catches.

## Replay Matrix

| ID | Historical signal | User-visible failure | Exact mutation method | Verification command | Expected current signal |
| --- | --- | --- | --- | --- | --- |
| HRE-01 | AI Models tab crashed when opened | Settings opens, but the AI Models tab crashes or never renders. | In `apps/native/src/components/widget/settings/ai-models-tab.tsx`, throw when `AiModelsTab` renders. | `cd apps/native && VITE_NIXMAC_E2E=true bun run build && NIXMAC_E2E_VIDEO=0 bun run test:wdio:smoke` | `settings_provider_change` fails while navigating Settings tabs. |
| HRE-02 | Missing provider configuration allowed prompt submission | With vLLM selected and no base URL, the prompt submits instead of guiding the user to Settings. | In `apps/native/src/lib/ai-provider-validation.ts`, make the `provider === "vllm"` branch always return `null`. | `cd apps/native && bun run test:wdio:provider-validation` | `provider_validation_blocks_prompt` fails before submission because the "No base URL set" guidance/send-disabled invariant disappears. |
| HRE-03 | Provider/model failures were swallowed | Provider error occurs but the app does not show a visible, retryable error. | In `apps/native/src/hooks/use-evolve.ts`, replace `setError(msg)` with `setError(null)` inside the `catch` block. | `cd apps/native && bun run test:wdio:provider-failure` | `provider_failure_recovery` fails waiting for the billing/credits error. |
| HRE-04 | Inline question answer deadlocked | User answers an inline question, but the evolve flow stays stuck. | In `apps/native/src/components/evolve-progress.tsx`, remove the `onAnswer(value.trim())` call from `QuestionPrompt.handleSubmit`. | `cd apps/native && bun run test:wdio:question-answer` | `question_answer_followup` fails before reaching evolve review. |
| HRE-05 | Fast answer/backend slot race | Backend rejects a prepared answer if the response slot is not registered first. | In `apps/native/src-tauri/src/commands.rs`, make `prepare_question_response` return a receiver without storing the sender in `ONGOING_QUESTION`. | `cargo test --manifest-path apps/native/src-tauri/Cargo.toml question_response_slot_accepts_answer_and_rejects_after_clear` | Rust unit test fails immediately. This is unit replay evidence, not E2E proof. |
| HRE-06 | Prompt history duplicated repeated prompts | Repeating a prompt creates duplicate chips/history entries instead of moving one entry to the top. | In `apps/native/src-tauri/src/store.rs`, remove `history.retain(|p| p != prompt);` from `add_to_prompt_history`. | `cd apps/native && bun run test:wdio:build && bun run test:wdio:prompt-keyboard` | `prompt_keyboard_and_suggestions` fails on duplicate prompt-history count. |
| HRE-07 | History restore bypassed dirty-state safety | A user with local changes can restore history without an uncommitted-changes block. | In `apps/native/src/hooks/use-history-restore.ts`, remove the `gitStatus.files.length > 0` guard in `handleRequestRestore`. | `cd apps/native && bun run test:wdio:history-navigation` | `history_navigation` fails because the restore preview opens despite dirty state. |
| HRE-08 | Existing-repo onboarding did not persist selected host | Onboarding appears to complete but the selected host is missing from persisted settings after restart/settings readback. | In `apps/native/src/hooks/use-darwin-config.ts`, make `saveHost` persist an empty host while leaving UI state selected. | `cd apps/native && bun run test:wdio:onboarding` | `onboarding_existing_repo` fails its persisted `settings.json` host assertion. |
| HRE-09A | OpenRouter API key removal did not persist, current-suite reachability check | Existing current settings scenario does not seed or clear an OpenRouter key. | No source mutation. Inspect and/or run the current settings scenario before adding coverage. | `cd apps/native && bun run test:wdio:settings-controls` | Log as `not exercised` unless the scenario is first updated to seed and clear OpenRouter. |
| HRE-09B | OpenRouter API key removal did not persist, post-fix replay | User clears a saved OpenRouter key, but it remains in `settings.json` afterward. | After adding deletion-persistence coverage, in `apps/native/src/components/widget/settings-dialog.tsx`, in the empty-key branch of `verifyOpenrouterKey`, do not call `ui.setPrefs({ openrouterApiKey: "" })`. | `cd apps/native && bun run test:wdio:settings-controls` | The updated `settings_controls_persistence` scenario fails with an OpenRouter deletion persistence assertion. |
| HRE-10 | UTF-8 truncation panic on multibyte error text | A multibyte error at the truncation boundary can panic instead of rendering a safe truncated message. | In `apps/native/src-tauri/src/evolve/utils.rs`, replace boundary-aware truncation with direct byte truncation at `half + 2`. | `cargo test --manifest-path apps/native/src-tauri/Cargo.toml truncate_error_handles_utf8_boundaries_without_panicking` | Rust unit test fails. This is unit replay evidence, not E2E proof. |
| HRE-11 | Queue summarizer accepted `changes: []` | Summary queue marks completion even though no individual changes were mapped. | In `apps/native/src-tauri/src/summarize/queue_summarizer.rs`, bypass the empty-`changes` validation branch. | `cargo test --manifest-path apps/native/src-tauri/Cargo.toml group_empty_changes_array_fails` | Rust unit test fails. This is unit replay evidence, not E2E proof. |

## Proposal

1. Run HRE-01 through HRE-11 exactly as mutations, restoring after each probe.
2. Save raw artifacts under `/tmp/nixmac-historical-replay-results-1/<ID>/`.
3. Update this file with a result table that includes:
   - command run,
   - scenario/test result,
   - caught/missed/not-exercised,
   - exact failure text or report path,
   - whether the failure is hosted E2E proof or unit proof.
4. Treat HRE-09 as two separate facts:
   - HRE-09A: the current suite's reachability. If the current suite does not
     seed and clear an OpenRouter key, record `not exercised`.
   - HRE-09B: the remediation replay. Add a focused settings deletion-persistence
     assertion, then rerun the mutation and require a scenario failure for the
     right reason.
5. Do not claim full-Mac/apply/rebuild historical bugs are verified by this pass.
   Full-Mac install and DMG launch proof already exist in the PR gate, but sudo,
   activation, and Full Disk Access regressions need a separate label-gated or
   nightly apply/rebuild lane before they can be called empirically covered.

## Result Log

Executed on 2026-04-26/2026-04-27 from
`/Users/farhankhalaf/Code/nixmac-e2e-testing` with raw artifacts under
`/tmp/nixmac-historical-replay-results-1/`.

HRE-09A was run before adding OpenRouter deletion coverage. The current
settings-controls scenario passed, but because it did not seed and clear
OpenRouter, it was recorded as `not exercised` instead of a pass. Artifact:
`/tmp/nixmac-historical-replay-results-1/HRE-09A/`.

| ID | Result | Proof type | Evidence |
| --- | --- | --- | --- |
| HRE-09A | not exercised | hosted E2E reachability check | Pre-fix `settings_controls_persistence` passed, but the scenario did not seed or clear OpenRouter. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-09A/` |
| HRE-01 | caught | hosted E2E | `settings_provider_change` failed with `Timed out waiting for selector: //h2[normalize-space()="AI Models"]`. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-01/` |
| HRE-02 | caught | hosted E2E | `provider_validation_blocks_prompt` failed on the missing vLLM base URL invariant. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-02/` |
| HRE-03 | caught | hosted E2E | `provider_failure_recovery` failed waiting for visible billing/credits error text. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-03/` |
| HRE-04 | caught | hosted E2E | `question_answer_followup` failed at the scenario-local evolve-review assertion with `Timed out waiting for selector: //h2[normalize-space()="What else can I change for you?"]`. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-04/` |
| HRE-05 | caught | unit replay | `question_response_slot_accepts_answer_and_rejects_after_clear` failed after the backend stopped registering the response sender. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-05/` |
| HRE-06 | caught | hosted E2E | `prompt_keyboard_and_suggestions` failed waiting for one de-duplicated `Install vim` history entry. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-06/` |
| HRE-07 | caught | hosted E2E | `history_navigation` failed because the restore preview stayed visible despite dirty state. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-07/` |
| HRE-08 | caught | hosted E2E | `onboarding_existing_repo` failed waiting for persisted settings after host save was broken. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-08/` |
| HRE-09B | caught | hosted E2E | Updated `settings_controls_persistence` failed with `Timed out waiting for cleared OpenRouter API key to persist to settings.json`. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-09B/` |
| HRE-10 | caught | unit replay | `truncate_error_handles_utf8_boundaries_without_panicking` failed after unsafe byte truncation was introduced. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-10/` |
| HRE-11 | caught | unit replay | `group_empty_changes_array_fails` failed after empty-change validation was bypassed. Artifacts: `/tmp/nixmac-historical-replay-results-1/HRE-11/` |

Final restore verification: `bun run test:wdio:build` exited 0 after all
mutations were restored. The clean updated `settings_controls_persistence`
scenario and the clean updated `question_answer_followup` scenario also passed
after restore. Summary:
`/tmp/nixmac-historical-replay-results-1/summary.json`; final clean settings
artifacts:
`/tmp/nixmac-historical-replay-results-1/final-clean-settings-controls-after-review/`;
final clean question-answer artifacts:
`/tmp/nixmac-historical-replay-results-1/final-clean-question-answer-after-hre04/`.

Post-review verification on 2026-04-27 reran the current worktree clean:
`bun run test:wdio:build`, `NIXMAC_E2E_VIDEO=0 bun run test:wdio:settings-controls`,
and `NIXMAC_E2E_VIDEO=0 bun run test:wdio:question-answer` all exited 0.
