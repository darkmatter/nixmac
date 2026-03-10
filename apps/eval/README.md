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

```sh
python run_evals.py
```
