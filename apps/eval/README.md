# AI Engine Evaluation Framework for nixmac

## Requirements

- You are in the devenv shell.
- The shell provides:
  - Rust
  - Bun/Node
  - Python 3.12 via uv (venv in this directory)

## Setup

```sh
cd apps/eval
uv venv
uv sync
source .venv/bin/activate
```

## Run

### Run with default Excel spreadsheet

```sh
python run_evals.py
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
