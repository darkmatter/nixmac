# Copilot Cloud Agent Instructions

## What this repository is

**nixmac** is a native macOS application (Tauri 2 + Rust backend, React 19 frontend) that puts an AI agent in front of a [nix-darwin](https://github.com/LnL7/nix-darwin) configuration. Users describe what they want in plain English and the app edits their Nix config files, builds the system, and applies it — including one-click rollback via git history.

## Organization-wide agent guidance

- Organization-wide Copilot instructions are maintained in the `darkmatter/skills` repository.
- When reviewing pull requests for this repository, also apply and follow the PR review guidelines documented there.

## Repository layout

```
nixmac/
├── apps/native/          # The main deliverable: Tauri desktop app
│   ├── src/              # React/TypeScript frontend (Vite)
│   │   ├── components/widget/   # UI widgets (badges, controls, feedback, history,
│   │   │                        #  layout, notifications, overlays, promptinput,
│   │   │                        #  settings, steps)
│   │   ├── hooks/        # React hooks (use-evolve.ts, use-apply.ts, …)
│   │   ├── ipc/          # Tauri IPC bindings (api.ts, sqlite.ts, types.ts)
│   │   ├── stores/       # Zustand state (widget-store.ts)
│   │   └── stories/      # Storybook stories
│   └── src-tauri/        # Rust backend
│       └── src/
│           ├── main.rs           # App entry point; declares top-level modules only
│           ├── ai/               # ChatCompletionProvider trait + provider impls
│           │   └── providers/    # openai.rs, ollama.rs, cli.rs
│           ├── evolve/           # The AI evolution loop (tool use, file edits, git)
│           │   ├── mod.rs        # Core agent loop
│           │   ├── tools.rs      # Tool definitions (think/read_file/edit_file/…)
│           │   ├── file_ops.rs   # Path-safe file helpers (join_in_dir, resolve_*)
│           │   ├── edit_nix_file.rs  # Semantic Nix AST editing (rnix/rowan)
│           │   └── …
│           ├── rebuild/          # darwin-rebuild build/apply/rollback wrappers
│           ├── summarize/        # AI summarization pipeline
│           ├── commands/         # Tauri command handlers
│           ├── shared_types/     # Types shared between Rust and TypeScript via specta
│           ├── storage/          # Tauri store + keyring credential storage
│           ├── git/              # Git operations (exec, changes_from_diff)
│           ├── state/            # App state (build state, watcher, evolve state)
│           └── …
├── packages/ui/          # Shared Radix UI + Tailwind component library
├── nix/                  # devenv modules and Nix helper files
└── ops/                  # Release scripts (scripts/) and SOPS-encrypted secrets (secrets/)
```

## Tech stack

| Layer | Technologies |
|-------|-------------|
| Rust backend | Tauri 2, tokio, serde/serde_json, anyhow, thiserror, rusqlite + rusqlite_migration, specta (type export), rnix + rowan (Nix AST), clap (CLI), async-openai, tiktoken-rs |
| TypeScript frontend | React 19, Vite 7, Zustand, Radix UI, TailwindCSS 3, Monaco Editor, Shiki, Sonner, motion |
| Package manager | **Bun** (1.3.x) — use `bun install`, never `npm install` or `yarn` |
| Linting | **oxlint** (TS/JS), **biome** (formatting) |
| Testing | Vitest (unit + Storybook browser tests), Playwright (e2e web), WebdriverIO (e2e Tauri app) |
| Build system | `bun run desktop:build` (Tauri) wraps `cargo build` + Vite |
| CI | GitHub Actions — `.github/workflows/build.yaml` runs on `macos-latest` |
| Secrets | SOPS + age (`ops/secrets/secrets.yaml`) — never commit plaintext secrets |

## ⚠️ macOS-only constraints for the cloud agent

nixmac targets macOS exclusively. The cloud agent runs on Ubuntu Linux; keep the following in mind:

- **The app cannot be fully built on Linux.** `tauri build` / `bun run desktop:build` requires macOS (Cocoa APIs, Apple signing). Do not attempt a production build in the agent environment.
- **Most Rust unit tests can run on Linux** via `cargo test --manifest-path apps/native/src-tauri/Cargo.toml`. Tests that invoke `darwin-rebuild` or macOS system APIs are guarded by `#[cfg(target_os = "macos")]` or the `e2e_mock_system` flag and will be skipped.
- **Frontend-only tests work fine** — `bun run test:unit` (Vitest/jsdom) runs on Linux.
- `devenv up` and `nix` commands require a Nix installation; do not rely on them in the agent.

## Building and testing (what works on Linux)

```bash
# Install JS/TS dependencies
bun install

# Rust unit tests (no macOS SDK required for most)
cargo test --manifest-path apps/native/src-tauri/Cargo.toml

# TypeScript unit tests
cd apps/native && bun run test:unit

# Storybook component tests (needs Playwright + Chromium installed)
cd apps/native && bun run test:storybook

# TS/JS lint
bun run check               # runs oxlint across the whole repo
cd apps/native && bun run lint

# Type-check frontend
cd apps/native && bun run build   # tsc + vite build (no macOS deps)
```

The canonical "full desktop test" command is:

```bash
cd apps/native && bun run desktop:test
# expands to: cargo test --manifest-path src-tauri/Cargo.toml && bun run test:unit
```

## Code conventions

### Rust

- Top-level module declarations belong in `main.rs` only. Leaf modules are declared by their parent `mod.rs` files so rust-analyzer resolves them via Cargo.
- All public `serde` structs use `#[serde(rename_all = "camelCase")]` to match JS/TS consumers.
- Prefer `anyhow::Result` for fallible functions; define domain errors with `thiserror`.
- Unused items are **denied** (`[lints.rust] unused = "deny"`); add `#[allow(dead_code)]` sparingly and only when the item is intentionally reserved.
- **Path safety**: always use `file_ops::join_in_dir` or `file_ops::resolve_*_path_in_dir*` when constructing paths inside the user's config dir. Never concatenate strings or use `Path::new(user_input)` directly — this prevents path-traversal out of `config_dir`.
- **External commands in the GUI app**: set `PATH` via `nix::get_nix_path()` (includes `/usr/local/bin` and `/opt/homebrew/bin`) so commands work when launched from Finder.
- **Rust tests that mutate environment variables**: use `crate::test_support::e2e_env_lock()` and `EnvVarRestore::capture(keys)` to serialize env state and restore it after the test.
- **Debug logs**: written under `dirs::data_local_dir()/nixmac/logs`. darwin-rebuild logs go to `~/Library/Logs/nixmac/`.

### TypeScript / React

- Use **Bun** for all package operations (`bun install`, `bun run …`).
- Components live under `apps/native/src/components/widget/{subfolder}/` — subfolders include `badges`, `controls`, `feedback`, `history`, `layout`, `notifications`, `overlays`, `promptinput`, `settings`, `steps`.
- The shared UI library is at `packages/ui/src`; import as `@nixmac/ui` or `@/components/ui`.
- State management uses **Zustand** (`apps/native/src/stores/widget-store.ts`).
- IPC with the Rust backend uses Tauri's `invoke` wrapped in `apps/native/src/ipc/api.ts`.
- TypeScript types shared with Rust are generated by **specta** (`specta-typescript`); regenerate with the specta export command after changing `#[specta::Type]`-annotated structs.
- Linting: **oxlint** + **biome** (extends `ultracite/core` + `ultracite/react`). Run `bun run check` from repo root.

### AI provider abstraction

The `ChatCompletionProvider` trait (`apps/native/src-tauri/src/ai/providers/mod.rs`) has two core methods:

```rust
async fn completion(&self, system_prompt, user_prompt, max_tokens, context_window_tokens, temperature, request_id) -> Result<(String, TokenUsage)>
async fn json_completion(&self, ...) -> Result<(String, TokenUsage)>
```

- `max_tokens` — maximum output tokens (all providers).
- `context_window_tokens` — optional override for the total context window. For **Ollama** this maps to `num_ctx`; OpenAI-compatible providers ignore it.
- Supported providers: `openrouter` (default), `openai`, `ollama`, `vllm`, `claude` (CLI), `codex` (CLI), `opencode` (CLI).

## Key domain concepts

| Concept | Description |
|---------|-------------|
| **Evolution** | One AI-driven config change cycle: prompt → tool use → file edits → `darwin-rebuild build` → `darwin-rebuild switch` → git commit |
| **EvolutionState** | Enum: `Pending`, `Running`, `Complete`, `Failed`, `Cancelled` |
| **SemanticFileEdit** | Structured Nix AST edit (`Add`, `Remove`, `Set`, `SetAttrs`) applied by `edit_nix_file.rs` via rnix/rowan |
| **Tools available to the agent** | `think`, `read_file`, `write_file`, `edit_file`, `edit_nix_file`, `list_files`, `search_packages`, `search_docs`, `search_code`, `build_check`, `ask_user`, `ensure_secret`, `done` |
| **Config dir** | The user's nix-darwin flake repo (default `~/.darwin`), always accessed through `file_ops` helpers |
| **Summarization pipeline** | Batched AI calls that generate commit messages and UI labels; token-budgeted via `tiktoken-rs` |

## Common pitfalls

1. **Do not run `bun run desktop:build` or `tauri build`** in the agent — they require macOS.
1. **Do not modify `ops/secrets/`** without sops; the files are encrypted with age.
1. **Do not use `npm` or `yarn`** — this project uses Bun exclusively.
1. **Do not add `unused` imports** — they are compile errors (`unused = "deny"`).
1. When adding a new Rust source file, declare it with `mod` in its **parent `mod.rs`**, not in `main.rs` (unless it is a new top-level domain module).
1. When adding or changing a Tauri command, update the corresponding TypeScript types in `apps/native/src/ipc/types.ts` (or regenerate via specta).
1. The `biome.json` `files.includes` list is explicit — new `apps/**` and `packages/**` files are covered automatically, but files outside those paths need to be added manually.
