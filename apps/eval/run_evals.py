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

DEFAULT_EVOLVE_MODEL = "gpt-oss-120b"
DEFAULT_SUMMARY_MODEL = "gpt-4o"
DEFAULT_MAX_ITERATIONS = 25

SCRIPT_DIR = Path(__file__).parent.resolve()

# Location where we store JSON evaluation results during test runs
RESULTS_DIR: Path = SCRIPT_DIR / "data/results"

# Directory holding all bundled nix-darwin templates (one subdir per template).
TEMPLATES_DIR: Path = SCRIPT_DIR.parent.parent / "vendor/nixmac/apps/native/templates"

# Template used when no --base-config is supplied.
DEFAULT_TEMPLATE_NAME = "nix-darwin-determinate"

# Default nixmac binary from the vendored public repo submodule (build with `cargo build` there).
DEFAULT_NIXMAC = SCRIPT_DIR.parent.parent / "vendor/nixmac/target/debug/nixmac"

# Directory containing nixmac config/state files (settings.json, evolve-state.json, etc.)
NIXMAC_CONFIG_DIR: Path = Path.home() / "Library" / "Application Support" / "com.darkmatter.nixmac"

# System nixmac settings.json (~/Library/Application Support/com.darkmatter.nixmac/settings.json)
NIXMAC_SETTINGS_PATH: Path = NIXMAC_CONFIG_DIR / "settings.json"

# Populated in __main__ when running as a script
args: argparse.Namespace | None = None


def _looks_like_git_url(value: str) -> bool:
    """Heuristic: is `value` a git URL rather than a local path?"""
    return (
        value.startswith(("http://", "https://", "git@", "ssh://", "git://"))
        or value.endswith(".git")
    )


def resolve_base_config(
    base_config: str | None,
    base_config_ref: str | None,
    clone_into: Path,
) -> Path:
    """Resolve --base-config into a directory holding a nix-darwin config.

    Resolution order:
    - None → bundled DEFAULT_TEMPLATE_NAME under TEMPLATES_DIR.
    - bundled template name (subdir of TEMPLATES_DIR) → that subdir.
    - local directory → that directory.
    - git URL → shallow clone into `clone_into` (C3, not yet implemented).

    The caller owns the lifetime of any temp directories it passed in.
    """
    if base_config is None:
        return TEMPLATES_DIR / DEFAULT_TEMPLATE_NAME

    # 1) bundled template name?
    candidate = TEMPLATES_DIR / base_config
    if candidate.is_dir():
        return candidate

    # 2) local directory path?
    local = Path(base_config).expanduser()
    if local.is_dir():
        return local

    # 3) git URL → shallow clone once into `clone_into`.
    if _looks_like_git_url(base_config):
        clone_into.mkdir(parents=True, exist_ok=True)
        kwargs: dict[str, Any] = {"depth": 1, "single_branch": True}
        if base_config_ref:
            kwargs["branch"] = base_config_ref
        print(
            f"Cloning {base_config}"
            + (f" @ {base_config_ref}" if base_config_ref else "")
            + f" into {clone_into}"
        )
        Repo.clone_from(base_config, str(clone_into), **kwargs)
        return clone_into

    raise ValueError(
        f"--base-config {base_config!r} is not a bundled template name, "
        f"an existing directory, or a git URL"
    )


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
        return subprocess.check_output(["scutil", "--get", "LocalHostName"], text=True).strip()
    except subprocess.CalledProcessError:
        return "localhost"


def create_nix_config_git_repo(template_dir: Path, hostname: str | None = None):
    """
    Create a temporary nix config git repo from `template_dir`, with hostname
    and platform placeholders replaced (where present), ready for nix-darwin
    evaluation.

    Mirrors the production template-processing path in default_config.rs:
    replaces HOSTNAME_PLACEHOLDER, USERNAME_PLACEHOLDER, and
    PLATFORM_PLACEHOLDER across ALL .nix files, not just flake.nix.
    """
    # Create temporary directory
    tmpdir = Path(tempfile.mkdtemp(prefix="nix-config-"))

    # Copy template into temp dir (full recursive copy, preserve all files).
    # Ignore any .git from the source so we always init a fresh repo and
    # don't inherit the source's branch state or bloat the temp dir.
    shutil.copytree(
        template_dir,
        tmpdir,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".git"),
    )

    if hostname is None:
        hostname = _get_eval_hostname()

    # Replace username placeholder with the current system user running this script
    try:
        username = getpass.getuser()
    except Exception:
        username = os.environ.get("USER", "nobody")

    # Replace placeholders in ALL .nix files (matching default_config.rs behavior)
    # Turn on unfree packages because we have several tests that require them
    # and agent behavior is inconsistent as to whether it tries to automatically
    # enable or just get stuck on the error.
    for nix_file in tmpdir.rglob("*.nix"):
        content = nix_file.read_text()
        updated = (
            content.replace("HOSTNAME_PLACEHOLDER", hostname)
            .replace("USERNAME_PLACEHOLDER", username)
            .replace("PLATFORM_PLACEHOLDER", "aarch64-darwin")
            .replace("# nixpkgs.config.allowUnfree = true;", "nixpkgs.config.allowUnfree = true;")
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
    template_dir: Path,
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
        config_dir = create_nix_config_git_repo(template_dir, hostname=eval_hostname)
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
        cmd = [str(nixmac), "evolve", case.request, "--out", str(out_path)]
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
    """Persist test result to file system."""
    print(f"Writing results JSON to results directory for case {case_num}...")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_path = RESULTS_DIR / f"case_{case_num}_result.json"
    with open(result_path, "w") as f:
        json.dump(result, f, indent=4)
    print(f"Saved results for case {case_num} to: {result_path}")


def backup_nixmac_settings() -> dict:
    """Back up nixmac files (settings.json, evolve-state.json, build-state.json).

    Copies any existing files to a .bak sibling and deletes the originals.
    Returns a dict mapping original Path -> backup Path for later restoration.
    """
    backups: dict[Path, Path] = {}

    candidates = [
        NIXMAC_SETTINGS_PATH,
        NIXMAC_CONFIG_DIR / "evolve-state.json",
        NIXMAC_CONFIG_DIR / "build-state.json",
    ]

    for p in candidates:
        try:
            if p.exists():
                backup_path = p.with_suffix(".bak")
                shutil.copy2(p, backup_path)
                print(f"Backed up {p.name} to: {backup_path}")
                # remove the original so tests start from a clean slate
                p.unlink()
                print(f"Removed original {p}")
                backups[p] = backup_path
        except Exception as exc:
            print(f"Warning: failed to back up {p}: {exc}")

    if not backups:
        print("No nixmac files found to back up.")

    return backups


def restore_nixmac_settings(backups: dict) -> None:
    """Restore previously backed up nixmac files from the provided mapping.

    `backups` should be the dict returned from `backup_nixmac_settings`.
    """
    if not backups:
        print("No nixmac backups to restore.")
        return

    for original_path, backup_path in backups.items():
        try:
            if backup_path.exists():
                shutil.copy2(backup_path, original_path)
                backup_path.unlink()
                print(f"Restored {original_path.name} from backup: {backup_path}")
            else:
                print(f"Backup not found for {original_path}: {backup_path}")
        except Exception as exc:
            print(f"Warning: failed to restore {original_path} from {backup_path}: {exc}")


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
        for k, v in auth_props.items():
            settings[k] = v

        # Derive provider kind from auth_props after merging: prefer ollama, else vllm
        provider: str | None = None
        if "ollamaApiBaseUrl" in auth_props:
            provider = "ollama"
        elif "vllmApiBaseUrl" in auth_props:
            provider = "vllm"

        settings["evolveProvider"] = provider
        settings["summaryProvider"] = provider

    NIXMAC_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(NIXMAC_SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=4)
    print(f"Generated nixmac settings at: {NIXMAC_SETTINGS_PATH}")


def main(parsed_args: argparse.Namespace) -> None:
    # Back up nixmac files (settings.json, evolve-state.json, build-state.json)
    # before running any test cases, and restore them at the end
    backups = backup_nixmac_settings()
    stop_requested = False

    def _sigint_handler(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        print("\nSIGINT received: will stop after current test (press again to force).")

    old_handler = signal.signal(signal.SIGINT, _sigint_handler)

    # Session-level clone dir, only allocated if --base-config is a URL.
    clone_dir: Path | None = None
    base_config_arg = getattr(parsed_args, "base_config", None)
    if base_config_arg and _looks_like_git_url(base_config_arg):
        clone_dir = Path(tempfile.mkdtemp(prefix="eval-base-config-"))

    try:
        # Resolve the nix-darwin baseline once per run.
        template_dir = resolve_base_config(
            base_config_arg,
            getattr(parsed_args, "base_config_ref", None),
            clone_into=clone_dir or Path(tempfile.gettempdir()),
        )
        print(f"Using nix-darwin baseline: {template_dir}")

        # When the user pointed at a real config (not a bundled template),
        # the placeholder substitution becomes a no-op, so --host must
        # match a darwinConfigurations entry in the config. Warn if not set.
        if parsed_args.base_config is not None and not parsed_args.host:
            derived = _get_eval_hostname()
            print(
                f"Warning: using derived host {derived!r} against external "
                f"--base-config; pass --host to match a darwinConfigurations "
                f"entry in your config."
            )

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
            raise ValueError(
                "Currently only CSV input is supported; please provide --csv argument pointing to test cases CSV file."
            )

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
                    raise ValueError(
                        "Cannot specify both --ollama-url and --vllm-url; please provide only one backend"
                    )

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
                    template_dir,
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
                result = {"success": False, "error": "Interrupted by user", "case": case.num}
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

        restore_nixmac_settings(backups)

        # Clean up the session-level cloned base config, if any.
        if clone_dir is not None:
            print(f"Cleaning up cloned base config directory: {clone_dir}")
            with suppress(Exception):
                shutil.rmtree(clone_dir)


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
        "--summary-model",
        type=str,
        default=DEFAULT_SUMMARY_MODEL,
        help="Summary model (e.g. gpt-4)",
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
        "--base-config",
        dest="base_config",
        type=str,
        default=None,
        help=(
            "Baseline nix-darwin config to evaluate against. Accepts a "
            "bundled template name (minimal | base | nix-darwin-determinate "
            "| nixos-unified), a local directory, or (later) a git URL. "
            f"Default: {DEFAULT_TEMPLATE_NAME}."
        ),
    )
    parser.add_argument(
        "--base-config-ref",
        dest="base_config_ref",
        type=str,
        default=None,
        help="Git ref to check out when --base-config is a URL (default: HEAD).",
    )

    parser.add_argument(
        "--max-iterations",
        dest="max_iterations",
        type=int,
        default=None,
        help=f"Maximum iterations for evolution (default: {DEFAULT_MAX_ITERATIONS})",
    )

    parser.add_argument(
        "--csv", type=str, default=None, help="Path to CSV file containing test prompts"
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
        "--priority",
        type=str,
        help="Filter test cases by priority (e.g., --priority {Critical,High,Medium,Low})",
    )
    parser.add_argument(
        "--persona", type=str, help="Filter test cases by persona (e.g., --persona Developer)"
    )

    args = parser.parse_args()

    # Validate that at least one backend is configured: either ollama or vllm
    ollama_set = bool(getattr(args, "ollama_url", None)) and args.ollama_url.strip() != ""
    vllm_set = bool(getattr(args, "vllm_url", None)) and args.vllm_url.strip() != ""
    if not (ollama_set or vllm_set):
        print(
            "Error: you must provide either --ollama-url or --vllm-url (and optionally --vllm-api-key)"
        )
        raise SystemExit(2)

    main(args)
