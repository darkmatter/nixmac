# Type Consolidation Plan — nixmac Rust crate

Generated: 2026-05-03

______________________________________________________________________

## Executive Summary

Three actionable consolidations found, all high-confidence:

1. **Collapse `PanicInfo` → `FeedbackPanicDetails`** (exact duplicate, different modules)
1. **Rename `types::ApplyResult` → `DarwinApplyLegacy`** (name conflict with `finalize_apply::ApplyResult`)
1. **Move `EvolutionProgress` + `EvolutionRunError` from `evolve/mod.rs` → `evolve/types.rs`**

No specta-exported types are renamed, so `bindings.ts` is unaffected.

______________________________________________________________________

## Task 1 — Collapse `PanicInfo` into `FeedbackPanicDetails`

**Why:** `panic_handler::PanicInfo` and `types::FeedbackPanicDetails` have **identical fields**.\
The `FeedbackMetadata` struct already has a `panic_details: Option<FeedbackPanicDetails>` field.\
The panic hook emits a `"rust:panic"` event whose payload has the same shape.\
Unifying means the frontend type for `"rust:panic"` and `FeedbackMetadata.panicDetails` is the same.

**Changes:**

- `panic_handler.rs`: Remove `struct PanicInfo`. Import `crate::types::FeedbackPanicDetails`. Replace all `PanicInfo { ... }` with `FeedbackPanicDetails { ... }`.
- `panic_handler.rs`: Add `use crate::types::FeedbackPanicDetails;`
- `types.rs`: No change needed (the canonical type stays there).

**Risk:** Low. No specta export. Frontend type changes from `PanicInfo` (if it was typed) to `FeedbackPanicDetails`, but since both have identical fields the JSON shape is unchanged.

______________________________________________________________________

## Task 2 — Rename `types::ApplyResult` to eliminate name conflict

**Why:** Two `ApplyResult` structs with completely different fields exist:

- `types.rs::ApplyResult`: `ok, code, stdout, stderr` — legacy stub returned by dead `darwin_apply` command
- `finalize_apply.rs::ApplyResult`: `git_status, evolve_state` — real result used by active code

This is confusing and makes it impossible to glob-import both modules.

**Changes:**

- `types.rs`: Rename `ApplyResult` → `DarwinApplyLegacy`
- `commands.rs`: Update `types::ApplyResult` → `types::DarwinApplyLegacy` (2 occurrences)

**Risk:** Low. `types::ApplyResult` is not specta-exported, not a Tauri command return value that flows to TS bindings (the command `darwin_apply` returns `Result<types::ApplyResult, String>` but this type has no `#[derive(Type)]`).

______________________________________________________________________

## Task 3 — Move `EvolutionProgress` + `EvolutionRunError` to `evolve/types.rs`

**Why:** The layering report explicitly flags these as "internal evolve types polluting the 1200-line mod.rs". Both are only used in `evolve/mod.rs` (defined + used) and `evolution.rs` (consumed via `evolve::EvolutionProgress` / `evolve::EvolutionRunError`).

**Changes:**

- `evolve/types.rs`: Add `EvolutionProgress` struct and `EvolutionRunError` struct+impl at the bottom.
- `evolve/mod.rs`: Remove definitions. Add `use self::types::{EvolutionProgress, EvolutionRunError};` (or prefix references with `types::`).
- `evolution.rs`: The existing `evolve::EvolutionProgress` and `evolve::EvolutionRunError` references remain valid because `evolve/mod.rs` re-exports via `pub use types::Evolution` pattern — we need to add `pub use types::{EvolutionProgress, EvolutionRunError};` to `evolve/mod.rs`.

**Risk:** Low. These are not specta-exported, not in `shared_types`, no TS impact.

______________________________________________________________________

## Non-actions (explicitly excluded)

| Candidate | Reason excluded |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `sqlite_types::Evolution` vs `evolve::types::Evolution` | Different types, already disambiguated by module path |
| `CommitResult` in `commands.rs` | Used only there; no duplication; leave inline |
| `darwin.rs::BuildResult`, `ActivateResult` | Private to `darwin.rs`; no duplication; leave |
| Moving `Feedback*` types | Plan says only move types when there's a duplication conflict |
| Moving `EvolveEvent*` | No duplication; plan says keep in `types.rs` |

______________________________________________________________________

## Verification Steps (per task)

After each commit:

```
cargo check --all-targets
cargo clippy --all-targets -- -D warnings
cargo test
cargo run --example specta_gen_ts
diff /tmp/shared_baseline.ts apps/native/src/types/shared.ts
diff /tmp/sqlite_baseline.ts apps/native/src/types/sqlite.ts
```
