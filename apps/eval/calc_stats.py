import argparse
import json
import statistics
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import tabulate

import grade as grading


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
    state: str = "generated"
    conversational_reply: str | None = None
    model_name: str | None = None
    expected_outcome: str | None = None
    graded_pass: bool | None = None
    failure_class: str | None = None
    has_telemetry: bool = True

    @property
    def passed(self) -> bool:
        """Graded verdict when available, engine `ok` otherwise.

        The engine's `ok` only means "a result was produced" — it says
        nothing about whether the behavior matched the case's
        expected_outcome, which is what the grader checks.
        """
        return self.graded_pass if self.graded_pass is not None else self.ok


def ensure_grades(results: list[tuple[int, dict[str, Any]]], csv_path: Path, expectations_path: Path) -> int:
    """Grade any results that lack a persisted `grade` object, in memory.

    Reuses grade.py's deterministic grader so stats always reflect
    expected_outcome, even when `grade` hasn't been run on the results dir.
    Nothing is written back to disk. Returns the number graded in memory.
    """
    csv_lookup = grading.load_csv_lookup(csv_path)
    expectations = grading.load_expectations(expectations_path)

    graded = 0
    prompt_mismatches: list[int] = []
    for case_num, data in results:
        if isinstance(data.get("grade"), dict):
            continue
        csv_row = csv_lookup.get(case_num)
        expected = (csv_row or {}).get("expected_outcome", "")
        if not expected:
            continue  # not in the CSV — leave ungraded, falls back to `ok`
        # Refuse to grade against the wrong prompt set: the default --csv is
        # the general corpus, but this results dir may come from another one.
        result_prompt = (data.get("prompt") or "").strip()
        csv_prompt = (csv_row or {}).get("prompt", "").strip()
        if result_prompt and csv_prompt and result_prompt != csv_prompt:
            prompt_mismatches.append(case_num)
            continue
        data["_case_id"] = case_num
        result = grading.grade_case(data, expected, expectations.get(str(case_num)), csv_row)
        data.pop("_case_id", None)
        data["grade"] = grading.grade_to_dict(result)
        graded += 1
    if prompt_mismatches:
        print(
            f"Warning: skipped in-memory grading for {len(prompt_mismatches)} case(s) "
            f"whose recorded prompt differs from the CSV ({prompt_mismatches[:5]}"
            f"{'…' if len(prompt_mismatches) > 5 else ''}) — pass --csv/--expectations "
            f"matching this results dir."
        )
    return graded


def extract_metrics(result_path: Path) -> ResultMetrics | None:
    """Extract metrics from a single result JSON file."""
    try:
        with result_path.open() as f:
            data: dict[str, Any] = json.load(f)

        # Extract case number from filename (e.g., "case_5_result.json" -> 5)
        case_num = int(result_path.stem.split("_")[1])
        return extract_metrics_from_data(case_num, data)
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"Warning: Failed to parse {result_path}: {e}")
        return None


def extract_metrics_from_data(case_num: int, data: dict[str, Any]) -> ResultMetrics | None:
    """Extract metrics from an already loaded result JSON object."""
    try:
        result = data.get("result", {})

        def optional_int(d: dict[str, Any], key: str) -> int | None:
            value = d.get(key)
            if isinstance(value, int):
                return value
            if isinstance(value, float):
                return int(value)
            if isinstance(value, str) and value.isdigit():
                return int(value)
            return None

        # prefer top-level summary, fall back to result.summary
        commit_message = (
            (data.get("summary") or {}).get("commitMessage")
            or (result.get("summary") or {}).get("commitMessage")
            or ""
        )
        # One shared state extractor with grade.py: telemetry.state preferred,
        # top-level as fallback (correct only after jp/fix-cli-state-hoist, or
        # for stubs whose only state IS the top-level one).
        state = grading.extract_state(data) or "generated"
        conversational_reply: str | None = None
        if state == "conversational":
            conversational_reply = (result.get("summary") or {}).get("instructions") or None
        # Extract model name
        model_name = (
            data.get("evolveModel")
            or data.get("model")
            or data.get("result", {}).get("model")
            or (data.get("summary") or {}).get("model")
            or None
        )

        # Metrics live under `result.telemetry`; stubs (timeouts, provider
        # failures killed before a result) have none. Keep those cases in the
        # denominator with zeroed metrics instead of dropping them — dropping
        # made `stats` and the HTML report disagree on the case count.
        telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
        has_telemetry = bool(telemetry)

        duration_ms = int(telemetry.get("durationMs", 0) or 0)
        iterations = int(telemetry.get("iterations", 0) or 0)
        build_attempts = int(telemetry.get("buildAttempts", 0) or 0)
        edits_count = int(telemetry.get("editsCount", 0) or 0)
        total_tokens = int(telemetry.get("totalTokens", 0) or 0)

        thinking_count = optional_int(telemetry, "thinkingCount")
        tool_calls_count = optional_int(telemetry, "toolCallsCount")

        git_status = result.get("gitStatus", {})
        # Support older files that used `headIsBuilt` while preferring the
        # newer `branchHasBuiltCommit` key.
        branch_has_built_commit = bool(git_status.get("branchHasBuiltCommit", git_status.get("headIsBuilt", False)))

        grade_obj = data.get("grade") if isinstance(data.get("grade"), dict) else None

        return ResultMetrics(
            case_num=case_num,
            prompt=data.get("prompt", ""),
            ok=data.get("ok", False),
            duration_ms=duration_ms,
            iterations=iterations,
            build_attempts=build_attempts,
            edits_count=edits_count,
            total_tokens=total_tokens,
            thinking_count=thinking_count,
            tool_calls_count=tool_calls_count,
            branch_has_built_commit=branch_has_built_commit,
            commit_message=commit_message,
            state=state,
            conversational_reply=conversational_reply,
            model_name=model_name,
            expected_outcome=grade_obj.get("expected_outcome") if grade_obj else None,
            graded_pass=grade_obj.get("pass") if grade_obj else None,
            failure_class=grade_obj.get("failure_class") if grade_obj else None,
            has_telemetry=has_telemetry,
        )
    except (KeyError, ValueError) as e:
        print(f"Warning: Failed to parse result for case {case_num}: {e}")
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

    passed = [m for m in metrics_list if m.passed]
    failed = [m for m in metrics_list if not m.passed]

    # Counts and pass rates cover every case; numeric aggregates only cover
    # cases with real telemetry so stubs' zeroed metrics don't skew averages.
    numeric = [m for m in metrics_list if m.has_telemetry] or metrics_list
    durations = [m.duration_ms for m in numeric]
    iterations = [m.iterations for m in numeric]
    build_attempts = [m.build_attempts for m in numeric]
    edits = [m.edits_count for m in numeric]
    tokens = [m.total_tokens for m in numeric]
    thinking = [m.thinking_count for m in numeric if m.thinking_count is not None]
    tool_calls = [m.tool_calls_count for m in numeric if m.tool_calls_count is not None]
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


def print_summary_table(stats: Statistics, metrics_list: list[ResultMetrics]) -> None:
    """Print a summary statistics table segmented by overall/passing/failing."""
    def _safe_calc(subset: list[ResultMetrics] | None):
        try:
            return calculate_stats(subset) if subset is not None and subset else None
        except Exception:
            return None

    passed_metrics = [m for m in metrics_list if m.passed]
    failed_metrics = [m for m in metrics_list if not m.passed]
    passed_stats = _safe_calc(passed_metrics)
    failed_stats = _safe_calc(failed_metrics)

    # model names present in metrics
    model_names = sorted({m.model_name for m in metrics_list if m.model_name})
    model_title = ", ".join(model_names) if model_names else "(models: unknown)"

    headers = ["Metric", "Overall", "Passing", "Failing"]

    def maybe(fmt: str, s: Statistics | None):
        try:
            return fmt.format(s) if s is not None else "n/a"
        except Exception:
            return "n/a"

    rows = []
    rows.append(["Total Cases", f"{stats.total_cases}", f"{passed_stats.total_cases}" if passed_stats else "0", f"{failed_stats.total_cases}" if failed_stats else "0"])
    rows.append(["Pass Rate", f"{stats.pass_rate:.1f}%", "100.0%" if passed_stats else "n/a", "0.0%" if failed_stats else "n/a"])

    # Agent-only rate: inconclusive cases (timeouts, provider failures) say
    # nothing about agent quality — show the rate with them excluded.
    inconclusive = [m for m in metrics_list if m.failure_class == "inconclusive"]
    if inconclusive:
        conclusive = [m for m in metrics_list if m.failure_class != "inconclusive"]
        n_pass = sum(1 for m in conclusive if m.passed)
        rate = n_pass / len(conclusive) * 100 if conclusive else 0.0
        rows.append([
            "Agent-only Rate",
            f"{rate:.1f}% ({n_pass}/{len(conclusive)}, {len(inconclusive)} inconclusive excluded)",
            "", "",
        ])

    rows.append(["", "", "", ""])
    rows.append(["Duration (ms)", "", "", ""])
    rows.append(["  Average", f"{stats.avg_duration_ms:.0f}", maybe("{0.avg_duration_ms:.0f}", passed_stats), maybe("{0.avg_duration_ms:.0f}", failed_stats)])
    rows.append(["  Median", f"{stats.median_duration_ms:.0f}", maybe("{0.median_duration_ms:.0f}", passed_stats), maybe("{0.median_duration_ms:.0f}", failed_stats)])
    rows.append([
        "  Min / Max",
        f"{stats.min_duration_ms} / {stats.max_duration_ms}",
        f"{passed_stats.min_duration_ms} / {passed_stats.max_duration_ms}" if passed_stats else "n/a",
        f"{failed_stats.min_duration_ms} / {failed_stats.max_duration_ms}" if failed_stats else "n/a",
    ])
    rows.append(["  Std Dev", f"{stats.stddev_duration_ms:.0f}", maybe("{0.stddev_duration_ms:.0f}", passed_stats), maybe("{0.stddev_duration_ms:.0f}", failed_stats)])

    rows.append(["", "", "", ""])
    rows.append(["Iterations", "", "", ""])
    rows.append(["  Average", f"{stats.avg_iterations:.2f}", maybe("{0.avg_iterations:.2f}", passed_stats), maybe("{0.avg_iterations:.2f}", failed_stats)])
    rows.append(["  Median", f"{stats.median_iterations:.0f}", maybe("{0.median_iterations:.0f}", passed_stats), maybe("{0.median_iterations:.0f}", failed_stats)])
    rows.append(["  Min / Max", f"{stats.min_iterations} / {stats.max_iterations}", f"{passed_stats.min_iterations} / {passed_stats.max_iterations}" if passed_stats else "n/a", f"{failed_stats.min_iterations} / {failed_stats.max_iterations}" if failed_stats else "n/a"])
    rows.append(["  Std Dev", f"{stats.stddev_iterations:.2f}", maybe("{0.stddev_iterations:.2f}", passed_stats), maybe("{0.stddev_iterations:.2f}", failed_stats)])

    rows.append(["", "", "", ""])
    rows.append(["Build Attempts", "", "", ""])
    rows.append(["  Average", f"{stats.avg_build_attempts:.2f}", maybe("{0.avg_build_attempts:.2f}", passed_stats), maybe("{0.avg_build_attempts:.2f}", failed_stats)])
    rows.append(["  Median", f"{stats.median_build_attempts:.0f}", maybe("{0.median_build_attempts:.0f}", passed_stats), maybe("{0.median_build_attempts:.0f}", failed_stats)])
    rows.append(["  Total", f"{stats.total_build_attempts}", maybe("{0.total_build_attempts}", passed_stats), maybe("{0.total_build_attempts}", failed_stats)])

    rows.append(["", "", "", ""])
    rows.append(["Token Usage", "", "", ""])
    rows.append(["  Average", f"{stats.avg_tokens:.0f}", maybe("{0.avg_tokens:.0f}", passed_stats), maybe("{0.avg_tokens:.0f}", failed_stats)])
    rows.append(["  Median", f"{stats.median_tokens:.0f}", maybe("{0.median_tokens:.0f}", passed_stats), maybe("{0.median_tokens:.0f}", failed_stats)])
    rows.append(["  Min / Max", f"{stats.min_tokens} / {stats.max_tokens}", f"{passed_stats.min_tokens} / {passed_stats.max_tokens}" if passed_stats else "n/a", f"{failed_stats.min_tokens} / {failed_stats.max_tokens}" if failed_stats else "n/a"])
    rows.append(["  Std Dev", f"{stats.stddev_tokens:.0f}", maybe("{0.stddev_tokens:.0f}", passed_stats), maybe("{0.stddev_tokens:.0f}", failed_stats)])

    rows.append(["", "", "", ""])
    rows.append(["Edits (Avg)", f"{stats.avg_edits:.2f}", maybe("{0.avg_edits:.2f}", passed_stats), maybe("{0.avg_edits:.2f}", failed_stats)])
    rows.append(["Thinking (Avg)", f"{stats.avg_thinking_count:.2f}" if stats.avg_thinking_count is not None else "n/a", maybe("{0.avg_thinking_count:.2f}", passed_stats), maybe("{0.avg_thinking_count:.2f}", failed_stats)])
    rows.append(["Tool Calls (Avg)", f"{stats.avg_tool_calls:.2f}" if stats.avg_tool_calls is not None else "n/a", maybe("{0.avg_tool_calls:.2f}", passed_stats), maybe("{0.avg_tool_calls:.2f}", failed_stats)])
    rows.append(["Built %", f"{stats.built_commit_rate:.1f}%", maybe("{0.built_commit_rate:.1f}%", passed_stats), maybe("{0.built_commit_rate:.1f}%", failed_stats)])

    # Add counts of observed states (e.g., generated, conversational, failed, etc.)
    counts = Counter(m.state for m in metrics_list)
    passed_counts = Counter(m.state for m in passed_metrics)
    failed_counts = Counter(m.state for m in failed_metrics)

    rows.append(["", "", "", ""])
    rows.append(["State Counts", "Overall", "Passing", "Failing"])
    for state, cnt in sorted(counts.items()):
        rows.append([f"  {state}", f"{cnt}", f"{passed_counts.get(state, 0)}", f"{failed_counts.get(state, 0)}"])

    # Graded pass rate per expected outcome (succeed / fail_gracefully / refuse)
    graded = [m for m in metrics_list if m.expected_outcome]
    if graded:
        rows.append(["", "", "", ""])
        rows.append(["Expected Outcome", "Passed/Total", "", ""])
        for outcome in sorted({m.expected_outcome for m in graded}):
            subset = [m for m in graded if m.expected_outcome == outcome]
            n_pass = sum(1 for m in subset if m.passed)
            rows.append([f"  {outcome}", f"{n_pass}/{len(subset)}", "", ""])

    # Failure-class breakdown for graded failures
    fail_classes = Counter(m.failure_class or "unclassified" for m in failed_metrics if m.graded_pass is False)
    if fail_classes:
        rows.append(["", "", "", ""])
        rows.append(["Failure Classes", "Count", "", ""])
        for cls, cnt in fail_classes.most_common():
            rows.append([f"  {cls}", f"{cnt}", "", ""])

    print("\n" + "=" * 95)
    print(f"EVALUATION STATISTICS SUMMARY — {model_title}")
    print("=" * 95)
    print(tabulate.tabulate(rows, headers=headers, tablefmt="simple"))
    print("=" * 95 + "\n")


def print_cases_table(metrics_list: list[ResultMetrics]) -> None:
    """Print a detailed table of individual cases."""
    sorted_metrics = sorted(metrics_list, key=lambda m: m.case_num)

    cases_data = []
    for m in sorted_metrics:
        status = "✓ PASS" if m.passed else "✗ FAIL"
        if m.graded_pass is None:
            status += " (ungraded)"
        if m.state == "conversational" and m.conversational_reply:
            raw = m.conversational_reply.replace("\n", " ").strip()
            commit_msg_display = ("💬 " + raw)[:60]
            if len("💬 " + raw) > 60:
                commit_msg_display = commit_msg_display[:57] + "..."
        else:
            commit_msg_display = m.commit_message or ""
            if len(commit_msg_display) > 60:
                commit_msg_display = commit_msg_display[:57] + "..."

        cases_data.append(
            [
                m.case_num,
                status,
                m.expected_outcome or "-",
                m.state,
                m.failure_class or "" if m.graded_pass is False else "",
                m.iterations,
                m.build_attempts,
                f"{m.duration_ms // 1000}s",
                m.total_tokens,
                m.edits_count,
                commit_msg_display,
            ]
        )

    headers = ["#", "Status", "Expected", "State", "Class", "Iters", "Blds", "Dur", "Toks", "Edits", "Commit"]
    print("\n" + "=" * 95)
    print("INDIVIDUAL CASE RESULTS")
    print("=" * 95)
    print(
        tabulate.tabulate(
            cast(Iterable[Iterable[Any]], cases_data), headers=headers, tablefmt="grid"
        )
    )
    print("=" * 95 + "\n")


def build_parser(parser: argparse.ArgumentParser | None = None) -> argparse.ArgumentParser:
    """Add the stats arguments to `parser` (or a fresh one) and return it."""
    if parser is None:
        parser = argparse.ArgumentParser(
            description="Calculate statistics from nixmac evaluation result files"
        )
    parser.add_argument(
        "-i",
        "--input-dir",
        type=Path,
        default=grading.DEFAULT_RESULTS_DIR,
        help="Directory containing result JSON files (default: data/results)",
    )
    parser.add_argument(
        "-s",
        "--summary-only",
        action="store_true",
        help="Show only summary statistics, not individual cases",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print first parsed ResultMetrics for debugging",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=grading.CSV_PATH,
        help="Path to test_prompts.csv (used to grade ungraded results in memory)",
    )
    parser.add_argument(
        "--expectations",
        type=Path,
        default=grading.EXPECTATIONS_PATH,
        help="Path to golden_set_expectations.json",
    )
    parser.set_defaults(func=main)
    return parser


def main(args: argparse.Namespace) -> None:
    """Compute and print statistics for the results in `args.input_dir`."""
    input_dir = args.input_dir
    if not input_dir.exists():
        print(f"Error: Input directory does not exist: {input_dir}")
        return

    # Find all result JSON files
    result_files = sorted(input_dir.glob("case_*_result.json"))
    if not result_files:
        print(f"No result files found in {input_dir}")
        return

    # Load all results, then grade any that lack a persisted grade so
    # pass/fail always reflects expected_outcome (grades are computed in
    # memory only; run grade.py to persist them).
    results: list[tuple[int, dict[str, Any]]] = []
    for result_file in result_files:
        try:
            with result_file.open() as f:
                data = json.load(f)
            case_num = int(result_file.stem.split("_")[1])
        except (json.JSONDecodeError, ValueError, OSError) as e:
            print(f"Warning: Failed to read {result_file}: {e}")
            continue
        results.append((case_num, data))

    graded_in_memory = ensure_grades(results, args.csv, args.expectations)
    if graded_in_memory:
        print(
            f"Note: graded {graded_in_memory} result(s) in memory against "
            f"expected_outcome; run grade.py to persist grades."
        )

    metrics_list: list[ResultMetrics] = []
    for case_num, data in results:
        metrics = extract_metrics_from_data(case_num, data)
        if metrics:
            metrics_list.append(metrics)

    if args.debug:
        print("\nDEBUG: first parsed metrics:\n")
        for m in metrics_list[:3]:
            print(m.__dict__)
        print("\n")

    if not metrics_list:
        print("No valid metrics could be extracted from result files")
        return

    # Calculate statistics
    stats = calculate_stats(metrics_list)

    # Print results
    print_summary_table(stats, metrics_list)

    if not args.summary_only:
        print_cases_table(metrics_list)


if __name__ == "__main__":
    main(build_parser().parse_args())
