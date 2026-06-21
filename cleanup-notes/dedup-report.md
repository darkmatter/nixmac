# Dedup Report — nixmac Rust crate

Generated: 2026-05-03

______________________________________________________________________

## Candidate 1 — `src/providers/{openai,ollama,cli}.rs` vs `src/evolve/providers/{openai,ollama,cli}.rs`

**Decision: left as-is (providers), one extraction (CLI arg building)**

### Side-by-side analysis

| Dimension | `providers/` | `evolve/providers/` |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Trait | `ChatCompletionProvider` | `AiProvider` |
| Call signature | `(system_prompt, user_prompt, max_tokens, context_window_tokens, temperature, request_id)` | `(messages: &[Message], tools: &[Tool])` |
| Message handling | Simple system+user pair | Full message history with Tool/Assistant variants |
| Tool calling | None | Full tool-call loop (function call encode/decode) |
| Token usage type | `Option<u32>` per field | `u32` per field + total |
| Error type | `anyhow::Error` | `ProviderError` enum |
| Completion log key | `"summary_provider_completions"` | `"evolve_provider_completions"` |

**Shared concept: none worth extracting** — the two provider stacks express fundamentally different call contracts. The "HTTP client + OpenAI config setup" lines (3–4 lines in constructors) are not worth a shared helper because they are already minimal and there is no risk of drift.

### Exception: `evolve/providers/cli.rs` CLI arg building

`evolve/providers/cli.rs` contained 17 lines of inlined arg-building logic that duplicated `providers/cli.rs::build_args` exactly (same match arms, same model-flag logic). **Extracted**: made `build_args` `pub` in `providers/cli.rs`; `evolve/providers/cli.rs` now calls it directly.

**Commit:** `refactor(providers): reuse build_args in evolve/providers/cli instead of inlining it`

______________________________________________________________________

## Candidate 2 — `finalize_apply.rs` vs `finalize_restore.rs`

**Decision: left as-is**

### Side-by-side analysis

Both files end with:

```rust
let git_status = git::status(&config_dir)?;
store::set_cached_git_status(app, &git_status);
build_state::record_build(app, &git_status)?;
```

But the surrounding logic diverges completely:

- `finalize_apply` manages `evolve_state`, rollback pointers, and `build_state::record_build`.
- `finalize_restore` does `git::commit_all` → tag → DB restore-origin insert, then calls `build_state::record_build`.

The three shared lines are idiomatic Tauri "refresh after mutation" plumbing. Extracting them into a helper like `record_git_and_build_state` would save 3 lines at the cost of introducing a coupling between two flows that are otherwise independent and may diverge. **Not extracted.**

______________________________________________________________________

## Candidate 3 — `db/store_bare_changeset.rs`, `db/store_evolved_changeset.rs`, `db/store_new_changeset.rs`

**Decision: extracted**

### Side-by-side analysis

`store_new_changeset.rs` and `store_evolved_changeset.rs` contained byte-for-byte identical `store_new_group` and `store_new_single` functions (40 lines each, 80 lines total duplicated). `store_bare_changeset.rs` uses a different simpler path with `insert_change_or_ignore` and no summaries — not related.

**Shared concept:** "persist a `NewGroupAssignment` (or `NewSingleAssignment`) into the DB within an ongoing transaction."

**Extracted** both functions into `db/changesets.rs` as `pub fn store_new_group` and `pub fn store_new_single`. Both callers import them from there. `store_new_changeset.rs` dropped from 96 → 59 lines; `store_evolved_changeset.rs` dropped from 148 → 100 lines.

**Commit:** `refactor(db): extract shared store_new_group/store_new_single into changesets.rs`

______________________________________________________________________

## Candidate 4 — Tauri command wrappers in `commands.rs`

**Decision: left as-is**

The hypothesis was that commands following `validate dir → call → serialize` share extractable structure.

After reading commands.rs (1414 lines), the pattern `store::ensure_config_dir_exists(&app).map_err(|e| capture_err("cmd_name", e))?` appears ~20 times, but:

1. Each command name in `capture_err` is different (used for Sentry telemetry tagging).
1. The "validate" step differs per command: some validate dir, some don't; some look up host attr; some do DB path resolution.
1. The serialize step is trivially `serde_json::json!({"ok": true})` or a typed return — not worth abstracting.

A helper like `with_config_dir(app, "cmd_name", |dir| { ... })` would obscure the control flow and make command logic harder to read. The `capture_err` helper already exists and is the right level of abstraction. **Not extracted.**

______________________________________________________________________

## Verification

```
cargo check --all-targets    clean
cargo clippy -D warnings     clean
cargo test                   241 passed, 5 failed (same pre-existing failures as before)
cargo run --example specta_gen_ts   clean — no binding drift
```
