# PR #228, #244–#255 Review Follow-ups

- Date: 2026-06-03
- Status: Draft for review
- Reviewer of the reviewed PRs: @arximboldi (Juan Pedro Bolívar Puente)
- Author: synthesized from review comments on PRs #228, #244–#255 with critical commentary
- Relates to: `docs/2026-05-29-state-management-migration-plan.md` (Phases 1, 2, 5, 7, 8)

This document collects the post-merge review remarks left on PRs #228 and
#244–#255, analyzes them, pushes back where the proposed remedy looks like it
trades clarity for over-abstraction, and proposes a refined plan. Several of
these items revise the design described in the 2026-05-29 migration plan —
that document was written before the slice infrastructure existed; this one
reacts to what shipped.

## 1. Comments collected, by source PR

Of the 13 PRs in scope, only five carry actionable feedback. The others were
either docs/process PRs or were approved without comment.

| PR | Title | Review | Inline comments |
| --- | ----------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| 228 | implement derive(Configurable) macro | — | — |
| 244 | docs(state): add migration plan issues | — | — |
| 245 | refactor(configurable): split derive and generated UI | CHANGES_REQUESTED | `configurable/src/lib.rs:91`, `commands/dev_configs.rs:33` |
| 246 | feat(state): add scoped slice persistence | CHANGES_REQUESTED | `state/slice/registry.rs:32`, `state/slice/persistence.rs:4`, `state/slice/mod.rs:101` |
| 247 | feat(db): add Diesel pool and table models | — | — |
| 248 | feat(state): wire runtime slices and summarizer | APPROVED | `commands/git.rs:61`, `evolve/mod.rs:657`, `commands/git.rs:45` |
| 249 | chore(credentials): remove legacy plaintext fallback | COMMENTED | (only meta-note about PR slicing) |
| 250 | feat(settings): split backup and tuning panels | — | — |
| 251 | fix(theme): scope Minted to Monaco diffs | — | — |
| 252 | feat(console): add resizable log panel | — | — |
| 253 | chore(fmt): add treefmt wiring | — | — |
| 254 | chore(beads): update state migration issues | — | — |
| 255 | refactor(frontend): move backend mirrors to viewmodel | APPROVED | (review summary only) |

The substantive remarks distill to eight themes, addressed below.

## 2. Themes, analysis, and pushback

The header "Verdict" below each theme is my synthesized recommendation —
agreement, disagreement, or partial agreement — not a restatement of the
review comment.

### 2.1 The `state/slice` module is a misnamed reinvention of `tauri::State`

**Review:** "This whole notion of 'state slice' is misleading. The persistence
layer should be tied to configurables. The registry is not needed. The whole
`state/slice` should go away. 'State slice' is a Tauri concept, it's
`tauri::State`, we should not reinvent it or abuse the term." (PR #246)

**Verdict: agree on the name, partially agree on the registry.**

The naming criticism is correct without qualification. The Tauri docs and
the Rust ecosystem use "state" and "slice" to mean exactly what `tauri::State`
already provides; using the same noun for our local primitive collides on the
first read. The `state/slice` module name should go.

The "registry is not needed" claim is more subtle and worth pushing back on.
`tauri::State<T>` is keyed by `TypeId` and is _not enumerable_ — you cannot
ask Tauri "give me every state that implements `Configurable`." The
`dev_configs_list` command needs that enumeration. So _some_ registry exists
either way; the only design choice is whether it is **built at compile time**
(linker-section magic via the [`inventory`](https://docs.rs/inventory/) crate,
populated by the derive macro) or **at runtime** (the current
`SliceRegistry`).

Compile-time registration via `inventory` is genuinely nicer when it works.
It does not work on every target — `inventory` uses linker-section tricks
that fail on Wasm targets and on Miri, and can be debugging puzzles when
linker GC strips symbols. None of those constraints currently apply to this
project (we ship a desktop Tauri binary on macOS/Linux/Windows), so it is the
right call here — but it is worth stating that as a constraint rather than
calling Tauri's state map "the registry."

### 2.2 Rename `Slice<T>` to `Observable<T>`

**Review:** "Perhaps it could be renamed into `Observable`, as the main feature
is actually observing changes (via emitters, or indirectly via the persistence
callback)." (PR #246)

**Verdict: agree the rename is needed, push back on `Observable`.**

The current type is doing three things: it owns a typed value, it notifies on
write (via `SliceEventEmitter`), and it persists on write (via `Persistence`).
"Observable" captures the notification axis but hides the persistence axis,
and in the JS/RxJS-influenced corner of the field it strongly suggests a
_stream you subscribe to_, not a _cell you read and write_.

Better candidates, roughly ranked:

- **`Persisted<T>`** — emphasizes the load-bearing property (state survives
  restarts) and makes the change-event a secondary detail. Read sites that
  do not subscribe never care about emission anyway.
- **`WatchedCell<T>`** / **`SyncedCell<T>`** — keeps the "cell" mental model
  from `std::cell::Cell` and friends, adds the notification verb.
- **`Signal<T>`** — accurate but heavily overloaded (Solid.js, Preact, Leptos,
  Sycamore, Tokio all use this name for related-but-different things).
- **`Observable<T>`** — what the review proposed; my objection above.

My recommendation is `Persisted<T>`, with `PersistedWriteGuard` and a
`PersistedEventEmitter` trait. The rename is mechanical (12 call-sites in
two crates), but worth doing once.

### 2.3 Split `Configurable`'s schema from its current value; decouple from Serde

**Review:** "Ideally we would have two separate concerns: fetching the schema
for a configurable (just meta-data, has static lifetime and can be cached) vs.
reading the current value (can't be cached). Also, I'm not sure I vibe with
having `default` be stored in JSON. JSON-serialization is orthogonal to the
configurable infrastructure. One could imagine using the Configurable stuff in
a different app that doesn't use Tauri and is all Rust and doesn't necessarily
use Serde." (PR #245)

**Verdict: agree on the schema/value split. Push back on the
Serde decoupling.**

The schema/value split is a real correctness and clarity win. `schema()`
today takes an `AppHandle` only because the static schema and the dynamic
current value were merged into one struct (`ConfigField`). Splitting these
into `ConfigFieldSchema` (static, no `app`, equatable, hashable, the same
value every call) and `ConfigFieldValue` (dynamic, joined with the schema
only at the IPC boundary) is the right shape. It also opens the door to
caching the schema once at startup, which is cheap and pays for itself the
moment anyone opens the dev settings panel twice.

The Serde decoupling is where I want to push back. The motivation given is
"one could imagine using the Configurable stuff in a different app that
doesn't use Tauri and is all Rust and doesn't necessarily use Serde." That is
a hypothetical second consumer. There is none planned. The cost of the
decoupling is real:

- The derive needs to materialize defaults from typed Rust values. If `T`
  must not be `Serialize`, then the default cannot be a `serde_json::Value`;
  it has to be either `Box<dyn Any>` (which forces downcasts at every use
  site), `T` itself (which leaks into every type that wants to enumerate
  schemas, requiring HKT-style workarounds), or a const-fn-evaluated
  placeholder that the derive constructs (which constrains `T` to types
  expressible in const).
- The on-disk format is JSON. Removing Serde from the core crate just pushes
  the same dependency into a thin `configurable-json` wrapper, with the same
  total complexity but more crates.

I would do the _type-level_ split (separate `ConfigFieldSchema` from value)
without doing the _crate-level_ decoupling. Keep `serde` as a hard dependency
of `configurable`. If a second non-Serde consumer ever shows up, splitting
crates is a mechanical extraction at that point.

The "default in JSON" sub-complaint resolves naturally with the type split:
`ConfigFieldSchema::default` becomes a typed value, and only the IPC payload
(which is built in the Tauri command, not in the schema) carries it as
`serde_json::Value`.

### 2.4 Whole-Configurable setter, not field-by-field

**Review:** "Why do we need to set the individual fields separately instead of
setting the whole `Configurable` in one?" (PR #245)

**Verdict: agree, with one tradeoff to surface.**

Validation via `serde::Deserialize` of the whole struct is cleaner than
per-field dispatch by name. It also kills the type-erased `set_field_fn`
function pointer and the `struct_name` string parameter, both of which only
exist to compensate for the current per-field shape.

The tradeoff to surface is partial-update semantics. Whole-struct writes
clobber concurrent edits — if a background process bumps field B while the
dev-settings UI is editing field A, the UI's POST overwrites B with whatever
stale value the panel started with. For a single-user dev-settings panel this
is fine. It would not be fine if the same primitive grew into a multi-actor
config surface (concurrent edits across tabs, syncing across a fleet, etc).
None of that is on the roadmap, but worth flagging because the field-by-field
setter does avoid this category of bug essentially by accident.

### 2.5 `upsert_commit_in_pool` is wordy

**Review:** "The `in_pool` thing in the name feels unnecessarily wordy.
Probably the LLM doing LLM things but just saying :)" (PR #248)

**Verdict: agree, but not yet.**

The `_in_pool` suffix exists right now precisely because the old rusqlite
`upsert_commit(db_path, ...)` and the new Diesel `upsert_commit_in_pool(pool, ...)`
coexist during the in-flight Diesel migration. Renaming today produces
ambiguous overloads. The right ordering is: delete the rusqlite twin of
each function (a sub-goal of Phase 2 in the migration plan, lines 80–98 of
`docs/2026-05-29-state-management-migration-plan.md`, though not currently
called out as an explicit milestone — see open question O5), then drop the
suffix from every Diesel function in `db/commits.rs` in one rename pass.
Same treatment for `get_commit_by_hash_in_pool`.

### 2.6 Panic when an expected `Persisted<T>` is unmanaged

**Review:** "I think it should be ok to `panic()` if we forget to manage the
Slice, but this doesn't hurt." (PR #248, `evolve/mod.rs:657`)

**Verdict: agree, but investigate the load-bearing comment first.**

`app.state::<T>()` already panics if the state is not managed; the current
`try_state` + default fallback is actively suppressing that panic. The
relevant code path is the evolve loop reading `EvolutionLimits`. The
suppression looks defensive (`"slice is not managed; using defaults"`), but
the defensive fallback is exactly what masks a real misconfiguration.

Before flipping to a panic, check whether any test or CLI path runs the
evolve loop without managing the slice. If yes, fix that setup. If no, drop
the fallback.

### 2.7 Widget-store trails on the frontend

**Review (#255 summary):** "There seems to be still some trails of the
widget-store that would be nice to get rid of in later commits."

**Verdict: agree, this is already Phase 8.**

The migration plan slates `widget-store.impl.ts` deletion for Phase 8
("Decommission"). The current state is ~30 import sites in
`apps/native/src/components/widget/**` and a couple of utility files. Some
of those imports are for _types_ (`WidgetStep`, `EvolveEvent`, `GitStatus`,
`RebuildErrorType`, `RebuildLine`) that legitimately still need a home; the
rest are uses of `useWidgetStore` that should already be reading from the
ViewModel or `useUiState`.

Action: before Phase 8 deletion, split the cleanup into two passes —
(a) move all type-only imports to `@/ipc/types` or `@/viewmodel/types`,
(b) replace `useWidgetStore` call sites with the appropriate ViewModel
selectors. Phase 8 then becomes a pure deletion.

### 2.8 ViewModel slice regularity

**Review (#255 summary):** "There is certain level of regularity in the
ViewModel slices that could perhaps be extracted away."

**Verdict: agree, with the rule of three honored.**

Every slice in `apps/native/src/viewmodel/{evolve,git,change-map}.ts` follows
the same skeleton: fetch initial state via a tauri command, register one
`ipcRenderer.on` listener that calls a `mirror*` function, return an
unlisten. Three repetitions of an identical pattern justify a helper:

```ts
function bindBackendSlice<TPayload>({
  initial,
  event,
  mirror,
}: {
  initial: () => Promise<TPayload>;
  event: string;
  mirror: (payload: TPayload) => void;
}): Promise<() => void>;
```

Caveat: the current `git.ts` slice does slightly more (it triggers a history
snapshot refresh and listens on a second `git_state_error` event). Keep the
helper composable enough that `git.ts` can use it for the main subscription
and stack an extra `ipcRenderer.on` next to it, rather than forcing every
slice through a one-size-fits-all interface. Over-fitted abstractions for
three call sites that might diverge again are worse than two helper calls
plus one ad-hoc subscriber.

## 3. Refined plan

Each item below has a motivation, a scope, risks, and an acceptance
criterion. Items are numbered B (backend) and F (frontend).

### B1. Delete `SliceRegistry`; switch to compile-time registration via `inventory`

- **Motivation:** Remove the runtime registry whose only job is to enumerate
  configurables; let the derive submit each configurable to a static
  `inventory` collection.
- **Scope:**
  - `apps/native/src-tauri/configurable-derive/src/codegen.rs` — emit
    `inventory::submit! { ConfigurableMeta { … } }` next to the impl block,
    where `ConfigurableMeta` carries the static schema and a typed handle
    that can be downcast to set the whole `T` via `tauri::State`.
  - `apps/native/src-tauri/configurable/src/lib.rs` — `inventory::collect!`
    declaration; expose `ConfigurableRegistry::iter()` that just walks it.
  - Delete `apps/native/src-tauri/src/state/slice/registry.rs`.
  - Delete `evolve::config::register_slice_config` and the corresponding
    `register_slice_config(&app.state::<SliceRegistry>())?` call in
    `main.rs`. Delete the `app.manage(SliceRegistry::default())` line.
  - Rewrite `src/commands/dev_configs.rs` to use the static registry.
- **Risks:** `inventory` requires the metadata be `Sync + 'static`. The
  current `set_field_fn` pointer takes `&AppHandle<Wry>`, which is fine.
  Watch for Wry-vs-generic-Runtime split (the codegen currently emits
  `__configurable_*_wry` monomorphizations for that reason; keep that).
- **Acceptance:** `grep -rn "SliceRegistry\|RegisteredSliceConfig" apps/`
  returns nothing; `main.rs` mentions no specific `Configurable` struct.

### B2. Rename `Slice<T>` to `Persisted<T>`; dissolve `src/state/slice/`

- **Motivation:** Stop colliding with Tauri's "state" / "slice" terminology;
  surface the load-bearing property (persistence) in the type name.
- **Scope:**
  - Move `src/state/slice/{mod,persistence,json_io}.rs` to `src/persisted/`
    (or `src/observed/` — see open question O2).
  - Rename `Slice<T>` → `Persisted<T>`, `SliceWriteGuard` →
    `PersistedWriteGuard`, `SliceEventEmitter` → `PersistedEventEmitter`.
  - Rename the existing event names (`*_changed`) — they currently echo
    "slice"; nothing user-facing needs to change.
  - Update all ~12 call sites.
- **Risks:** Touches a lot of files but every edit is mechanical.
- **Acceptance:** No file under `apps/native/src-tauri/src/` is named
  `slice*`; `cargo build` and `cargo test` pass.

### B3. Split `Configurable`'s schema from its current value

- **Motivation:** Make the schema a static, cacheable value; remove the
  spurious `app` parameter from `schema()`. Stops `ConfigField` from being a
  conflation of metadata and runtime state.
- **Scope:**
  - In `configurable/src/lib.rs`, split `ConfigField` into
    `ConfigFieldSchema { key, label, help, ty, default }` (static) and
    `ConfigFieldValue { key, current }` (dynamic, used only on the IPC wire).
  - `ConfigurableSchema` becomes purely static; a new
    `ConfigurableSnapshot` joins schema + values for the
    `dev_configs_list` response.
  - In the derive (`configurable-derive/src/codegen.rs`), emit a
    `const FIELD_SCHEMAS: &'static [ConfigFieldSchema] = …;` per struct, and
    a `fn current_values(app) -> Vec<ConfigFieldValue>` that returns the
    runtime state.
- **Risks:** The TypeScript types regenerated via `specta` will change shape.
  Frontend mirror (`apps/native/src/components/.../developer-tab.tsx`) needs
  to update its mapping.
- **Pushback on the review:** The reviewer also asked to **decouple from
  Serde / `serde_json::Value`** so a non-Tauri consumer could use the crate.
  This document recommends _not_ doing the crate-level decoupling, because
  there is no second consumer and the cost is real. The schema/value
  type-level split delivers the clarity benefit without the
  speculative-future-proofing cost. See §2.3 for the full reasoning. If
  agreement is not reached here, this item splits in two and B3b
  (Serde-decoupling) becomes a follow-up.
- **Acceptance:** `EvolutionLimits::schema()` is callable without an
  `AppHandle` and returns the same value every call; the IPC payload of
  `dev_configs_list` joins schema and values at the command boundary.

### B4. Setter takes the whole `Configurable`, not `(struct_name, key, value)`

- **Motivation:** Single-shot Serde validation; drop the per-field dispatch
  table; the IPC command becomes one strongly-typed call per configurable.
- **Scope:**
  - Replace `dev_config_set(struct_name, key, value)` with one of:
    - A generic `dev_config_set(struct_name, value: serde_json::Value)`
      that deserializes the whole struct via the static registry; OR
    - One `set_<configurable>(value: T)` command per configurable, emitted
      by the derive. Better static typing on both sides, more commands.
  - Frontend `developer-tab` posts the entire panel state on save (or on
    blur of any field) rather than one field at a time.
- **Risks:** Concurrent-edit clobbering (see §2.4). Acceptable for the
  dev-settings UI.
- **Acceptance:** No `set_field_fn` function pointer in the registry; one
  command per configurable (or one generic command keyed by struct name) on
  the IPC surface.

### B5. Drop `_in_pool` suffix once the rusqlite twins are gone

- **Motivation:** Naming hygiene; the suffix exists only because the
  rusqlite path is still alive.
- **Gate (precise):** For each `*_in_pool` function in
  `apps/native/src-tauri/src/db/commits.rs`, the corresponding rusqlite
  twin (same root name, takes `db_path: &Path`) has been deleted. This
  belongs inside Phase 2 of the migration plan (lines 80–98 of
  `docs/2026-05-29-state-management-migration-plan.md`), which commits to
  porting `rusqlite::Connection::open` sites "incrementally" but does not
  explicitly call out the deletion of the rusqlite twins as a milestone.
  See open question O5 below — the migration plan should add that
  milestone, or B5 should explicitly migrate to Phase 8 "Decommission."
- **Scope:** Rename in `apps/native/src-tauri/src/db/commits.rs` and call
  sites:
  - `upsert_commit_in_pool` → `upsert_commit`
  - `get_commit_by_hash_in_pool` → `get_commit_by_hash`
  - Any sibling `*_in_pool` functions.
- **Risks:** Trivial.
- **Acceptance:** `grep -rn "_in_pool" apps/native/src-tauri/src/` returns
  nothing.

### B6. Drop the silent default fallback on missing `Persisted<EvolutionLimits>`

- **Motivation:** Misconfiguration should fail loudly at startup, not
  silently swap in defaults at runtime.
- **Scope:**
  - In `src/evolve/mod.rs` near line 657, replace the `try_state` +
    fallback with `app.state::<Persisted<config::EvolutionLimits>>().read_sync().clone()`.
  - Verify no test or CLI entry point reaches that code path without
    managing the state. If one does, fix the setup; do not restore the
    fallback.
- **Risks:** Hidden test setup that depends on the fallback. Investigate
  before flipping.
- **Acceptance:** No call to `try_state::<Persisted<EvolutionLimits>>()` in
  the evolve loop; the production binary panics on startup if the state is
  not managed.

### F1. Sweep widget-store import surface ahead of Phase 8 deletion

- **Motivation:** Phase 8 calls for deleting `widget-store.impl.ts`. The
  deletion is currently blocked by ~30 callers. Two-step the cleanup.
- **Scope:**
  - Step F1a: relocate type-only imports (`WidgetStep`, `EvolveEvent`,
    `GitStatus`, `RebuildErrorType`, `RebuildLine`, …) from
    `@/stores/widget-store` to `@/ipc/types` or `@/viewmodel/types`.
  - Step F1b: replace each `useWidgetStore` call site with the appropriate
    ViewModel selector or `useUiState` field. Stories and mocks last.
- **Risks:** The Storybook `__mocks__/widget-store.ts` needs equivalent
  mocks under the new homes; do not delete it until stories are migrated.
- **Acceptance:** Phase 8 deletion of `widget-store{,.impl,.test}.ts` is a
  pure file removal with no follow-up edits.

### F2. Extract `bindBackendSlice` helper used by ViewModel slices

- **Motivation:** Three near-identical slice subscribers in
  `apps/native/src/viewmodel/{evolve,git,change-map}.ts` justify one helper.
- **Scope:**
  - Add `bindBackendSlice` to `apps/native/src/viewmodel/_helpers.ts` (new
    file).
  - Each slice exports `startEvolveSync` / `startGitSync` /
    `startChangeMapSync` as a one-liner around the helper. `git.ts` keeps
    its extra `git_state_error` listener alongside the helper call.
- **Risks:** Premature abstraction is the danger; keep the helper minimal
  (one event, one hydrate, one mirror) and let slices that need more do it
  inline next to the helper call.
- **Acceptance:** Each `start*Sync` is under 10 lines; the helper is under
  20\.

## 4. Sequencing

### 4.1 Dependency table

| Item | Depends on | External wait | Size | Risk |
| ---- | ---------- | ----------------------------------------------------- | ---- | ------ |
| B2 | — | — | M | low |
| B3 | — | — | M | medium |
| B1 | B2, B3 | — | L | medium |
| B4 | B1, B3 | — | M | medium |
| B5 | — | rusqlite twins deleted (sub-goal of Phase 2; see §B5) | XS | low |
| B6 | — | Investigation (§2.6) | XS | low |
| F1a | — | — | S | low |
| F1b | — | — | M | low |
| F1c | F1a, F1b | Phase 8 of migration plan | XS | low |
| F2 | — | — | S | low |

Sizes are rough PR scale: XS ≤ 50 LOC, S ≤ 200, M ≤ 600, L ≤ 1500.

### 4.2 Wave structure

Three waves, organized so each wave can be parallelized across PRs and so no
PR has to be rebased on top of another in-flight PR from the same wave.

**Wave 1 — independent quick wins (parallel PRs).** These can all open
simultaneously; none touches the same files as another.

- B2: rename `Slice<T>` → `Persisted<T>`, move `src/state/slice/` →
  `src/persisted/`.
- B6: investigate the `try_state` fallback and drop it if nothing depends on
  it.
- F1a: relocate type-only imports out of `@/stores/widget-store`.
- F2: extract `bindBackendSlice` and rewrite the three ViewModel slices over
  it.

Wave 1 lands first because it is the lowest risk and clears the surface for
Wave 2 — in particular, B2 has to land before B1, or the `inventory` entries
introduced in B1 would reference the old `Slice<T>` and need to be renamed
twice.

**Wave 2 — the Configurable redesign (sequential, one PR per step).** This
is the chain B3 → B1 → B4. Each step is reviewable in isolation; doing them
as one PR would push past the ~1500 LOC line and lose reviewability.

- B3: split `ConfigField` into `ConfigFieldSchema` (static) +
  `ConfigFieldValue` (dynamic). Update the derive to emit a
  `const FIELD_SCHEMAS: &'static [ConfigFieldSchema]`. The IPC payload joins
  the two at the command boundary. Frontend mirror in `developer-tab.tsx`
  follows the regenerated specta types.
- B1: delete `SliceRegistry`, `RegisteredSliceConfig`, and the
  `register_slice_config` boilerplate. Replace with `inventory::submit!` in
  the derive and `inventory::collect!` in the `configurable` crate.
  Rewrite `dev_configs_list` to walk the static registry.
- B4: change the setter from `(struct_name, key, value)` to a whole-struct
  write. Either one generic command keyed by struct name or one command per
  configurable — see open question O3.

Wave 2 cannot start until Wave 1 B2 ships, because B1 introduces inventory
entries that hold references to `Persisted<T>` slices. If B1 were attempted
on top of `Slice<T>`, the rename in B2 would force a second pass through
the same code.

**Wave 3 — externally gated cleanup.** These wait for prior phases of the
2026-05-29 migration plan to complete.

- B5: drop the `_in_pool` suffix from every Diesel function in
  `db/commits.rs`. Gated on the rusqlite twins being deleted — a sub-goal
  of Phase 2 ("port `rusqlite::Connection::open` sites incrementally", line
  91 of the migration plan) but not currently called out as an explicit
  milestone in that document. The suffix is load-bearing as a
  disambiguator until then.
- F1b: replace `useWidgetStore` call sites with ViewModel selectors or
  `useUiState`. Can technically start anytime after F1a, but the cleanest
  scheduling is to do it together with Phase 8 prep.
- F1c: delete `widget-store.ts`, `widget-store.impl.ts`,
  `widget-store.test.ts`, and the Storybook `__mocks__/widget-store.ts`.
  Gated on F1a and F1b being complete. This is the Phase 8 deletion bullet
  already in the migration plan.

### 4.3 Diagram

```
Wave 1 (parallel)        Wave 2 (sequential)         Wave 3 (gated)
───────────────────      ────────────────────        ─────────────────────

B2  Persisted<T> ──┐                                 B5  drop _in_pool
                   │                                     (after rusqlite
                   │                                      twins deleted)
B6  drop fallback  │     ┌── B3  schema/value
                   ├───► │                           F1b useWidgetStore
F1a type imports   │     ├── B1  inventory               replacement
                   │     │
F2  bindBackendSlice     └── B4  whole-struct set    F1c delete files
                                                         (after F1a+F1b,
                                                         = Phase 8)
```

### 4.4 Why this ordering

- **B2 before B1/B4** because B1 introduces new references to the type; we
  do not want to rename twice.
- **B3 before B1** because B1's `inventory` entries hold static schemas,
  and the static schemas are exactly what B3 introduces.
- **B4 last in Wave 2** because the whole-struct setter is the cleanest
  expression _after_ the registry is static and the schema is decoupled
  from runtime values. Doing it earlier would mean designing it around the
  per-field dispatch table that B1 deletes.
- **B5 deferred** because the rename collides with the still-living
  rusqlite function of the same name. Phase 2 removes the collision; B5
  then becomes a one-line rename per call site.
- **F2 in Wave 1** because it has no backend dependencies and unblocks the
  three ViewModel slices from accumulating further drift in the meantime.
- **F1 split across waves** because Phase 8 of the migration plan owns the
  file deletion; F1a and F1b just trim the surface so that deletion is
  truly a deletion.

### 4.5 Stopping points

If the work has to halt midway, these are the safe halt points:

- After Wave 1: code is internally consistent (renames done, helper
  extracted, fallback either fixed or documented as load-bearing). No
  functional change.
- After Wave 2 B3: type split is in place but the registry is still
  runtime; acceptable indefinitely if B1 turns out to be unwanted.
- After Wave 2 B1: the static registry is live and the runtime
  `SliceRegistry` is gone; the field-by-field setter remains. Functional
  and reviewable; B4 can wait.
- Wave 3 items are individually independent and can be picked up at any
  time once their external gate clears.

## 5. Open questions for the reviewer

- **O1.** Should B3 include the crate-level Serde decoupling (this document
  recommends _no_), or only the type-level schema/value split?
- **O2.** Final name for the renamed primitive in B2. This document proposes
  `Persisted<T>`; the original review proposed `Observable<T>`. Other
  candidates: `WatchedCell<T>`, `SyncedCell<T>`.
- **O3.** For B4, do we want one generic `dev_config_set(struct_name, value)`
  command or one `set_<configurable>(value: T)` per configurable? The latter
  gives better static typing but multiplies the IPC surface.
- **O4.** B6: is the `try_state` fallback actually load-bearing for any test
  or CLI path? Worth confirming before deleting.
- **O5.** B5: the migration plan (Phase 2, line 91) says rusqlite call
  sites are "ported incrementally" but never names a milestone where the
  rusqlite twins are deleted. Two options: (a) amend Phase 2 to require
  twin-deletion as its exit criterion; (b) move the twin-deletion (and
  therefore B5's gate) into Phase 8 "Decommission." Option (a) is cleaner
  — it keeps Phase 2 self-contained — but it broadens the Phase 2 scope.

## 6. Process notes (not code work)

Two PR-slicing observations from the reviewer worth fixing in the workflow,
not in code:

- **PR #245 / #246 ordering.** The reviewer noted that types used in #245
  were "in fact introduced here [in #246] for the first time." The
  `SliceRegistry` import in `src/commands/dev_configs.rs` (PR #245) refers
  to a type defined in `src/state/slice/registry.rs`, which only existed in
  PR #246. The first PR cannot have compiled in isolation. This is a
  stacked-PR slicing error — the rebase that produced #245 included #246's
  files. Fix in process: rebase each PR in the stack onto its parent
  _after_ the parent is approved, never before.
- **PR #249 "includes the previous one."** The base of #249 was the #246
  branch; when GitHub renders the diff of #249 against the wrong base, the
  parent's content reappears. The fix is the same: rebase stacked branches
  onto `develop` as soon as their parent merges, and confirm the PR base
  matches.

## 7. Tracking

These items should land as new sub-issues under `nixmac-h85`:

- `nixmac-h85.5.1` — B1, B2, B3, B4 (the Configurable redesign)
- `nixmac-h85.5.2` — B6
- `nixmac-h85.2.1` — B5
- `nixmac-h85.8.1` — F1
- `nixmac-h85.7.1` — F2

The 2026-05-29 migration plan should be amended in Phase 1 ("slice
registry") and Phase 5 ("slice registry / `set_field` path") to reflect the
revised design before any of these issues are picked up.
