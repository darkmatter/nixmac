"""Summarize a nixmac eval run against the March 30 Sonnet Slack baseline.

This intentionally supports an aggregate-only baseline because the raw
`full230-sonnet-20260329` artifacts are not guaranteed to be present locally.
"""

import argparse
import json
from pathlib import Path
from typing import Any

SONNET_SLACK_BASELINE = {
    "total_prompts": 231,
    "completed": 226,
    "ok_true": 192,
    "runtime_errors": 34,
    "judgeable_succeed": 108,
    "raw_judge_pass_context_only": 93,
    "corrected_judge_pass": 97,
    "corrected_judge_fail": 15,
}


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def count_ok(results: list[dict[str, Any]]) -> int:
    return sum(1 for result in results if result.get("ok") is True)


def grade_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    graded = [result for result in results if isinstance(result.get("grade"), dict)]
    passed = [result for result in graded if result["grade"].get("pass") is True]
    by_expected: dict[str, dict[str, int]] = {}
    for result in graded:
        expected = result["grade"].get("expected_outcome", "unknown")
        bucket = by_expected.setdefault(expected, {"passed": 0, "total": 0})
        bucket["total"] += 1
        if result["grade"].get("pass") is True:
            bucket["passed"] += 1
    return {
        "graded": len(graded),
        "passed": len(passed),
        "failed": len(graded) - len(passed),
        "by_expected_outcome": by_expected,
    }


def judge_summary(run_dir: Path) -> dict[str, Any]:
    sidecars = sorted(run_dir.glob("case_*_llm_judge.json"))
    judged = []
    for sidecar in sidecars:
        data = load_json(sidecar)
        if data:
            judged.append(data)
    passed = [
        result
        for result in judged
        if isinstance(result.get("grade"), dict) and result["grade"].get("overall_pass") is True
    ]
    return {
        "judged": len(judged),
        "passed": len(passed),
        "failed": len(judged) - len(passed),
    }


def summarize_candidate(run_dir: Path) -> dict[str, Any]:
    result_files = sorted(run_dir.glob("case_*_result.json"))
    results = [data for path in result_files if (data := load_json(path))]
    manifest = load_json(run_dir / "manifest.json") or {}
    attempted = manifest.get("counts", {}).get("attempted")
    completed = len(results)
    ok_true = count_ok(results)
    return {
        "run_dir": str(run_dir),
        "run_id": manifest.get("run_id"),
        "selected": manifest.get("counts", {}).get("selected"),
        "attempted": attempted,
        "completed": completed,
        "ok_true": ok_true,
        "runtime_errors": (attempted - ok_true) if isinstance(attempted, int) else None,
        "grade": grade_summary(results),
        "judge": judge_summary(run_dir),
        "manifest": {
            "git_commit": manifest.get("git_commit"),
            "prompt_source_sha256": manifest.get("prompt_source_sha256"),
            "providers": manifest.get("providers"),
            "limits": manifest.get("limits"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare nixmac eval run summaries")
    parser.add_argument("--candidate", type=Path, required=True, help="Candidate run directory")
    parser.add_argument(
        "--baseline-label",
        default="Sonnet 4 via OpenRouter, 2026-03-30 Slack baseline",
        help="Human-readable baseline label",
    )
    parser.add_argument(
        "--baseline-slack-ts",
        default="1774924687.725639",
        help="Slack parent timestamp for the aggregate baseline",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of a Markdown summary",
    )
    args = parser.parse_args()

    if not args.candidate.exists():
        raise SystemExit(f"Candidate run directory does not exist: {args.candidate}")

    report = {
        "baseline": {
            "label": args.baseline_label,
            "slack_ts": args.baseline_slack_ts,
            "metrics": SONNET_SLACK_BASELINE,
        },
        "candidate": summarize_candidate(args.candidate),
    }

    if args.json:
        print(json.dumps(report, indent=2))
        return

    candidate = report["candidate"]
    judge = candidate["judge"]
    grade = candidate["grade"]
    print("# Eval Run Comparison")
    print()
    print(f"Baseline: {args.baseline_label} (`{args.baseline_slack_ts}`)")
    print(f"Candidate: `{candidate['run_id']}`")
    print()
    print("| Metric | Sonnet/OpenRouter Baseline | Candidate |")
    print("| --- | ---: | ---: |")
    print(f"| Completed | {SONNET_SLACK_BASELINE['completed']} | {candidate['completed']} |")
    print(
        f"| Runtime ok=true | {SONNET_SLACK_BASELINE['ok_true']}/{SONNET_SLACK_BASELINE['completed']} | "
        f"{candidate['ok_true']}/{candidate['completed']} |"
    )
    print(
        f"| Runtime errors | {SONNET_SLACK_BASELINE['runtime_errors']} | {candidate['runtime_errors']} |"
    )
    print(f"| Deterministic graded | n/a | {grade['graded']} |")
    print(f"| Deterministic pass | n/a | {grade['passed']}/{grade['graded']} |")
    print(
        f"| LLM judge pass | {SONNET_SLACK_BASELINE['corrected_judge_pass']}/{SONNET_SLACK_BASELINE['judgeable_succeed']} | "
        f"{judge['passed']}/{judge['judged']} |"
    )
    print(
        f"| LLM judge fail | {SONNET_SLACK_BASELINE['corrected_judge_fail']}/{SONNET_SLACK_BASELINE['judgeable_succeed']} | "
        f"{judge['failed']}/{judge['judged']} |"
    )
    print()
    print("Candidate manifest:")
    print(json.dumps(candidate["manifest"], indent=2))


if __name__ == "__main__":
    main()
