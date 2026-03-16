import argparse
import json
import statistics
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import tabulate


@dataclass
class ResultMetrics:
    """Metrics extracted from a single result JSON file."""

    case_num: int
    prompt: str
    ok: bool
    duration_ms: int
    iterations: int
    build_attempts: int
    edits_count: int
    total_tokens: int
    thinking_count: int | None
    tool_calls_count: int | None
    branch_has_built_commit: bool
    commit_message: str


def extract_metrics(result_path: Path) -> ResultMetrics | None:
    """Extract metrics from a single result JSON file."""
    try:
        with result_path.open() as f:
            data: dict[str, Any] = json.load(f)

        # Extract case number from filename (e.g., "case_5_result.json" -> 5)
        case_num = int(result_path.stem.split("_")[1])

        result = data.get("result", {})

        def optional_int(d: dict[str, Any], key: str) -> int | None:
            value = d.get(key)
            return value if isinstance(value, int) else None

        # prefer top-level summary, fall back to result.summary
        commit_message = (
            (data.get("summary") or {}).get("commitMessage")
            or (result.get("summary") or {}).get("commitMessage")
            or ""
        )
        return ResultMetrics(
            case_num=case_num,
            prompt=data.get("prompt", ""),
            ok=data.get("ok", False),
            duration_ms=result.get("durationMs", 0),
            iterations=result.get("iterations", 0),
            build_attempts=result.get("buildAttempts", 0),
            edits_count=result.get("editsCount", 0),
            total_tokens=result.get("totalTokens", 0),
            thinking_count=optional_int(result, "thinkingCount"),
            tool_calls_count=optional_int(result, "toolCallsCount"),
            branch_has_built_commit=result.get("gitStatus", {}).get("branchHasBuiltCommit", False),
            commit_message=commit_message,
        )
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"Warning: Failed to parse {result_path}: {e}")
        return None


@dataclass
class Statistics:
    """Aggregated statistics across multiple results."""

    total_cases: int
    passed_cases: int
    failed_cases: int
    pass_rate: float
    avg_duration_ms: float
    median_duration_ms: float
    min_duration_ms: int
    max_duration_ms: int
    stddev_duration_ms: float
    avg_iterations: float
    median_iterations: float
    min_iterations: int
    max_iterations: int
    stddev_iterations: float
    avg_build_attempts: float
    median_build_attempts: float
    total_build_attempts: int
    avg_edits: float
    median_edits: float
    avg_tokens: float
    median_tokens: float
    min_tokens: int
    max_tokens: int
    stddev_tokens: float
    avg_thinking_count: float | None
    avg_tool_calls: float | None
    built_commit_rate: float


def calculate_stats(metrics_list: list[ResultMetrics]) -> Statistics:
    """Calculate aggregated statistics from a list of metrics."""
    if not metrics_list:
        raise ValueError("No valid metrics to analyze")

    passed = [m for m in metrics_list if m.ok]
    failed = [m for m in metrics_list if not m.ok]

    durations = [m.duration_ms for m in metrics_list]
    iterations = [m.iterations for m in metrics_list]
    build_attempts = [m.build_attempts for m in metrics_list]
    edits = [m.edits_count for m in metrics_list]
    tokens = [m.total_tokens for m in metrics_list]
    thinking = [m.thinking_count for m in metrics_list if m.thinking_count is not None]
    tool_calls = [m.tool_calls_count for m in metrics_list if m.tool_calls_count is not None]
    built_commits = [m.branch_has_built_commit for m in metrics_list]

    def safe_stdev(values: list[float]) -> float:
        """Calculate stddev, handling edge cases."""
        return statistics.stdev(values) if len(values) > 1 else 0.0

    return Statistics(
        total_cases=len(metrics_list),
        passed_cases=len(passed),
        failed_cases=len(failed),
        pass_rate=len(passed) / len(metrics_list) * 100 if metrics_list else 0,
        avg_duration_ms=statistics.mean(durations),
        median_duration_ms=statistics.median(durations),
        min_duration_ms=min(durations),
        max_duration_ms=max(durations),
        stddev_duration_ms=safe_stdev([float(d) for d in durations]),
        avg_iterations=statistics.mean(iterations),
        median_iterations=statistics.median(iterations),
        min_iterations=min(iterations),
        max_iterations=max(iterations),
        stddev_iterations=safe_stdev([float(i) for i in iterations]),
        avg_build_attempts=statistics.mean(build_attempts),
        median_build_attempts=statistics.median(build_attempts),
        total_build_attempts=sum(build_attempts),
        avg_edits=statistics.mean(edits),
        median_edits=statistics.median(edits),
        avg_tokens=statistics.mean(tokens),
        median_tokens=statistics.median(tokens),
        min_tokens=min(tokens),
        max_tokens=max(tokens),
        stddev_tokens=safe_stdev([float(t) for t in tokens]),
        avg_thinking_count=statistics.mean(thinking) if thinking else None,
        avg_tool_calls=statistics.mean(tool_calls) if tool_calls else None,
        built_commit_rate=sum(built_commits) / len(built_commits) * 100 if built_commits else 0,
    )


def print_summary_table(stats: Statistics) -> None:
    """Print a summary statistics table."""
    summary_data = [
        ["Metric", "Value"],
        ["─" * 40, "─" * 20],
        ["Total Cases", stats.total_cases],
        ["Passed", f"{stats.passed_cases} ({stats.pass_rate:.1f}%)"],
        ["Failed", stats.failed_cases],
        ["", ""],
        ["Duration (ms)", ""],
        ["  Average", f"{stats.avg_duration_ms:.0f}"],
        ["  Median", f"{stats.median_duration_ms:.0f}"],
        ["  Min / Max", f"{stats.min_duration_ms} / {stats.max_duration_ms}"],
        ["  Std Dev", f"{stats.stddev_duration_ms:.0f}"],
        ["", ""],
        ["Iterations", ""],
        ["  Average", f"{stats.avg_iterations:.2f}"],
        ["  Median", f"{stats.median_iterations:.0f}"],
        ["  Min / Max", f"{stats.min_iterations} / {stats.max_iterations}"],
        ["  Std Dev", f"{stats.stddev_iterations:.2f}"],
        ["", ""],
        ["Build Attempts", ""],
        ["  Average", f"{stats.avg_build_attempts:.2f}"],
        ["  Median", f"{stats.median_build_attempts:.0f}"],
        ["  Total", stats.total_build_attempts],
        ["", ""],
        ["Token Usage", ""],
        ["  Average", f"{stats.avg_tokens:.0f}"],
        ["  Median", f"{stats.median_tokens:.0f}"],
        ["  Min / Max", f"{stats.min_tokens} / {stats.max_tokens}"],
        ["  Std Dev", f"{stats.stddev_tokens:.0f}"],
        ["", ""],
        ["Edits", f"{stats.avg_edits:.2f}"],
        [
            "Thinking (Avg)",
            f"{stats.avg_thinking_count:.2f}" if stats.avg_thinking_count is not None else "n/a",
        ],
        [
            "Tool Calls (Avg)",
            f"{stats.avg_tool_calls:.2f}" if stats.avg_tool_calls is not None else "n/a",
        ],
        ["Built %", f"{stats.built_commit_rate:.1f}%"],
    ]

    print("\n" + "=" * 65)
    print("EVALUATION STATISTICS SUMMARY")
    print("=" * 65)
    print(tabulate.tabulate(cast(Iterable[Iterable[Any]], summary_data), tablefmt="plain"))
    print("=" * 65 + "\n")


def print_cases_table(metrics_list: list[ResultMetrics]) -> None:
    """Print a detailed table of individual cases."""
    sorted_metrics = sorted(metrics_list, key=lambda m: m.case_num)

    cases_data = []
    for m in sorted_metrics:
        status = "✓ PASS" if m.ok else "✗ FAIL"
        commit_msg_display = m.commit_message or ""
        if len(commit_msg_display) > 80:
            commit_msg_display = commit_msg_display[:77] + "..."

        cases_data.append(
            [
                m.case_num,
                status,
                m.iterations,
                m.build_attempts,
                f"{m.duration_ms // 1000}s",
                m.total_tokens,
                m.thinking_count if m.thinking_count is not None else "-",
                m.tool_calls_count if m.tool_calls_count is not None else "-",
                m.edits_count,
                commit_msg_display,
            ]
        )

    headers = ["#", "Status", "Iters", "Blds", "Dur", "Toks", "Think", "Tools", "Edits", "Commit"]
    print("\n" + "=" * 95)
    print("INDIVIDUAL CASE RESULTS")
    print("=" * 95)
    print(
        tabulate.tabulate(
            cast(Iterable[Iterable[Any]], cases_data), headers=headers, tablefmt="grid"
        )
    )
    print("=" * 95 + "\n")


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Calculate statistics from nixmac evaluation result files"
    )
    parser.add_argument(
        "-i",
        "--input-dir",
        type=Path,
        default=Path("./data/results"),
        help="Directory containing result JSON files (default: ./data/results)",
    )
    parser.add_argument(
        "-s",
        "--summary-only",
        action="store_true",
        help="Show only summary statistics, not individual cases",
    )
    args = parser.parse_args()

    input_dir = args.input_dir
    if not input_dir.exists():
        print(f"Error: Input directory does not exist: {input_dir}")
        return

    # Find all result JSON files
    result_files = sorted(input_dir.glob("case_*_result.json"))
    if not result_files:
        print(f"No result files found in {input_dir}")
        return

    # Extract metrics from all result files
    metrics_list: list[ResultMetrics] = []
    for result_file in result_files:
        metrics = extract_metrics(result_file)
        if metrics:
            metrics_list.append(metrics)

    if not metrics_list:
        print("No valid metrics could be extracted from result files")
        return

    # Calculate statistics
    stats = calculate_stats(metrics_list)

    # Print results
    print_summary_table(stats)

    if not args.summary_only:
        print_cases_table(metrics_list)


if __name__ == "__main__":
    main()
