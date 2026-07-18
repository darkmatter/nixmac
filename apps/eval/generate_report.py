"""Generate an HTML report from nixmac eval results.

Reads:
  - data/results/case_*_result.json  (post `grade.py`)
  - data/test_prompts.csv            (category / priority / notes)
  - data/golden_set_expectations.json (which cases are golden)
  - data/results/run_meta.json       (optional, written by run_evals.py)

Writes:
  - data/report/index.html           (headline + aggregate + case table)
  - data/report/cases/case_<id>.html (per-case detail)
  - data/report/assets/{style.css,…}
  - data/report/manifest.json        (consumed by --compare in a later phase)

Usage:
    uv run python generate_report.py
    uv run python generate_report.py -i data/results -o data/report
    uv run python generate_report.py --golden-only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make sibling modules (grade.py, calc_stats.py) importable.
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

from report import loader, render  # noqa: E402

DEFAULT_RESULTS = SCRIPT_DIR / "data" / "results"
DEFAULT_OUTPUT = SCRIPT_DIR / "data" / "report"
DEFAULT_CSV = SCRIPT_DIR / "data" / "test_prompts.csv"
DEFAULT_EXPECTATIONS = SCRIPT_DIR / "data" / "golden_set_expectations.json"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("-i", "--input-dir", type=Path, default=DEFAULT_RESULTS,
                   help="Directory of case_*_result.json (default: data/results)")
    p.add_argument("-o", "--output-dir", type=Path, default=DEFAULT_OUTPUT,
                   help="Directory to write the report (default: data/report)")
    p.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to test_prompts.csv")
    p.add_argument("--expectations", type=Path, default=DEFAULT_EXPECTATIONS,
                   help="Path to golden_set_expectations.json")
    p.add_argument("--run-meta", type=Path, default=None,
                   help="Path to run_meta.json (default: <input-dir>/run_meta.json)")
    p.add_argument("--golden-only", action="store_true",
                   help="Only include cases in the golden set")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    run = loader.load(
        results_dir=args.input_dir,
        csv_path=args.csv,
        golden_path=args.expectations,
        run_meta_path=args.run_meta,
        log_path=None,
        golden_only=args.golden_only,
    )
    if not run.cases:
        print(f"No cases found in {args.input_dir}", file=sys.stderr)
        return 1
    render.write(run, args.output_dir)
    print(f"Wrote report: {args.output_dir / 'index.html'}")
    print(f"  {run.aggregate_stats.passed}/{run.aggregate_stats.total} passed "
          f"({run.aggregate_stats.pass_rate:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
