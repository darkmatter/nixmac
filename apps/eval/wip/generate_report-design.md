# `generate_report.py` — Design Doc

**Status:** Draft, pending review
**Author:** Juan Pedro
**Goal:** Make eval output evaluable by a human in minutes, not hours.

______________________________________________________________________

## Problem

Today, inspecting an eval run means:

1. Eyeballing the terminal output of `calc_stats.py` (a fixed-width table).
1. Re-running `grade.py` and reading another terminal block.
1. Opening individual `case_*_result.json` files to see the prompt, the diff,
   the grading detail, the conversational reply.
1. Going to the `NIXMAC_LOGFILE` (`*.out`) to grep around for the chain of tool
   calls used in a given iteration.

Every step is a context switch. There is no shareable artifact: a reviewer
who is not me cannot inspect the same run without rerunning everything.

## What this tool does

A single Python script, `apps/eval/generate_report.py`, that takes:

- the results directory (default `data/results/`),
- optionally the eval log file (`NIXMAC_LOGFILE`, default auto-detected),

and produces an HTML report under `data/report/` (configurable) that a human
can open locally to inspect the whole run.

```
uv run python generate_report.py
uv run python generate_report.py -i data/results -o data/report
uv run python generate_report.py --log 2026-05-19-evals.out
uv run python generate_report.py --golden-only
```

It does **not** re-run the eval and does **not** re-grade — it expects
`grade.py` to have run first (and warns if any case is missing `grade`).

## User journey

Two personas, one document.

**Reviewer (PM, eng lead).** Opens `report/index.html`. Sees the headline
pass rate, the segmented breakdown, and a scannable table of all cases.
Clicks into the failed ones. Reads the prompt, sees the diff, reads
*why* the grader marked it failed, decides whether they agree.

**Author of changes (model / prompt iteration).** Same entry point.
Filters to a single failure class or a single category. For one case,
expands the chain of tool calls to understand *what the model was trying
to do* before it went wrong.

The report should be openable directly from disk (`file://`) — no server.

## What the report looks like

### Layout

```
data/report/
├── index.html         ← summary + case table, links to detail pages
├── cases/
│   ├── case_1.html
│   ├── case_3.html
│   └── ...
└── assets/
    ├── style.css
    └── report.js      ← only for client-side filter/sort
```

(Open question — see Q1 — whether multi-file or single-file is preferred.)

### `index.html`

**Section 1 — Headline.** One block, large:

> **Pass rate: 23 / 28 (82%)** — golden set
> Model: `gpt-oss-120b` (vllm) · Summary: `gpt-4o` · 2026-05-19 · 28 cases

If a previous report is supplied via `--compare path/to/prev`, the
delta vs. the previous run goes here too (`+2 cases`, `-1 case`).

**Section 2 — Segmented summary.** Three cards side by side:

- **Succeed** (N/M passed)
- **Fail gracefully** (N/M passed)
- **Refuse** (N/M passed)

Each card shows pass rate, count, and the dominant failure class
for the failures in that bucket.

**Section 3 — Aggregate stats.** The same numbers `calc_stats.py`
prints today, but rendered as a clean table with three columns:
Overall / Passing / Failing. Sourced by importing `calc_stats`
directly (no logic duplication).

**Section 4 — Failure breakdown.** Bar chart or simple bar-row of
`failure_class` counts, with each bar linking to a filtered view of
the case table (e.g. clicking `reasoning_error` scrolls the table
and applies the filter).

**Section 5 — Case table.** One row per case. Columns:

| # | Status | Outcome | Category | Iters | Builds | Tokens | Duration | Failure class | Prompt (truncated) |
|---|--------|---------|----------|-------|--------|--------|----------|---------------|--------------------|
| 1 | ✓ | succeed | package | 5 | 1 | 41101 | 14s | — | Install ripgrep … |

- Row links to `cases/case_N.html`.
- Header is sortable client-side. A tiny set of filter chips at the
  top: `All / Pass / Fail / succeed / fail_gracefully / refuse / golden-only / has-tool-trace`.
- Conversational cases get a 💬 glyph in the diff column.

### `cases/case_N.html`

A single page per case, top to bottom:

1. **Header.** Case ID, status pill (PASS/FAIL), expected outcome,
   category/subcategory, priority. Links: ← previous / next →, back to index.
1. **Prompt.** Verbatim, in a quoted block. CSV `notes` column shown
   underneath if present.
1. **Verdict.** A table of grading checks (`completed_ok`, `has_diff`,
   `build_attempted`, …), each with a ✓/✗ and the grader's `detail`
   string. The failure class is highlighted if the case failed.
1. **Diff.** The unified diff from `result.gitStatus.diff`,
   syntax-highlighted (red/green per line, file headers bold). Empty
   diff renders as a placeholder. (Open question Q4 — diff library
   choice.)
1. **Conversational response.** Shown only if `result.conversationalResponse`
   is set, as a quoted block.
1. **Commit message / summary.** From `result.summary.commitMessage`
   / `result.summary.instructions` when present.
1. **Telemetry.** Compact table: iterations, build attempts, edits,
   tool-calls count, thinking entries, duration, tokens (in/out
   if available).
1. **Tool-call chain.** Collapsed by default. When expanded, shows the
   per-iteration trace parsed from the log (see "Where the tool-call
   chain comes from" below). If the log is unavailable, a friendly
   "tool trace not captured for this run" placeholder.

Every section has an anchor link so a reviewer can deep-link to
e.g. `case_27.html#diff`.

### Tool-call chain — what it looks like

Per iteration:

```
ITERATION 2  (active messages=4, build_attempts=0/5)
└── 🔧 list_files { pattern: "**/*.nix" }
    └── returned 365 bytes  (15 files)

ITERATION 3
└── 🔧 read_file { path: "modules/darwin/packages.nix" }
    └── returned 1111 bytes

ITERATION 5
└── 🔧 edit_nix_file { action: add, path: environment.systemPackages,
                       values: ["ripgrep","fd"] }
    └── 📝 Semantic Edit applied
```

Rendered as a vertical timeline. Tool name and args are the main signal;
the response size / summary is secondary. Long arg values are collapsible.

## Where the tool-call chain comes from

This is the most under-specified part of the existing pipeline and the
main reason for this doc.

- The result JSON only stores `telemetry.toolCallsCount` — no actual
  trace.
- The full trace exists only in the `NIXMAC_LOGFILE` (`*.out`), as
  stderr-style tracing-subscriber lines.
- The logfile contains *all* cases concatenated in run order, delimited
  by the `EVOLUTION STARTING` / `EVOLUTION COMPLETE` banners and an
  `Evolution ID:` line. Mapping log section → case ID is not direct;
  it has to be done by ordering against the prompt (logged as
  `📝 Prompt: <text>`) and/or run order.

The design assumes a best-effort log parser that:

- Splits the log into per-evolution sections.
- Matches each section to a result JSON by prompt text (exact match
  on the first line) — falls back to "section index N" if no match.
- Extracts each `ITERATION N`, `🔧 Model requested …`, `→ <tool> | args:`,
  `Tool returned … bytes`, and the various per-tool result lines
  (`📝 Semantic Edit`, `🔍 Search Packages …`).
- Stores the parsed trace as JSON next to the case (`cases/case_N.trace.json`)
  so the HTML can be regenerated without re-parsing the log.

If `--log` is omitted and no `*.out` is auto-detected, traces are simply
absent — the rest of the report still works.

## Out of scope (v1)

- Re-running the eval, or invoking `grade.py` automatically.
- Side-by-side diff of two runs (compare is text-only in v1).
- Anything LLM-as-judge (semantic grading is a separate workstream).
- Editing / annotating grades from the report (read-only).
- Hosting the report anywhere — purely local `file://`.

## Implementation sketch (non-binding, here to make the doc honest)

- Stdlib only where possible: `json`, `csv`, `html`, `pathlib`,
  `dataclasses`. Reuses `calc_stats.extract_metrics` and
  `grade.load_csv_lookup` / `grade.load_expectations`.
- Templating: Jinja2 if we're OK adding the dep; otherwise plain
  f-strings in a `templates.py` module. (Open question Q5.)
- Diff rendering: `difflib.HtmlDiff` is built-in but ugly; a small
  custom renderer that classes each line `add`/`del`/`hunk`/`ctx`
  is probably better. (Open question Q4.)
- Log parser: ~150 LOC, line-based state machine.
- No JS framework. A 50-line `report.js` for sort + filter on the
  case table. Page should be fully usable with JS disabled.

______________________________________________________________________

## Open questions / choices I'd like your input on

**Q1. Single-file vs. multi-file report.**
Multi-file (proposed above) keeps each case page small and lets you
share a single deep link. Single-file is easier to email / archive,
but a 28-case run with full tool traces will be ~5–10 MB of HTML and
slow to load. Lean multi-file?

ANSWER: multi-file

**Q2. Tool-call chain — how hard do we try in v1?**
Three options, in increasing effort:

1. **Skip it.** Ship without the tool-call timeline; add a "trace
   not available — pass `--log`" placeholder. Fastest, most honest.
1. **Best-effort log parse** (described above). Matches log sections
   to cases by prompt text. Works but is brittle when prompts repeat
   or get truncated in the log.
1. **Capture in the runtime.** Have `run_evals.py` (or nixmac itself)
   write a structured `case_N_trace.json` alongside the result. Most
   robust but requires changes outside this script.

My preference: ship (1) in v1 if (2) turns out to need >½ day to make
reliable; do (3) as a follow-up. Which would you rather?

ANSWER=1 + follow-up (perhaps include raw log).

**Q3. Run metadata.**
Each `case_*_result.json` knows its own model/provider, but there's
no run-level manifest (start time, end time, command-line args, eval
host, git SHA of the nixmac binary). For the headline section I can
either (a) derive from the cases (model = mode of `evolveModel`,
date = mtime of newest result file) or (b) require a `meta.json`
that `run_evals.py` writes. (a) is good enough; (b) is nicer but is
yet another runtime change. Go with (a)?

ANSWER = (b) + (a) when meta is not there)

**Q4. Diff rendering.**
Three options:

1. Plain `<pre>` with line-class colouring (50 LOC, no deps, looks fine).
1. `difflib.HtmlDiff` (built-in, but the markup is dated and hard to
   restyle).
1. `pygments` for syntax highlighting + a thin diff layer (prettier,
   one new dep, ~3 MB install).

I'd default to (1). Worth (3)?

ANSWER = (3)

**Q5. Templating.**
Jinja2 is the obvious choice but adds a dep. Given the small surface
(2 templates, both fairly static), inlined f-strings in a `templates.py`
module would work. Preference?

ANSWER = deps are fine, use jinja if it makes things cleaner.

**Q6. Comparison to previous runs.**
SCORECARD.md asks for a `Pass rate: XX% → YY%` line. In v1 I propose
just `--compare path/to/previous/report/` that reads its `manifest.json`
(written next to `index.html`) and prints deltas in the headline. Not
side-by-side. Is that enough?

ANSWER = Yes.

**Q7. Filtering / segmentation in the UI.**
Proposed chips: All / Pass / Fail / succeed / fail_gracefully / refuse
/ golden-only / has-tool-trace. Missing anything important? In
particular: priority filter (Critical/High/…) and category filter
would also be useful — but they balloon the chip strip. Dropdown
instead?

ANSWER = either is fine.

**Q8. Output location and `.gitignore`.**
`data/report/` would by default be checked in. The `.gitignore`
currently excludes `data/results` and `data/results_*` but not
`data/report`. I assume reports are artifacts, not committed —
add `data/report` / `data/report_*` to `.gitignore`?

ANSWER = add data/report to gitignore

**Q9. What's the smallest version that's still useful?**
If we have to cut, I'd cut in this order: tool-call chain → comparison
mode → fancy diff → filter chips → segmented cards. The minimum
viable report is: headline + aggregate table + per-case pages with
prompt, verdict, and diff. Agree with that ordering?

ANSWER = Agree.
