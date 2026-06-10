# External base config for the eval suite — Plan

**Status:** Draft, pending review
**Goal of this doc:** let `run_evals.py` evaluate against an arbitrary
nix-darwin configuration (local path or git repo) instead of being
hard-wired to the bundled `nix-darwin-determinate` template. Useful for
comparing how the eval suite behaves on different baseline configs
(minimal vs. determinate vs. a user's real-world config).

When no override is given, behavior is unchanged: bundled template.

______________________________________________________________________

## Background (what the suite does today)

Confirmed in `run_evals.py`:

- `CONFIG_TEMPLATE_DIR` (line 35) is hard-coded to
  `apps/native/templates/nix-darwin-determinate`.
- `create_nix_config_git_repo()` (lines 144–209) copies that template
  into a `tempfile.mkdtemp(prefix="nix-config-")`, substitutes
  `HOSTNAME_PLACEHOLDER` / `USERNAME_PLACEHOLDER` /
  `PLATFORM_PLACEHOLDER`, force-enables `allowUnfree` if the commented
  marker is present, and `git init`s the result.
- `main()` backs up `~/Library/Application Support/com.darkmatter.nixmac/{settings,evolve-state,build-state}.json`
  before any run, and `generate_nixmac_settings(..., configDir=<temp>)`
  writes a fresh `settings.json` for the duration of the run.
- Hostname is derived from `scutil --get LocalHostName`
  (`_get_eval_hostname`, line 131); username from `getpass.getuser()`.

So the *only* things the eval currently borrows from the host machine
are the hostname (for `darwinConfigurations.<hostname>`) and `$USER`.
The system's *actual* nix-darwin config is **not** used. The user's
prior assumption that it was is wrong; what's missing is the
*ability to substitute a different baseline*, which is what this plan
adds.

______________________________________________________________________

## What we want

```bash
# unchanged — bundled template
python run_evals.py --csv ... --vllm-url ...

# point at a local nix-darwin config (a directory)
python run_evals.py --csv ... --base-config ~/.darwin --host my-mac

# point at a git repo (shallow-cloned to a temp dir before each case)
python run_evals.py --csv ... \
    --base-config https://github.com/me/dotfiles.git \
    --base-config-ref main \
    --host my-mac

# also support one of the other bundled templates by name
python run_evals.py --csv ... --base-config minimal
```

The flag accepts three shapes, in priority order:

1. **A bundled template name** (`minimal`, `base`, `nix-darwin-determinate`,
   `nixos-unified`) — resolved against `apps/native/templates/<name>`.
   Same machinery as today, just selectable.
1. **A local directory** — copied as-is (no `.git` from the source is
   preserved; we always init a fresh repo, see *Git handling* below).
1. **A git URL** (heuristic: `http(s)://`, `git@`, or ends in `.git`) —
   shallow-cloned to a per-case temp dir, then treated like (2).

`--host` becomes effectively required when `--base-config` is a real
config (since the config likely doesn't have `HOSTNAME_PLACEHOLDER` and
`scutil --get LocalHostName` won't match any `darwinConfigurations` in
a stranger's repo). The script will warn — not error — if `--host`
isn't passed alongside `--base-config`; nix eval will surface the real
problem if there's a mismatch.

______________________________________________________________________

## Design decisions

**Placeholder substitution stays unconditional.** Today's substitutions
(`HOSTNAME_PLACEHOLDER`, `USERNAME_PLACEHOLDER`, `PLATFORM_PLACEHOLDER`,
`allowUnfree` un-commenting) all use `str.replace`, which is a no-op
when the marker isn't present. A real config won't have these markers,
so it'll pass through untouched. No new flag needed to "turn off"
substitution.

**`allowUnfree` is still force-enabled when the marker is present.**
For real configs (no marker) we *don't* rewrite their `allowUnfree`
setting — that would be surprising. Several test cases depend on
`allowUnfree = true`; if a user's config has `allowUnfree = false`,
those cases will legitimately fail, and that's the whole point of
running the suite against different baselines. We surface this in the
report as a known-good failure category in a follow-up; not this PR.

**Git clones are fresh per run, not per case.** Cloning takes seconds
but tests are minutes — still, doing it per-case adds tens of seconds
across a 100-case run for no benefit. Clone once at the start of
`main()`, then `create_nix_config_git_repo` continues to make a fresh
temp copy per case (so each case starts from a clean tree, matching
today's behavior).

**Shallow clone with `--depth=1`.** GitPython is already a dep
(`Repo.clone_from(url, dir, depth=1, single_branch=True, branch=ref)`).
`--base-config-ref` defaults to the repo's default branch.

**No caching.** Re-cloning on every invocation is fine. Caching adds
correctness questions (cache invalidation on `--base-config-ref`
changes, stale clones across sessions) that aren't worth the few
seconds saved.

**Resolution order in `--base-config`.** Try bundled-template-name
first (cheap string compare), then local path (`Path(...).is_dir()`),
then git URL heuristic, then error. This way `--base-config minimal`
isn't accidentally interpreted as a local path called `minimal`.

**`-h` / `--host` semantics.** Unchanged for the no-override case
(derived from `scutil`). When `--base-config` is set and `--host`
isn't, we still derive from `scutil` but log a one-line warning:
`Using derived host '<x>' against external --base-config; pass --host to match a darwinConfigurations entry in your config.`

______________________________________________________________________

## Code changes

All in `apps/eval/run_evals.py`. No nixmac binary changes; the
`configDir` it consumes is already overridable via
`generate_nixmac_settings(..., configDir=...)`.

### 1. Resolve `--base-config` into a template directory

New helper:

```python
TEMPLATES_DIR: Path = SCRIPT_DIR.parent / "native/templates"
DEFAULT_TEMPLATE_NAME = "nix-darwin-determinate"

def resolve_base_config(
    base_config: str | None,
    base_config_ref: str | None,
    clone_into: Path,
) -> Path:
    """Return a directory holding a nix-darwin config to be used as the
    template for eval runs. Caller owns the lifetime of the returned dir.

    - None → bundled DEFAULT_TEMPLATE_NAME under TEMPLATES_DIR.
    - bundled template name → TEMPLATES_DIR / name.
    - local path that is_dir() → that path.
    - URL-shaped string → shallow clone into `clone_into`.
    """
```

`clone_into` is a session-level temp dir created in `main()` and
removed in its `finally` block.

### 2. Parameterize `create_nix_config_git_repo`

```python
def create_nix_config_git_repo(
    template_dir: Path,
    hostname: str | None = None,
) -> Path:
    ...
```

`CONFIG_TEMPLATE_DIR` constant goes away (replaced by `TEMPLATES_DIR`

- `DEFAULT_TEMPLATE_NAME`). Body otherwise unchanged: copy →
  substitute → `.gitignore flake.lock` → init/commit → return.

### 3. Thread `template_dir` through `run_test_case` and `main`

`run_test_case(..., template_dir=template_dir)` — passes through.
`main()` resolves `--base-config` once, passes the resulting path to
every `run_test_case` call.

### 4. CLI surface

```python
parser.add_argument(
    "--base-config",
    dest="base_config",
    type=str,
    default=None,
    help=(
        "Baseline nix-darwin config to evaluate against. Accepts: "
        "a bundled template name (minimal|base|nix-darwin-determinate|"
        "nixos-unified), a local directory, or a git URL. "
        "Default: nix-darwin-determinate."
    ),
)
parser.add_argument(
    "--base-config-ref",
    dest="base_config_ref",
    type=str,
    default=None,
    help="Git ref to check out when --base-config is a URL (default: HEAD).",
)
```

### 5. Run metadata

`meta.json` (already planned in
`generate_report-plan.md` P3) gains two fields:

```json
{
  "base_config_source": "https://github.com/me/dotfiles.git@main",
  "base_config_resolved_template": "/tmp/eval-base-config-xyz",
  "host_attr": "my-mac"
}
```

`generate_report.py` surfaces these in the headline so reviewers can
tell at a glance which baseline a report was generated against. The
loader already accepts missing fields with `sourced_from = "derived"`,
so this is additive.

______________________________________________________________________

## Phasing (small green commits)

Each commit builds + tests on its own. Each one is independently
revertable.

**C1 — Refactor only, no behavior change.**

- Introduce `TEMPLATES_DIR` + `DEFAULT_TEMPLATE_NAME`.
- Make `create_nix_config_git_repo(template_dir, hostname)` take an
  explicit template dir; pass `TEMPLATES_DIR / DEFAULT_TEMPLATE_NAME`
  from `run_test_case` / `main`.
- Existing run path unchanged.

**C2 — `--base-config` for bundled templates and local paths.**

- Add `resolve_base_config` (no URL branch yet).
- Add `--base-config` CLI flag.
- README: document the new flag.

**C3 — Git URL support.**

- Add URL branch to `resolve_base_config`: shallow clone with
  GitPython into a session-level temp dir.
- Add `--base-config-ref`.
- Cleanup: remove cloned dir in `main()`'s `finally`.
- README: amend with the git-URL example.

**C4 — Provenance in `meta.json`.**

- Add `base_config_source`, `base_config_resolved_template`,
  `host_attr` to whatever `meta.json` emission `run_evals.py`
  acquires (per the `generate_report-plan.md` P3 ticket).
- Loader + headline rendering in `generate_report.py`.

C1–C3 are this PR. C4 is a separate PR that lands together with the
`meta.json` introduction, or follows it.

______________________________________________________________________

## Tests

`apps/eval` has no test runner today, but `pyproject.toml` already
declares `pytest` indirectly via `report/` work. Adding a thin
`apps/eval/tests/test_base_config.py` is cheap:

- `test_resolve_bundled_name` — `resolve_base_config("minimal", None, …)`
  returns `TEMPLATES_DIR / "minimal"`.
- `test_resolve_local_path` — pass a `tmp_path` fixture, assert it
  comes back unchanged.
- `test_resolve_url_clones` — skipped by default (network); run
  locally against a tiny public repo or a `git daemon` fixture.
- `test_create_nix_config_git_repo_no_placeholders` — feed a
  template that has *no* placeholders, confirm output is a valid git
  repo and the files round-trip byte-for-byte.

The substitution edge cases (placeholders present, `allowUnfree`
marker present) are already exercised implicitly by the existing
template; one positive test against a copy of `nix-darwin-determinate`
is enough.

______________________________________________________________________

## What this plan does *not* commit to\*

- **Auto-detecting `--host` from the config.** Parsing `flake.nix` to
  list `darwinConfigurations` keys would be nice, but the heuristics
  are brittle (string match vs. nix eval). For now: trust the user
  and let nix eval surface mismatches.
- **Per-case overrides.** All cases in a single run use the same
  base config. Matrix runs (same suite × multiple base configs)
  are a wrapper concern, not this script's job.
- **Caching clones.** See *Design decisions*.
- **Mutating the user's real `~/.darwin`.** We always copy into a
  temp dir before running. The source is never written to.

______________________________________________________________________

## Open questions

These don't block starting — defaults are listed — but worth deciding
on review:

- **Flag name.** `--base-config` (proposed) vs `--config` vs
  `--config-template`. `--config` is overloaded ("the script's own
  config file?"); `--config-template` is accurate but verbose.
  Leaning `--base-config`.

  ANSWER: --base-config

- **URL vs separate `--base-config-repo` flag.** Single flag with
  heuristic detection (proposed) is fewer flags; separate flag is
  more explicit. Heuristic is unambiguous enough (URLs don't look
  like dirs).

  ANSWER: single flag

- **What happens when `--base-config` is a local path that *is* a
  git working tree?** Today: we copy the worktree only and init a
  fresh repo (the source's `.git` is *not* copied because
  `shutil.copytree` does copy hidden dirs by default — we'd need to
  explicitly `ignore=shutil.ignore_patterns(".git")`). Decision:
  explicitly ignore `.git` on copy so the source repo isn't bloated
  into temp dirs and we don't accidentally inherit the user's
  branch state.

  ANSWER: yes

- **Should we record the *commit SHA* of the resolved base config in
  `meta.json`?** Yes — `git -C <resolved> rev-parse HEAD` after
  the fresh `git init` won't help (it'll be the eval's own commit),
  but if the source was a clone we can capture
  `Repo(clone_dir).head.commit.hexsha` before any modifications.
  For local paths: best-effort, skip if not a git repo.

  ANSWER: yes
