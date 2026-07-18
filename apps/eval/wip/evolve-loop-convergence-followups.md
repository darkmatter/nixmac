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
