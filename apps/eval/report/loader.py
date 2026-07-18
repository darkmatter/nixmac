"""Read result JSONs + CSV + golden expectations into a RunView.

This is the only module that reads files. Everything downstream takes a
RunView and renders it.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Reuse the shared CSV/expectations helpers from grade.py so we have one
# source of truth for the column meanings.
from grade import load_csv_lookup, load_expectations
from report import diff_html, stats
from report.viewmodel import CaseView, CheckView, RunMeta, RunView

# Where a results dir conventionally stores its run manifest (P3).
RUN_META_FILENAME = "run_meta.json"


def _extract_diff(result: dict[str, Any]) -> str:
    inner = result.get("result") or {}
    git_status = inner.get("gitStatus")
    if isinstance(git_status, dict):
        d = git_status.get("diff") or ""
        if d:
            return d
    summary = inner.get("summary")
    if isinstance(summary, dict):
        d = summary.get("diff") or ""
        if d:
            return d
    return (result.get("summary") or {}).get("diff", "") or ""


def _extract_summary_block(result: dict[str, Any]) -> tuple[str | None, str | None]:
    inner = result.get("result") or {}
    summary = inner.get("summary") or result.get("summary")
    if not isinstance(summary, dict):
        return None, None
    return summary.get("commitMessage") or None, summary.get("instructions") or None


def _build_case(
    case_id: int,
    result: dict[str, Any],
    csv_row: dict[str, str] | None,
    is_golden: bool,
) -> CaseView:
    inner = result.get("result") or {}
    telemetry = inner.get("telemetry") if isinstance(inner.get("telemetry"), dict) else {}

    diff = _extract_diff(result)
    commit_message, instructions = _extract_summary_block(result)

    grade = result.get("grade") if isinstance(result.get("grade"), dict) else None
    if grade:
        checks = [
            CheckView(name=name, passed=bool(c.get("pass")), detail=c.get("detail", ""))
            for name, c in (grade.get("checks") or {}).items()
        ]
        passed = bool(grade.get("pass"))
        failure_class = grade.get("failure_class")
        has_grade = True
    else:
        checks = []
        passed = bool(result.get("ok", False))
        failure_class = None
        has_grade = False

    return CaseView(
        case_id=case_id,
        prompt=result.get("prompt", "") or "",
        notes=(csv_row.get("notes") if csv_row else None) or None,
        category=(csv_row.get("category") if csv_row else "") or "",
        subcategory=(csv_row.get("subcategory") if csv_row else "") or "",
        priority=(csv_row.get("priority") if csv_row else "") or "",
        expected_outcome=(csv_row.get("expected_outcome") if csv_row else "") or "",
        is_golden=is_golden,
        passed=passed,
        failure_class=failure_class,
        checks=checks,
        has_grade=has_grade,
        diff=diff,
        diff_html=diff_html.render(diff),
        conversational_reply=inner.get("conversationalResponse") or None,
        commit_message=commit_message,
        summary_instructions=instructions,
        iterations=int(telemetry.get("iterations", inner.get("iterations", 0)) or 0),
        build_attempts=int(telemetry.get("buildAttempts", inner.get("buildAttempts", 0)) or 0),
        edits_count=int(telemetry.get("editsCount", inner.get("editsCount", 0)) or 0),
        tool_calls_count=telemetry.get("toolCallsCount"),
        thinking_count=telemetry.get("thinkingCount"),
        duration_ms=int(telemetry.get("durationMs", 0) or 0),
        total_tokens=int(telemetry.get("totalTokens", 0) or 0),
        state=result.get("state") or inner.get("state") or "",
        log_excerpt=None,
        evolve_model=result.get("evolveModel"),
        evolve_provider=result.get("evolveProvider"),
    )


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _build_meta(
    cases: list[CaseView],
    results_dir: Path,
    run_meta_path: Path,
    golden_only: bool,
) -> RunMeta:
    title = "golden set" if golden_only else "full eval"
    generated_at = datetime.now()

    raw: dict[str, Any] = {}
    sourced_from = "derived"
    if run_meta_path.exists():
        try:
            with run_meta_path.open() as f:
                raw = json.load(f)
            sourced_from = "run_meta.json"
        except (OSError, json.JSONDecodeError) as e:
            print(f"warning: failed to read {run_meta_path}: {e}", file=sys.stderr)

    if sourced_from == "derived":
        # Best-effort derivation from result file mtimes.
        result_files = sorted(results_dir.glob("case_*_result.json"))
        if result_files:
            mtimes = [datetime.fromtimestamp(p.stat().st_mtime) for p in result_files]
            run_started_at = min(mtimes)
            run_finished_at = max(mtimes)
        else:
            run_started_at = run_finished_at = None
    else:
        run_started_at = _parse_iso(raw.get("run_started_at"))
        run_finished_at = _parse_iso(raw.get("run_finished_at"))

    evolve_models = sorted({c.evolve_model for c in cases if c.evolve_model})
    evolve_providers = sorted({c.evolve_provider for c in cases if c.evolve_provider})
    # summary_models are run-level — only known via run_meta.json
    summary_models = (
        [raw["summary_model"]] if raw.get("summary_model") else []
    )

    return RunMeta(
        title=title,
        generated_at=generated_at,
        run_started_at=run_started_at,
        run_finished_at=run_finished_at,
        evolve_models=evolve_models,
        evolve_providers=evolve_providers,
        summary_models=summary_models,
        nixmac_git_sha=raw.get("nixmac_git_sha"),
        eval_host=raw.get("eval_host"),
        cli_args=raw.get("cli_args"),
        sourced_from=sourced_from,
    )


def load(
    results_dir: Path,
    csv_path: Path,
    golden_path: Path,
    run_meta_path: Path | None = None,
    log_path: Path | None = None,
    golden_only: bool = False,
) -> RunView:
    if not results_dir.exists():
        raise FileNotFoundError(f"results dir not found: {results_dir}")

    csv_lookup = load_csv_lookup(csv_path) if csv_path.exists() else {}
    expectations = load_expectations(golden_path) if golden_path.exists() else {}
    golden_ids = set(expectations.keys())  # keys are case_id as str

    cases: list[CaseView] = []
    ungraded: list[int] = []

    for path in sorted(results_dir.glob("case_*_result.json")):
        try:
            case_id = int(path.stem.split("_")[1])
        except (IndexError, ValueError):
            print(f"warning: cannot parse case id from {path.name}", file=sys.stderr)
            continue

        if golden_only and str(case_id) not in golden_ids:
            continue

        try:
            with path.open() as f:
                result = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"warning: failed to read {path}: {e}", file=sys.stderr)
            continue

        csv_row = csv_lookup.get(case_id)
        case = _build_case(
            case_id=case_id,
            result=result,
            csv_row=csv_row,
            is_golden=str(case_id) in golden_ids,
        )
        if not case.has_grade:
            ungraded.append(case_id)
        cases.append(case)

    cases.sort(key=lambda c: c.case_id)

    if ungraded:
        print(
            f"warning: {len(ungraded)} case(s) missing grade block "
            f"(run grade.py): {ungraded[:5]}{'…' if len(ungraded) > 5 else ''}",
            file=sys.stderr,
        )

    rm_path = run_meta_path or (results_dir / RUN_META_FILENAME)
    meta = _build_meta(cases, results_dir, rm_path, golden_only)

    return RunView(
        meta=meta,
        cases=cases,
        segments=stats.segments(cases),
        aggregate_stats=stats.aggregate(cases),
        outcome_breakdown=stats.outcome_breakdown(cases),
        compare_to=None,
    )
