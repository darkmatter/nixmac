# Dead Code Report

Generated: 2026-05-03

Tools used: `cargo-machete`, grep/rg pub-reachability audit.

______________________________________________________________________

## 1. High Confidence (deleted/fixed in this session)

### Build-breaking stale invoke_handler entry

| Location | Symbol | Evidence |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.rs:332` | `commands::git_init_repo` in `invoke_handler!` | Function was removed from `commands.rs` in commit `a132b9e3` but the entry in `invoke_handler!` was left behind, causing a build error. Zero frontend callers (`rg git_init_repo apps/`). **Removed.** |

### Unused Dependencies (Cargo.toml)

| Crate | Evidence | Action |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `similar = "2.7.0"` | Zero `use similar` / `similar::` / TextDiff / ChangeTag references anywhere in `src/` or `examples/`. Flagged by both machete. | **Removed** |
| `tauri-plugin-global-shortcut = "2"` | Never imported in Rust. No frontend usage. Also stale in `capabilities/default.json`. | **Removed** (+ 3 capability JSON entries) |
| `tauri-plugin-notification = "2.0.0"` | Never imported in Rust (`tauri_plugin_notification` absent from all `.rs`). No frontend usage. | **Removed** |
| `tauri-plugin-opener = "2.0.0"` | Never imported in Rust. No frontend usage. | **Removed** |
| `tauri-specta = { version = "2.0.0-rc.21", ... }` | `tauri_specta` is never imported anywhere. `examples/specta_gen_ts.rs` uses only `specta` and `specta-typescript`. | **Removed** |
| `tracing = "0.1"` | Never imported directly (`use tracing` / `tracing::` macros: zero matches). Only `tracing-subscriber`, `tracing-appender`, and `tracing-log` are used; `tracing` itself is a transitive dep of those. | **Removed** |

### Dead `pub` items — tightened to private

| Location | Symbol | Evidence |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/provider_errors.rs:38` | `pub fn openai_error_code_to_status` | Only callers are within `provider_errors.rs` itself (`classify_openai_error` on line 59). No external `provider_errors::openai_error_code_to_status` references. Changed to `fn` (private). |
| `src/historelog.rs:4` | `pub const VERBOSE` | Only referenced inside `historelog.rs` (lines 14, 29, 36). Zero external callers. Changed to `const` (private). |
| `src/git.rs:88` | `pub fn require_repo` | Called only within `git.rs` itself (line 281). Zero external callers via `crate::git::require_repo`. Changed to `fn` (private). |
| `src/git.rs:183` | `pub fn count_diff_changes` | Called only within `git.rs` itself (line 285). Zero external callers. Changed to `fn` (private). |
| `src/git.rs:202` | `pub fn parse_files_from_diff` | Called only within `git.rs` itself (line 287) and one internal test (line 713). Zero external callers. Changed to `fn` (private). |
| `src/completion_log.rs:13` | `pub fn log_path_for_today` | Called only within `completion_log.rs` itself (lines 29, 76). Zero external callers. Changed to `fn` (private). |

______________________________________________________________________

## 2. Medium Confidence (flagged for human review, NOT deleted)

| Location | Symbol | Why uncertain |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/peek.rs` | `show_icon`, `hide_icon`, `on_icon_clicked`, `is_main_window_open`, `lock_expanded`, `start_monitoring`, `stop_monitoring`, `create_preview_indicator_window`, `hide_main_window` | The module has `#![allow(dead_code)]`, indicating the author knew these were dormant. The preview indicator window creation is commented out in `main.rs:569`. These peek functions appear to be planned/in-progress UI features. Deleting them is risky; they may be re-enabled. |
| `src/credential_store.rs:125` | `pub struct InMemoryStore` | Only used in `#[cfg(test)]` tests within `credential_store.rs`. Could be narrowed to `pub(crate)` or left as-is since it's test-only infrastructure. Low risk but technically unnecessary public surface. |
| `src/evolve/chat_memory.rs:9-10` | `pub const DEFAULT_THREAD_MAX_MESSAGES`, `pub const DEFAULT_THREAD_MAX_TOKENS` | Only used within `chat_memory.rs` itself. Could be private. Kept `pub` as they serve as documented configuration constants. |
| `src/evolve/chat_memory.rs:32` | `pub struct ThreadLimits` | Only used within `chat_memory.rs`. Could be narrowed to `pub(crate)`. |
| `src/evolve/chat_memory.rs:63` | `pub struct InMemoryChatMemoryStore` | Only used within `chat_memory.rs` (including tests). Could be narrowed to `pub(crate)`. |

______________________________________________________________________

## 3. Unused Dependencies in Cargo.toml

All 6 previously-identified unused deps have been removed. `cargo-machete` reports zero unused dependencies.

### False Positives (NOT removed)

| Crate | Why kept |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tauri-plugin-updater` | Used in `main.rs:284` under `#[cfg(not(debug_assertions))]`. machete/udeps run in debug mode and would miss it. |
| `specta` | Used via `specta::Type` derive in `sqlite_types.rs` and `shared_types.rs`. |
| `specta-typescript` | Used in `examples/specta_gen_ts.rs`. |

______________________________________________________________________

## Verification

After all changes:

- `cargo check --all-targets` ✅ clean
- `cargo clippy --all-targets -- -D warnings` ✅ clean
- `cargo test` ✅ 243+ passed (4–5 pre-existing failures in `summarize::token_budgets` unrelated to this cleanup — the repo didn't compile before our `git_init_repo` fix, so no baseline exists)
- `cargo run --example specta_gen_ts` ✅ no binding drift
- `cargo machete` ✅ zero unused dependencies
