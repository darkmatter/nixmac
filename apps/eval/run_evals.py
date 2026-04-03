# Example command line to do full logging and capture those, and keep the process caffeinated to prevent sleep during long test runs:
#
# RUST_LOG=nixmac=debug NIXMAC_LOGFILE=2025-04-02-evals.out caffeinate python run_evals.py --csv data/test_prompts.csv --priority Critical --vllm-url "http://100.111.97.14:8002/v1" --vllm-api-key "$VLLM_API_KEY"


import argparse
import csv
import json
import os
import shutil
import subprocess
import tempfile
import getpass
import signal
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from git import Actor, Repo

# DEFAULT_EVOLVE_MODEL = "gpt-oss-200k:latest"
# DEFAULT_SUMMARY_MODEL = "gpt-oss:120b"

DEFAULT_EVOLVE_MODEL = "gpt-4o"
DEFAULT_SUMMARY_MODEL = "gpt-4o"
DEFAULT_MAX_ITERATIONS = 25

SCRIPT_DIR = Path(__file__).parent.resolve()

# Testcase data
SPREADSHEET: Path = SCRIPT_DIR / "data/dimensions-of-variation.xlsx"

# Location where we store JSON evaluation results during test runs
RESULTS_DIR: Path = SCRIPT_DIR / "data/results"

# Default nix config template
CONFIG_TEMPLATE_DIR: Path = SCRIPT_DIR.parent / "native/templates/nix-darwin-determinate"

# Default place we find nixmac to run evolution during test cases
DEFAULT_NIXMAC = SCRIPT_DIR.parent.parent / "target" / "debug" / "nixmac"

# System nixmac settings.json (~/Library/Application\ Support/com.darkmatter.nixmac/settings.json)
NIXMAC_SETTINGS_PATH = (
    Path.home() / "Library" / "Application Support" / "com.darkmatter.nixmac" / "settings.json"
)

# Populated in __main__ when running as a script
args: argparse.Namespace | None = None


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
    skip: bool = False


def read_test_cases_from_csv(
    csv_path: Path,
    rows: list[int] | None = None,
    priority: str | None = None,
    persona: str | None = None,
) -> list[EvalTestCase]:
    """Read test cases from a CSV file.

    Expected CSV columns:
    - id: test case number
    - prompt: the user request
    - expected_outcome: expected result (succeed/fail_gracefully/refuse)
    - category: high-level category
    - subcategory: more specific scenario
    - quality_dimension: quality aspect being tested
    - priority: priority level (Critical/High/Medium/Low)
    - notes: additional notes
    - skip: if TRUE, the test case is skipped
    """
    cases: list[EvalTestCase] = []

    with open(csv_path, newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for idx, row_data in enumerate(reader, start=2):  # Start at 2 (header is row 1)
            try:
                case_id = row_data.get("id", "")
                if not case_id:
                    continue

                # Try to parse id as integer
                num: Any
                try:
                    num = int(case_id)
                except ValueError:
                    num = case_id

                # Map CSV columns to EvalTestCase fields
                case = EvalTestCase(
                    row=idx,
                    num=num,
                    feature=row_data.get("category", ""),
                    scenario=row_data.get("subcategory", ""),
                    persona=row_data.get("quality_dimension", ""),
                    priority=row_data.get("priority", ""),
                    request=row_data.get("prompt", ""),
                    expected=row_data.get("expected_outcome", ""),
                    status=row_data.get("notes", ""),
                    skip=row_data.get("skip", "").strip().upper() == "TRUE",
                )

                # Apply filters
                if rows and num not in rows:
                    continue
                if priority and case.priority != priority:
                    continue
                if persona and case.persona != persona:
                    continue
                if case.request:
                    cases.append(case)
            except Exception as e:
                print(f"Warning: Skipping row {idx} in CSV due to error: {e}")
                continue

    return cases


def _get_eval_hostname() -> str:
    """Get the canonical hostname for eval runs.

    Uses scutil --get LocalHostName (same source the app uses for
    darwinConfigurations key). This must match the hostAttr passed to
    generate_nixmac_settings so template and build target agree.
    """
    try:
        return subprocess.check_output(
            ["scutil", "--get", "LocalHostName"], text=True
        ).strip()
    except subprocess.CalledProcessError:
        return "localhost"


def create_nix_config_git_repo(hostname: str | None = None):
    """
    Create a temporary nix config git repo from the template, with hostname
    and platform placeholders replaced, ready for nix-darwin evaluation.

    Mirrors the production template-processing path in default_config.rs:
    replaces HOSTNAME_PLACEHOLDER, USERNAME_PLACEHOLDER, and
    PLATFORM_PLACEHOLDER across ALL .nix files, not just flake.nix.
    """
    # Create temporary directory
    tmpdir = Path(tempfile.mkdtemp(prefix="nix-config-"))

    # Copy template into temp dir (full recursive copy, preserve all files)
    shutil.copytree(CONFIG_TEMPLATE_DIR, tmpdir, dirs_exist_ok=True)

    if hostname is None:
        hostname = _get_eval_hostname()

    # Replace username placeholder with the current system user running this script
    try:
        username = getpass.getuser()
    except Exception:
        username = os.environ.get("USER", "nobody")

    # Replace placeholders in ALL .nix files (matching default_config.rs behavior)
    for nix_file in tmpdir.rglob("*.nix"):
        content = nix_file.read_text()
        updated = (
            content.replace("HOSTNAME_PLACEHOLDER", hostname)
            .replace("USERNAME_PLACEHOLDER", username)
            .replace("PLATFORM_PLACEHOLDER", "aarch64-darwin")
        )
        if updated != content:
            nix_file.write_text(updated)

    # Ignore flake.lock so nix operations don't dirty the git tree
    # Normally we would want to commit the lockfile, but for AI evolve engine
    # testing doing a lock upfront wastes time and having it always
    # a part of dirty changes is noisy and obfuscates the actual changes
    # made by the evolve engine during test runs.
    (tmpdir / ".gitignore").write_text("flake.lock\n")

    # Initialize git repo
    repo = Repo.init(str(tmpdir))

    # Ensure local user config
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "eval")
        cw.set_value("user", "email", "eval@test")

    # Add all files and commit
    repo.git.add(A=True)
    actor = Actor("eval", "eval@test")
    try:
        repo.index.commit("initial nix config state", author=actor, committer=actor)
    except Exception as exc:
        raise RuntimeError("Failed to create initial git commit for fixture") from exc

    # Refresh index to ensure git tree is clean
    repo.git.update_index("--refresh")

    return tmpdir


def run_test_case(
    case: EvalTestCase,
    nixmac: Path,
    evolve_model: str | None = None,
    summary_model: str | None = None,
    openai_key: str | None = None,
    openrouter_key: str | None = None,
    auth_props: dict | None = None,
    max_iterations: int | None = None,
    host: str | None = None,
) -> Any:
    """Run a single test case.

    Returns provider-specific result (could be string, dict, etc.).
    """
    print(f"Running prompt: {case.request}")

    # Derive hostname once and thread through both template and settings
    eval_hostname = host if host else _get_eval_hostname()

    # Create a git repo in a temporary directory from nix-darwin-determinate
    config_dir: Path | None = None
    result_dir: Path | None = None
    try:
        config_dir = create_nix_config_git_repo(hostname=eval_hostname)
        print(f"Created git repo with config at: {config_dir}")

        # Generate nixmac settings.json pointing to the config dir
        # Use the same eval_hostname for hostAttr so template and build agree
        generate_nixmac_settings(
            evolve_model,
            summary_model,
            openai_key,
            openrouter_key,
            auth_props,
            max_iterations,
            eval_hostname,
            str(config_dir),
        )

        # Create a temporary directory to capture the evolution result
        result_dir = Path(tempfile.mkdtemp(prefix="evolution-"))
        out_path = result_dir / "evolution_result.json"

        # Run the test case using nixmac and write output to the temp dir.
        # Use subprocess.run instead of os.system: os.system blocks SIGINT in
        # the parent while the child runs, so Ctrl-C would not reach
        # the stop_requested handler until after the child exits.
        # This way we don't have to Ctrl-C O(n) times stop a long-running test suite.
        cmd = [
            str(nixmac),
            "evolve",
            case.request,
            "--out",
            str(out_path),
        ]
        subprocess.run(cmd, check=False)

        # Read and return the evolution result if present
        if out_path.exists():
            with open(out_path) as f:
                evolution_result = json.load(f)
            print(json.dumps(evolution_result, indent=2))
            return evolution_result
        else:
            print("No evolution result file found after running nixmac.")
            # TODO: nixmac CLI should report structured failure info (exit code + JSON).
            # For now create a stub JSON result indicating failure so tests can record it.
            stub = {
                "success": False,
                "error": "nixmac did not produce evolution_result.json",
                "case": case.num,
                "command": cmd,
            }
            try:
                with open(out_path, "w") as f:
                    json.dump(stub, f, indent=2)
            except Exception:
                pass
            return stub
    finally:
        if config_dir is not None:
            print(f"Cleaning up temporary config directory: {config_dir}")
            with suppress(Exception):
                shutil.rmtree(config_dir)
        if result_dir is not None:
            print(f"Cleaning up temporary evolution result directory: {result_dir}")
            with suppress(Exception):
                shutil.rmtree(result_dir)


def update_test_case_status(case_num: Any, result: Any) -> None:
    """Persist test result back to the spreadsheet or other storage.

    Uses the test case's `num` (from the spreadsheet/csv) for filenames so
    output files map to case numbers rather than Excel row indices.
    """
    print(f"Writing results JSON to results directory for case {case_num}...")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_path = RESULTS_DIR / f"case_{case_num}_result.json"
    with open(result_path, "w") as f:
        json.dump(result, f, indent=4)
    print(f"Saved results for case {case_num} to: {result_path}")


def backup_nixmac_settings() -> Path | None:
    """Back up the nixmac settings.json file if it exists, and return the backup path."""
    if NIXMAC_SETTINGS_PATH.exists():
        backup_path = NIXMAC_SETTINGS_PATH.with_suffix(".bak")
        shutil.copy2(NIXMAC_SETTINGS_PATH, backup_path)
        print(f"Backed up nixmac settings to: {backup_path}")
        return backup_path
    else:
        print("No existing nixmac settings found to back up.")
        return None


def restore_nixmac_settings(backup_path: Path | None) -> None:
    """Restore the nixmac settings.json file from the backup path."""
    if backup_path is not None and backup_path.exists():
        shutil.copy2(backup_path, NIXMAC_SETTINGS_PATH)
        backup_path.unlink()
        print(f"Restored nixmac settings from backup: {backup_path}")
    else:
        print("No backup settings found to restore.")


def generate_nixmac_settings(
    evolve_model: str | None = None,
    summary_model: str | None = None,
    openai_key: str | None = None,
    openrouter_key: str | None = None,
    auth_props: dict | None = None,
    max_iterations: int | None = None,
    host: str | None = None,
    configDir: str | None = None,
) -> None:
    """Generate a nixmac settings.json file based on provided parameters."""
    if host is None:
        host = _get_eval_hostname()

    settings = {
        "evolveModel": evolve_model,
        "summaryModel": summary_model,
        "openaiApiKey": openai_key,
        "openrouterApiKey": openrouter_key,
        "hostAttr": host,
        "configDir": configDir,
    }

    # Ensure maxIterations is set (use default if not provided)
    settings["maxIterations"] = (
        max_iterations if max_iterations is not None else DEFAULT_MAX_ITERATIONS
    )

    # Merge any auth_props (e.g., ollamaApiBaseUrl OR vllmApiBaseUrl/vllmApiKey)
    # Also set provider per auth type.
    if auth_props is not None:
        for (k, v) in auth_props.items():
            settings[k] = v

        # Derive provider kind from auth_props after merging: prefer ollama, else vllm
        provider: str | None = None
        if "ollamaApiBaseUrl" in auth_props:
            provider = "ollama"
        elif "vllmApiBaseUrl" in auth_props:
            provider = "vllm"

        settings["evolveProvider"] = provider
        settings["summaryProvider"] = provider
    
    NIXMAC_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(NIXMAC_SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=4)
    print(f"Generated nixmac settings at: {NIXMAC_SETTINGS_PATH}")


def main(parsed_args: argparse.Namespace) -> None:
    # Back up nixmac settings.json before running any test cases, and restore it at the end
    settings_backup_path = backup_nixmac_settings()
    stop_requested = False

    def _sigint_handler(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        print("\nSIGINT received: will stop after current test (press again to force).")

    old_handler = signal.signal(signal.SIGINT, _sigint_handler)

    try:
        # Parse comma-delimited rows into list[int]
        rows: list[int] | None
        if parsed_args.rows:
            rows = [int(s) for s in str(parsed_args.rows).replace(",", " ").split() if s]
        else:
            rows = None

        # Read test cases from CSV
        cases: list[EvalTestCase]
        if parsed_args.csv:
            csv_path = Path(parsed_args.csv)
            if not csv_path.exists():
                raise FileNotFoundError(f"CSV file not found: {csv_path}")
            cases = read_test_cases_from_csv(
                csv_path, rows=rows, priority=parsed_args.priority, persona=parsed_args.persona
            )
        else:
            raise ValueError("Currently only CSV input is supported; please provide --csv argument pointing to test cases CSV file.")
        
        # Apply --limit if provided to cap number of cases run
        if parsed_args.limit is not None:
            total_cases = len(cases)
            if parsed_args.limit < total_cases:
                cases = cases[: parsed_args.limit]
                print(f"Limiting test cases to {len(cases)} of {total_cases} matching cases...")
            else:
                print(
                    f"Limit {parsed_args.limit} >= total matching cases ({total_cases}); running all."
                )

        print(f"Running {len(cases)} test cases...")
        for case in cases:
            if stop_requested:
                print("Stop requested; exiting before starting next test.")
                break

            if case.skip:
                print(f"Skipping case {case.num}: {case.scenario} (marked skip=TRUE in CSV).")
                continue

            print(f"Running case {case.num}: {case.scenario}...")
            nixmac_path = Path(parsed_args.nixmac)
            try:
                # Build auth_props based on which backend URL is provided (ollama or vllm); validate that both are not provided at the same time
                auth_props: dict | None = None
                ollama_url = getattr(parsed_args, "ollama_url", "").strip()
                vllm_url = getattr(parsed_args, "vllm_url", "").strip()
                
                if ollama_url and vllm_url:
                    raise ValueError("Cannot specify both --ollama-url and --vllm-url; please provide only one backend")
                
                if ollama_url:
                    auth_props = {"ollamaApiBaseUrl": ollama_url}
                elif vllm_url:
                    auth_props = {"vllmApiBaseUrl": vllm_url}
                    vllm_api_key = getattr(parsed_args, "vllm_api_key", None)
                    if vllm_api_key:
                        auth_props["vllmApiKey"] = vllm_api_key

                # Run the test case and capture the result
                result = run_test_case(
                    case,
                    nixmac_path,
                    parsed_args.evolve_model,
                    parsed_args.summary_model,
                    parsed_args.openai_key,
                    parsed_args.openrouter_key,
                    auth_props,
                    parsed_args.max_iterations,
                    parsed_args.host,
                )
            except KeyboardInterrupt:
                # Signal handler also sets `stop_requested`; ensure we record
                # that this case was interrupted and then break the loop so
                # the overall cleanup in the outer finally runs.
                stop_requested = True
                print(f"Interrupted during case {case.num}; finishing cleanup and exiting...")
                result = {
                    "success": False,
                    "error": "Interrupted by user",
                    "case": case.num,
                }
            update_test_case_status(case.num, result)
            if stop_requested:
                print("Stop requested; exiting after current test.")
                break
    finally:
        # Restore original SIGINT handler
        try:
            signal.signal(signal.SIGINT, old_handler)
        except Exception:
            pass

        restore_nixmac_settings(settings_backup_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run evaluation test cases.")

    parser.add_argument(
        "--nixmac", type=str, default=str(DEFAULT_NIXMAC), help="Path to nixmac binary"
    )
    # Flags mirroring main nixmac app settings
    parser.add_argument(
        "--evolve-model", type=str, default=DEFAULT_EVOLVE_MODEL, help="Evolve model (e.g. gpt-4)"
    )
    parser.add_argument(
        "--summary-model", type=str, default=DEFAULT_SUMMARY_MODEL, help="Summary model (e.g. gpt-4)"
    )
    parser.add_argument(
        "--openai-key", dest="openai_key", type=str, default=None, help="OpenAI API key"
    )
    parser.add_argument(
        "--openrouter-key", dest="openrouter_key", type=str, default=None, help="OpenRouter API key"
    )
    
    # One of (ollama or vllm) must be provided to specify the engine backend for testing.
    # The summary and evolve providers will be derived from these arguments.
    parser.add_argument(
        "--ollama-url",
        dest="ollama_url",
        type=str,
        default="",
        help="Ollama base URL (e.g. http://localhost:11434)",
    )
    parser.add_argument(
        "--vllm-url",
        dest="vllm_url",
        type=str,
        default="",
        help="vLLM base URL (e.g. http://100.111.97.14:8002/v1)",
    )
    parser.add_argument(
        "--vllm-api-key",
        dest="vllm_api_key",
        type=str,
        default=None,
        help="vLLM API key (if required)",
    )
    parser.add_argument("--host", type=str, default=None, help="Host name for your Mac")

    parser.add_argument(
        "--max-iterations",
        dest="max_iterations",
        type=int,
        default=None,
        help=f"Maximum iterations for evolution (default: {DEFAULT_MAX_ITERATIONS})",
    )

    parser.add_argument(
        "--csv",
        type=str,
        default=None,
        help="Path to CSV file containing test prompts (alternative to Excel spreadsheet)",
    )
    parser.add_argument(
        "--rows",
        type=str,
        default=None,
        help="Comma-delimited list of test case numbers to run (e.g., --rows 1,3,5)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of test cases to run (default: all matching cases)",
    )
    parser.add_argument(
        "--priority", type=str, help="Filter test cases by priority (e.g., --priority {Critical,High,Medium,Low})"
    )
    parser.add_argument(
        "--persona", type=str, help="Filter test cases by persona (e.g., --persona Developer)"
    )

    args = parser.parse_args()

    # Validate that at least one backend is configured: either ollama or vllm
    ollama_set = bool(getattr(args, "ollama_url", None)) and args.ollama_url.strip() != ""
    vllm_set = bool(getattr(args, "vllm_url", None)) and args.vllm_url.strip() != ""
    if not (ollama_set or vllm_set):
        print("Error: you must provide either --ollama-url or --vllm-url (and optionally --vllm-api-key)")
        raise SystemExit(2)

    main(args)
