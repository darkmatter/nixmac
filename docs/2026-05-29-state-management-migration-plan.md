# State Management Migration Plan

Status: draft for review

Beads epic: `nixmac-h85`

## Goal

Apply the state-management architecture direction without turning it into one cross-cutting rewrite.

The end state is:

- Runtime and preference state that Rust owns is represented as typed `tauri::State` slices.
- Preferences are split by scope: global app data versus repo-scoped settings under the user's config repo.
- SQLite remains for project and summarization data, but access goes through a Diesel `r2d2::Pool`.
- The `Configurable` derive remains the authoring surface for typed knobs and writes through the new slice infrastructure.
- The frontend separates backend mirror state from UI-only state.
- Legacy `tauri-plugin-store` runtime usage, the compound watcher event, and the old `widget-store` shim are removed after migration.

## Locked Decisions

- Keep SQLite. Do not revive the JSON-only storage branch for summaries or checkpoints.
- Move SQLite access from `rusqlite` to Diesel with pooled connections.
- Keep repo-scoped preferences as a first-class scope, especially for `EvolutionLimits`.
- Keep API keys in the keychain. Do not serialize secrets into preference JSON.
- Do not create durable backend slices for values that are better read from the real source, such as git status or nix generations, unless implementation proves a slice is the right owner.
- Preserve compatibility while the frontend migrates. The old `WatcherEvent` path can stay for one release window.

## Issue Map

| Issue | Phase | Purpose |
| -------------- | ------- | ------------------------------------------------------ |
| `nixmac-h85` | Epic | Apply the architecture direction as a staged migration |
| `nixmac-h85.1` | Phase 1 | Introduce `Slice<T>` infrastructure |
| `nixmac-h85.2` | Phase 2 | Move SQLite access to Diesel pooled connections |
| `nixmac-h85.3` | Phase 3 | Migrate backend-owned runtime state to slices |
| `nixmac-h85.4` | Phase 4 | Split preferences into global and repo-scoped slices |
| `nixmac-h85.5` | Phase 5 | Retarget `Configurable` to scoped slices |
| `nixmac-h85.6` | Phase 6 | Serialize summarizer work through one mpsc worker |
| `nixmac-h85.7` | Phase 7 | Split frontend view-model from UI state |
| `nixmac-h85.8` | Phase 8 | Remove compatibility shims |

Existing issues to reconcile:

- `nixmac-gr3`: overlaps the repo-scoped settings backend. Fold into Phase 4/5 or close as superseded once scoped slices land.
- `nixmac-e53` and its child preference-migration issues: fold into the Phase 4/5 preference and `Configurable` work rather than continuing a parallel `UiPrefs -> Configurable` design.
- `nixmac-93p`: validate whether it is already covered by the slice registry/dev-config command work after Phase 5.

## Dependency Order

```text
Phase 1 Slice<T>    --+
                     +--> Phase 3 backend runtime slices --> Phase 7 frontend split --+
                     +--> Phase 4 preferences -------------> Phase 5 Configurable ----+
Phase 2 Diesel -----+--> Phase 6 summarizer worker -----------------------------------+
                                                                                       +--> Phase 8 cleanup
```

Phases 1 and 2 can start independently. Everything else should wait for the phase listed above it.

## Phase 1: Slice<T> Infrastructure

Deliver a reusable backend primitive without changing behavior.

Scope:

- Add `apps/native/src-tauri/src/state/slice.rs` or equivalent.
- Implement `Slice<T>` with async `read()` and `write(&app)`.
- Implement `SliceWriteGuard` that emits `<slice>_changed` and flushes persistence on `Drop`.
- Add a `Persistence` trait with `AppDataJson` and `RepoScopedJson`.
- Add a slice registry for schema and field-update commands.
- Test JSON round-trip, event emission, and global versus repo-scoped routing.

Review gate:

- No existing application state should move in this phase.
- The API should be generic enough for runtime state and preferences.
- `RepoScopedJson` must fall back to defaults if `config_dir` is not configured yet.

## Phase 2: Diesel Migration

Move SQLite access to a pooled connection without redesigning the schema.

Scope:

- Add Diesel, Diesel migrations, and r2d2 with SQLite support.
- Snapshot current schema as the initial Diesel migration baseline.
- Generate or maintain `db/schema.rs`.
- Add typed models where straightforward.
- Manage `DbPool` in `tauri::State` for GUI and CLI paths.
- Port existing `rusqlite::Connection::open` sites incrementally.
- Use `sql_query` for gnarly recursive or aggregate queries when a full DSL port would add risk.

Review gate:

- Schema and behavior remain unchanged.
- Tests run migrations against a temporary database.
- No attempt is made to remove SQLite or redesign summary storage.

## Phase 3: Backend Runtime Slices

Move backend-owned runtime state to slices.

Scope:

- Start with `EvolveState`, which is clearly backend-owned.
- Replace `tauri-plugin-store` runtime plumbing in `state/evolve_state.rs`.
- Split watcher updates into independent slice-specific events where the backend owns the state.
- Keep `git:status-changed` and `WatcherEvent` as deprecated compatibility output.
- For git status, build state, and change maps, decide whether each value is owned state or a read-through/derived view.

Review gate:

- Avoid inventing mutable state for git or nix generation values that should be read from their source.
- Event ordering must be safe when formerly correlated `WatcherEvent` fields become independent updates.
- Frontend compatibility must remain intact.

## Phase 4: Preferences By Scope

Split preferences from caches and runtime state.

Scope:

- Add `GlobalPreferences` persisted with `AppDataJson`.
- Add `RepoPreferences` persisted with `RepoScopedJson`.
- Keep API keys in `storage/credential_store.rs`.
- Move `cachedModels_*`, `cachedGitStatus`, and `promptHistory` out of preferences.
- Add one-shot migration from the old `tauri-plugin-store` blob.
- Shrink `storage/store.rs` to a migration compatibility layer.

Review gate:

- Repo-scoped settings follow the user's config repo.
- Global settings remain per-device.
- Sensitive values are not exported into JSON preferences.

## Phase 5: Configurable On Scoped Slices

Keep the derive, but retarget it to the new storage model.

Scope:

- Add `#[config(scope = "global")]` and `#[config(scope = "repo")]`.
- Default to global scope.
- Make generated `load`, `schema`, and `set_field` paths use the slice registry.
- Move `EvolutionLimits` to repo scope.
- Change evolve code to read `Slice<EvolutionLimits>` from `tauri::State`.
- Make `dev_configs_list`, `dev_config_set`, and settings import/export slice-aware.

Review gate:

- Retire direct `tauri-plugin-store` and `store_path_fn` coupling.
- Do not force keychain-backed API keys through the JSON slice path.
- Keep generated IPC types coherent.

## Phase 6: Summarizer Queue Worker

Use mpsc for in-process coordination while keeping durable DB recovery.

Scope:

- Add `SummarizerState { tx: mpsc::Sender<SummarizeJob> }`.
- Spawn exactly one worker at startup.
- Have fresh/evolved changeset pipelines enqueue jobs instead of spawning processors.
- Remove the racy "is queue empty?" spawn gate.
- Keep `queued_summaries` as the Diesel-backed durable table.
- Test concurrent sends and no double-processing.

Review gate:

- The queue is not a replacement for durable summary state.
- The worker uses the Diesel pool.
- Restart recovery still drains `queued_summaries`.

## Phase 7: Frontend Split

Separate backend mirror state from UI-only state.

Scope:

- Add `apps/native/src/stores/view-model.ts`.
- Add `apps/native/src/stores/ui-state.ts`.
- Add one `view-model-sync/<slice>.ts` writer per mirrored backend slice.
- Hydrate each mirrored slice with `get_<slice>_state`.
- Subscribe to `<slice>_changed` events.
- Migrate hooks and components away from manually setting backend-owned state after `invoke`.
- Keep `widget-store.impl.ts` as a temporary re-export shim.

Review gate:

- View-model actions may invoke commands but must not directly mutate backend-owned state.
- UI-only optimistic state belongs in `ui-state.ts`.
- Command return types should stop carrying mirrored backend state unless that data is the command result.

## Phase 8: Decommission

Delete compatibility surfaces once all consumers have moved.

Scope:

- Remove legacy `tauri-plugin-store` runtime-state usage.
- Delete or reduce `storage/store.rs`.
- Remove `WatcherEvent` and `git:status-changed` compatibility output.
- Delete the `widget-store.impl.ts` shim.
- Remove migration shims after the agreed support window.
- Regenerate IPC types and update tests.

Review gate:

- This phase should be mostly deletion.
- Any newly discovered redesign should become a follow-up issue, not hidden in cleanup.

## Review Checklist

- Does each phase have one primary owner and one reviewable surface?
- Are Phase 1 and Phase 2 small enough to land independently?
- Is every legacy compatibility path paired with a later deletion issue?
- Are existing Beads issues folded into the new plan rather than duplicated?
- Are git/nix-derived values treated as derived views unless a real owner emerges?
- Are migrations one-shot, observable, and reversible enough for pre-release software?

## Risks

- Diesel may expose schema assumptions in complex summary queries. Use `sql_query` where needed rather than blocking on a perfect DSL port.
- Repo-scoped persistence can run before onboarding has `config_dir`. Defaults must remain safe.
- Split events can arrive in a different order than the old compound watcher event. Frontend sync must treat each slice independently.
- Legacy store migration can pollute the new preference split if caches are not separated first.
- The current Beads/Dolt shared-server setup is fragile. The committed `.beads/issues.jsonl` should be treated as the durable review surface until the server issue is fixed.

## Suggested Review Order

1. Review locked decisions.
1. Review Phase 1 and Phase 2 boundaries.
1. Review the Phase 3 rule for derived git/build state.
1. Review the preference scope split in Phase 4.
1. Review whether existing Configurable issues should be superseded or folded into Phase 5.
1. Review cleanup timing and compatibility window.
