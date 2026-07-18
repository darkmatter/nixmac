# Evolve-loop convergence follow-ups

Findings from the first hermetic Critical-priority baseline run
(2026-07-18, 28 cases, `gpt-oss-120b` via an OpenAI-compatible endpoint,
results in `data/results-critical-baseline/`). These are **product-side
issues in the nixmac evolve engine**, observed through eval traces — they
are not eval-suite bugs. Recorded here so eval work can stay focused;
each item should become its own fix/PR against `apps/native`.

Baseline context: 16/28 cases generated cleanly, 7 ended
conversationally (5 of them correctly), 5 hit `limitReached`. Every
`limitReached` case traces back to one or more of the mechanisms below.

## 1. Build-error truncation drops the root cause

`truncate_build_output_for_model`
(`apps/native/src-tauri/src/evolve/mod.rs:1854`) slices the build output
from the last `error:` line, but when that section still exceeds
`BUILD_OUTPUT_MAX_CHARS` (6,000) it truncates the **tail**. Nix puts the
causal message at the *end* of the `… while evaluating …` chain, so for
long errors the model sees the trace preamble and loses the actual
failing line, then debugs by guessing (observed: model invented a
".nixmac git tracking" explanation from an unrelated dirty-tree
warning).

Also: first builds flood stderr with lockfile-creation noise
(`creating lock file …`, `Added input 'nixpkgs' …`) that eats the
6,000-char budget before any error text.

**Fix direction:** keep the tail (root cause) rather than the head when
over budget; strip lockfile/warning noise before budgeting.

## 2. `done`-rejection hint references a parameter that doesn't exist

When `done` arrives with unverified edits the engine replies
`"Run build_check with host='<host>' to validate, then call done again"`
(`apps/native/src-tauri/src/evolve/mod.rs:2186`) — but the `build_check`
tool only accepts `show_trace`, not `host`
(`apps/native/src-tauri/src/evolve/tools/build_check.rs`). gpt-oss-120b
takes the hint literally, concludes the tool is broken
("Cannot run build_check with host parameter"), and starts re-calling
`done` with near-identical summaries. The rejection text is identical on
every repeat, so nothing breaks the cycle; one case spent iterations
11–25 in this loop.

**Fix direction:** drop the phantom `host` argument from the message;
escalate/vary the message after the first repeated rejection (e.g. name
the last build error inline).

## 3. Nothing terminates a doomed session early

`build_attempts` is capped (5) but reaching the cap does not end the
evolution, and repeated rejected `done` calls don't count toward any
limit. The only exit is `maxIterations` → `limitReached`, so a session
that cannot fix its build always burns the full iteration and token
budget (cases 39, 44, 60: 25 iterations, 265–425k tokens each).

**Fix direction:** end with a graceful structured failure when the
build-attempt cap is hit, or after N identical rejected `done` calls,
instead of grinding to `limitReached`.

## 4. Exploration thrash: repeated tool calls, no dead-end detection

Case 50 ("configure git with name/email") spent all 18 iterations on
`list_files`/`search_code`/`read_file` — including literally repeated
calls (`list_files pattern="**/modules/**"` twice, overlapping regex
searches) — and made zero edits, hunting for a home-manager-style
`programs.git` location the template doesn't obviously have.

Related: case 65 (intentionally ambiguous "make my mac look cool")
ground through 25 iterations / 453k tokens instead of using the
conversational-response path that 7 other cases used successfully.

**Fix direction:** detect repeated identical tool calls and nudge the
model to commit to a decision; strengthen system-prompt guidance on
when to answer conversationally / ask for clarification instead of
continuing to explore.

## 5. `edit_nix_file action=set` on nested paths inserts conflicting, stringified assignments

Observed in the case 44 re-run after fix 1 landed (2026-07-18,
`data/results-critical-truncfix`). The model called
`edit_nix_file action=set path=inputs.home-manager` with a Nix attrset
as the value. `nix_file_editor` did not find the path and fell back to
"inserting scalar assignment", producing a **top-level**

```nix
inputs.home-manager = "{
      url = \"github:nix-community/home-manager\";
      inputs.nixpkgs.follows = \"nixpkgs\";
    }";
```

Two defects in one: the assignment conflicts with the existing
`inputs = { … }` binding (`error: attribute 'inputs' already defined`,
because Nix forbids mixing `inputs = {…}` and `inputs.x = …` at the
same level), and the attrset value was serialized as a quoted string
literal. The model then spent its remaining iterations repairing the
damage and hit `limitReached` anyway.

**Fix direction:** when a `set` path's outer segment matches an
existing attrset binding, merge the new attribute inside it instead of
inserting a sibling path assignment; detect values that parse as Nix
expressions and splice them unquoted rather than stringifying.

## 6. `list_files` with `pattern="**"` returns 0 files in a populated repo

Observed once during the fix-4 recalibration run (case 50, crashed
attempt): the model called `list_files pattern="**"` and got
"Found 0 files" from a fully populated temp config. The glob semantics
of bare `**` apparently match nothing (vs `**/*`). This feeds the model
a false "repository is empty" signal at the worst possible moment.
Check the glob translation in `evolve/tools/list_files.rs`.

## Re-run log

- **2026-07-18, after fix 1** (branch `jp/evolve-build-truncation`,
  PR #551; results in `data/results-critical-truncfix`, cases 39/44/60
  only): case 39 `limitReached` → `generated` (25→16 iterations,
  265k→162k tokens); case 60 unchanged (0 builds/edits — pure
  exploration thrash, item 4); case 44 still `limitReached` but no
  longer error-blind — with the dirty-tree warning stripped the model
  correctly diagnosed `attribute 'inputs' already defined` instead of
  inventing a git-tracking explanation. Its remaining blockers are
  item 5 (which caused that error) and a late first `build_check`
  (iteration 18/25). Single runs — the full 28-case sweep is still the
  real re-measure.

- **2026-07-18, after fixes 2+3** (branch `jp/evolve-done-rejection`,
  PR #552; results in `data/results-pr2-check`, cases 39/44/60, run
  against a PR1+PR2 merge): all three hit `limitReached` at 25
  iterations — but **zero `done` rejections occurred in any of them**,
  so the new paths (escalating rejection message, early stop after 3
  rejections) were never exercised. All three failed via
  exploration/edit thrash this round (item 4), including case 39 which
  had passed cleanly in the previous sample. Illustrates how
  run-to-run variance dominates 3-case samples with gpt-oss-120b;
  item 4 is now clearly the dominant remaining failure mode.

- **2026-07-18, after fix 4** (branch `jp/evolve-thrash`, PR #553;
  results in `data/results-pr3-check` and `data/results-pr3b-check`,
  run against a PR1+PR2+PR3 merge): case 65 now ends
  **conversationally at iteration 2 / 18k tokens** (baseline 25 it /
  453k) — the headline win. Case 50 `generated` cleanly on repro with
  git config implemented (baseline: 18 it of pure thrash, 0 edits);
  its first attempt died as a one-off process exit mid-`read_file path="."` that did not reproduce (also surfaced item 6). Case 44
  `generated` with a verified build. Calibration note: the first
  prompt draft made case 39 bail out conversationally at iteration 4
  instead of creating the zsh config — fixed by gating the bail-out on
  vague *intent* rather than missing *files* before landing. Case 39
  remains noisy across runs (generated in some samples, limitReached
  in others). The repeat-call nudge fired once across these runs;
  literal repeats are rarer than the baseline suggested.

## How to re-measure

Re-run the baseline after each fix and diff the scorecards:

```sh
cd apps/eval
uv run python run_evals.py --csv data/test_prompts.csv \
  --priority Critical --results-dir data/results-critical-<tag> \
  --vllm-url "$VLLM_URL" --vllm-api-key "$VLLM_API_KEY"
uv run python calc_stats.py -i data/results-critical-<tag>
```

Watch: `limitReached` count (baseline: 5/28), iterations and
`totalTokens` on cases 39, 44, 50, 60, 65, and that the 16 clean
`generated` cases stay clean. Note `calc_stats.py` currently counts any
produced result as PASS — it does not compare against
`expected_outcome` (separate eval-suite follow-up).
