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

# Wall-clock cap per case. Defense-in-depth against runaway loops in the
# nixmac binary (e.g. an evolve session that never converges). 0 = no
# timeout. See apps/eval/wip/evolve_limits-plan.md for the proper fix.
DEFAULT_CASE_TIMEOUT_SECONDS = 600

SCRIPT_DIR = Path(__file__).parent.resolve()

# Location where we store JSON evaluation results during test runs
RESULTS_DIR: Path = SCRIPT_DIR / "data/results"

# Repository root (the eval suite lives in apps/eval of the nixmac repo).
REPO_ROOT: Path = SCRIPT_DIR.parent.parent

# Directory holding all bundled nix-darwin templates (one subdir per template).
TEMPLATES_DIR: Path = REPO_ROOT / "apps/native/templates"

# Template used when no --base-config is supplied.
DEFAULT_TEMPLATE_NAME = "nix-darwin-determinate"

# Default nixmac binary built from this repo (build with `cargo build` at the root).
DEFAULT_NIXMAC = REPO_ROOT / "target/debug/nixmac"

# Environment variable the nixmac binary honors to root ALL of its per-device
# state (settings.json, global-preferences.json, nixmac.db, secrets, ...) in a
# directory of our choosing. Each test case gets a fresh temp dir, so eval runs
# are fully hermetic: they can never read or mutate the developer's real app
# state, credentials, or nix config.
NIXMAC_APP_DATA_DIR_ENV = "NIXMAC_APP_DATA_DIR"

# Populated in __main__ when running as a script
args: argparse.Namespace | None = None


def _looks_like_git_url(value: str) -> bool:
    """Heuristic: is `value` a git URL rather than a local path?"""
    if value.startswith(("git+", "github:")):
        return True
    head = value.split("?", 1)[0]
    return (
        head.startswith(("http://", "https://", "git@", "ssh://", "git://"))
        or head.endswith(".git")
    )


def _parse_flake_url(value: str) -> tuple[str, str | None]:
    """Parse a flake-style git URL into (clone_url, ref).

    Accepted forms:
      github:user/repo[/ref]                         — GitHub shorthand
      git+https://host/repo[.git][?ref=X]            — flake git+ prefix
      https://host/repo[.git][?ref=X]                — plain git URL
      git@host:user/repo.git[?ref=X]                 — ssh
    """
    if value.startswith("github:"):
        rest = value[len("github:"):]
        # Strip any query string for safety; refs in github: come via the path.
        rest = rest.split("?", 1)[0]
        parts = rest.split("/", 2)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise ValueError(
                f"github: URL must be github:user/repo[/ref]: {value!r}"
            )
        user, repo = parts[0], parts[1]
        ref = parts[2] if len(parts) == 3 and parts[2] else None
        return f"https://github.com/{user}/{repo}", ref

    if value.startswith("git+"):
        value = value[len("git+"):]

    if "?" in value:
        base, qs = value.split("?", 1)
        from urllib.parse import parse_qs

        params = parse_qs(qs)
        ref = params.get("ref", [None])[0]
        return base, ref

    return value, None


def resolve_base_config(
    base_config: str | None,
    clone_into: Path,
) -> Path:
    """Resolve --base-config into a directory holding a nix-darwin config.

    Resolution order:
    - None → bundled DEFAULT_TEMPLATE_NAME under TEMPLATES_DIR.
    - bundled template name (subdir of TEMPLATES_DIR) → that subdir.
    - local directory → that directory.
    - flake-style git URL → shallow clone into `clone_into`.

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

    # 3) flake-style git URL → shallow clone once into `clone_into`.
    if _looks_like_git_url(base_config):
        clone_url, ref = _parse_flake_url(base_config)
        clone_into.mkdir(parents=True, exist_ok=True)
        kwargs: dict[str, Any] = {"depth": 1, "single_branch": True}
        if ref:
            kwargs["branch"] = ref
        print(
            f"Cloning {clone_url}"
            + (f" @ {ref}" if ref else "")
            + f" into {clone_into}"
        )
        Repo.clone_from(clone_url, str(clone_into), **kwargs)
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


def create_nix_config_git_repo(
    template_dir: Path,
    hostname: str | None = None,
    max_token_budget: int | None = None,
    max_iterations: int | None = None,
):
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
    #
    # .nixmac/ must NOT be gitignored: the template's flake.nix imports
    # ./.nixmac as a module, and nix flakes only see git-tracked files, so
    # ignoring it makes every build_check fail before the model has done
    # anything. It is also where repo-scoped EvolutionLimits live
    # (mirroring production, where .nixmac/settings.json is tracked so it
    # follows the repo across machines) — write them before the initial
    # commit so they are committed and the tree starts clean.
    (tmpdir / ".gitignore").write_text("flake.lock\n")

    generate_repo_scoped_settings(
        tmpdir,
        max_token_budget=max_token_budget,
        max_iterations=max_iterations,
    )

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
    api_key_env: dict | None = None,
    max_iterations: int | None = None,
    max_token_budget: int | None = None,
    host: str | None = None,
    case_timeout: int | None = None,
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
    app_data_dir: Path | None = None
    try:
        # Repo-scoped EvolutionLimits (maxTokenBudget, maxIterations) are
        # written into <config_dir>/.nixmac/settings.json and committed as
        # part of the fixture's initial state.
        config_dir = create_nix_config_git_repo(
            template_dir,
            hostname=eval_hostname,
            max_token_budget=max_token_budget,
            max_iterations=max_iterations,
        )
        print(f"Created git repo with config at: {config_dir}")

        # Fresh hermetic app-data dir per case: the binary roots ALL of its
        # per-device state here (via NIXMAC_APP_DATA_DIR), so nothing is
        # read from or written to the developer's real app state, and
        # nothing leaks between cases.
        app_data_dir = Path(tempfile.mkdtemp(prefix="nixmac-appdata-"))
        print(f"Created hermetic app-data dir at: {app_data_dir}")

        # Generate nixmac settings.json pointing to the config dir
        # Use the same eval_hostname for hostAttr so template and build agree
        generate_nixmac_settings(
            app_data_dir,
            evolve_model,
            summary_model,
            auth_props,
            max_iterations,
            max_token_budget,
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

        # Hermetic state root plus env-first API keys. The keys go through
        # the environment because that is the binary's highest-precedence
        # secret source and it keeps them out of on-disk settings.
        child_env = os.environ.copy()
        child_env[NIXMAC_APP_DATA_DIR_ENV] = str(app_data_dir)
        if openai_key:
            child_env["OPENAI_API_KEY"] = openai_key
        if openrouter_key:
            child_env["OPENROUTER_API_KEY"] = openrouter_key
        for env_key, value in (api_key_env or {}).items():
            child_env[env_key] = value

        timed_out = False
        timeout_seconds = case_timeout if case_timeout and case_timeout > 0 else None
        # Run in a new session so subprocess.run can kill the whole process
        # group on timeout (nixmac shells out to nix / nixos-rebuild / git;
        # we don't want orphans burning CPU after we cut the parent).
        try:
            subprocess.run(
                cmd,
                check=False,
                timeout=timeout_seconds,
                start_new_session=True,
                env=child_env,
            )
        except subprocess.TimeoutExpired:
            timed_out = True
            print(
                f"Case {case.num}: wall-clock timeout after "
                f"{timeout_seconds}s; killed nixmac. "
                f"See apps/eval/wip/evolve_limits-plan.md for the proper fix."
            )

        # Refuse to continue if the binary ignored the hermetic override —
        # that would mean this case just ran against real user state.
        assert_hermetic_run(app_data_dir)

        # If we timed out, prefer a structured stub so the result is recorded
        # but graders can distinguish a timeout from a successful or
        # model-decided stop.
        if timed_out:
            stub = {
                "success": False,
                "error": f"case timed out after {timeout_seconds}s",
                "case": case.num,
                "command": cmd,
                "state": "timeout",
            }
            return stub

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
        if app_data_dir is not None:
            print(f"Cleaning up hermetic app-data directory: {app_data_dir}")
            with suppress(Exception):
                shutil.rmtree(app_data_dir)


def update_test_case_status(case_num: Any, result: Any, results_dir: Path = RESULTS_DIR) -> None:
    """Persist test result to file system."""
    print(f"Writing results JSON to {results_dir} for case {case_num}...")
    results_dir.mkdir(parents=True, exist_ok=True)
    result_path = results_dir / f"case_{case_num}_result.json"
    with open(result_path, "w") as f:
        json.dump(result, f, indent=4)
    print(f"Saved results for case {case_num} to: {result_path}")


def assert_hermetic_run(app_data_dir: Path) -> None:
    """Verify the nixmac binary actually honored NIXMAC_APP_DATA_DIR.

    A binary built before the hermetic override existed would silently fall
    back to the real OS app-data directory — running the evolution against
    the developer's real nix config with their real credentials. The CLI
    always creates its sqlite DB in the app-data dir on startup, so its
    absence in the hermetic dir means the override was ignored. Abort the
    whole suite in that case rather than keep spawning unsafe runs.
    """
    if not (app_data_dir / "nixmac.db").exists():
        raise RuntimeError(
            f"nixmac did not write state into {app_data_dir}; the binary "
            f"appears to ignore {NIXMAC_APP_DATA_DIR_ENV}. Rebuild nixmac "
            "from this repo (the hermetic override is required for eval "
            "runs) — refusing to continue against real user state."
        )


def generate_repo_scoped_settings(
    config_dir: Path,
    max_token_budget: int | None = None,
    max_iterations: int | None = None,
) -> None:
    """Write `<config_dir>/.nixmac/settings.json` for EvolutionLimits.

    The evolve-loop safety knobs (maxTokenBudget, maxIterations,
    maxBuildAttempts, maxOutputTokens) are persisted per-repo via
    `ConfiguredRepoScopedJson`, not in the global preferences observable.
    We only write fields the eval is overriding; everything else falls
    back to EvolutionLimits's own defaults inside the binary.

    No-op when nothing is overridden, so the binary uses its defaults.
    """
    settings: dict[str, Any] = {}
    if max_token_budget is not None:
        settings["maxTokenBudget"] = max_token_budget
    if max_iterations is not None:
        settings["maxIterations"] = max_iterations
    if not settings:
        return
    nixmac_dir = config_dir / ".nixmac"
    nixmac_dir.mkdir(parents=True, exist_ok=True)
    settings_path = nixmac_dir / "settings.json"
    settings_path.write_text(json.dumps(settings, indent=2))
    print(f"Wrote repo-scoped EvolutionLimits to {settings_path}: {settings}")


def generate_nixmac_settings(
    app_data_dir: Path,
    evolve_model: str | None = None,
    summary_model: str | None = None,
    auth_props: dict | None = None,
    max_iterations: int | None = None,
    max_token_budget: int | None = None,
    host: str | None = None,
    configDir: str | None = None,
) -> None:
    """Write a legacy-format settings.json into the hermetic app-data dir.

    The binary's one-shot legacy migration copies these values into its
    GlobalPreferences on first load. Because `app_data_dir` is a fresh temp
    dir per case, there is no stale global-preferences.json to override them
    and nothing leaks between cases.

    API keys are NOT written here — the binary only reads secrets from the
    legacy store under the e2e mock-system gate. They are passed via the
    child environment instead (OPENAI_API_KEY etc.), which the binary's
    env-first secret resolution picks up.
    """
    if host is None:
        host = _get_eval_hostname()

    settings = {
        "evolveModel": evolve_model,
        "summaryModel": summary_model,
        "hostAttr": host,
        "configDir": configDir,
    }

    # Ensure maxIterations is set (use default if not provided)
    settings["maxIterations"] = (
        max_iterations if max_iterations is not None else DEFAULT_MAX_ITERATIONS
    )

    # Only set maxTokenBudget when explicitly overridden so the binary uses
    # its own DEFAULT_MAX_TOKEN_BUDGET otherwise.
    if max_token_budget is not None:
        settings["maxTokenBudget"] = max_token_budget

    # Merge any auth_props (ollamaApiBaseUrl OR openaiCompatibleApiBaseUrl)
    # and set the provider per auth type. "openai_compatible" is the current
    # name for what the eval flags still call vLLM.
    if auth_props is not None:
        for k, v in auth_props.items():
            settings[k] = v

        provider: str | None = None
        if "ollamaApiBaseUrl" in auth_props:
            provider = "ollama"
        elif "openaiCompatibleApiBaseUrl" in auth_props:
            provider = "openai_compatible"

        settings["evolveProvider"] = provider
        settings["summaryProvider"] = provider

    app_data_dir.mkdir(parents=True, exist_ok=True)
    settings_path = app_data_dir / "settings.json"
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=4)
    print(f"Generated nixmac settings at: {settings_path}")


def main(parsed_args: argparse.Namespace) -> None:
    stop_requested = False

    def _sigint_handler(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        print("\nSIGINT received: will stop after current test (press again to force).")

    old_handler = signal.signal(signal.SIGINT, _sigint_handler)

    # Per-run results directory (overridable so two runs can sit side-by-side).
    results_dir = (
        Path(parsed_args.results_dir).expanduser()
        if getattr(parsed_args, "results_dir", None)
        else RESULTS_DIR
    )
    print(f"Writing results to: {results_dir}")

    # Session-level clone dir, only allocated if --base-config is a URL.
    clone_dir: Path | None = None
    base_config_arg = getattr(parsed_args, "base_config", None)
    if base_config_arg and _looks_like_git_url(base_config_arg):
        clone_dir = Path(tempfile.mkdtemp(prefix="eval-base-config-"))

    try:
        # Resolve the nix-darwin baseline once per run.
        template_dir = resolve_base_config(
            base_config_arg,
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
                api_key_env: dict = {}
                ollama_url = getattr(parsed_args, "ollama_url", "").strip()
                vllm_url = getattr(parsed_args, "vllm_url", "").strip()

                if ollama_url and vllm_url:
                    raise ValueError(
                        "Cannot specify both --ollama-url and --vllm-url; please provide only one backend"
                    )

                if ollama_url:
                    auth_props = {"ollamaApiBaseUrl": ollama_url}
                elif vllm_url:
                    # vLLM is served through the binary's "openai_compatible"
                    # provider; its key travels via the VLLM_API_KEY env var.
                    auth_props = {"openaiCompatibleApiBaseUrl": vllm_url}
                    vllm_api_key = getattr(parsed_args, "vllm_api_key", None)
                    if vllm_api_key:
                        api_key_env["VLLM_API_KEY"] = vllm_api_key

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
                    api_key_env,
                    parsed_args.max_iterations,
                    parsed_args.max_token_budget,
                    parsed_args.host,
                    case_timeout=parsed_args.case_timeout,
                )
            except KeyboardInterrupt:
                # Signal handler also sets `stop_requested`; ensure we record
                # that this case was interrupted and then break the loop so
                # the overall cleanup in the outer finally runs.
                stop_requested = True
                print(f"Interrupted during case {case.num}; finishing cleanup and exiting...")
                result = {"success": False, "error": "Interrupted by user", "case": case.num}
            update_test_case_status(case.num, result, results_dir=results_dir)
            if stop_requested:
                print("Stop requested; exiting after current test.")
                break
    finally:
        # Restore original SIGINT handler
        try:
            signal.signal(signal.SIGINT, old_handler)
        except Exception:
            pass

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
            "| nixos-unified), a local directory, or a flake-style git URL "
            "(github:user/repo[/ref], git+https://..., or https://...?ref=X). "
            f"Default: {DEFAULT_TEMPLATE_NAME}."
        ),
    )

    parser.add_argument(
        "--max-iterations",
        dest="max_iterations",
        type=int,
        default=None,
        help=f"Maximum iterations for evolution (default: {DEFAULT_MAX_ITERATIONS})",
    )

    parser.add_argument(
        "--max-token-budget",
        dest="max_token_budget",
        type=int,
        default=None,
        help=(
            "Override the binary's maxTokenBudget (cumulative session-token cap "
            "that triggers limitReached). Leave unset to use the binary's own "
            "default (~50k). Real-world configs (e.g. user dotfiles) tend to "
            "need 200k+ because the repo-view context eats per-call budget."
        ),
    )

    parser.add_argument(
        "--case-timeout",
        dest="case_timeout",
        type=int,
        default=DEFAULT_CASE_TIMEOUT_SECONDS,
        help=(
            "Wall-clock timeout per case, in seconds. Defense-in-depth "
            "against runaway loops in the nixmac binary. Pass 0 to "
            f"disable. Default: {DEFAULT_CASE_TIMEOUT_SECONDS}s."
        ),
    )

    parser.add_argument(
        "--csv", type=str, default=None, help="Path to CSV file containing test prompts"
    )
    parser.add_argument(
        "--results-dir",
        dest="results_dir",
        type=str,
        default=None,
        help=(
            "Directory to write case_<n>_result.json files into. Useful for "
            "side-by-side runs (e.g. comparing two --base-config baselines) "
            "without one overwriting the other. Default: data/results."
        ),
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
