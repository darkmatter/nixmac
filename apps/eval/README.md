# Evaluation Framework

This directory contains tools for evaluating nixmac's evolution capabilities against a test matrix of user requests.

## Isolation

Every test case runs fully hermetically. The suite creates a fresh temp
directory per case and passes it to the nixmac binary via the
`NIXMAC_APP_DATA_DIR` environment variable, which roots **all** of the
binary's per-device state there: `settings.json`,
`global-preferences.json`, the sqlite DB, docs cache, and secrets. Eval
runs therefore never read or mutate your real nixmac preferences, your
keychain/dev credentials, or your real nix configuration. API keys are
passed to the child process through the environment
(`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `VLLM_API_KEY`), never written
to disk.

The suite verifies after the first invocation that the binary actually
honored the override and aborts otherwise, so pointing `--nixmac` at an
old binary that predates `NIXMAC_APP_DATA_DIR` fails loudly instead of
silently running against your real state.

## Setup

Install dependencies with `uv`:

```bash
uv sync
```

## The `nixmac-eval` CLI

All tools are available as subcommands of a single CLI:

```bash
uv run nixmac-eval run --csv data/test_prompts.csv --vllm-url ... # run cases
uv run nixmac-eval grade  -i data/results                         # persist grades
uv run nixmac-eval stats  -i data/results                         # scorecard tables
uv run nixmac-eval report -i data/results -o data/report          # HTML report
```

The typical workflow is `run` → `grade` → `stats`/`report`. `stats` also
works on ungraded results: it grades them in memory (without writing
back) so its pass/fail always reflects each case's `expected_outcome`.

The original entry points (`python run_evals.py`, `python calc_stats.py`,
`python grade.py`, `python generate_report.py`) still work with the same
flags.

## Running Evaluations

Execute the evaluation suite:

```bash
uv run nixmac-eval run --csv data/test_prompts.csv --ollama-url http://localhost:11434
```

Options:

- `--rows <case_ids>` - Run specific test cases by id (comma-separated)
- `--priority <level>` - Filter by priority level
- `--limit <num>` - Max number of cases to run
- `--persona <name>` - Filter by persona
- `--nixmac <path>` - Path to nixmac binary (default: `../../target/debug/nixmac`, built from this repo with `cargo build`)

Results are saved to `data/results/` as JSON files.

## Analyzing Results

Calculate statistics from evaluation runs:

```bash
uv run nixmac-eval stats
```

Options:

- `-i, --input-dir <path>` - Results directory (default: `./data/results`)
- `-s, --summary-only` - Show summary statistics only, skip individual case details

### Output

The script generates two tables:

**Summary Statistics** - Aggregated metrics across all cases:

- Pass/fail rates
- Duration statistics (avg, median, min, max, stddev)
- Iteration efficiency metrics
- Build attempt counts
- Token usage across evolution runs
- Success rates for generating buildable commits

**Individual Case Results** - Details for each test case:

- Case number and success status
- Iterations required
- Build attempts
- Wall-clock duration
- Token consumption
- Number of edits made
- Commit message

### Example

```bash
# Run all evaluations, grade, and analyze results
uv run nixmac-eval run --csv data/test_prompts.csv --ollama-url http://localhost:11434
uv run nixmac-eval grade
uv run nixmac-eval stats

# Analyze a specific subset of results
uv run nixmac-eval stats -i ./data/results -s
```

Run specific cases by row number:

```bash
uv run nixmac-eval run --csv data/test_prompts.csv --rows 5,6,8
```

### Run with CSV file

```sh
uv run nixmac-eval run --csv data/test_prompts.csv
```

The CSV file should have the following columns:

- `id`: test case number
- `prompt`: the user request to test
- `expected_outcome`: expected result (e.g., succeed, fail_gracefully, refuse)
- `category`: high-level category
- `subcategory`: more specific scenario
- `quality_dimension`: quality aspect being tested (e.g., correctness, safety, faithfulness)
- `notes`: additional notes

### Filter test cases

Run specific test cases by row number:

```sh
uv run nixmac-eval run --csv data/test_prompts.csv --rows 1,5,10
```

Filter by persona/quality dimension:

```sh
uv run nixmac-eval run --csv data/test_prompts.csv --persona correctness
```

### Configure AI providers

One of `--ollama-url` or `--vllm-url` selects the backend; `--vllm-url`
works with any OpenAI-compatible endpoint. API keys are forwarded to the
nixmac binary via environment variables, never written to disk.

```sh
uv run nixmac-eval run --csv data/test_prompts.csv \
  --vllm-url https://my-endpoint.example.com/v1 \
  --vllm-api-key YOUR_API_KEY \
  --evolve-model gpt-oss-120b
```

### Choose the nix-darwin baseline

By default, every test case starts from the bundled
`nix-darwin-determinate` template. Use `--base-config` to point the
suite at a different baseline so you can compare how the same prompts
behave on different starting points.

```sh
# A different bundled template
uv run nixmac-eval run --csv data/test_prompts.csv --base-config minimal

# A local nix-darwin configuration on disk
uv run nixmac-eval run --csv data/test_prompts.csv \
  --base-config ~/.darwin --host my-mac

# A git repo (shallow-cloned for the duration of the run).
# Refs use Nix flake-URL syntax — drop them in the URL itself.
uv run nixmac-eval run --csv data/test_prompts.csv \
  --base-config github:me/dotfiles/main \
  --host my-mac

# Same thing as a plain git URL with ?ref=
uv run nixmac-eval run --csv data/test_prompts.csv \
  --base-config 'https://github.com/me/dotfiles.git?ref=main' \
  --host my-mac
```

When `--base-config` points at a real config (not a bundled template),
its `.nix` files won't contain the `HOSTNAME_PLACEHOLDER` markers the
suite normally substitutes, so you'll typically want to pass `--host`
matching a `darwinConfigurations.<name>` entry in your config.
