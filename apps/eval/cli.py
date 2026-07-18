"""nixmac-eval: unified CLI for the nixmac evaluation suite.

One tool, four subcommands covering the whole eval workflow:

    nixmac-eval run    --csv data/test_prompts.csv --vllm-url ...   # run cases
    nixmac-eval grade  -i data/results                              # persist grades
    nixmac-eval stats  -i data/results                              # scorecard tables
    nixmac-eval report -i data/results -o data/report               # HTML report

Each subcommand delegates to its module (run_evals, grade, calc_stats,
generate_report), which all remain runnable standalone via
`python <module>.py` with identical flags.
"""

from __future__ import annotations

import argparse
import sys

import calc_stats
import generate_report
import grade
import run_evals


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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
