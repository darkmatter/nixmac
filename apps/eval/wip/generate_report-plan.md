# `generate_report.py` — Implementation Plan

**Status:** Ready to implement
**Companion doc:** `generate_report-design.md` (UX + decisions)
**Goal of this doc:** code structure, module boundaries, data flow,
cut order, and the small changes needed outside the script itself.

Decisions from the design doc that shape this plan:

- Multi-file HTML output (`index.html` + `cases/case_N.html`).
- Tool-call chain is **out of scope for v1** (stretch: raw log excerpt
  per case). Structured tool traces are a follow-up that requires
  runtime changes.
- New deps allowed: **Jinja2** for templating, **Pygments** for
  diff syntax highlighting.
- `run_evals.py` will write a `meta.json` alongside results;
  `generate_report.py` falls back to deriving metadata from the
  result files when it's absent.
- `--compare path/to/previous/report/` reads a `manifest.json` to
  compute text-only deltas in the headline.
- `data/report*` added to `.gitignore`.

______________________________________________________________________

## File layout

```
apps/eval/
├── generate_report.py            ← new, CLI entrypoint (thin)
├── report/                       ← new package
│   ├── __init__.py
│   ├── loader.py                 ← reads result JSONs + CSV + golden expectations + meta + log
│   ├── viewmodel.py              ← CaseView / RunView dataclasses (the report's "model")
│   ├── stats.py                  ← thin wrapper around calc_stats with extra rollups
│   ├── diff_html.py              ← unified-diff → HTML (Pygments-backed)
│   ├── log_excerpt.py            ← (stretch) split eval *.out into per-case slices
│   ├── render.py                 ← Jinja2 environment + render(run_view) → writes files
│   ├── templates/
│   │   ├── base.html.j2
│   │   ├── index.html.j2
│   │   ├── case.html.j2
│   │   └── _macros.html.j2       ← status pill, verdict table, telemetry row, etc.
│   └── assets/                   ← copied to output/assets/
│       ├── style.css
│       └── report.js             ← ~50 LOC, sort+filter on the case table
```

`generate_report.py` itself is a thin CLI: argparse → `loader.load(...)`
→ `render.write(run_view, out_dir)` → done. All heavy lifting lives in
`report/`.

Rationale for a package rather than one big file:

- Each module has one job and can be tested independently.
- `viewmodel.py` is the contract between everything else: loaders
  produce a `RunView`, the renderer consumes one. Adding a new data
  source later (e.g. structured tool traces) only touches `loader.py`
  and `viewmodel.py`.
- Avoids the trap `grade.py` and `calc_stats.py` already fell into
  (one ~400-line file mixing IO, computation, and presentation).

## Data flow

```
   data/results/case_*.json ─┐
   data/test_prompts.csv ────┤
   data/golden_set_*.json ───┼──► loader.load() ──► RunView ──► render.write() ──► out_dir/
   data/meta.json       ─────┤                                       ▲
   *.out (eval log)    ─────┤                                       │
   (compare report)    ─────┘                                       │
                                                                    │
                                              Jinja2 templates ─────┘
                                              Pygments diff
```

## Intermediate data model (`report/viewmodel.py`)

The whole point of this module is: **what does the HTML need to know
per case and per run?** Defining this up front means renderers can be
pure (no `json.load` calls in templates, no IO in render code).

```python
@dataclass(frozen=True)
class CheckView:
    name: str
    passed: bool
    detail: str

@dataclass(frozen=True)
class CaseView:
    case_id: int
    prompt: str
    notes: str | None            # from CSV
    category: str                # from CSV
    subcategory: str             # from CSV
    priority: str                # from CSV
    expected_outcome: str        # succeed | fail_gracefully | refuse
    is_golden: bool

    passed: bool                 # grade.pass
    failure_class: str | None
    checks: list[CheckView]

    # output artifacts
    diff: str                    # raw unified diff (may be "")
    diff_html: str               # pre-rendered HTML (Pygments)
    conversational_reply: str | None
    commit_message: str | None
    summary_instructions: str | None

    # telemetry
    iterations: int
    build_attempts: int
    edits_count: int
    tool_calls_count: int | None
    thinking_count: int | None
    duration_ms: int
    total_tokens: int
    state: str

    # stretch: best-effort log excerpt for this case
    log_excerpt: str | None      # None if log not provided or no match

    # provenance
    evolve_model: str | None
    evolve_provider: str | None

@dataclass(frozen=True)
class RunMeta:
    title: str                   # "golden set" or "full eval"
    generated_at: datetime       # report generation time, not run time
    run_started_at: datetime | None
    run_finished_at: datetime | None
    evolve_models: list[str]     # unique values seen across cases
    evolve_providers: list[str]
    summary_models: list[str]
    nixmac_git_sha: str | None
    eval_host: str | None
    cli_args: str | None
    sourced_from: str            # "meta.json" or "derived"

@dataclass(frozen=True)
class Segment:
    name: str                    # "succeed" / "fail_gracefully" / "refuse"
    cases: list[CaseView]
    @property
    def passed(self) -> int: ...
    @property
    def failed(self) -> int: ...
    @property
    def dominant_failure_class(self) -> str | None: ...

@dataclass(frozen=True)
class RunView:
    meta: RunMeta
    cases: list[CaseView]        # sorted by case_id
    segments: list[Segment]
    aggregate_stats: AggregateStats   # the calc_stats.Statistics, repackaged
    failure_breakdown: dict[str, int] # failure_class → count
    compare_to: "RunView | None"      # if --compare given
```

These types are explicit on purpose. The templates only see a
`RunView`; they don't reach into raw JSON.

## Module responsibilities

### `report/loader.py`

- `load(results_dir, csv_path, golden_path, meta_path, log_path, golden_only) -> RunView`
- Reads each `case_*_result.json`. Skips files missing a `grade` block,
  warns to stderr with the case ID.
- Joins each case to: the CSV row (for category/subcategory/priority/
  notes), the golden expectations (for `is_golden`).
- Builds `RunMeta` from `meta.json` if present; otherwise derives:
  - `evolve_models` = sorted unique values from cases
  - `run_started_at` / `run_finished_at` = min/max of result file
    mtimes
  - `sourced_from = "derived"`
- Calls `diff_html.render(case.diff)` to populate `diff_html`.
- (Stretch) Calls `log_excerpt.split(log_path)` and matches by prompt.

### `report/stats.py`

- Imports `calc_stats.extract_metrics`, `calc_stats.calculate_stats`.
- Adds a `segments(cases) -> list[Segment]` rollup.
- Adds `failure_breakdown(cases) -> dict[str, int]`.
- Does **not** print anything — `calc_stats.py` keeps its CLI; this
  module just consumes its computation.

### `report/diff_html.py`

- One function: `render(unified_diff: str) -> str`.
- Splits the unified diff into hunks per file. For the body of each
  hunk:
  - Strip the leading +/-/space markers.
  - Run the content through Pygments with a language guesser
    (defaulting to Nix for `.nix`, otherwise text) to get syntax
    highlighting on a per-line basis.
  - Wrap each line in `<span class="diff-add|diff-del|diff-ctx">`
    around the highlighted content so the green/red background reads
    cleanly.
- Returns a self-contained HTML fragment; Pygments-emitted CSS classes
  are styled in `style.css`.
- Empty diff → returns `""` so the template can show a placeholder.

### `report/log_excerpt.py` (stretch — see "Phasing")

- Walks the `*.out` line by line, slicing between
  `EVOLUTION STARTING` / `EVOLUTION COMPLETE` banners.
- Records each section's `📝 Prompt:` line as the lookup key.
- Returns `{prompt_text: log_section_text}`.
- The loader uses this to populate `CaseView.log_excerpt`.
- Pure text; no parsing into structured tool calls in v1.

### `report/render.py`

- Sets up a `jinja2.Environment(loader=PackageLoader("report"))`.
- Registers small filters: `pct`, `format_duration_ms`,
  `format_tokens`, `truncate_middle`, `failure_class_badge`.
- `write(run_view, out_dir)`:
  1. Render `index.html.j2` → `out_dir/index.html`.
  1. For each case, render `case.html.j2` → `out_dir/cases/case_<id>.html`.
  1. Copy `report/assets/*` → `out_dir/assets/`.
  1. Write `out_dir/manifest.json` (headline numbers, generated_at,
     case IDs, model — used by `--compare`).

### `report/templates/`

- `base.html.j2` — head, header, footer, includes `style.css` /
  `report.js`.
- `index.html.j2` — extends base, renders the five sections from the
  design doc.
- `case.html.j2` — extends base, renders the eight sections from the
  design doc.
- `_macros.html.j2` — `{% macro %}` definitions for the bits that
  repeat (status pill, verdict row, telemetry table).

### `generate_report.py`

```python
def main() -> None:
    args = parse_args()
    run_view = loader.load(
        results_dir=args.input_dir,
        csv_path=args.csv,
        golden_path=args.expectations,
        meta_path=args.meta,
        log_path=args.log,
        golden_only=args.golden_only,
    )
    if args.compare:
        run_view = run_view._replace(compare_to=loader.load_compare(args.compare))
    render.write(run_view, args.output_dir)
    print(f"Wrote report: {args.output_dir / 'index.html'}")
```

CLI surface (matches what's already shown in the design doc):

```
-i, --input-dir       (default data/results)
-o, --output-dir      (default data/report)
    --csv             (default data/test_prompts.csv)
    --expectations    (default data/golden_set_expectations.json)
    --meta            (default data/meta.json — optional)
    --log             (default: auto-detect *.out in cwd, else none)
    --golden-only
    --compare PATH    (path to a previous report dir with manifest.json)
```

## External changes needed

These are intentionally small and live in commits separate from the
main script. None are blocking the v1 happy path.

1. **`run_evals.py` writes `meta.json`.** New helper at the end
   of `main()` that dumps:

   ```json
   {
     "run_started_at": "...",
     "run_finished_at": "...",
     "cli_args": "...",
     "nixmac_path": "...",
     "nixmac_git_sha": "<best effort: git -C nixmac rev-parse HEAD>",
     "eval_host": "<socket.gethostname()>",
     "evolve_model": "...",
     "summary_model": "...",
     "max_iterations": ...
   }
   ```

   Loader falls back gracefully when absent (sets
   `RunMeta.sourced_from = "derived"`).

1. **`.gitignore`** — add `data/report` and `data/report_*`.

1. **`pyproject.toml`** — add `jinja2>=3.1` and `pygments>=2.17` to
   `dependencies`.

1. **`README.md`** — add a "Generating an HTML report" section under
   "Analyzing Results", mirroring the existing tone.

## Phasing / cut order

Each phase is independently shippable. The MVP is P1; everything else
is incremental polish.

**P1 — MVP (target: ½ day).**

- `loader.py` + `viewmodel.py` (CaseView, RunMeta, RunView).
- `diff_html.py` with Pygments.
- `render.py` + minimal templates (`base`, `index`, `case`).
- `style.css` (just enough to be readable).
- CLI: `-i`, `-o`, `--csv`, `--expectations`, `--golden-only`.
- Sections rendered: headline, aggregate table, case table,
  per-case pages with prompt / verdict / diff / conversational
  reply / commit message / telemetry.

**P2 — Segmentation + failure breakdown.**

- `stats.py` `segments()` and `failure_breakdown()`.
- Index sections 2 and 4 (segmented cards + failure bars).
- Anchor links from failure bars to filtered table view.

**P3 — Run metadata.**

- `run_evals.py` writes `meta.json` (the external change).
- Loader consumes it; falls back to derived.
- Headline displays git SHA, host, CLI args.

**P4 — Filter + sort.**

- `report.js` (50 LOC vanilla) for chips + sortable headers.
- Chips: status, expected outcome, golden-only.
- Dropdowns: priority, category.

**P5 — Comparison mode.**

- `--compare` flag, `manifest.json` produced by `render.write()`.
- Headline shows `XX% → YY% (+N / −M)` and lists regressions /
  new passes.

**P6 — Log excerpt (stretch within v1).**

- `log_excerpt.py` splits and matches by prompt.
- Renders raw text in a collapsible `<details>` on each case page.
- This is the "perhaps include raw log" follow-up note from the
  design doc — kept structurally separate so it's easy to cut.

**P7 — Follow-up (not v1): structured tool-call timeline.**

- Either (a) parse the log into structured tool calls, or (b) have
  the nixmac runtime emit a `case_N_trace.json`. (b) is the right
  long-term answer; this script is ready to consume it via a new
  field on `CaseView`.

## Testing

Light-touch. The pipeline is mostly IO + template rendering; the
interesting logic is small.

- `loader.load()` against the existing `data/results/` fixture →
  asserts on a few `CaseView` fields for known case IDs (1, 115,
  300). Runs in CI, fast.
- `diff_html.render()` — snapshot test against the case-1 diff.
- `stats.segments()` — pure function, table-driven test.
- A smoke test that runs `generate_report.py` end-to-end against
  the fixture and asserts: `index.html` exists, case count matches,
  `manifest.json` is valid JSON.

No HTML golden-file snapshots — too brittle, too noisy on style
tweaks.

## What this plan does *not* commit to

- Exact CSS / colors / layout polish. The templates will be drab on
  first pass; design polish is its own pass.
- The shape of the `case_N_trace.json` from P7. That contract is set
  by whoever changes the nixmac runtime, not by this script.
- An incremental / watch mode. The whole report regenerates in
  under a second; no need.
- Hosting. `file://` only, as agreed.

## Open implementation questions (worth flagging now)

These don't block starting — defaults are listed — but call them out
on review:

- **`meta.json` location.** I propose `data/meta.json`
  (one per results dir). If we plan to keep multiple result
  directories around, it should live alongside the results
  (`data/results/meta.json`). Slight preference for the latter
  ANSWER: latter.
- **Pygments lexer for non-`.nix` files in diffs.** Default to `text`
  to avoid wrong guesses. Worth keeping a small `.ext → lexer` map
  (`.toml`, `.json`, `.md`) — three extra lines.
- **Case page navigation.** Prev/next within the *current filter* or
  the global case order? Global is simpler and probably fine for v1.
  ANSWER: global.
- **Conversational reply rendering.** Some replies contain Markdown
  (lists, code spans). Render as plaintext in v1; revisit if it
  looks bad.
