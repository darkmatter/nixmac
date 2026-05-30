# nixmac Rust source layout

Each directory is a module declared in `main.rs` via `mod <name>;`.
Root-level `.rs` files are also modules. A `<name>.rs` file can be
promoted to a `<name>/mod.rs` directory at any time without changing
callers — Rust resolves both identically.

## Root modules

| Module | Purpose | Called by |
|---|---|---|
| `main.rs` | App entry point: initializes Tauri GUI (window, tray, plugins, DB, watcher) or dispatches to CLI mode | OS / process launcher |
| `cli.rs` | Clap argument parsing and headless `nixmac evolve` execution | main.rs |
| `shared_types.rs` | Specta-exported contract types (events, evolve state, feedback, git, prefs, system). Regenerated into TypeScript via `cargo run --example specta_gen_ts` | Nearly every module |
| `sqlite_types.rs` | Structs mirroring SQLite table rows (Commit, Evolution, Prompt, Change, etc.) kept in sync with `db/schema.rs` | db, summarize, history, state |
| `types.rs` | Tauri command response types and `emit_evolve_event` helper for streaming progress to the frontend | commands, evolve, rebuild, watcher |
| `peek.rs` | Peek/preview-indicator UX: monitors screen corners, manages overlay window for uncommitted changes | main.rs, commands::peek |
| `feedback.rs` | Gathers and submits user feedback metadata, redacts secrets, retries pending reports from disk | commands::feedback, main.rs |
| `panic_handler.rs` | Custom panic hook: captures backtrace, reports to Sentry, emits `rust:panic` event to frontend | main.rs |
| `statistics.rs` | Persistent evolution success/failure counts and iteration totals via tauri-plugin-store | evolve, feedback |
| `updater_pin/` | Developer-mode "pin to version" install flow for bisecting regressions via synthetic updater manifest | commands (install_version, clear_pinned_version) |
| `utils.rs` | Small shared utilities: unix timestamp, path normalization (tilde expansion), UTF-8 string truncation | types, db, evolve, summarize, many others |

## Directory modules

### `ai/` — General LLM clients

Provider abstraction layer for chat completions. **Not** evolve-specific.

- `providers/` — OpenAI-compatible, Ollama, and CLI (claude/codex/opencode) backends
- `provider_errors.rs` — HTTP error classification and status mapping
- `log_summarizer.rs` — Buffers and AI-summarizes darwin-rebuild log lines for UI streaming

**Called by:** evolve (provider selection), summarize (model_calls), rebuild/darwin (log summarization)

### `bootstrap/` — First-run setup

- `default_config.rs` — Copies bundled templates, processes placeholders, initializes git, finalizes flake.lock
- `template.rs` — Tera-based templating engine for .nix files

**Called by:** commands::config, commands::apply

### `commands/` — Tauri IPC handlers

Thin `#[tauri::command]` handlers that the frontend calls via `invoke()`.
Each file (apply, cli_tool, config, debug, editor, evolve, evolve_state, feedback, git, homebrew, peek, permissions, rollback, summarize, system_defaults, ui_prefs, updater) delegates to the corresponding backend module. `helpers.rs` contains shared command utilities.

**Called by:** Tauri invoke handler in `main.rs`. All frontend calls go through `ipc/api.ts` in the TypeScript layer.

### `db/` — SQLite persistence

- `schema.rs` — Runs migrations
- `commits.rs`, `evolutions.rs` — CRUD for their respective tables
- `changesets.rs` — Shared insert helpers for changeset tables
- `store_new_changeset.rs`, `store_evolved_changeset.rs`, `store_bare_changeset.rs` — Persist summarization pipeline results
- `restore_commits.rs` — Tracks restore-origin provenance

**Called by:** history, summarize, evolve/lifecycle, managed_edits, state/watcher

### `editor/` — Monaco editor backend

- `mod.rs` — Safe read/write/list operations scoped to the config directory
- `lsp.rs` — Spawns nixd and bridges its stdio to the frontend via Tauri events

**Called by:** commands::editor

### `evolve/` — AI-assisted configuration engine

Core agentic loop: calls an AI provider, executes tools, runs build checks, emits progress events.

- `mod.rs` — `generate_evolution` agentic loop
- `lifecycle.rs` — End-to-end orchestration (backup, evolve, summarize, record)
- `tools.rs` — Tool definitions and dispatch (read/edit/search/build/think/ask_user/done)
- `file_ops.rs` — Safe path resolution and file I/O within config dir
- `session_control.rs` — Cancellation flag and question/response channel (extracted from commands)
- `edit_nix_file.rs` — Semantic .nix AST edits via rnix
- `search_code.rs` — Ripgrep wrapper
- `search_packages.rs` — Nix search wrapper
- `search_docs.rs` — Fuzzy nix-darwin/home-manager docs index
- `ensure_secret.rs`, `sops.rs`, `age.rs` — Secret scaffolding and encryption
- `chat_memory.rs` — Session-scoped conversation persistence
- `gitignore.rs` — Gitignore-aware file filtering
- `config_dir_context.rs` — Renders config dir tree for prompts
- `messages.rs` — Provider-agnostic message types
- `providers/` — AiProvider trait + OpenAI/Ollama/CLI implementations (evolve-specific, separate from `ai/providers/`)
- `types.rs` — Evolution, FileEdit structs
- `utils.rs` — Evolve-specific helpers

**Called by:** commands::evolve, cli.rs, lifecycle

### `git/` — Low-level git operations

- `exec.rs` — Subprocess wrappers: status, commit, stash, tag, branch backup/restore, caching
- `changes_from_diff.rs` — Parses unified diffs into per-hunk Change structs with SHA-256 hashing

**Called by:** Nearly every module that interacts with the config repo

### `history/` — Timeline read model

- `get_history.rs` — Joins git log with DB commits, build state, and summarized changes
- `historelog.rs` — Verbose debug logging for restore operations

**Called by:** commands::summarize, rebuild/finalize_restore

### `managed_edits/` — Non-AI config file mutations

Shared "managed edit" pattern (prepare, apply, finalize into review flow).

- `managed_edit.rs` — Context and finalization helpers
- `system_defaults.rs` — Applies detected macOS defaults to a .nix module
- `homebrew_adopt.rs` — Adopts Homebrew casks/brews/taps into the nix-darwin config

**Called by:** commands::system_defaults, commands::homebrew

### `rebuild/` — Darwin-rebuild pipeline

- `darwin.rs` — Dry-run build checks, streaming `darwin-rebuild switch`, store-path activation
- `finalize_apply.rs` — Commits and tags after a successful build
- `finalize_restore.rs` — Commits/tags/restores after a history restore
- `rollback.rs` — Erases uncommitted changes and restores from backup branch

**Called by:** commands::apply, commands::rollback, commands::summarize, evolve/lifecycle

### `state/` — Persisted app state

- `build_state.rs` — Last successful nix-darwin build (store path, changeset, commit hash)
- `evolve_state.rs` — Frontend step-routing state machine (Begin/Evolve/Commit/ManualEvolve/ManualCommit)
- `watcher.rs` — Polls git status at a configurable interval, emits `WatcherEvent` to frontend
- `completion_log.rs` — Records AI completion responses to daily JSONL files

**Called by:** commands, rebuild, evolve/lifecycle, main.rs (watcher startup)

### `storage/` — Persistent settings and credentials

- `store.rs` — Main settings interface (config dir, host attr, API keys, model prefs, UI prefs) backed by tauri-plugin-store
- `credential_store.rs` — Keychain vs. settings-file credential storage with lazy migration from plaintext to macOS Keychain

**Called by:** Nearly every module that reads or writes preferences/credentials

### `summarize/` — AI-powered change summarization

Orchestrates the summarization pipeline from raw git diffs to DB-persisted changesets.

- `mod.rs` — Top-level `new_changeset` flow
- `find_existing.rs` — Queries DB for existing summarized changes
- `group_existing.rs` — Builds SemanticChangeMap from found changesets
- `assignments.rs` — Reconciles model output into DB-writable assignments
- `model_calls.rs` — AI API calls for hunk/group/commit-message summarization
- `build_prompt.rs` — Constructs prompts
- `simplify_grouped.rs` — Converts semantic maps into simplified forms for AI input
- `queue_summarizer.rs` — Background service draining the queued_summaries table
- `token_budgets.rs` — Computes input/output token allocations
- `model_output_types.rs` — Structured AI response types
- `sumlog.rs` — Toggleable debug logging
- `pipelines/` — fresh_changeset, evolved_changeset, history, commit_message implementations

**Called by:** commands::summarize, evolve/lifecycle, state/watcher, history

### `system/` — OS-level inspection

- `nix.rs` — Resolves Nix PATH (with login-shell fallback), runs nix commands
- `scanner.rs` — Reads macOS user defaults, compares against known factory values, produces nix-darwin system.defaults recommendations
- `permissions.rs` — Checks/requests macOS permissions (Desktop, Documents, Full Disk Access, sudo)
- `secret_scanner.rs` — Gitleaks rules and entropy detection for redacting secrets
- `nix_ast_lists.rs` — Parses Nix files via rnix to extract string-list assignments for semantic editing

**Called by:** commands (permissions, system_defaults), feedback (redaction), evolve (PATH, build check), managed_edits

## Key dependency edges

```
commands/ → evolve/ → ai/providers/
                   → git/
                   → rebuild/
                   → state/
                   → storage/

evolve/ → managed_edits/ → evolve/ (edit primitives only)
rebuild/ → git/, state/, db/
summarize/ → ai/, db/, git/
history/ → git/, db/, summarize/
feedback/ → git/, system/secret_scanner, storage/
```
