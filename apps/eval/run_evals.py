from pathlib import Path
from typing import Any, List, Optional
from dataclasses import dataclass
import argparse

SCRIPT_DIR = Path(__file__).parent.resolve()
SPREADSHEET: Path = SCRIPT_DIR / "data/dimensions-of-variation.xlsx"

# Populated in __main__ when running as a script
args: Optional[argparse.Namespace] = None


@dataclass
class EvalTestCase:
    row: int
    num: Any
    feature: str
    scenario: str
    persona: str
    priority: str
    request: str
    expected: str
    status: str


def read_test_cases(
    rows: Optional[List[int]] = None,
    priority: Optional[str] = None,
    persona: Optional[str] = None,
) -> List[EvalTestCase]:
    """Read test cases from the spreadsheet."""
    from openpyxl import load_workbook

    wb = load_workbook(SPREADSHEET)
    ws = wb["Test Matrix"]
    cases: List[EvalTestCase] = []
    for r in range(5, ws.max_row + 1):
        num = ws.cell(r, 1).value
        if num is None:
            continue
        case = EvalTestCase(
            row=r,
            num=num,
            feature=str(ws.cell(r, 2).value or ""),
            scenario=str(ws.cell(r, 3).value or ""),
            persona=str(ws.cell(r, 4).value or ""),
            priority=str(ws.cell(r, 5).value or ""),
            request=str(ws.cell(r, 6).value or ""),
            expected=str(ws.cell(r, 7).value or ""),
            status=str(ws.cell(r, 8).value or ""),
        )
        if rows and case.num not in rows:
            continue
        if priority and case.priority != priority:
            continue
        if persona and case.persona != persona:
            continue
        if case.request:
            cases.append(case)
    wb.close()
    return cases


def run_test_case(case: EvalTestCase) -> Any:
    """Run a single test case.

    Returns provider-specific result (could be string, dict, etc.).
    """
    print(f"Running prompt: {case.request}")
    return None


def update_test_case_status(row: int, result: Any) -> None:
    """Persist test result back to the spreadsheet or other storage.

    Not implemented in this script.
    """
    print("Updating test case status in spreadsheet (not implemented).")


def main(parsed_args: argparse.Namespace) -> None:
    cases: List[EvalTestCase] = read_test_cases(
        rows=parsed_args.rows,
        priority=parsed_args.priority,
        persona=parsed_args.persona,
    )
    print(f"Running {len(cases)} test cases...")
    for case in cases:
        print(f"Running case {case.num}: {case.scenario}...")
        result = run_test_case(case)
        print(f"Result: {result}")
        update_test_case_status(case.row, result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run evaluation test cases.")
    parser.add_argument(
        "--rows",
        type=int,
        nargs="+",
        help="Specific test case numbers to run (e.g., --rows 1 3 5)",
    )
    parser.add_argument(
        "--priority",
        type=str,
        help="Filter test cases by priority (e.g., --priority High)",
    )
    parser.add_argument(
        "--persona",
        type=str,
        help="Filter test cases by persona (e.g., --persona Developer)",
    )
    args = parser.parse_args()
    main(args)
