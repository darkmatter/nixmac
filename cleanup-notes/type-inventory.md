# Type Inventory — nixmac Rust crate

Generated: 2026-05-03\
Source root: `apps/native/src-tauri/src/`

______________________________________________________________________

## 1. `src/types.rs` — Tauri IPC response types + evolve streaming

| Name | Line | Kind | Specta? | Where used |
|---|---|---|---|---|
| `Config` | 14 | struct | No | `commands.rs` only |
| `ApplyResult` | 27 | struct | No | `commands.rs` only (legacy; different fields from `finalize_apply::ApplyResult`) |
| `FeedbackShareOptions` | 48 | struct | No | `feedback.rs`, `commands.rs` |
| `FeedbackSystemInfo` | 63 | struct | No | `feedback.rs`, `commands.rs`, `statistics.rs` |
| `FeedbackUsageStats` | 74 | struct | No | `feedback.rs`, `commands.rs`, `statistics.rs` |
| `FeedbackAiProviderModelInfo` | 85 | struct | No | `feedback.rs`, `commands.rs` |
| `FeedbackFlakeInputEntry` | 99 | struct | No | `feedback.rs` |
| `FeedbackFlakeInputsSnapshot` | 107 | struct | No | `feedback.rs` |
| `FeedbackMetadataRequest` | 118 | struct | No | `feedback.rs`, `commands.rs` |
| `FeedbackMetadata` | 126 | struct | No | `feedback.rs`, `commands.rs` |
| `FeedbackPanicDetails` | 142 | struct | No | `feedback.rs` (field of `FeedbackMetadata`) |
| `EvolveEvent` | 156 | struct | No | `evolution.rs`, `evolve/mod.rs`, `commands.rs` |
| `EvolveEventType` | 176 | enum | No | `evolution.rs`, `evolve/mod.rs` |
| `emit_evolve_event` | 430 | fn | — | `evolution.rs`, `evolve/mod.rs` |
| `EVOLVE_EVENT_CHANNEL` | 427 | const | — | `evolution.rs`, `evolve/mod.rs` |

______________________________________________________________________

## 2. `src/shared_types.rs` — Specta-exported cross-module types

All types here carry `#[derive(Type)]` and are exported to `apps/native/src/types/shared.ts`.

| Name | Line | Kind | Where used |
|---|---|---|---|
| `ChangeType` | 15 | enum | `git.rs`, exported |
| `GitFileStatus` | 25 | struct | `git.rs`, `build_state.rs`, exported |
| `GitStatus` | 33 | struct | widespread, exported |
| `WatcherEvent` | 47 | struct | `watcher.rs`, exported |
| `HomebrewState` | 60 | struct | `mac/homebrew.rs`, `commands.rs`, exported |
| `ChangeWithSummary` | 75 | struct | `summarize/*`, exported |
| `SemanticChangeGroup` | 89 | struct | `summarize/*`, exported |
| `SemanticChangeMap` | 96 | struct | widespread, exported |
| `SummarizedChange` | 104 | struct | `db/changesets.rs`, `summarize/*`, exported |
| `SummarizedChangeSet` | 112 | struct | `db/changesets.rs`, `summarize/*`, exported |
| `HistoryItem` | 121 | struct | `get_history.rs`, `commands.rs`, exported |
| `EvolveStep` | 146 | enum | `evolve_state.rs`, `managed_edit.rs`, exported |
| `EvolveState` | 159 | struct | widespread, exported |
| `SetDirResult` | 201 | struct | `commands.rs`, exported |
| `RollbackResult` | 214 | struct | `rollback.rs`, `commands.rs`, exported |
| `EvolutionState` | 228 | enum | `evolve/types.rs`, `evolve/mod.rs`, `evolution.rs`, `cli.rs`, exported |
| `EvolutionTelemetry` | 248 | struct | `evolution.rs`, exported |
| `EvolutionResult` | 262 | struct | `evolution.rs`, `commands.rs`, exported |
| `EvolutionFailureResult` | 273 | struct | `evolution.rs`, `commands.rs`, exported |
| `UiPrefs` | 286 | struct | `commands.rs`, `store.rs`, exported |

______________________________________________________________________

## 3. `src/sqlite_types.rs` — DB row mirror types

All carry `#[derive(Type)]`; exported to `apps/native/src/types/sqlite.ts`.

| Name | Line | Kind | Where used |
|---|---|---|---|
| `Commit` | 11 | struct | `git.rs`, `db/commits.rs`, `shared_types.rs`, exported |
| `Evolution` | 22 | struct | `db/evolutions.rs`, exported |
| `Prompt` | 33 | struct | `db/`, exported |
| `Change` | 43 | struct | widespread, exported |
| `ChangeSummary` | 56 | struct | `summarize/*`, `shared_types.rs`, exported |
| `QueuedSummary` | 68 | struct | `summarize/queue_summarizer.rs`, exported |
| `ChangeSet` | 87 | struct | `summarize/*`, `db/*`, exported |

______________________________________________________________________

## 4. `src/evolve/types.rs` — Internal evolve types

No `#[derive(Type)]`; not exported to TS.

| Name | Line | Kind | Where used |
|---|---|---|---|
| `FileEdit` | 7 | struct | `evolve/mod.rs`, `evolve/file_ops.rs`, `evolve/tools.rs` |
| `FileEditAction` | 15 | enum | `evolve/edit_nix_file.rs`, `evolve/ensure_secret.rs`, `evolve/tools.rs`, `mac/homebrew.rs` |
| `SemanticFileEdit` | 36 | struct | `evolve/edit_nix_file.rs`, `evolve/ensure_secret.rs`, `evolve/tools.rs` |
| `ThinkingEntry` | 44 | struct | `evolve/mod.rs` (via `Evolution`) |
| `ToolCallRecord` | 58 | struct | `evolve/mod.rs` (via `Evolution`) |
| `Evolution` | 75 | struct | `evolve/mod.rs`, `evolution.rs` (re-exported via `pub use types::Evolution`) |

______________________________________________________________________

## 5. Inline definitions in other files

| Name | File | Line | Kind | Where else used |
|---|---|---|---|---|
| `ApplyResult` | `finalize_apply.rs` | 11 | struct | `commands.rs` |
| `CommitResult` | `commands.rs` | 360 | struct | `commands.rs` only |
| `BuildResult` | `darwin.rs` | 121 | struct (private) | `darwin.rs` only |
| `ActivateResult` | `darwin.rs` | 128 | struct (private) | `darwin.rs` only |
| `PanicInfo` | `panic_handler.rs` | 21 | struct | `panic_handler.rs` only |
| `EvolutionProgress` | `evolve/mod.rs` | 277 | struct | `evolution.rs` |
| `EvolutionRunError` | `evolve/mod.rs` | 290 | struct/error | `evolution.rs` |

______________________________________________________________________

## 6. Duplicates / Near-Duplicates

### 6a. DUPLICATE: `ApplyResult` — name collision, different semantics

| Location | Fields |
|---|---|
| `types.rs:27` | `ok: bool, code: Option<i32>, stdout: Option<String>, stderr: Option<String>` |
| `finalize_apply.rs:11` | `git_status: GitStatus, evolve_state: EvolveState` |

These are **completely different types** with the same name. `types.rs::ApplyResult` is a legacy stub used by the dead `darwin_apply` command (which returns a redirect message). `finalize_apply.rs::ApplyResult` is the real rich result used by the active code.

**Resolution**: Rename `types.rs::ApplyResult` → `LegacyApplyResult` since it's only used in one legacy command and not exported to TS. Better: since the `darwin_apply` command is itself dead/stub, consider inlining the construction or renaming.

### 6b. NEAR-DUPLICATE: `PanicInfo` ≈ `FeedbackPanicDetails`

| Location | Fields |
|---|---|
| `panic_handler.rs:21` | `message: String, location: Option<String>, backtrace: Option<String>, timestamp: String` |
| `types.rs:142` | `message: String, location: Option<String>, backtrace: Option<String>, timestamp: String` |

**Identical fields.** `PanicInfo` is used by `panic_handler.rs` to emit a `"rust:panic"` event. `FeedbackPanicDetails` is used by `feedback.rs` as a field in `FeedbackMetadata`. The frontend likely reads both.

**Resolution**: Collapse to one type. `FeedbackPanicDetails` is in `types.rs` alongside the other `Feedback*` types. Change `panic_handler.rs` to use `types::FeedbackPanicDetails` directly (it already has the same fields), and delete `PanicInfo`.

### 6c. NEAR-DUPLICATE: `sqlite_types::Evolution` vs `evolve::types::Evolution`

| Location | Fields |
|---|---|
| `sqlite_types.rs:22` | `id: i64, origin_branch: String, merged: i64, builds: i64` — DB row mirror |
| `evolve/types.rs:75` | `id: String, created_at: i64, state: EvolutionState, prompt: String, ...` — in-memory AI evolution |

**Different types** with same name — different semantics (DB row vs. runtime state). Disambiguation is already achieved by their module paths (`sqlite_types::Evolution` vs `evolve::types::Evolution`). No change needed.

### 6d. `EvolutionProgress` should move to `evolve/types.rs`

`EvolutionProgress` (line 277 of `evolve/mod.rs`) is an internal evolve struct only used in `evolution.rs` for telemetry. The layering report explicitly calls this out. Moving it to `evolve/types.rs` reduces the god-module.

______________________________________________________________________

## 7. Canonical Location Decisions

| Type | Current | Action | Rationale |
|---|---|---|---|
| `types.rs::ApplyResult` | `types.rs` | Rename → `DarwinApplyLegacy` (inline in command) | Name-conflicts with `finalize_apply::ApplyResult`; legacy stub used in 1 place |
| `PanicInfo` | `panic_handler.rs` | Delete; use `types::FeedbackPanicDetails` | Exact duplicate |
| `EvolutionProgress` | `evolve/mod.rs` | Move → `evolve/types.rs` | Internal evolve type in god-module |
| `EvolutionRunError` | `evolve/mod.rs` | Move → `evolve/types.rs` | Internal evolve type in god-module |
| `CommitResult` | `commands.rs` | Keep in `commands.rs` | Used only there, Tauri-specific IPC result |
| All `Feedback*` | `types.rs` | Keep | Used by `feedback.rs` + `commands.rs`; no better home without creating a new file |
| `EvolveEvent`, `EvolveEventType` | `types.rs` | Keep | Broadly used but not specta-exported; no better home without new file |
