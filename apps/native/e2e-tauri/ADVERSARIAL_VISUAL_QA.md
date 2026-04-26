# nixmac E2E Adversarial Visual QA

This file defines an intentionally adversarial mutation suite for the nixmac E2E gate.
The goal is not to pick bugs the current scripts already catch. The goal is to ask:
would a reasonable human QA tester notice this, and does the current E2E gate surface it
clearly in PR-facing output?

## Execution Rules

- Start from the current E2E gate worktree state.
- Inject one bug at a time using the exact mutation method in the table.
- Run the smallest relevant E2E scenario pack first, then escalate only when the mutation targets a full-Mac-only surface.
- A mutation is **caught by the gate** only when the scenario `e2e-report.json` status is not `passed`, or the PR/workflow-facing summary explicitly names the specific defect.
- A generic visual timeline observation such as `low-contrast frame`, `large visual change`, or `late-flow frame` does **not** count as caught unless it identifies the defect in user-actionable language.
- Mark a mutation as **visible but missed** when the scenario passes and the defect is visible in the proof video, screenshot, or visual timeline without being named.
- Record misses honestly, even when they are outside the current scripted assertions.
- Restore the mutation before moving to the next bug.
- Verify restoration before the next run by checking that only this Markdown/result-log work remains changed beyond the pre-existing dirty E2E branch state.
- Use this as a test of the gate, not as a critique of the product implementation.

## Bug Matrix

| ID | Probe type | Human visibility | Area | Injected bug | Exact mutation method | How it should appear visually to human QA | Gate prediction | Primary scenario(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AVQ-01 | Control | Obvious | Prompt empty state | Misspell the first-screen title from `Get started` to `Get startd`. | In `apps/native/src/components/widget/get-started-message.tsx`, change the `<h3>` text to `Get startd`. | Main empty state has an obvious typo in the central heading. | Caught. Existing XPath waits for exact `Get started`. | `history_navigation` |
| AVQ-02 | Gap probe | Obvious | Header navigation | Hide the Settings gear while leaving the invisible button clickable. | In `apps/native/src/components/widget/header.tsx`, add `opacity-0` to the `<Settings>` icon class only; keep the parent button and `aria-label="Settings"`. | Header has History and Feedback icons, but the Settings gear is missing; a human sees no obvious settings affordance. | Likely missed. Aria-label click still opens settings. | `settings_provider_change`, `history_navigation` |
| AVQ-03 | Gap probe | Obvious | Prompt input | Make typed prompt text invisible while preserving textarea value and submit behavior. | In `apps/native/src/components/widget/prompt-input.tsx`, add `className="text-transparent caret-transparent"` to `InputGroupTextarea`. | Prompt field looks blank after selecting a suggestion or typing; the user cannot visually verify the prompt. | Likely missed. Scenario checks DOM value, not visible contrast. | `prompt_keyboard_and_suggestions` |
| AVQ-04 | Gap probe | Subtle-to-obvious | Prompt send affordance | Make the empty prompt send button look enabled even while it remains disabled. | In `apps/native/src/components/widget/prompt-input.tsx`, add disabled-state override classes to `InputGroupButton`: `disabled:opacity-100 disabled:bg-primary disabled:text-primary-foreground`. | On first screen, the send arrow looks active before any prompt exists, misleading the user about whether it can be clicked. | Likely missed. Existing scenario checks disabled DOM state, not visual affordance. | `prompt_keyboard_and_suggestions` |
| AVQ-05 | Gap probe | Obvious | Evolve review | Hide the generated diff body while keeping the Diff tab and non-empty repo diff intact. | In `apps/native/src/components/widget/summaries/diff.tsx`, add `opacity-0` to the `CodeBlockContent` wrapper or nearest diff body container, without rendering `No diff available`. | Review says `What's changed` and `Diff`, but the visible diff content is blank. | Likely missed. Current helper checks no `No diff available` and filesystem diff, not visible diff text. | `prompt_keyboard_and_suggestions`, `auto_evolve_basic_package` |
| AVQ-06 | Gap probe | Obvious | Discard dialog | Swap the visible `Confirm` and `Cancel` labels while preserving their underlying handlers/test IDs. | In `apps/native/src/components/widget/confirmation-dialog.tsx`, change the cancel button text to `Confirm` and confirm button text to `Cancel`; keep `data-testid`s and handlers unchanged. | Dialog presents misleading destructive choices; a human would not know which visible label is safe. | Likely missed. Current tests click test IDs and verify outcome, not visible label semantics. | `discard_and_restore_state` |
| AVQ-07 | Gap probe | Subtle | Discard dialog severity | Make the destructive discard confirmation button look neutral/safe. | In `apps/native/src/components/widget/confirmation-dialog.tsx`, change `colorClasses.amber.buttonBg` from rose styling to the teal styling used for safe actions. | Discard confirmation looks like a safe/primary action instead of a destructive one. | Likely missed. Current tests do not assert color/severity. | `discard_and_restore_state` |
| AVQ-08 | Gap probe | Medium | Feedback/report issue | Keep `Bug` functional but visually dim even after it is selected. | In `apps/native/src/components/widget/feedback-dialog.tsx`, change only the Bug tile opacity expression so it never reaches `opacity-100` when `FeedbackType.Bug` is selected. | User selects Bug and sees bug-only fields, but the Bug tile still appears inactive/dim. | Likely missed. Existing scenario checks fields/text, not selected visual state. | `feedback_report_issue` |
| AVQ-09 | Gap probe | Medium | History navigation | Show an incorrect History count badge while keeping the real history item visible. | In `apps/native/src/components/widget/history/history-header.tsx`, render `{count + 98}` instead of `{count}` in the count badge so TypeScript still sees `count` as used. | History screen has one visible item but the badge says `99`, an obvious data-integrity/UI mismatch. | Likely missed. Existing scenario checks heading and item text, not count accuracy. | `history_navigation` |
| AVQ-10 | Full-Mac gap probe | Medium | Full-Mac first-run proof | Hide the full-Mac clean-machine first-screen identity while leaving launch and expected setup/install text intact. | In `apps/native/src/components/widget/steps/nix-setup-step.tsx`, add `opacity-0` to the setup icon and change the visible copy from `nixmac needs...` to `This app needs...`; in `apps/native/src/components/widget/header.tsx`, add `opacity-0` to the header app-name `<h3>`. | Installed app launches on a real Mac and still says `System Setup` / `Install Nix`, but there is no visible nixmac name/logo/identity in the app chrome or setup body. | Likely missed. Full-Mac smoke only greps broad first-screen text such as `install`, `nix`, `welcome`, or `get started`. | `release_dmg_app_translocation_smoke` |

AVQ-10 requires the full-Mac lane. If runtime is constrained, execute AVQ-01 through AVQ-09 first and record AVQ-10 as pending full-Mac validation rather than folding it into the hosted score.

## Result Log

Hosted AVQ-01 through AVQ-09 execution used `/tmp/run-nixmac-avq-hosted-2.mjs`
with per-mutation artifacts under `/tmp/nixmac-avq-results-2`. Each row rebuilt
the Vite app with one injected bug, ran the listed WDIO scenario, copied the
scenario report/proof, restored source, and rebuilt clean before the next probe.

| ID | Mutation target | Scenario run | Gate result | Caught by gate? | Human-visible defect surfaced? | Visual analysis observation | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AVQ-01 | `get-started-message.tsx` title typo | `history_navigation` / `bun run test:wdio:history-navigation` | `failed` | Yes | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-01/artifacts/history_navigation/failure-1777154305058.png` | Control passed: exact visible title assertion caught the typo. |
| AVQ-02 | `header.tsx` hidden Settings icon | `settings_provider_change` / `bun run test:wdio:smoke` | `passed` | No | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-02/artifacts/settings_provider_change/recording-opens-and-navigates-all-tabs-1777154348392.mp4` | Miss: invisible button remains clickable by aria-label. |
| AVQ-03 | `prompt-input.tsx` transparent prompt text | `prompt_keyboard_and_suggestions` / `bun run test:wdio:prompt-keyboard` | `passed` | No | Yes | `low-contrast frame`, `low-detail frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-03/artifacts/prompt_keyboard_and_suggestions/recording-uses-a-prompt-suggestion-records-keyboard-action-proof-and-reaches-evolve-review-1777154394414.mp4` | Miss: DOM value was correct while the user-visible prompt was blank. |
| AVQ-04 | `prompt-input.tsx` disabled send button styled active | `prompt_keyboard_and_suggestions` / `bun run test:wdio:prompt-keyboard` | `passed` | No | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-04/artifacts/prompt_keyboard_and_suggestions/recording-uses-a-prompt-suggestion-records-keyboard-action-proof-and-reaches-evolve-review-1777154441043.mp4` | Miss: semantic disabled state was correct, visual affordance was wrong. |
| AVQ-05 | `summaries/diff.tsx` hidden diff body | `prompt_keyboard_and_suggestions` / `bun run test:wdio:prompt-keyboard` | `passed` | No | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-05/artifacts/prompt_keyboard_and_suggestions/recording-uses-a-prompt-suggestion-records-keyboard-action-proof-and-reaches-evolve-review-1777154487607.mp4` | Miss: filesystem diff existed, but rendered diff body was visually blank. |
| AVQ-06 | `confirmation-dialog.tsx` swapped Confirm/Cancel labels | `discard_and_restore_state` / `bun run test:wdio:discard` | `passed` | No | Yes | `low-contrast frame`, `mostly blank or single-color frame`, `late-flow frame`, `stable visual state` | `/tmp/nixmac-avq-results-2/AVQ-06/artifacts/discard_and_restore_state/recording-submits-a-prompt-reaches-evolve-review-then-discards-and-returns-to-initial-state-1777154533821.mp4` | Miss: tests clicked test IDs, not visible destructive-label semantics. |
| AVQ-07 | `confirmation-dialog.tsx` destructive button styled safe | `discard_and_restore_state` / `bun run test:wdio:discard` | `passed` | No | Yes | `low-contrast frame`, `mostly blank or single-color frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-07/artifacts/discard_and_restore_state/recording-submits-a-prompt-reaches-evolve-review-then-discards-and-returns-to-initial-state-1777154583695.mp4` | Miss: no visual severity assertion. |
| AVQ-08 | `feedback-dialog.tsx` Bug tile remains dim after selection | `feedback_report_issue` / `bun run test:wdio:feedback-report` | `passed` | No | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-08/artifacts/feedback_report_issue/recording-covers-header-feedback-mode-and-footer-issue-report-mode-1777154632438.mp4` | Miss: fields appeared, but selected tile visual state was wrong. |
| AVQ-09 | `history-header.tsx` count badge off by 98 | `history_navigation` / `bun run test:wdio:history-navigation` | `passed` | No | Yes | `low-contrast frame`, `late-flow frame` | `/tmp/nixmac-avq-results-2/AVQ-09/artifacts/history_navigation/recording-opens-and-closes-history-and-settings-controls-1777154680430.mp4` | Miss: heading/item assertions did not compare badge count to visible items. |
| AVQ-10 | `nix-setup-step.tsx` setup identity + `header.tsx` app name hidden | `release_dmg_app_translocation_smoke` / full-Mac workflow dispatch | `passed` | No | Yes | Not available on the branch under test | Report: https://releases.nixmac.com/e2e/manual/24942138678/534412365f8dcb2a914bb47d4c27bbc754bb75b3/release_dmg_app_translocation_smoke/index.html; local screenshot `/tmp/nixmac-avq-fullmac-artifacts-2/release_dmg_app_translocation_smoke/01-launched-1777156521.png` | Corrected AVQ-10 passed despite a generic, unbranded first screen. First attempt (`24941879546`) proved the lane works but targeted the wrong first screen, so it is not counted. No PR side effects. |

Final adversarial score: 1 caught / 10 executed. The single catch was the
control row with an exact text assertion. The nine misses were visible to a
human reviewing the proof but not named by the gate.

## Fix Proposal

The hosted misses are not failures of video capture. They are failures of the
gate contract: the test scripts currently verify that flows function, but they
do not consistently verify that the UI remains visually intelligible to a
human reviewer.

| Misses covered | Proposed change | Expected gate behavior after fix |
| --- | --- | --- |
| AVQ-02 | Add a WDIO visual invariant for the Settings affordance: the settings button's icon must be rendered, visible, non-zero size, and not hidden by ancestor opacity/visibility. Wire it into the settings smoke path before opening settings. | Hidden Settings gear fails with an explicit `Settings icon should be visibly rendered` assertion. |
| AVQ-03 | Add a prompt-input readability assertion: after a suggestion or typed prompt, the textarea must contain the expected value and its effective text color/opacity must be visible against the resolved background. | Transparent prompt text fails even when the DOM value and submit behavior are correct. |
| AVQ-04 | Add a disabled-affordance assertion for the empty prompt send button: when disabled, effective opacity must stay at or below `0.75` rather than active-primary opacity. | A disabled-but-active-looking send button fails before any prompt is submitted. |
| AVQ-05 | Add a shared ancestor-aware visibility helper, then assert the generated diff includes visible rendered diff text for prompt flows that know the expected diff token. | Hidden diff body fails even when the filesystem diff exists and `No diff available` is absent. |
| AVQ-06 | Assert confirmation dialog visible labels match their destructive semantics before clicking by `data-testid`. | Swapped `Confirm`/`Cancel` labels fail before the script clicks either button. |
| AVQ-07 | Assert the discard confirmation's confirm button visually looks destructive by checking a concrete rose-family computed background after a short style-settle pause. | Safe/teal destructive confirmation fails with a severity-style assertion. |
| AVQ-08 | Assert the selected Bug feedback tile is at least `0.15` effective-opacity points more prominent than the non-selected sibling tiles. | Dim selected Bug tile fails after choosing Bug. |
| AVQ-09 | Add a stable `data-testid` for the History count badge and assert it equals the visible seeded history item count in the history scenario. | A badge showing `99` with one visible item fails with a data-integrity assertion. |
| AVQ-10 | Strengthen the full-Mac release smoke with two lightweight checks: setup copy must include the visible identity phrase `nixmac needs`, and the first screenshot must contain enough light pixels in the setup-icon region to prove the logo/detail rendered. | A full-Mac launch that is usable but visually unbranded fails with a human-readable first-screen identity error. |

Implementation notes:

- Keep visual timeline analysis as review evidence only; do not count generic
  frame observations as gate catches.
- Prefer deterministic DOM/computed-style assertions for hosted WDIO. They are
  fast, stable, and make the PR failure text specific.
- Apply the ancestor-aware visibility helper across all hosted text/element
  visual assertions so parent `opacity-0` cannot hide content while tests pass.
- Keep the full-Mac assertion lightweight. It should not attempt full OCR-based
  design QA; it should only ensure the installed app launches into a recognizable
  nixmac first screen using the captured screenshot plus targeted setup copy.
- After implementation, rerun the same adversarial hosted mutation runner and
  expect AVQ-01 through AVQ-09 to fail for named reasons. Rerun or inspect the
  full-Mac AVQ-10 dispatch result separately because it depends on the remote
  Mac lane and exact CI app build.

## Post-Fix Verification

The original adversarial score was **1 caught / 10 executed**. After the visual
assertion fixes, the hosted probes were rerun with isolated, one-mutation runs
to avoid WebView/static-asset cache contamination between source rewrites. The
full-Mac probe was rerun through GitHub Actions against a temporary validation
branch and real Mac lane.

| ID | Post-fix gate result | Caught by gate? | Specific failure surfaced | Evidence |
| --- | --- | --- | --- | --- |
| AVQ-01 | `failed` | Yes | Timed out waiting for exact visible `Get started` title. | `/tmp/nixmac-avq-results-3/summary.json` |
| AVQ-02 | `failed` | Yes | `Settings gear icon should be visibly correct (effective_opacity_zero)` | `/tmp/nixmac-avq-results-3/summary.json` |
| AVQ-03 | `failed` | Yes | `Prompt input text should be visibly correct (transparent_text)` | `/tmp/nixmac-avq-results-4-subset/summary.json` |
| AVQ-04 | `failed` | Yes | `Disabled send button affordance should be visibly correct (disabled_opacity_too_high:1.00)` | `/tmp/nixmac-avq-results-3/summary.json` |
| AVQ-05 | `failed` | Yes | `Visible text: jetbrains-mono should be visibly correct (visible_text_missing)` | `/tmp/nixmac-avq-results-5-avq05/summary.json` |
| AVQ-06 | `failed` | Yes | `Discard dialog cancel label should be visibly correct (unexpected_text:Confirm)` | `/tmp/nixmac-avq-results-7-avq06/summary.json` |
| AVQ-07 | `failed` | Yes | `Discard confirmation destructive button should be visibly correct (not_destructive_color:rgb(94,234,212))` | `/tmp/nixmac-avq-results-6-discard/summary.json` |
| AVQ-08 | `failed` | Yes | `Bug feedback type selected state should be visibly correct (selected_not_prominent:0.40<=0.40)` | `/tmp/nixmac-avq-results-3/summary.json` |
| AVQ-09 | `failed` | Yes | `History count badge should be visibly correct (unexpected_text:99)` | `/tmp/nixmac-avq-results-4-subset/summary.json` |
| AVQ-10 | `failed` | Yes | `First screen did not contain visible nixmac setup identity copy` | GitHub Actions run `24944184057`; report: https://releases.nixmac.com/e2e/manual/24944184057/edbf9a1a583ae75ae6c03f5c627538547140cdda/release_dmg_app_translocation_smoke/index.html |

Post-fix adversarial score: **10 caught / 10 executed**.

The authoritative hosted evidence is the isolated per-probe result set above.
An all-in-one mutation runner is still useful for smoke feedback, but it can
produce misleading later-probe failures when Vite/WebView cache state survives
between repeated source rewrites. The gate itself executes clean checkout runs,
so the isolated evidence better matches CI behavior.

Baseline regression verification after the fixes:

- `VITE_NIXMAC_E2E=true bun run build`
- `bun run test:wdio:smoke`
- `bun run test:wdio:prompt-keyboard`
- `bun run test:wdio:discard`
- `bun run test:wdio:feedback-report`
- `bun run test:wdio:history-navigation`
- Full-Mac AVQ-10 validation through `nixmac E2E Gate` run `24944184057`
