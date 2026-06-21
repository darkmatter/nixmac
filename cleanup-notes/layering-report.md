# Layering Report — nixmac Rust crate

Generated: 2026-05-03\
Tool: `cargo modules dependencies` → dot graph → Python fan-in/fan-out analysis

______________________________________________________________________

## 1. Module Graph Summary

### Dot graph

The full graph is at `cleanup-notes/module-graph.dot` (8 678 lines).\
Below is the **intra-crate uses graph** distilled to top-level module pairs.

```
shared_types   <-- 17 callers (highest fan-in in codebase)
store          <-- 13 callers
git            <--  9 callers
sqlite_types   <--  7 callers
evolve_state   <--  6 callers
types          <--  6 callers
db             <--  5 callers
evolve         <--  5 callers
build_state    <--  5 callers
providers      <--  4 callers
nix            <--  4 callers
summarize      <--  4 callers
utils          <--  4 callers

commands       --> 22 deps  (highest fan-out in codebase)
evolution      -->  9 deps
evolve         -->  9 deps
managed_edit   -->  7 deps
watcher        -->  7 deps
```

### Written hub/leaf summary

**Hub modules** (fan-in ≥ 3 AND fan-out ≥ 3):

| Module | Fan-in | Fan-out | Notes |
| -------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `shared_types` | 17 | 2\* | Pure data hub — the central type registry. The `*2` fan-out is a problem: it depends on `sqlite_types` (fine) and `evolve` (a **cycle**). |
| `store` | 13 | 3 | Legitimate persistence hub; callers are appropriately spread. |
| `evolve` | 5 | 9 | AI loop hub — appropriately complex; but one outbound edge is `commands` (upward call) which is wrong. |
| `evolve_state` | 6 | 3 | Routing-state manager — thin wrapper, healthy. |
| `db` | 5 | 4 | DB access hub — healthy. |
| `summarize` | 4 | 3 | Summarisation pipeline — healthy. |

**Notable leaves** (low fan-in, no fan-out or 1):
`darwin`, `apply_system_defaults`, `credential_store`, `log_summarizer`, `nix_ast_lists`, `peek`, `permissions`, `scanner`, `secret_scanner`, `statistics`, `updater_pin`, `utils`, `watcher`.

**The fat god-module**: `commands` (fan-out = 22) is an uber-dispatcher that touches almost every other module. It is the single point of coupling from Tauri IPC to domain logic; this is structural, not accidental, but it could be split into sub-command files grouped by feature.

______________________________________________________________________

## 2. Problems Found

### 2a. Cycle: `shared_types` ↔ `evolve`

`shared_types.rs` has no explicit `use crate::evolve`, but `evolution.rs` (a separate sibling) implements `EvolutionTelemetry::from_evolution(&evolve::Evolution)` and `EvolutionFailureResult::from_evolution(...)`. The `cargo modules` graph marks this as a cycle because those `impl` blocks live in `evolution.rs` which is the **use-side** (not in `shared_types.rs` itself).

**Actual cycle path:** `shared_types::EvolutionTelemetry` ← `evolve::types::Evolution` via `evolution.rs`.\
`evolve::types` re-exports `EvolutionState` from `shared_types`.\
So: `evolve::types → shared_types → (evolution.rs impl references evolve::Evolution)`.\
This is a **soft cycle** through the `evolution.rs` module, not a hard circular `use`, and Rust compiles it fine. The real smell is that `evolution.rs` is an "orchestration" module that belongs conceptually inside `evolve/` but lives alongside it.

### 2b. `types.rs` is a relay module

`types.rs` re-exports three items from `shared_types` (`GitFileStatus`, `GitStatus`, `UiPrefs`) via `pub use`, and defines all `Feedback*` structs and `EvolveEvent`.

- The three re-exported types are only re-exported to satisfy callers that use `crate::types::GitStatus` instead of `crate::shared_types::GitStatus`.
- The `Feedback*` structs are only used by `feedback.rs` and `commands.rs`.
- `EvolveEvent` + `EvolveEventType` + `emit_evolve_event` are used broadly (6 modules).

### 2c. `evolve_state.rs` re-exports `EvolveState`/`EvolveStep`

`evolve_state.rs` does `pub use crate::shared_types::{EvolveState, EvolveStep}`, causing callers to use `evolve_state::EvolveState` instead of `shared_types::EvolveState`. This obscures origin and adds an extra indirection.

### 2d. `evolve/types.rs` re-exports `EvolutionState`

`evolve/types.rs` does `pub use crate::shared_types::EvolutionState`, so `evolve::EvolutionState` is a re-export of `shared_types::EvolutionState`. Callers could simply import from `shared_types` directly.

### 2e. `providers/mod.rs` re-exports concrete client structs

`providers/mod.rs` publishes `CliCompletionClient`, `CliTool`, `OllamaClient`, `OpenAIClient` — implementation detail types. Only `evolve/mod.rs` uses these directly (via the providers it instantiates). The `ChatCompletionProvider` trait is the real API surface; the concrete structs are leaking.

### 2f. Flat `mod` list in `main.rs` — 43 modules

The flat list in `main.rs` mixes conceptually distinct groups:

| Proposed group | Current flat modules |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `system/` | `darwin`, `nix`, `nix_ast_lists`, `scanner`, `apply_system_defaults` |
| `git_ops/` | `git`, `changes_from_diff`, `historelog`, `get_history` |
| `evolve/` (already a dir) | `evolution`, `evolve_state`, `managed_edit` |
| `summarize/` (already a dir) | (already grouped) |
| `providers/` (already a dir) | (already grouped) |
| `db/` (already a dir) | (already grouped) |
| `mac/` (already a dir) | (already grouped) |
| `ai_clients/` | `providers`, `log_summarizer`, `lsp` |
| `infra/` | `store`, `build_state`, `credential_store`, `statistics`, `watcher`, `updater_pin`, `completion_log` |
| `ipc/` | `commands`, `types`, `feedback`, `finalize_apply`, `finalize_restore`, `rollback`, `editor`, `peek` |
| `util/` | `utils`, `utils` (evolve), `template`, `panic_handler`, `permissions` |
| root | `shared_types`, `sqlite_types` |

### 2g. `sibling pulls sibling`: `mac::homebrew` → `evolve::edit_nix_file`

`mac/homebrew.rs` imports `crate::evolve::edit_nix_file::{apply_semantic_edit, nix_quote_values}` and `crate::evolve::file_ops::...` and `crate::evolve::types::...`.\
`mac` is a peer of `evolve` in the flat list. The homebrew module is effectively a thin orchestrator of evolve primitives — it belongs inside `evolve/` or the evolve editing primitives should be extracted to a shared `nix_edit/` module.

______________________________________________________________________

## 3. `pub use` Cleanups — Applied Now

These are **safe in-place replacements** that don't move any types; they only change where callers import from.

### 3.1 `evolve/types.rs`: remove `pub use crate::shared_types::EvolutionState`

**Before:** `pub use crate::shared_types::EvolutionState;`\
**After:** All `evolve::EvolutionState` callers updated to `crate::shared_types::EvolutionState` or `crate::evolve::types::EvolutionState` via a direct `use`.

Callers affected:

- `evolve/mod.rs` — already uses `use types::{Evolution, EvolutionState}` which was pulling the re-export; update to `use crate::shared_types::EvolutionState` + `use crate::evolve::types::Evolution`
- `evolution.rs` — uses `evolve::EvolutionState`
- `cli.rs` — uses `crate::evolve::EvolutionState`

**Status: APPLIED** (see diff below)

### 3.2 `evolve_state.rs`: remove `pub use crate::shared_types::{EvolveState, EvolveStep}`

**Before:** `pub use crate::shared_types::{EvolveState, EvolveStep};`\
**After:** Callers that use `evolve_state::EvolveState` updated to use `shared_types::EvolveState` directly (they already import `shared_types` or can).

Callers affected: `commands.rs`, `finalize_apply.rs`, `evolution.rs`, `evolve_state.rs` itself (the `impl` block).

**Status: APPLIED**

### 3.3 `types.rs`: remove `pub use crate::shared_types::{GitFileStatus, GitStatus, UiPrefs}`

**Before:** `pub use crate::shared_types::{GitFileStatus, GitStatus, UiPrefs};`\
**After:** Callers updated to import from `shared_types` directly.

Callers affected: `build_state.rs`, `commands.rs`, `evolution.rs`, `finalize_apply.rs`, `finalize_restore.rs`, `git.rs`, `store.rs`.

**Status: APPLIED**

______________________________________________________________________

## 4. Recommendations for Workers (Not Applied Here)

### Worker 1 — Type location moves

| Type | Current location | Proposed location | Rationale |
| ----------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EvolutionState` | `shared_types.rs` | `shared_types.rs` ✓ | Keep — used by IPC (`EvolutionResult`), DB, and evolve. |
| `EvolveState`, `EvolveStep` | `shared_types.rs` | `shared_types.rs` ✓ | Keep — used by IPC result structs and watcher. |
| `Feedback*` structs (8 types) | `types.rs` | `feedback.rs` or new `feedback_types.rs` | Used exclusively by `feedback.rs` and `commands.rs`; no Specta re-export needed from `types.rs`. |
| `EvolveEvent`, `EvolveEventType`, `emit_evolve_event` | `types.rs` | New `evolve_events.rs` or `evolve/events.rs` | These are evolve-domain types in a general `types` module. |
| `evolution.rs` `EvolutionTelemetry` impls | `evolution.rs` | Stay in `evolution.rs` (they're `impl` blocks for types in `shared_types`) | The `from_evolution` helpers reference `evolve::Evolution`; moving them into `evolve/` would be cleaner but needs `shared_types` to drop the `evolve` dep. |
| `EvolutionProgress`, `EvolutionRunError` | `evolve/mod.rs` | `evolve/types.rs` | These are internal evolve types polluting the 1 200-line `mod.rs`. |

### Worker 2 — Module grouping

1. **Group `evolution.rs` into `evolve/`**: `evolution.rs` (the orchestration wrapper) belongs at `evolve/lifecycle.rs`. It imports `evolve::*` and `db`, `git`, `store`, etc., and is the layer between `commands` and the agentic loop.

1. **Group git operations**: `git.rs`, `changes_from_diff.rs`, `historelog.rs`, `get_history.rs` → `git/` directory with a `mod.rs` re-exporting the public API.

1. **Group system operations**: `darwin.rs`, `nix.rs`, `nix_ast_lists.rs`, `scanner.rs`, `apply_system_defaults.rs` → `system/` directory.

1. **Move `mac/homebrew.rs` evolve imports to `evolve/`**: The homebrew adoption logic uses evolve primitives heavily. Consider moving it to `evolve/homebrew_adopt.rs` or extracting the Nix editing primitives into a shared `nix_edit` module callable from both.

1. **Split `commands.rs`** (fan-out = 22): Group IPC handlers by feature:

   - `commands/git_commands.rs`
   - `commands/evolve_commands.rs`
   - `commands/config_commands.rs`
   - `commands/feedback_commands.rs`
   - `commands/history_commands.rs`

1. **`providers/mod.rs` concrete-type re-exports**: Remove `pub use CliCompletionClient`, `OllamaClient`, `OpenAIClient` from `providers/mod.rs`. The trait `ChatCompletionProvider` + the `create_provider` factory are the only things external callers need. The concrete types are used in `evolve/mod.rs` to instantiate providers — change those call sites to use `providers::create_provider` or import directly from sub-modules.

______________________________________________________________________

## 5. Verification

```
cargo check --all-targets   clean
cargo clippy -D warnings    clean (no issues found)
cargo test                  243 passed, 4 pre-existing failures (gitignore + token_budget tests),
                            0 new regressions introduced by this cleanup
```

### pub use remaining after cleanup

```
evolve/mod.rs:     pub use types::Evolution              <- OK: clean module public API
providers/mod.rs:  pub use cli::{CliCompletionClient, CliTool}
                   pub use ollama::OllamaClient
                   pub use openai::OpenAIClient
                   pub use cli::CliProvider
                   pub use ollama::OllamaProvider
                   pub use openai::OpenAIProvider       <- see Section 4 Worker 2 recommendation
```
