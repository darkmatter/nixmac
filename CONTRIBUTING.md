# Contributing to nixmac

Thanks for wanting to contribute. This file defines the bar every PR must clear, and documents the exact commands that prove your change clears it.

## Read this first

nixmac _is_ an AI agent, and we build with AI tooling every day — nobody here is going to ask whether you used an assistant. That's precisely why the bar sits where it does.

### Our philosophy

AI can do much of our coding now. That doesn't lower the bar for a contribution — it moves the work to the steps around the code:

- **Planning, before it.** What problem does this solve? Why this approach instead of the alternatives? Is the change wanted at all? What behavior changes, and what breaks?
- **Testing, after it.** Does it actually work on a real machine? What did you run, and what did you observe? Which edge cases did you check? What did you deliberately leave untested, and why?

Generating a diff is the cheap part now. What we review is the thinking in front of it and the verification behind it — and if it's clear that no effort went into either, and your PR clearly expects us to do that work for you, it will be closed.

### A PR is yours only if

- **You planned it.** You can state the problem in your own words, defend the approach against alternatives, and point to an issue or proposal where the change is wanted.
- **You tested it yourself.** You ran the validation below and observed the results — for behavior changes, you ran the app — and the PR carries the evidence: a screenshot or screen recording of the change working, or the command output you observed for non-visual changes. "The model said the tests pass" is not a test plan.
- **You can explain and defend it.** Every line. A reviewer asking "why this approach?" is asking _you_ — the answer comes from your reasoning, not from regenerating the patch. "The AI wrote it" is not a defense — you opened the PR.

If any of these are missing, don't send the PR.

### Signals we close on

None of these is disqualifying on its own, but a PR that trips several gets closed without a line-by-line review.

**No planning:**

- **Generic summaries.** "This PR improves error handling and code quality" could describe any repo on GitHub. It tells us nobody decided what the PR is _for_.
- **Unrequested scope.** New features, new dependencies, new config surface, or rewrites nobody asked for. No issue, no proposal, no maintainer sign-off — the planning step was skipped entirely.
- **Sweep PRs.** Formatting drives, mass renames, "modernization," lint-chasing refactors. No problem statement, no behavior change — and the commit hook already runs treefmt, so a mostly-formatting PR means nobody even ran it.
- **Re-review churn.** Every round of review produces a completely different patch. There was never a plan — the model is steering and you're holding on.

**No testing:**

- **Empty test plan.** The default "No test plan needed" checkbox on a diff that changes behavior. Danger flags this on every PR.
- **CI as the whole test plan.** Green CI is the floor, not the goal — CI runs exactly the commands in this file, and it cannot tell whether your change does what the Summary claims.
- **No manual verification.** nixmac is a macOS app that rebuilds your system; most of its behavior can only be confirmed by running it (`bun run desktop:dev`). A test plan without "I ran the app and saw X" — and without the screenshots or recording to prove it — is a strong tell.
- **CI silencing.** Deleting or stubbing code, sprinkling `#[allow(...)]`, or commenting things out to make checks pass. The workspace denies `unused` and `clippy::all` on purpose — a warning is a task, not an obstacle.

**Both skipped:**

- **Toolchain tells.** npm/pnpm/yarn in place of bun, hand-edits to generated files like `apps/native/src/ipc/types.ts` (regenerate instead — see [Code generation](#code-generation)), or plaintext edits to `ops/secrets/secrets.sops.json` (edit only via `sops`).
- **Hallucinated APIs.** Invented functions, config keys, or flags that don't compile. Nobody read the code being changed, and nobody ran it.

### Before you open a PR

1. **Plan before you code.** Tracked work carries a Linear ID (`ENG-…`) in the title, body, or branch name. For an unrequested non-trivial change, open the proposal _first_ and get a maintainer's take — drive-by rewrites are the fastest close. Use `#no-linear` only for genuinely untracked work.
1. **Test after you code.** Run the validation locally — everything in [Testing](#testing) and [Lint and formatting](#lint-and-formatting) — and for behavior changes, run the app. Write the test plan from what you actually observed, and attach the evidence in it: screenshots or a screen recording for visual changes, command output or logs for the rest.
1. **Fill the template in your own words.** Summary = the problem, the why, and the behavior that changes. If you touched behavior-sensitive paths (the agent loop, CLI, rebuild/rollback, prompts, templates), behavior changes need a companion docs PR in `darkmatter/nixmac-web`.
1. **One concern per PR.** Danger warns past ~1,500 lines — split before you get there.
1. **Don't bump versions.** Releases are cut with `release-it` by maintainers.
1. **Stay the author in review.** Answer comments yourself. Not understanding a review question is fine and fixable — say so and ask. Sending a regenerated patch you can't walk through is not.

First-time contributors: small, focused fixes with tests are the best way in. If you're unsure whether a change is wanted, that's what step 1 is for.

## Prerequisites

- macOS with Xcode — required to build and sign the desktop app (most Rust unit tests and all frontend tests also run on Linux)
- [Nix](https://nixos.org/download.html) with flakes ([Determinate Nix Installer](https://github.com/DeterminateSystems/nix-installer) recommended)
- [devenv](https://devenv.sh/) — `nix profile add github:cachix/devenv/latest`

Everything else (Bun, cargo, clippy, rustfmt, oxlint, oxfmt, treefmt, sops, uv, playwright, process-compose) is provided at pinned versions by the devenv shell.

## Getting set up

```bash
git clone https://github.com/darkmatter/nixmac.git
cd nixmac
devenv shell      # or: direnv allow
bun install
```

Always work inside the devenv shell — CI uses the same toolchain, and mixing host versions is the most common source of spurious failures.

`bun install` also regenerates `bun.nix` via bun2nix (postinstall hook). Git hooks (treefmt + shellcheck) are installed automatically by [git-hooks.nix](https://github.com/cachix/git-hooks.nix); formatting runs at commit time.

## Running locally

```bash
devenv up             # process-compose TUI: tauri dev + vitest watch
bun run desktop:dev   # just the Tauri desktop app (dev config, HMR)
```

Notes:

- The `test` process in `devenv up` decrypts `ops/secrets/secrets.sops.json` via `sops exec-env`. If you don't have key access, run `cd apps/native && bun run test:watch` instead.
- Storybook and a local production build are available as disabled process-compose services — start them from the TUI, or `cd apps/native && bun run storybook`.

## Testing

The canonical "did I break anything" command:

```bash
cd apps/native && bun run desktop:test
# expands to: cargo test --manifest-path src-tauri/Cargo.toml && bun run test:unit
```

Everything else:

| Command (from `apps/native`) | What it runs |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `bun run test:unit` | Frontend unit tests (Vitest/jsdom) |
| `bun run test:watch` | Vitest in watch mode |
| `bun run test:storybook` | Storybook browser tests (Playwright + Chromium) |
| `bun run test:e2e` | Web e2e (Playwright) — run `bun run test:e2e:install` first |
| `bun run test:wdio` | Tauri app e2e (WebdriverIO) — see [`e2e-tauri/README.md`](apps/native/e2e-tauri/README.md) |

Rust tests can also be run directly: `cargo test --manifest-path apps/native/src-tauri/Cargo.toml`. Most tests pass on Linux; paths that invoke `darwin-rebuild` or macOS system APIs are gated with `#[cfg(target_os = "macos")]` or the `e2e_mock_system` flag and skip elsewhere.

## Lint and formatting

```bash
treefmt           # format the tree (nixfmt, rustfmt, oxfmt, mdformat; shellcheck lints shell)
bun run check     # oxlint across the repo
cargo clippy --workspace --all-targets --features nixmac/codegen -- -D warnings
```

CI runs the git hooks against all files (treefmt must produce no changes), clippy with `-D warnings`, oxlint, and the unit test suites. The workspace denies `unused` and `clippy::all` — an unused import is a hard error, not a warning.

## Code generation

If you change Rust types shared with the frontend (`#[specta::Type]` structs, Tauri commands, oRPC procedures), regenerate the bindings from `apps/native`:

```bash
bun run gen:schemas       # IPC schemas
bun run gen:orpc          # oRPC client bindings
bun run gen:specta        # TypeScript types via specta
bun run gen:docs-index    # docs index
```

All of these build with `--features codegen` for you. Keep the generated output committed — never hand-edit it.

## Project layout

```
apps/native/          # Tauri 2 desktop app — the main deliverable
├── src/              # React 19 + Vite frontend (components, hooks, ipc, stores)
└── src-tauri/src/    # Rust backend
    ├── ai/           # ChatCompletionProvider trait + provider impls
    ├── evolve/       # agentic evolution loop, tools, semantic Nix AST editing
    ├── rebuild/      # darwin-rebuild build/apply/rollback wrappers
    ├── commands/     # Tauri command handlers
    └── shared_types/ # Rust ↔ TypeScript types (specta)
packages/ui/          # shared UI component library (@nixmac/ui)
ops/                  # release scripts + SOPS-encrypted secrets
docs/                 # plans and dated decision notes
```

See the [README](README.md) for the full architecture and the evolution loop.

## Code conventions

### Rust

- Declare new modules in the **parent's `mod.rs`**; top-level `mod` declarations belong in `main.rs` only.
- Public `serde` structs use `#[serde(rename_all = "camelCase")]` to match TS consumers.
- `anyhow::Result` for fallible functions; `thiserror` for domain errors.
- **Path safety**: construct paths inside the user's config dir with `file_ops::join_in_dir` / `file_ops::resolve_*` — never string concatenation or raw `Path::new` on user input.
- When shelling out in the GUI app, set `PATH` via `nix::get_nix_path()` so commands work when launched from Finder.
- Tests that mutate environment variables: use `crate::test_support::e2e_env_lock()` and `EnvVarRestore::capture(keys)`.

### TypeScript / React

- Components live under `apps/native/src/components/widget/{subfolder}/` (badges, controls, feedback, history, layout, notifications, overlays, promptinput, settings, steps).
- Shared primitives live in `packages/ui` (`@nixmac/ui`).
- State management is Zustand (`apps/native/src/stores/`).
- IPC with the Rust backend goes through `apps/native/src/ipc/api.ts` — don't call `invoke` directly from components.
- **Bun only** — never `npm` or `yarn`.

## Secrets

Secrets are SOPS-encrypted with age (`ops/secrets/secrets.sops.json`). Never commit plaintext secrets. Edit with:

```bash
sops ops/secrets/secrets.sops.json
```

## Reporting bugs

Open a GitHub issue with your macOS version, Nix setup, relevant logs, and — if you can capture it — a screenshot or recording of the misbehavior:

- darwin-rebuild logs: `~/Library/Logs/nixmac/`
- app debug logs: `~/Library/Application Support/nixmac/logs` (or stdout/stderr; set `NIXMAC_LOGFILE` for file output)

## License

MIT. By contributing, you agree that your contributions will be licensed under this repository's [MIT license](LICENSE).
