# Arximboldi eval: agent improvement analysis

Date: 2026-07-20

This document analyzes the `glm-5.2-fp8` run against
`data/test_prompts_arximboldi.csv`, using `arximboldi/dotfiles` at commit
`c4afbb3f740a25b0e6af8459501ffb614bab009d`, config directory `nix/os`, and
host `tyrell2`.

Artifacts:

- report: `data/report_glm52_arximboldi_20260720/index.html`
- results: `data/results_glm52_arximboldi_20260720/`
- input cases: `data/test_prompts_arximboldi.csv`

## Executive summary

The deterministic report says 19/28 passed (67.9%), but that number is not a
reliable measure of agent effectiveness yet. A manual review gives this more
useful breakdown:

- 15 clearly satisfactory results
- 7 genuine agent-behavior failures: 3, 169, 170, 201, 215, 303, and 306
- 3 provider/infrastructure failures that need rerunning: 219, 301, and 304
- 2 expectation or grader problems: 53 and 226
- 1 nominal pass whose runtime effect is too uncertain: 305

The highest-leverage product problem is that repository context construction
failed during the run. On macOS, the same temporary directory was observed as
both `/tmp/...` and `/private/tmp/...`; lexical `Path::strip_prefix` then failed
and the entire `<repo_view>` was replaced with `(Failed to render repo view)`.
This makes the system prompt's main source of repository structure unavailable
and helps explain why the model repeatedly confused a package that exists
somewhere in the repository with one active for `tyrell2`.

The next most important problems are:

1. The agent has no explicit representation of the target host's module/import
   closure.
1. An actionable request can terminate as a conversational response with no
   check that the requested state was actually satisfied.
1. The grader treats every conversational `succeed` result as a pass, which
   concealed two real failures.
1. Nix build success does not establish that generated activation scripts will
   work or change the intended application preference.
1. Failure artifacts discard the detailed completion logs needed for diagnosis.

## What the cases show

| Case | Human assessment | Evidence and likely cause |
| --- | --- | --- |
| 3 | Agent failure | `htop` was already active in `tyrell0/darwin-configuration.nix`, which is the module used by `tyrell2`. The agent instead added a second, inactive `environment.systemPackages = [ htop ];` to `common/devel.nix`, with poor formatting. This combines missed host scope, missed existing state, and a non-minimal edit. |
| 53 | Eval expectation problem | Fira Code and the JetBrains Mono **Nerd Font** were present, but plain `jetbrains-mono` was commented out. Enabling the plain font is a defensible interpretation of “Install JetBrains Mono.” This should not be a strict no-op case unless the prompt explicitly asks for the Nerd Font variant. |
| 169 | Agent failure despite automatic pass | The no-op was correct, but the explanation was materially false: it claimed there were no Homebrew casks, no Darwin setup, and that the repository looked NixOS-only. `tyrell0/darwin-configuration.nix` contains `homebrew.casks` and is imported by `tyrell2`. |
| 170 | Agent convergence failure | The request described already-absent Docker Homebrew state. The agent used 18 iterations and 222,976 tokens, produced no edit and no explanation, and ended `limitReached`. |
| 201 | Agent failure hidden by grader | The agent found Firefox in `common/internet.nix` and declared the request already satisfied. That module is not imported by `tyrell2`; Firefox should have been added to the active Darwin package list. |
| 215 | Agent failure hidden by grader | The agent correctly discovered that Home Manager was not integrated and listed the required changes, but then asked for permission to edit `flake.nix`. “Add a home-manager service” already authorizes the integration work necessary to fulfill the request. No changes were made. |
| 219 | Infrastructure failure | The result ended `failed` after 627,678 ms with no edit. The run output showed an upstream provider connection/timeout failure. This is inconclusive for agent quality. |
| 226 | Grader false negative | The agent accurately reported that `allowUnfree`, VS Code, and Slack were already configured, made no edit, and gave a useful explanation. It failed only because it ran one build; `is_conversational` currently requires zero build attempts. The build was unnecessary but not a bad user outcome. |
| 301 | Infrastructure failure | The result ended `failed` after 502,857 ms and only two iterations due to the provider. It did not exercise the important `gnujump` host-scope behavior. |
| 303 | Agent failure and validation gap | Bash was already enabled and configured as the user's login shell, so no edit was needed. The agent changed `dscl -create` to `dscl -change` but omitted the required `old_val`; local `dscl(8)` documents the form as `-change record_path key old_val new_val`. The Nix build still passed because it did not execute the activation script. |
| 304 | Infrastructure failure | The result ended `failed` after 807,268 ms due to the provider, before any edit or build. The cross-platform module behavior remains untested. |
| 305 | Risky nominal pass | The generated activation script hard-codes `/Users/raskolnikov`, only edits profile index 0, does nothing until the plist exists, and suppresses all `PlistBuddy` failures with `|| true`. A successful Nix build cannot show that iTerm will actually use Inconsolata. |
| 306 | Agent idempotency failure | Hotkeys 60 and 61 were already disabled. The agent spent 18 iterations and 335,458 tokens rewriting comments around the same values, creating a user-visible diff with no functional change. |

Cases 2, 4, 5, 9, 10, 11, 12, 13, 16, 21, 48, 72, 210, 302, and 307
were satisfactory on manual review. Several successful edit cases were still
expensive, so correctness should be protected while improving convergence.

## Root causes in the code

### 1. Repository context can disappear because paths are not canonicalized

`apps/native/src-tauri/src/evolve/config_dir_context.rs` calls
`strip_prefix(repo_root)` for depth calculation and for every rendered or
gitignore-relative path (currently around lines 43, 136, and 178). On macOS,
`/tmp` resolves through `/private/tmp`, but the two spellings are not lexically
prefix-compatible.

`apps/native/src-tauri/src/evolve/mod.rs` catches this error around lines
1151-1159, logs a warning, and continues with `(Failed to render repo view)`.
The system prompt, however, explicitly tells the model to plan from
`<repo_view>` (`prompts/system.md`, around lines 54-75 and 398-403). Continuing
without it is therefore a substantial degradation rather than a harmless
fallback.

Recommended change:

- Canonicalize both `repo_root` and `config_dir` once, before walking.
- Canonicalize or construct child paths from that canonical root consistently.
- Prefer `PathBuf` rather than converting `config_dir` to `&str` at this layer.
- Add a macOS regression test with a symlinked root analogous to
  `/tmp -> /private/tmp`.
- If context rendering still fails, emit a structured degraded-context flag in
  telemetry and either rebuild the view with a safe fallback or stop before
  spending model tokens.

### 2. A file tree is not enough; the agent needs target-host reachability

The hard cases are not ordinary text search. They ask whether a declaration is
effective for a particular flake output. For example:

- `common/internet.nix` contains Firefox but is not in the `tyrell2` closure.
- `common/gaming.nix` contains `gnujump` but is not in the `tyrell2` closure.
- `tyrell0/darwin-configuration.nix` has a misleading host-like name but is the
  module imported by both Darwin outputs, including `tyrell2`.

Search can establish occurrence, not reachability. The agent currently has to
reconstruct that distinction from loosely related reads, which it failed to do
in cases 3, 169, and 201.

Recommended change:

- Build a small `target_context` before the first completion: selected flake
  output, platform, direct modules, recursively imported local modules, and the
  file that defines each relevant option when evaluation can provide it.
- Put this next to `<repo_view>` in the prompt, with an explicit warning that a
  match outside the active closure does not satisfy the request.
- Add a read-only tool such as `inspect_option` or `is_active_for_host` that can
  answer “what is the effective value and where did it come from?”
- Require the initial `think` step to name the target host and active edit file
  before editing or declaring an actionable request already satisfied.

Where feasible, obtain effective values from Nix evaluation rather than only a
static import parser. Static parsing remains useful as a fast fallback because
imports may be conditional or computed.

### 3. Conversational termination does not preserve task intent

In `apps/native/src-tauri/src/evolve/mod.rs` around lines 1868-1900, any final
assistant message with no tool calls and no edits becomes `Conversational`.
There is no distinction among:

- a genuine conversational question,
- a verified already-satisfied request,
- an actionable request the model declined to implement,
- a wrong assertion that an inactive declaration satisfies the request.

That is how cases 201 and 215 ended cleanly despite not fulfilling their
prompts.

Recommended change:

- Classify intent near the start of a turn: `informational`, `ambiguous`, or
  `actionable`.
- For actionable turns, allow no-edit completion only through a structured
  `already_satisfied` outcome containing the evidence checked: target host,
  effective option/package, and source file.
- If an actionable turn returns plain conversational text without that evidence,
  feed back a single correction asking the model to either implement the change,
  prove the effective state, or report a concrete blocker.
- Treat the user's requested end state as authorization for ordinary necessary
  integration edits. The protected-file rule should prevent unrelated flake
  churn, not make the agent ask again when Home Manager integration necessarily
  requires `flake.nix`.

The system prompt already says concrete requests are actionable and users expect
the agent to make necessary changes (`prompts/system.md`, lines 6 and 38-40).
The runtime should enforce that contract instead of relying on prose alone.

### 4. No-op detection and semantic minimality are weak

Cases 3, 303, and 306 edited configurations that already expressed the requested
state. Case 306 is particularly useful: the effective Nix values did not change;
only comments did.

Recommended change:

- Add an idempotency preflight for actionable configuration requests: inspect
  the effective current state before proposing an edit.
- After every edit, compare the parsed Nix values before and after. If only
  whitespace/comments changed and the request did not ask for documentation or
  formatting, discard the edit and return `already_satisfied`.
- Add a final “minimal diff” check: every changed attribute should map to an
  explicit user outcome.
- Teach `edit_nix_file` to report `already_present`/`already_absent` as a typed
  result, not merely a text response the model may work around with `edit_file`.

During the run, some successful cases also needed repair after structured edits
before reaching their final diff. The existing tests in
`nix_file_editor.rs` cover simple `with pkgs; [ ... ]` lists, but the
Arximboldi fixtures should be added verbatim as regression fixtures so comments,
bindings, and the repository's formatting are preserved. The final case 3 diff
(`environment.systemPackages = [ htop ];}`) is also evidence that raw fallback
edits need formatting and duplicate-option safeguards.

### 5. Build validation does not validate activation-time behavior

`build_check` proves that Nix can evaluate and build the selected system. It does
not execute macOS activation scripts against Directory Service or application
preference files. This let case 303's invalid `dscl -change` invocation and case
305's failure-swallowing plist script look successful.

Recommended change:

- Run shell syntax checking on generated activation snippets.
- Add focused lint rules for known macOS commands whose argument structure is
  checkable (`dscl`, `defaults`, and `PlistBuddy`).
- Do not permit blanket `|| true` around the operation that implements the
  requested outcome; handle expected absence explicitly and surface other
  failures.
- Derive user paths from the Nix configuration (`config.system.primaryUser`,
  `config.users.users.<name>.home`, or an equivalent value) instead of embedding
  a literal `/Users/...` path.
- For application preferences, prefer a declarative option when one exists. If
  an imperative script is unavoidable, make it idempotent, update the intended
  profile(s), and report limitations rather than silently succeeding.

### 6. Convergence intervention happens too late

The no-progress threshold is 75% of `max_iterations`
(`MAX_ITERATIONS_BEFORE_EDIT_PERCENT` in `evolve/mod.rs`, line 339; applied
around lines 1100-1104 and 1902-1924). With a limit of 25, the first intervention
is iteration 18. Case 170 consequently consumed 222,976 tokens before ending
without even an explanation; case 306 used 335,458 tokens for a comment-only
change.

Recommended change:

- Add an earlier decision checkpoint after roughly 4-6 exploration calls or 25%
  of the iteration budget.
- At the checkpoint, require exactly one next mode: edit, verified no-op,
  clarification, or structured blocker.
- Detect repeated or substantially overlapping reads/searches, not only exactly
  identical tool calls.
- Budget by lack of new evidence as well as iteration count. A tool call that
  discovers no new path, option, or value should not reset progress.
- Track time and tokens by phase (`context`, `exploration`, `edit`, `repair`,
  `build`) so regressions are visible in reports.

This complements the existing observations in
`apps/eval/wip/evolve-loop-convergence-followups.md`; it does not replace the
build-error and repeated-`done` fixes recorded there.

### 7. Provider failures need their own outcome and retained evidence

Cases 219, 301, and 304 spent roughly 10.5, 8.4, and 13.5 minutes respectively
before ending `failed`. The result JSON does not preserve the provider error, so
the deterministic grader classified these as ordinary `no_action` or `other`
failures.

The OpenAI-compatible provider currently returns normalized transport/HTTP
errors directly (`evolve/providers/openai.rs`, around lines 201-216 and
263-306). Retrying all failures inside the product could duplicate expensive or
billable calls, so recovery should be conservative and split between product and
eval harness.

Recommended change:

- Emit structured terminal data: `failure_origin=provider`, HTTP status when
  known, retryability, request duration, and whether any streamed content was
  received. Never put credentials or raw prompt bodies in the report.
- Bound each provider request by the evolution's remaining wall-clock deadline.
- Retry only clearly transient failures (for example 502/503/504/524 or a
  connection reset before any response), with small capped backoff and jitter.
- In the eval harness, retry a whole case once when it ends with a retryable
  provider failure, and otherwise mark it `inconclusive`; do not include it in
  the agent pass-rate denominator.
- Save the error metadata in the case result even when no
  `evolution_result.json` is produced.

Detailed completion logs were not available after this run. `run_evals.py`
deletes the per-case hermetic app-data directory in `finally` (around lines
493-496), which also removes logs written beneath it by
`state/completion_log.rs`. Add `--keep-logs` or copy a redacted log bundle into
the case results directory before cleanup, at least for failed and
`limitReached` cases.

### 8. The grader currently rewards the wrong behavior

`apps/eval/grade.py` has two relevant shortcuts:

- `is_conversational` (around lines 138-155) treats historical conversational
  state as sufficient, but otherwise requires zero builds.
- `grade_succeed` (around lines 259-269) treats every conversational response as
  satisfying both the diff and build checks.

The first caused case 226's false negative. The second caused cases 201 and 215
to pass even though their prompts were actionable and unfulfilled. In addition,
the Arximboldi expectations file contains no semantic per-case assertions, so
the grader could not catch an edit to an inactive file or a script that merely
mentions the right words.

Recommended change:

- Add an explicit CSV/expectation field such as `allowed_completion` with values
  `edit`, `already_satisfied`, `clarify`, or `conversational`.
- Require a diff for actionable `succeed` cases unless `already_satisfied` is
  explicitly allowed and structurally evidenced.
- Define no-op quality independently of build count. A read-only build may be
  wasteful, but it should be scored as an efficiency issue rather than turning a
  correct response into a task failure.
- Add semantic Arximboldi expectations: permitted files, required effective
  values for `tyrell2`, forbidden inactive files, and whether a no-op is required.
- Give provider failures an `inconclusive` grade and report both raw and
  agent-only pass rates.
- Add a secondary response-faithfulness check for no-op explanations so a
  correct empty diff with false claims, as in case 169, does not pass.

## Prioritized implementation plan

### P0: make the run trustworthy

1. Canonicalize repository paths and add the `/tmp` versus `/private/tmp`
   regression test.
1. Preserve redacted per-case logs and structured provider failure metadata.
1. Fix conversational grading and add explicit completion modes.
1. Populate semantic expectations for the Arximboldi cases.

### P1: make target-state reasoning reliable

1. Add target-host import/effective-option context.
1. Add structured `already_satisfied` completion with evidence.
1. Add semantic no-op/minimal-diff detection.
1. Clarify that a concrete Home Manager request authorizes necessary flake
   integration while unrelated protected-file edits remain prohibited.
1. Add activation-script linting and remove failure-swallowing success paths.

### P2: improve efficiency and resilience

1. Move the no-progress decision checkpoint earlier and detect exploration
   without new evidence.
1. Add conservative transient-provider retry and eval-level rerun support.
1. Add phase-level time/token telemetry and report efficiency separately from
   correctness.

## Acceptance criteria for the next run

- Repository context renders successfully for every case, with no
  `/tmp`/`/private/tmp` prefix warnings.
- Cases 3, 201, and 301 distinguish active `tyrell2` state from inactive common
  modules.
- Cases 169, 170, 226, 302, 303, 306, and 307 return a correct, evidenced no-op
  without changing files. A diagnostic build is allowed but reported as an
  efficiency cost.
- Case 215 implements the requested Home Manager integration or reports a real
  technical blocker; it does not ask permission already implied by the prompt.
- Case 303 never replaces the working shell configuration with an invalid
  `dscl -change` command.
- Case 305 either uses a reliable declarative mechanism or produces an
  idempotent, user-derived, non-silent implementation whose limitations can be
  tested.
- Transient provider failures are labeled inconclusive, retain actionable error
  metadata, and can be rerun independently.
- No actionable `succeed` case passes solely because it returned conversational
  text.
- No functionally unchanged diff passes an idempotency case.
