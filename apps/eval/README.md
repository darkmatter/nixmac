# Evaluation Framework

This directory contains tools for evaluating nixmac's evolution capabilities against a test matrix of user requests.

## Setup

Install dependencies with `uv`:

```bash
uv sync
```

## Running Evaluations

Execute the evaluation suite:

### Run with default Excel spreadsheet

```bash
uv run python run_evals.py
```

Options:

- `--cases <row_numbers>` - Run specific test cases by row number (comma-separated)
- `--priority <level>` - Filter by priority level
- `--limit <num>` - Max number of cases to run
- `--persona <name>` - Filter by persona
- `--nixmac <path>` - Path to nixmac binary (default: `../../target/debug/nixmac`)

Results are saved to `data/results/` as JSON files.

## Analyzing Results

Calculate statistics from evaluation runs:

```bash
uv run python calc_stats.py
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
# Run all evaluations and analyze results
uv run python run_evals.py
uv run python calc_stats.py

# Analyze a specific subset of results
uv run python calc_stats.py -i ./data/results -s
```

Run specific cases by row number:

```bash
uv run python run_evals.py --cases 5,6,8
```

### Run with CSV file

```sh
python run_evals.py --csv data/test_prompts.csv
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
python run_evals.py --csv data/test_prompts.csv --rows 1,5,10
```

Filter by persona/quality dimension:

```sh
python run_evals.py --csv data/test_prompts.csv --persona correctness
```

### Configure AI providers

```sh
python run_evals.py --csv data/test_prompts.csv \
  --evolve-provider openai \
  --evolve-model gpt-4 \
  --openai-key YOUR_API_KEY
```

### Choose the nix-darwin baseline

By default, every test case starts from the bundled
`nix-darwin-determinate` template. Use `--base-config` to point the
suite at a different baseline so you can compare how the same prompts
behave on different starting points.

```sh
# A different bundled template
python run_evals.py --csv data/test_prompts.csv --base-config minimal

# A local nix-darwin configuration on disk
python run_evals.py --csv data/test_prompts.csv \
  --base-config ~/.darwin --host my-mac

# A git repo (shallow-cloned for the duration of the run)
python run_evals.py --csv data/test_prompts.csv \
  --base-config https://github.com/me/dotfiles.git \
  --base-config-ref main \
  --host my-mac
```

When `--base-config` points at a real config (not a bundled template),
its `.nix` files won't contain the `HOSTNAME_PLACEHOLDER` markers the
suite normally substitutes, so you'll typically want to pass `--host`
matching a `darwinConfigurations.<name>` entry in your config.
