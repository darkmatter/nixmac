# Eval data

This directory contains the prompt corpora and semantic expectations used by
the nixmac eval suite. Run the commands below from `apps/eval`.

## Files

### `test_prompts.csv`

The general prompt corpus. Its cases are designed for the default
`nix-darwin-determinate` template unless a case's notes say otherwise.

```sh
uv run nixmac-eval run --csv data/test_prompts.csv
```

### `test_prompts_arximboldi.csv`

A repository-specific corpus for the `nix/os` flake in
[`arximboldi/dotfiles`](https://github.com/arximboldi/dotfiles). These cases
target the Apple Silicon nix-darwin host `tyrell2` and test reasoning about an
existing, multi-host configuration.

See [Running the arximboldi corpus](#running-the-arximboldi-corpus) for its
pinned revision and invocation.

### `golden_set_expectations.json`

Additional semantic grading rules for selected general-corpus cases. Entries
are keyed by case ID and can require particular diff content, target files,
option values, empty diffs, explanations, or the absence of dangerous tools.
The `_meta` object records the intended template and expectation-set status.

This is not a second prompt list: cases without an entry still run and receive
the generic grading appropriate to their `expected_outcome`.

### `golden_set_expectations_arximboldi.json`

An intentionally empty repository-specific expectations set. Pass it with the
arximboldi CSV so reused case IDs do not inherit semantic file-path assertions
written for the default template. The arximboldi cases currently receive the
generic grading associated with their CSV `expected_outcome`.

## CSV schema

Both prompt files use the same columns:

- `id`: stable case identifier;
- `prompt`: request sent to the nixmac agent;
- `expected_outcome`: `succeed`, `fail_gracefully`, or `refuse`;
- `category` and `subcategory`: scenario classification;
- `quality_dimension`: primary behavior being measured;
- `priority`: filtering and reporting priority;
- `notes`: fixture assumptions and intended behavior;
- `skip`: `TRUE` to exclude a case from normal runs.

Case IDs may intentionally appear in both CSVs when the same scenario is
evaluated against different starting configurations. Keep results from those
runs in separate output directories.

## General versus repository-specific cases

Put a case in `test_prompts.csv` when its meaning and expected result are stable
against the default template. Put it in a repository-specific CSV when the
correct behavior depends on files, imports, packages, or settings already
present in that repository.

For example, the general corpus expects the Ctrl+Space case to make a change.
The arximboldi corpus expects a no-op because the relevant symbolic hotkeys are
already disabled for `tyrell2`. Conversely, `gnujump` occurs in an unimported
NixOS module in that repository, so its presence in a text search does not mean
it is installed on the Darwin host.

## Running the arximboldi corpus

The expectations were audited against commit
`c4afbb3f740a25b0e6af8459501ffb614bab009d` on the `master` branch. Re-audit
the `already_satisfied`, `already_absent`, and `target_scope` cases before
moving the pinned revision: they deliberately depend on the starting state.

The eval runner's Git URL support currently selects the repository root and
cannot select the nested `nix/os` directory. Clone the pinned repository and
pass that subdirectory:

```sh
git clone https://github.com/arximboldi/dotfiles.git /tmp/arximboldi-dotfiles
git -C /tmp/arximboldi-dotfiles checkout c4afbb3f740a25b0e6af8459501ffb614bab009d

uv run nixmac-eval run \
  --csv data/test_prompts_arximboldi.csv \
  --expectations data/golden_set_expectations_arximboldi.json \
  --base-config /tmp/arximboldi-dotfiles/nix/os \
  --host tyrell2
```

### Repo-specific expected outcomes

The current grader supports only `succeed`, `fail_gracefully`, and `refuse`.
The arximboldi corpus uses `fail_gracefully` as a temporary representation of
two successful no-op states:

- `already_satisfied`: the requested configuration is already active for
  `tyrell2`;
- `already_absent`: a requested removal has nothing to remove from `tyrell2`.

For both, a pass means a conversational explanation with no diff or build. A
future `already_satisfied` outcome would make reporting clearer by separating
correct idempotent behavior from genuine inability to fulfill a request.

The `target_scope` cases test the opposite failure mode: a package may occur in
one of the repository's NixOS-only modules but still be absent from `tyrell2`.
The agent must trace imports for the selected host rather than treating a text
match anywhere in the repository as proof that the request is satisfied.

Cases 302, 303, 305, 306, and 307 also have variants in the general prompt
corpus. Cases 302, 303, 306, and 307 change from `succeed` against a fresh base
to a no-op `fail_gracefully` here because the requested state is already active
for `tyrell2`. Case 305 remains `succeed`: iTerm and the font are installed, but
the application preference still needs to be configured.
