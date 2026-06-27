# ViewModel Completion Plan

- Date: 2026-06-12
- Status: draft for review
- Relates to: `docs/2026-05-29-state-management-migration-plan.md` (Phases 3, 7, 8),
  `docs/2026-06-03-pr-review-followups.md` (F1, F2)
- Branch context: written on `jp/refactor-ts-store`, which already contains the
  backend follow-ups B1–B4 and B6 (`Observable<T>`, inventory registry,
  schema/value split, whole-struct set, fallback removal).

This document supersedes the Phase 7 scope sketch in the 2026-05-29 plan with a
concrete design, and adds a backend homogenization stage that the original plan
did not call out. The end state: the frontend separates a **ViewModel**
(mirrored backend state, written only by a sync layer driven by Rust events)
from **UI state** (TS-owned), and the backend exposes one regular contract for
every mirrored slice.

## Where things stand

- `stores/view-model.ts` and `stores/ui-state.ts` exist. Four slices sync
  correctly through `viewmodel/{evolve,git,change-map,history}.ts` (hydrate via
  command, subscribe to `*_changed`).
- Nothing reads `ui-state.ts` yet except `viewmodel/git.ts` writing one error
  string. Half the ViewModel's declared fields (`permissions`, `nix`,
  `darwinRebuild`, `rebuild`, `evolution`, `evolveActions`) are placeholders —
  never written, never read.
- `widget-store.impl.ts` is still the live store for ~84 files and duplicates
  fields that exist in both new stores.

Three findings drive the design:

1. **Manual mirrors exist because events are unreliable after commands.** The
   git watcher (`state/watcher.rs`) only emits `git_state_changed` when the
   fresh status differs from the persisted `store::cached_git_status` cache —
   and mutating commands (evolve, commit, finalize-apply) update that same
   cache themselves. If a hook stopped calling `mirrorGitState()` after
   `finalizeApply`, the watcher would see no diff and never emit. The watcher
   also polls at 2.5s, so even without the suppression there would be lag.
1. **Several backend-owned values have no change event at all** and cannot be
   mirrored regularly today: permissions (probe command only), config
   dir/host/hosts, prompt history, cached models. Nix install and rebuild
   progress are ad-hoc event streams with no readable state behind them, so a
   remount mid-flight misses everything.
1. **Commands return mirrored state and hooks re-inject it.**
   `darwin_evolve` returns `{gitStatus, evolveState, changeMap, telemetry, conversationalResponse}`; `git_commit` returns `evolve_state`;
   `use-evolve`/`use-apply`/`use-rollback`/`use-darwin-config` call `mirror*()`
   with these returns, racing the event path. `developer-tab.tsx` calls
   `useViewModel.setState` directly from a component.

## Locked decisions

- **One backend contract per mirrored slice:** the value lives in
  `tauri::State<Observable<Foo>>`, is hydrated via a `get_foo` command that
  reads the cell, and emits `foo_changed` from the write guard on every
  mutation. The frontend binds each slice with one helper call.
- **Streams are the second, explicitly-named kind.** High-frequency
  append-only payloads (evolve agent events, apply log lines) stay plain
  event streams — putting growing buffers in an Observable that re-emits the
  whole value per line is O(n²) IPC. Every stream is paired with an
  Observable _status_ slice so remounts are still correct.
- **Mirror cells of derived state are not persisted and have one writer.**
  Per the 2026-05-29 locked decision, git status, change maps, and similar
  values are owned by their real source (git, the DB). Their Observables are
  in-memory last-known caches with a single designated writer (the watcher
  loop / summarize pipeline); no `persist_to` subscriber. `EvolveState`,
  `GlobalPreferences`, and `EvolutionLimits` keep their existing persistence.
- **Getters never probe; probes are explicit.** `get_permissions` reads the
  cell. Triggering a macOS permission check is `refresh_permissions`, whose
  only effect is writing the cell.
- **Secrets never enter an Observable.** `get_global_preferences` returns the
  preferences value only; API keys stay behind keychain-backed commands.
- **Command return types stop carrying mirrored state.** Mutating commands
  update the relevant cells before returning; the events deliver the data.
  Data that is genuinely the command's result (e.g. a generated commit
  message) may still be returned.
- **Frontend write discipline:** backend-originated state reaches the UI
  through exactly one path — a `viewmodel/<slice>.ts` sync module. UI code
  never writes the ViewModel; ViewModel has no setters and no action thunks.
- **Naming:** verb-first getter `get_<noun>`, event `<noun>_changed`, probe
  `refresh_<noun>`, snake_case throughout. Existing colon-namespaced stream
  names (`nix:install:*`, `darwin:apply:*`, `darwin:evolve:event`) are folded
  into the same convention during the compat window.

## State taxonomy

| Category | Definition | Home | Examples |
| ---------------------- | ---------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Mirrored backend state | Observable cell with `get_*` + `*_changed` | ViewModel, via sync module | evolve, git, change map, preferences, config, permissions, nix install, rebuild status |
| Backend streams | Append-only event flows, folded client-side | ViewModel, via sync module (fold) | evolve agent events, apply log lines |
| Query results | On-demand command results, caller-owned, not authoritative | UiState or component state | `fileDiffContents`, `recommendedPrompt`, `commitMessageSuggestion` |
| UI-only state | Never originates in Rust | UiState | panels, prompt text, processing flags, console buffer, feedback/panic/error, editor |

Two deletions from the current ViewModel type: `evolveActions` (action thunks
move to a plain module or stay in the hook; the store is setter-free and
action-free) and every placeholder field until its sync module lands.

## Per-slice homogenization map

| Slice | Today | After Stage 1 | Persisted? |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `EvolveState` | Observable + `routing_state_get` + `evolve_state_changed` | rename command to `get_evolve_state` | yes (AppDataJson) |
| `GitState` (status + external build flag) | watcher emit + persisted cache + `git_status` shells out | `Observable<GitState>`, watcher sole writer, `get_git_state` reads cell, delete `store::cached_git_status` | no |
| `SemanticChangeMap` | watcher/pipeline emits; `find_change_map` queries DB | Observable cell seeded from DB at startup; both writers go through it; `get_change_map` | no (DB is source) |
| `GlobalPreferences` | Observable exists; hydration via `ui_get_prefs` grab-bag; some writes bypass the Observable | `get_global_preferences`; all mutations (toggles, prompt history, cached models) flow through the Observable; keys split out to keychain commands | yes |
| Config (dir, host, hosts) | `config_get` + `list_hosts`, no event | `Observable<ConfigState>`, written by `set_dir`/bootstrap (and watcher for hosts), `get_config_state` + `config_state_changed` | follows existing config storage |
| `PermissionsState` | probe command only | Observable + `get_permissions` + `refresh_permissions`; apply's full-disk-error path writes the cell | no |
| `NixInstallState` (install + darwin-rebuild availability) | ad-hoc `nix:install:*`, `nix:darwin-rebuild:end` emits | `Observable<NixInstallState>`; installer/prefetch threads write phases into it | no |
| `RebuildState` (status only) | ad-hoc `darwin:apply:*` emits, frontend fold | Observable for `{isRunning, context, phase, errorType, exitCode, success, systemUntouched}`; line stream stays a stream | no |
| History | command + frontend refetch-on-event | `Observable<Vec<HistoryItem>>` recomputed in the watcher cycle (same total work as today's refetch, pushed instead of pulled) | no (DB is source) |
| `EvolutionLimits` | Observable + event; hydration via configurable registry | unchanged — read through the dev-configs surface | yes (repo-scoped) |

Streams after Stage 1: `evolve_agent_event` (carrying `telemetry` and
`conversationalResponse` in its terminal payload, so `darwin_evolve` returns
`Result<(), Error>`), `rebuild_output` (raw lines), `rebuild_summary`
(AI-summarized lines). Each is folded by its slice's sync module; the fold
resets on the stream's start-type event rather than the UI clearing before
invoke.

## Stages

Each stage lands as a series of small, independently green commits/PRs.

### Stage 0: Frontend groundwork (parallel, no behavior change)

- Add `bindBackendSlice({hydrate, event, mirror})` to
  `viewmodel/_helpers.ts`; rewrite the three existing sync modules over it
  (F2 from the follow-ups doc). Keep it composable: `git.ts` stacks its extra
  error listener beside the helper call.
- F1a: move type-only exports (`WidgetStep`, `RebuildState`, `RebuildLine`,
  `RebuildErrorType`, `RebuildContext`, `SettingsTab`, pref-key types) out of
  `widget-store` into `@/types/` or `@/viewmodel/types.ts`; update the ~15
  type-only import sites.

Review gate: no runtime behavior change; helper under ~20 lines; each sync
module under ~10.

### Stage 1: Backend homogenization (one commit per slice)

Apply the per-slice map above. For each slice: introduce the Observable,
route all writers through it, add `get_<noun>`, emit `<noun>_changed` from
the write guard. Keep the old command/event as a deprecated alias for the
compat window (mark with a `// DEPRECATED:` comment and a Stage 5 deletion
note). The watcher refactor replaces the persisted-cache equality check with
a comparison against the cell value, and exposes a refresh entry point that
mutating commands call so the cell (and therefore the event) updates before
the command returns.

Review gate:

- Mirror cells of derived state have no persistence subscriber and exactly
  one writer module.
- `get_permissions` does not probe; `get_global_preferences` carries no
  secrets.
- After each commit, the old frontend still works through the aliases.
- Acceptance for the watcher commit: `grep -rn "cached_git_status"` returns
  only the migration shim, and a mutating command observably produces a
  `git_state_changed` emission without waiting for the poll interval.

### Stage 2: UI-state cutover (parallel with Stage 1)

Flip readers/writers of pure-UI fields from `useWidgetStore` to `useUiState`,
cluster by cluster, deleting each widget-store field as its last reader
moves:

1. Panels/dialogs: `settingsOpen`, `settingsActiveTab`, `showHistory`,
   `showFilesystem`, `filesystemTargetSection`.
1. Processing + prompt: `evolvePrompt`, `isProcessing`, `processingAction`,
   `isSummarizing`, `isGenerating`, `isBootstrapping`.
1. Console: `consoleLogs`.
1. Feedback/panic/error: `feedbackOpen`, `feedbackTypeOverride`,
   `feedbackInitialText`, `panicDetails`, `error`.
1. Editor + misc: `editingFile`, `analyzingHistoryForHashes`,
   `commitMessageSuggestion` (query result, caller-owned), drop
   `prefsLoaded` in favor of a hydration flag on the preferences slice.

Review gate: each commit deletes the migrated fields from
`widget-store.impl.ts`; no field exists in both stores.

### Stage 3: Frontend ViewModel slices (one PR per slice)

Now purely mechanical bindings over the Stage 1 surface, one
`viewmodel/<slice>.ts` per row of the map: `preferences` (also delete
`use-prefs`'s optimistic write/rollback — the event round-trip is local IPC),
`config`, `permissions`, `nix-install`, `rebuild` (move the fold from
`use-rebuild-stream.ts`; its full-disk-error permissions write becomes a
backend cell write), `evolution` (move the `darwin:evolve:event` listener out
of `use-evolve.ts`). Register each in `startViewModelSync()`. Remove the
corresponding widget-store fields and placeholder ViewModel fields as each
slice goes live.

Review gate: `useViewModel.setState` appears only under `src/viewmodel/`;
each new slice is a `bindBackendSlice` call plus at most one extra listener.

### Stage 4: Enforce the data-flow discipline

1. Delete every `mirror*()`-after-invoke in `use-evolve`, `use-apply`,
   `use-rollback`, `use-git-operations`, `use-darwin-config`,
   `use-homebrew-diff`, `use-history-restore`; make `mirror*` functions
   module-private to `viewmodel/`.
1. Fix `developer-tab.tsx`: clearing Tauri state makes the backend
   Observables emit their reset values; the component stops writing stores.
1. Slim command returns, one command per commit: `EvolveResult` drops
   `gitStatus`/`evolveState`/`changeMap`; `CommitResult` drops
   `evolve_state`; finalize/rollback return `()`. Regenerate IPC types each
   time.

Review gate: no `mirror` import outside `viewmodel/`; no command return type
contains a type that is also an event payload (except genuine results).

### Stage 5: Decommission

- Flip remaining `useWidgetStore` readers to ViewModel/UiState selectors;
  rewrite `useCurrentStep` as a selector over the two stores.
- Port `__mocks__/widget-store.ts`, `widget-test-helpers.ts`, and stories to
  per-store seeding (`useViewModel.setState` / `useUiState.setState`).
- Delete `widget-store{,.impl,.test}.ts` and its mock as a pure file removal
  (F1c / Phase 8).
- Delete the Stage 1 deprecated command/event aliases.

Review gate: this stage is mostly deletion; anything that turns out to need
redesign becomes a follow-up issue.

## Dependency order

```text
Stage 0 frontend groundwork ──────────────┐
                                          ├──> Stage 3 VM slices ──> Stage 4 discipline ──> Stage 5 decommission
Stage 1 backend homogenization ───────────┘                              ^
Stage 2 UI-state cutover ────────────────────────────────────────────────┘
```

Stages 0, 1, and 2 can run in parallel (they touch disjoint files). Stage 3
binds to Stage 1's surface. Stage 4 needs Stage 1 (cell-refresh guarantee)
and Stage 3 (slices live). Stage 5 needs everything.

## Risks

- **Event-ordering changes.** Replacing return-value mirroring with events
  means formerly synchronous updates become asynchronous. The Stage 1 rule
  that mutating commands write the cell _before_ returning keeps the window
  small, but UI flows that read the ViewModel immediately after `await invoke(...)` must tolerate one render of old state. Audit during Stage 4.
- **Preferences write latency.** Dropping optimistic updates means toggles
  render after the `global_preferences_changed` round-trip. Local IPC makes
  this imperceptible; if it ever is not, the fix is pending-state in UiState,
  never a ViewModel write.
- **History recompute cost.** Pushing history from the watcher cycle does the
  same work the frontend refetch does today, but on every change emission.
  If profiling shows it matters, downgrade history to refetch-on-event — the
  one tolerated deviation from the uniform contract.
- **Stories/test churn.** ~84 files import widget-store; Stage 5 is wide but
  shallow. The per-store mocks must exist before the last `useWidgetStore`
  reader flips, or Storybook breaks mid-stage.

## Open questions

- O1. History: conform to the Observable contract (this document's default)
  or keep refetch-on-event? Yes, Observable.
- O2. Stream rename timing: fold `nix:install:*` / `darwin:apply:*` /
  `darwin:evolve:event` into snake_case during Stage 1 (this document's
  default) or defer to Stage 5 to shrink the compat surface? Defer.
- O3. Does any e2e/mock path (`e2e_mock_system`) depend on the old compound
  return values slimmed in Stage 4? Verify before deleting.

## Tracking

Land as sub-issues under `nixmac-h85`:

- `nixmac-h85.3.1` — Stage 1 backend homogenization (extends Phase 3's
  "backend runtime slices" with the uniform get/event contract)
- `nixmac-h85.7.1` — Stage 0 (F2 helper + F1a types)
- `nixmac-h85.7.2` — Stage 2 UI-state cutover
- `nixmac-h85.7.3` — Stage 3 ViewModel slices
- `nixmac-h85.7.4` — Stage 4 data-flow discipline + command-return slimming
- `nixmac-h85.8.1` — Stage 5 decommission (absorbs F1b/F1c)
