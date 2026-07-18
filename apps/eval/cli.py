"""nixmac-eval: unified CLI for the nixmac evaluation suite.

One tool covering the whole eval workflow:

    nixmac-eval run    --csv data/test_prompts.csv --vllm-url ...   # run cases
    nixmac-eval grade  -i data/results                              # persist grades
    nixmac-eval stats  -i data/results                              # scorecard tables
    nixmac-eval report -i data/results -o data/report               # HTML report

    nixmac-eval all    --csv data/test_prompts.csv --vllm-url ...   # all of the above

Each subcommand delegates to its module (run_evals, grade, calc_stats,
generate_report), which all remain runnable standalone via
`python <module>.py` with identical flags. `all` chains the four steps
in order against one results directory.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import calc_stats
import generate_report
import grade
import run_evals


def build_all_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    """The `all` subcommand: run → grade → stats → report in one go.

    Takes the full set of `run` flags plus the report/stats knobs that
    make sense for the whole pipeline. `--results-dir` (or the run
    default, data/results) is the shared handoff directory.
    """
    run_evals.build_parser(parser)
    parser.add_argument(
        "--expectations",
        type=Path,
        default=grade.EXPECTATIONS_PATH,
        help="Path to golden_set_expectations.json (grade/stats/report)",
    )
    parser.add_argument(
        "--golden-only",
        action="store_true",
        help="Only grade/report cases in the golden set",
    )
    parser.add_argument(
        "-s",
        "--summary-only",
        action="store_true",
        help="Show only summary statistics, not individual cases",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=generate_report.DEFAULT_OUTPUT,
        help="Directory to write the HTML report (default: data/report)",
    )
    parser.set_defaults(func=main_all)
    return parser


def main_all(args: argparse.Namespace) -> int:
    """Run the whole pipeline against a single results directory."""
    results_dir = Path(args.results_dir).expanduser() if args.results_dir else run_evals.RESULTS_DIR
    csv_path = Path(args.csv) if args.csv else grade.CSV_PATH

    print(f"[1/4] run    → {results_dir}")
    run_evals.main(args)

    print(f"\n[2/4] grade  → {results_dir}")
    grade.main(
        argparse.Namespace(
            input_dir=results_dir,
            output_dir=None,
            golden_only=args.golden_only,
            csv=csv_path,
            expectations=args.expectations,
        )
    )

    print(f"\n[3/4] stats  → {results_dir}")
    calc_stats.main(
        argparse.Namespace(
            input_dir=results_dir,
            summary_only=args.summary_only,
            debug=False,
            csv=csv_path,
            expectations=args.expectations,
        )
    )

    print(f"\n[4/4] report → {args.output_dir}")
    return int(
        generate_report.main(
            argparse.Namespace(
                input_dir=results_dir,
                output_dir=args.output_dir,
                csv=csv_path,
                expectations=args.expectations,
                run_meta=None,
                golden_only=args.golden_only,
            )
        )
        or 0
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nixmac-eval",
        description="Evaluate nixmac's evolution engine: run cases, grade, summarize, report.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_evals.build_parser(
        sub.add_parser(
            "run",
            help="Run evaluation cases against a nixmac binary (hermetic per-case state)",
        )
    )
    grade.build_parser(
        sub.add_parser(
            "grade",
            help="Grade results against expected outcomes and persist grade objects",
        )
    )
    calc_stats.build_parser(
        sub.add_parser(
            "stats",
            help="Print scorecard tables (grades ungraded results in memory)",
        )
    )
    generate_report.build_parser(
        sub.add_parser(
            "report",
            help="Generate an HTML report from (graded) results",
        )
    )
    build_all_parser(
        sub.add_parser(
            "all",
            help="Run the whole pipeline: run → grade → stats → report",
        )
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
