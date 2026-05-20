"""
LLM-as-judge for nixmac eval results.

Grades structurally-passing succeed cases with non-empty diffs using an LLM
to evaluate semantic correctness. Writes sidecar files (case_N_llm_judge.json)
alongside result files — never mutates result JSONs.

Calibrates against golden set expectations when available.

Usage:
    uv run python llm_judge.py -i ./data/runs/full230-sonnet-20260329
    uv run python llm_judge.py -i ./data/runs/full230-sonnet-20260329 --model anthropic/claude-haiku-4
    uv run python llm_judge.py -i ./data/runs/full230-sonnet-20260329 --calibrate-only
    uv run python llm_judge.py -i ./data/runs/full230-sonnet-20260329 --dry-run
"""

import argparse
import csv
import hashlib
import json
import os
import ssl
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent.resolve()
CSV_PATH = SCRIPT_DIR / "data" / "test_prompts.csv"
EXPECTATIONS_PATH = SCRIPT_DIR / "data" / "golden_set_expectations.json"
ENV_PATH = SCRIPT_DIR / ".env"

# nix-darwin template context (embedded so the judge knows the valid file structure)
TEMPLATE_CONTEXT = """
The nix-darwin template has these module files under modules/darwin/:
- packages.nix: environment.systemPackages (nix packages — preferred for ALL apps available in nixpkgs, including GUI apps)
- homebrew.nix: homebrew.taps, homebrew.brews, homebrew.casks (fallback for apps NOT available in nixpkgs)
- defaults.nix: system.defaults.* (Dock, Finder, trackpad, keyboard, screencapture)
- environment.nix: environment.variables (EDITOR, LANG, PATH additions)
- home.nix: home-manager config (user-level programs, dotfiles)
- fonts.nix: fonts.packages (system fonts)
- networking.nix: networking config
- security.nix: security settings
- services.nix: launchd/system services
- users.nix: user account config
- flake.nix: top-level flake (inputs, outputs, system config) — generally should NOT be edited

Valid file placement rules:
- Any app available in nixpkgs (CLI or GUI) → packages.nix (environment.systemPackages) — nix-first is the default
- Apps NOT in nixpkgs → homebrew.nix (homebrew.casks for GUI, homebrew.brews for CLI)
- Homebrew formulae (when user explicitly requests Homebrew) → homebrew.nix (homebrew.brews)
- Custom taps → homebrew.nix (homebrew.taps)
- macOS system defaults → defaults.nix (system.defaults.*)
- Environment variables → environment.nix (environment.variables)
- Shell aliases, PATH → environment.nix or a shell config module
- Git config → home.nix (home-manager programs.git)
""".strip()

JUDGE_SYSTEM_PROMPT = """You are a grading judge for a nix-darwin configuration AI agent.

You evaluate whether the agent's code changes (git diff) correctly accomplish what the user's prompt requested. You grade based on semantic correctness, not just structural validity.

You MUST respond with valid JSON matching the schema below. No markdown, no commentary outside the JSON.

JSON Schema:
{
  "correctness": <0-3>,
  "correctness_rationale": "<1-2 sentences>",
  "file_placement": <0-2>,
  "file_placement_rationale": "<1 sentence>",
  "nix_validity": <0-2>,
  "nix_validity_rationale": "<1 sentence>",
  "scope_discipline": <0-1>,
  "scope_discipline_rationale": "<1 sentence>",
  "overall_pass": <true|false>,
  "confidence": "<high|medium|low>",
  "overall_rationale": "<1-2 sentences summarizing the grade>",
  "expected_in_diff": ["<keyword1>", "<keyword2>", ...],
  "expected_files": ["<file_path1>", ...]
}

Scoring guide:
- correctness: 0=completely wrong, 1=partially correct (some elements right), 2=mostly correct (minor issues), 3=fully correct
- file_placement: 0=wrong file(s), 1=acceptable but not ideal, 2=correct file(s)
- nix_validity: 0=invalid nix syntax, 1=valid but non-idiomatic, 2=valid and idiomatic
- scope_discipline: 0=unnecessary changes beyond the request, 1=appropriately scoped
- overall_pass: true if correctness >= 2 AND no critical issues
- confidence: how confident you are in your grading (high/medium/low)
- expected_in_diff: keywords that SHOULD appear in the diff for this prompt (for future deterministic grading)
- expected_files: which module files should be edited for this prompt"""

JUDGE_USER_TEMPLATE = """Grade this nix-darwin evolution result.

## User Prompt
{prompt}

## Category
{category} / {subcategory}

## Template Context
{template_context}

## Deterministic Facts
- CLI completed: {ok}
- State: {state}
- Build attempts: {build_attempts}
- Edits count: {edits_count}
- Iterations: {iterations}
- Files edited: {edited_files}

## Git Diff
```
{diff}
```

## Agent Summary
{summary_text}

Respond with the JSON grade only."""


@dataclass
class JudgeResult:
    case_id: int
    prompt: str
    model: str
    prompt_hash: str
    timestamp: str
    grade: dict[str, Any]
    raw_response: str


def load_env(env_path: Path) -> dict[str, str]:
    """Load key=value pairs from .env file."""
    env: dict[str, str] = {}
    if not env_path.exists():
        return env
    with open(env_path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


def get_api_key() -> str:
    """Get OpenRouter API key from env var or .env file."""
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if key:
        return key
    env = load_env(ENV_PATH)
    key = env.get("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError(
            "No OPENROUTER_API_KEY found. Set it as an env var or in apps/eval/.env"
        )
    return key


def load_csv_lookup(csv_path: Path) -> dict[int, dict[str, str]]:
    """Load test_prompts.csv into a lookup by case ID."""
    lookup: dict[int, dict[str, str]] = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            case_id = row.get("id", "")
            if not case_id:
                continue
            try:
                lookup[int(case_id)] = row
            except ValueError:
                continue
    return lookup


def load_expectations(path: Path) -> dict[str, Any]:
    """Load golden_set_expectations.json."""
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if k != "_meta"}


def extract_diff(result: dict[str, Any]) -> str:
    """Extract git diff from result JSON, checking multiple possible locations."""
    r = result.get("result") or {}
    # Try result.gitStatus.diff (gitStatus can be null on failure)
    git_status = r.get("gitStatus")
    if isinstance(git_status, dict):
        diff = git_status.get("diff", "")
        if diff:
            return diff
    # Try result.summary.diff
    summary = r.get("summary")
    if isinstance(summary, dict):
        diff = summary.get("diff", "")
        if diff:
            return diff
    # Try top-level summary.diff (older format)
    top_summary = result.get("summary")
    if isinstance(top_summary, dict):
        return top_summary.get("diff", "") or ""
    return ""


def extract_edited_files(diff: str) -> list[str]:
    """Extract edited file paths from unified diff."""
    files = []
    for line in diff.splitlines():
        if line.startswith("diff --git"):
            parts = line.split(" b/")
            if len(parts) >= 2:
                files.append(parts[-1])
    return files


def extract_summary_text(result: dict[str, Any]) -> str:
    """Extract summary/instructions text from result JSON."""
    r = result.get("result") or {}
    conversational_response = r.get("conversationalResponse", "")
    if isinstance(conversational_response, str) and conversational_response.strip():
        return conversational_response
    summary = r.get("summary")
    if isinstance(summary, dict):
        text = summary.get("instructions", "") or summary.get("commitMessage", "")
        if text:
            return text
    elif summary:
        return str(summary)
    # Fallback: top-level summary (older payload format)
    top_summary = result.get("summary")
    if isinstance(top_summary, dict):
        return top_summary.get("instructions", "") or top_summary.get("commitMessage", "")
    if isinstance(top_summary, str) and top_summary:
        return top_summary
    return ""


def extract_telemetry_field(result: dict[str, Any], key: str, default: int = 0) -> int:
    """Extract a numeric telemetry field from either historical or current result shape."""
    r = result.get("result") or {}
    value = r.get(key)
    if isinstance(value, int):
        return value
    telemetry = r.get("telemetry") if isinstance(r.get("telemetry"), dict) else {}
    telemetry_value = telemetry.get(key)
    return telemetry_value if isinstance(telemetry_value, int) else default


def extract_state(result: dict[str, Any]) -> str:
    """Extract evolution state from either historical or current result shape."""
    r = result.get("result") or {}
    telemetry = r.get("telemetry") if isinstance(r.get("telemetry"), dict) else {}
    telemetry_state = telemetry.get("state", "")
    if isinstance(telemetry_state, str) and telemetry_state:
        return telemetry_state
    state = result.get("state", "")
    if isinstance(state, str) and state:
        return state
    nested_state = r.get("state", "")
    return nested_state if isinstance(nested_state, str) else ""


def call_llm(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_retries: int = 2,
) -> str:
    """Call OpenRouter API and return the response text."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 1024,
    }).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/darkmatter/nixmac",
        "X-Title": "nixmac-eval-judge",
    }

    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:200]
            if attempt < max_retries:
                wait = 2 ** (attempt + 1)
                print(f"  API error (attempt {attempt + 1}): {e.code} {body} — retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise RuntimeError(f"API call failed after {max_retries + 1} attempts: {e.code} {body}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < max_retries:
                wait = 2 ** (attempt + 1)
                print(f"  API error (attempt {attempt + 1}): {e} — retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise RuntimeError(f"API call failed after {max_retries + 1} attempts: {e}") from e
    raise RuntimeError("Unreachable")


REQUIRED_JUDGE_KEYS = {
    "correctness", "file_placement", "nix_validity", "scope_discipline",
    "overall_pass", "confidence", "expected_in_diff", "expected_files",
}


def parse_judge_response(raw: str) -> dict[str, Any]:
    """Parse and validate the LLM's JSON response."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        # Remove first line (```json or ```) and last line (```)
        lines = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(lines)

    grade = json.loads(text)

    # Validate required keys
    missing = REQUIRED_JUDGE_KEYS - set(grade.keys())
    if missing:
        raise ValueError(f"Judge response missing required keys: {missing}")

    # Validate types for critical fields
    if not isinstance(grade["overall_pass"], bool):
        raise ValueError(f"overall_pass must be bool, got {type(grade['overall_pass']).__name__}")
    if grade["confidence"] not in ("high", "medium", "low"):
        raise ValueError(f"confidence must be high/medium/low, got {grade['confidence']!r}")
    if not isinstance(grade["correctness"], int) or not 0 <= grade["correctness"] <= 3:
        raise ValueError(f"correctness must be int 0-3, got {grade['correctness']!r}")

    return grade


MAX_DIFF_CHARS = 8000


def _truncate_diff(diff: str) -> str:
    """Truncate diff with a marker if it exceeds the limit."""
    if not diff:
        return "(empty)"
    if len(diff) <= MAX_DIFF_CHARS:
        return diff
    return diff[:MAX_DIFF_CHARS] + "\n\n[TRUNCATED — diff exceeds 8000 chars, some hunks omitted]"


def build_user_prompt(
    result: dict[str, Any],
    csv_row: dict[str, str],
) -> str:
    """Build the user prompt for the judge."""
    diff = extract_diff(result)

    return JUDGE_USER_TEMPLATE.format(
        prompt=result.get("prompt", csv_row.get("prompt", "")),
        category=csv_row.get("category", "unknown"),
        subcategory=csv_row.get("subcategory", "unknown"),
        template_context=TEMPLATE_CONTEXT,
        ok=result.get("ok", False),
        state=extract_state(result) or "unknown",
        build_attempts=extract_telemetry_field(result, "buildAttempts"),
        edits_count=extract_telemetry_field(result, "editsCount"),
        iterations=extract_telemetry_field(result, "iterations"),
        edited_files=", ".join(extract_edited_files(diff)) or "none",
        diff=_truncate_diff(diff),
        summary_text=extract_summary_text(result)[:1000] or "(none)",
    )


def hash_prompt(system_prompt: str, user_prompt: str) -> str:
    """Create a short hash of the judge prompt for versioning."""
    content = system_prompt + user_prompt
    return hashlib.sha256(content.encode()).hexdigest()[:12]


def is_judgeable(result: dict[str, Any], csv_row: dict[str, str]) -> bool:
    """Check if a case should be judged: structurally-passing succeed with non-empty diff."""
    expected_outcome = csv_row.get("expected_outcome", "")
    if expected_outcome != "succeed":
        return False

    ok = result.get("ok", False)
    if not ok:
        return False

    # Skip conversational succeed cases (e.g., "Hi!")
    state = extract_state(result)
    if state == "conversational":
        return False

    diff = extract_diff(result)
    return bool(diff.strip())


def judge_case(
    result: dict[str, Any],
    csv_row: dict[str, str],
    case_id: int,
    api_key: str,
    model: str,
) -> JudgeResult:
    """Judge a single case and return the result."""
    user_prompt = build_user_prompt(result, csv_row)
    prompt_hash = hash_prompt(JUDGE_SYSTEM_PROMPT, user_prompt)
    timestamp = datetime.now(timezone.utc).isoformat()

    raw_response = call_llm(api_key, model, JUDGE_SYSTEM_PROMPT, user_prompt)
    grade = parse_judge_response(raw_response)

    return JudgeResult(
        case_id=case_id,
        prompt=result.get("prompt", csv_row.get("prompt", "")),
        model=model,
        prompt_hash=prompt_hash,
        timestamp=timestamp,
        grade=grade,
        raw_response=raw_response,
    )


def write_judge_result(judge_result: JudgeResult, output_dir: Path) -> Path:
    """Write judge result as a sidecar JSON file."""
    out_path = output_dir / f"case_{judge_result.case_id}_llm_judge.json"
    data = {
        "case_id": judge_result.case_id,
        "prompt": judge_result.prompt,
        "method": "llm_judge",
        "model": judge_result.model,
        "prompt_hash": judge_result.prompt_hash,
        "timestamp": judge_result.timestamp,
        "grade": judge_result.grade,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
    return out_path


def print_calibration_report(
    judge_results: list[JudgeResult],
    expectations: dict[str, Any],
) -> None:
    """Compare judge results against golden set expectations."""
    golden_ids = set(expectations.keys())
    overlap = [jr for jr in judge_results if str(jr.case_id) in golden_ids]

    if not overlap:
        print("\nNo golden-set overlap cases to calibrate against.")
        return

    print(f"\n{'=' * 60}")
    print("CALIBRATION: LLM Judge vs Golden Set")
    print(f"{'=' * 60}")
    print(f"Overlap cases: {len(overlap)}")

    agreements = 0
    disagreements = []

    for jr in overlap:
        exp = expectations[str(jr.case_id)]
        judge_pass = jr.grade.get("overall_pass", False)
        exp_outcome = exp.get("expected_outcome", "succeed")

        # For succeed cases, the golden set expects a pass
        expected_pass = exp_outcome == "succeed"

        if judge_pass == expected_pass:
            agreements += 1
        else:
            disagreements.append({
                "case_id": jr.case_id,
                "judge_pass": judge_pass,
                "expected_pass": expected_pass,
                "judge_confidence": jr.grade.get("confidence", "?"),
                "correctness": jr.grade.get("correctness", "?"),
                "rationale": jr.grade.get("overall_rationale", ""),
            })

    print(f"Agreement rate: {agreements}/{len(overlap)} ({agreements/len(overlap)*100:.0f}%)")

    if disagreements:
        print(f"\nDisagreements ({len(disagreements)}):")
        for d in disagreements:
            print(f"  Case {d['case_id']}: judge={'PASS' if d['judge_pass'] else 'FAIL'}, "
                  f"expected={'PASS' if d['expected_pass'] else 'FAIL'}, "
                  f"confidence={d['judge_confidence']}, correctness={d['correctness']}")
            print(f"    Rationale: {d['rationale']}")

    # Check keyword overlap
    keyword_matches = 0
    keyword_total = 0
    for jr in overlap:
        exp = expectations[str(jr.case_id)]
        exp_keywords = exp.get("expected_in_diff", [])
        judge_keywords = jr.grade.get("expected_in_diff", [])
        if exp_keywords:
            keyword_total += 1
            exp_set = {k.lower() for k in exp_keywords}
            judge_set = {k.lower() for k in judge_keywords}
            if exp_set.issubset(judge_set) or judge_set.issubset(exp_set):
                keyword_matches += 1

    if keyword_total:
        print(f"\nKeyword overlap: {keyword_matches}/{keyword_total} golden cases have similar expected_in_diff")

    print(f"{'=' * 60}")


def main() -> None:
    parser = argparse.ArgumentParser(description="LLM-as-judge for nixmac eval results")
    parser.add_argument(
        "-i", "--input-dir",
        type=Path,
        required=True,
        help="Directory containing result JSON files",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="anthropic/claude-haiku-4.5",
        help="OpenRouter model for judging (default: anthropic/claude-haiku-4.5)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=CSV_PATH,
        help="Path to test_prompts.csv",
    )
    parser.add_argument(
        "--expectations",
        type=Path,
        default=EXPECTATIONS_PATH,
        help="Path to golden_set_expectations.json",
    )
    parser.add_argument(
        "--calibrate-only",
        action="store_true",
        help="Only judge golden-set cases (for calibration)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show which cases would be judged without calling the API",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of cases to judge",
    )
    parser.add_argument(
        "--rows",
        type=str,
        default=None,
        help="Comma-delimited list of case IDs to judge (e.g., --rows 1,3,5)",
    )
    args = parser.parse_args()

    if not args.input_dir.exists():
        print(f"Error: Input directory does not exist: {args.input_dir}")
        return

    # Load reference data
    csv_lookup = load_csv_lookup(args.csv)
    expectations = load_expectations(args.expectations)

    # Parse row filter
    row_filter: set[int] | None = None
    if args.rows:
        row_filter = {int(s) for s in args.rows.replace(",", " ").split() if s}

    # Find result files (sort numerically by case ID, not lexicographically)
    def _case_id_sort_key(p: Path) -> int:
        try:
            return int(p.stem.split("_")[1])
        except (IndexError, ValueError):
            return 0

    result_files = sorted(args.input_dir.glob("case_*_result.json"), key=_case_id_sort_key)
    if not result_files:
        print(f"No result files found in {args.input_dir}")
        return

    # Identify judgeable cases
    judgeable: list[tuple[int, dict[str, Any], dict[str, str]]] = []

    for result_file in result_files:
        try:
            with open(result_file, encoding="utf-8") as f:
                result = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Failed to read {result_file}: {e}")
            continue

        try:
            case_id = int(result_file.stem.split("_")[1])
        except (IndexError, ValueError):
            continue

        csv_row = csv_lookup.get(case_id)
        if not csv_row:
            continue

        # Apply row filter
        if row_filter and case_id not in row_filter:
            continue

        # Apply calibrate-only filter
        if args.calibrate_only and str(case_id) not in expectations:
            continue

        # Check if already judged (sidecar exists)
        sidecar = args.input_dir / f"case_{case_id}_llm_judge.json"
        if sidecar.exists() and not args.calibrate_only:
            continue

        if is_judgeable(result, csv_row):
            judgeable.append((case_id, result, csv_row))

    # Apply limit
    if args.limit is not None:
        judgeable = judgeable[:args.limit]

    print(f"Found {len(judgeable)} judgeable cases (structurally-passing succeed with non-empty diffs)")

    if args.dry_run:
        print("\nDry run — cases that would be judged:")
        for case_id, _result, csv_row in judgeable:
            golden = " [GOLDEN]" if str(case_id) in expectations else ""
            print(f"  Case {case_id}: {csv_row.get('prompt', '')[:60]}...{golden}")
        return

    if not judgeable:
        print("No cases to judge.")
        return

    # Get API key
    api_key = get_api_key()

    # Judge cases
    judge_results: list[JudgeResult] = []
    errors: list[tuple[int, str]] = []

    for idx, (case_id, result, csv_row) in enumerate(judgeable):
        golden_marker = " [GOLDEN]" if str(case_id) in expectations else ""
        print(f"[{idx + 1}/{len(judgeable)}] Judging case {case_id}{golden_marker}: "
              f"{csv_row.get('prompt', '')[:50]}...")

        try:
            jr = judge_case(result, csv_row, case_id, api_key, args.model)
            judge_results.append(jr)
            write_judge_result(jr, args.input_dir)

            grade = jr.grade
            status = "PASS" if grade.get("overall_pass") else "FAIL"
            conf = grade.get("confidence", "?")
            corr = grade.get("correctness", "?")
            print(f"  → {status} (confidence={conf}, correctness={corr}/3)")

        except Exception as e:
            print(f"  → ERROR: {e}")
            errors.append((case_id, str(e)))

        # Small delay to respect rate limits
        if idx < len(judgeable) - 1:
            time.sleep(0.5)

    # Print summary
    print(f"\n{'=' * 60}")
    print("LLM JUDGE SUMMARY")
    print(f"{'=' * 60}")
    print(f"Model: {args.model}")
    print(f"Cases judged: {len(judge_results)}")
    print(f"Errors: {len(errors)}")

    if judge_results:
        passed = [jr for jr in judge_results if jr.grade.get("overall_pass")]
        failed = [jr for jr in judge_results if not jr.grade.get("overall_pass")]
        print(f"Passed: {len(passed)} ({len(passed)/len(judge_results)*100:.0f}%)")
        print(f"Failed: {len(failed)} ({len(failed)/len(judge_results)*100:.0f}%)")

        # Confidence distribution
        conf_dist: dict[str, int] = {}
        for jr in judge_results:
            conf = jr.grade.get("confidence", "unknown")
            conf_dist[conf] = conf_dist.get(conf, 0) + 1
        print(f"\nConfidence distribution: {conf_dist}")

        # Correctness distribution
        corr_dist: dict[int, int] = {}
        for jr in judge_results:
            corr = jr.grade.get("correctness", -1)
            corr_dist[corr] = corr_dist.get(corr, 0) + 1
        print(f"Correctness distribution: {dict(sorted(corr_dist.items()))}")

        # Failed cases detail
        if failed:
            print(f"\nFailed cases ({len(failed)}):")
            for jr in failed:
                g = jr.grade
                print(f"  Case {jr.case_id}: correctness={g.get('correctness', '?')}/3, "
                      f"confidence={g.get('confidence', '?')}")
                print(f"    Prompt: {jr.prompt[:60]}...")
                print(f"    Rationale: {g.get('overall_rationale', '')}")

        # Low confidence cases
        low_conf = [jr for jr in judge_results if jr.grade.get("confidence") == "low"]
        if low_conf:
            print(f"\nLow-confidence cases ({len(low_conf)}) — flagged for human review:")
            for jr in low_conf:
                g = jr.grade
                status = "PASS" if g.get("overall_pass") else "FAIL"
                print(f"  Case {jr.case_id} ({status}): {jr.prompt[:50]}...")
                print(f"    Rationale: {g.get('overall_rationale', '')}")

    # Calibration report
    if expectations:
        print_calibration_report(judge_results, expectations)

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for case_id, err in errors:
            print(f"  Case {case_id}: {err}")

    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
