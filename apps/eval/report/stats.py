"""Roll-ups built from CaseView lists.

The per-case numeric extraction is reused from calc_stats.py; this module
just groups and summarises.
"""

from __future__ import annotations

import statistics
from collections import Counter

from report.viewmodel import AggregateStats, CaseView, OutcomeCount, Segment, StatRow

SEGMENT_NAMES = ("succeed", "fail_gracefully", "refuse")


def segments(cases: list[CaseView]) -> list[Segment]:
    by_outcome: dict[str, list[CaseView]] = {name: [] for name in SEGMENT_NAMES}
    for c in cases:
        by_outcome.setdefault(c.expected_outcome or "unknown", []).append(c)
    return [Segment(name=name, cases=by_outcome.get(name, [])) for name in SEGMENT_NAMES]


def outcome_breakdown(cases: list[CaseView]) -> list[OutcomeCount]:
    """Count every case by its outcome_label (a passing outcome OR a failure class).

    Returns one row per distinct label, sorted by count descending. Each row
    carries kind="pass" or "fail" so the renderer can colour the badge.
    """
    pass_counts: Counter[str] = Counter()
    fail_counts: Counter[str] = Counter()
    for c in cases:
        if not c.has_grade:
            continue
        (pass_counts if c.passed else fail_counts)[c.outcome_label] += 1

    rows = [OutcomeCount(label=k, count=v, kind="pass") for k, v in pass_counts.items()]
    rows += [OutcomeCount(label=k, count=v, kind="fail") for k, v in fail_counts.items()]
    rows.sort(key=lambda r: r.count, reverse=True)
    return rows


def _fmt_int(n: float | int | None) -> str:
    if n is None:
        return "—"
    return f"{int(n):,}"


def _fmt_avg(n: float | None, places: int = 2) -> str:
    if n is None:
        return "—"
    return f"{n:.{places}f}"


def _sub(
    label: str,
    all_vals: list[float],
    pass_vals: list[float],
    fail_vals: list[float],
    avg_fn=statistics.mean,
    fmt=_fmt_avg,
) -> StatRow:
    def cell(vals: list[float]) -> str:
        return fmt(avg_fn(vals)) if vals else "—"

    return StatRow(kind="sub", label=label, overall=cell(all_vals), passing=cell(pass_vals), failing=cell(fail_vals))


def _data(label: str, overall: str, passing: str, failing: str) -> StatRow:
    return StatRow(kind="data", label=label, overall=overall, passing=passing, failing=failing)


def _group(label: str) -> StatRow:
    return StatRow(kind="group", label=label, overall="", passing="", failing="")


_SPACER = StatRow(kind="spacer", label="", overall="", passing="", failing="")


def aggregate(cases: list[CaseView]) -> AggregateStats:
    total = len(cases)
    passed = sum(1 for c in cases if c.passed)
    failed = total - passed
    pass_rate = (passed / total * 100.0) if total else 0.0

    pass_cases = [c for c in cases if c.passed]
    fail_cases = [c for c in cases if not c.passed]

    def col(cases_: list[CaseView], attr: str) -> list[float]:
        return [float(getattr(c, attr)) for c in cases_]

    durations = [c.duration_ms / 1000.0 for c in cases]
    pass_durations = [c.duration_ms / 1000.0 for c in pass_cases]
    fail_durations = [c.duration_ms / 1000.0 for c in fail_cases]

    fmt_int = lambda n, places=0: _fmt_int(n)  # noqa: E731

    rows: list[StatRow] = [
        _data("Cases", str(total), str(passed), str(failed)),
        _data("Pass rate", f"{pass_rate:.1f}%",
              "100.0%" if pass_cases else "—",
              "0.0%" if fail_cases else "—"),
        _SPACER,

        _group("Duration"),
        _sub("avg (s)", durations, pass_durations, fail_durations),
        _sub("median (s)", durations, pass_durations, fail_durations, avg_fn=statistics.median),
        _SPACER,

        _group("Iterations"),
        _sub("avg", col(cases, "iterations"), col(pass_cases, "iterations"), col(fail_cases, "iterations")),
        _sub("median", col(cases, "iterations"), col(pass_cases, "iterations"), col(fail_cases, "iterations"),
             avg_fn=statistics.median, fmt=fmt_int),
        _SPACER,

        _group("Tokens"),
        _sub("avg", col(cases, "total_tokens"), col(pass_cases, "total_tokens"), col(fail_cases, "total_tokens"), fmt=fmt_int),
        _sub("median", col(cases, "total_tokens"), col(pass_cases, "total_tokens"), col(fail_cases, "total_tokens"),
             avg_fn=statistics.median, fmt=fmt_int),
        _SPACER,

        _group("Build attempts"),
        _sub("avg", col(cases, "build_attempts"), col(pass_cases, "build_attempts"), col(fail_cases, "build_attempts")),
        _sub("median", col(cases, "build_attempts"), col(pass_cases, "build_attempts"), col(fail_cases, "build_attempts"),
             avg_fn=statistics.median, fmt=fmt_int),
        _SPACER,

        _data("Edits (avg)",
              _fmt_avg(statistics.mean(col(cases, "edits_count"))) if cases else "—",
              _fmt_avg(statistics.mean(col(pass_cases, "edits_count"))) if pass_cases else "—",
              _fmt_avg(statistics.mean(col(fail_cases, "edits_count"))) if fail_cases else "—"),
    ]

    return AggregateStats(total=total, passed=passed, failed=failed, pass_rate=pass_rate, rows=rows)
