# Onboarding state ownership: from derived gate to explicit lifecycle

- Date: 2026-07-08
- Status: accepted (open questions resolved 2026-07-08); implementation plan in `docs/2026-07-08-onboarding-state-implementation-plan.md`
- Relates to: `docs/2026-05-29-state-management-migration-plan.md` (locked decisions, `Slice`/`Observable` infrastructure), `docs/2026-06-12-viewmodel-completion-plan.md` (state taxonomy, one-backend-contract-per-slice, frontend write discipline), `.cursor/rules/native-config-tiers.mdc`, skills-repo ADR-0005 (typed settings decoupled from provider, exception 3: runtime-mutable state is its own service)

## Goal

Onboarding should be a flow the user enters and leaves at well-defined moments — first launch, and an explicit "Restart setup" — instead of a global reactive takeover that can hijack the window whenever a preference regresses. To get there, the *lifecycle* of onboarding (has the user completed it?) becomes explicit, backend-owned, persisted state with its own Tauri slice and ViewModel mirror, while the *progress* within the flow stays derived from durable facts as it is today.

## Context

### How visibility works today

Whether onboarding takes over the window is a pure derivation with no memory:

1. `computeOnboardingStep` (`apps/native/src/components/widget/onboarding/lib/onboarding.ts:89`) returns the first unsatisfied gate, or `null` when every gate is satisfied. Every input is a durable fact: probed system state (permissions, Nix install) or persisted `GlobalPreferences` fields (`configDir`, `hostAttr` + flake hosts, `onboardingMacScannedAt`, `onboardingLoginDecided`, inference provider/model, `onboardingLastBuildAt`).
1. `useOnboardingFlow` (`apps/native/src/components/widget/onboarding/use-onboarding-flow.ts:80`) computes `showFlow = !complete || celebrating` where `complete = derivedStep === null`.
1. `DarwinWidget` (`apps/native/src/components/widget/widget.tsx:200`) replaces the entire window with `<OnboardingFlow />` whenever `showFlow` is true.

This is documented as intentional (`onboarding.ts:83-88`): a finished user computes `null` forever, and a regressed prerequisite "naturally re-surfaces its gate". There is no stored notion of "the user finished onboarding" — completion is re-proved from current facts on every render.

### The bug that motivates the change

Changing the configuration directory in the preferences dialog re-summons the full onboarding wizard underneath the settings overlay:

1. The General tab's `DirectoryPicker` calls `setDir`/`pickDir` from `use-darwin-config.ts`.
1. `applyDirResult` (`apps/native/src/hooks/use-darwin-config.ts:27-33`) deliberately clears the host on any dir change (`setHostAttr({ host: "" })`) because the old host is meaningless in the new flake.
1. The backend emits `global_preferences_changed`; the preferences sync module mirrors the new `configDir` and the empty `hostAttr` into the ViewModel and re-lists hosts.
1. `flakeReady = configDirReady && Boolean(host) && hosts.includes(host)` (`use-onboarding-flow.ts:46`) is now false, `computeOnboardingStep` returns `"setup"`, `showFlow` flips to true, and the wizard takes over the window mid-settings-edit — even when the new directory is a perfectly valid config the user has used before.

The bug is not in any one of these steps; each is locally correct. The bug is architectural: **"which prerequisites hold right now" and "is the user in the onboarding journey" are two different questions, and today one answer is used for both.**

### Why this state deserves to be owned, not derived

The migration plan's locked decision says: *"Do not create durable backend slices for values that are better read from the real source … unless implementation proves a slice is the right owner."* This is that proof. "The user completed onboarding" is a historical fact about a user journey, not a projection of current system state — current state can regress (host intentionally cleared during a settings edit) while the journey remains finished. No real source exists to read it from; deriving it is the misrepresentation. Skills-repo ADR-0005 points the same way: values that change during the lifetime of the process and don't fit "load once at startup" get their own explicit service, not a spot inside a static derivation.

The derive-everything model does have real virtues worth keeping: it is self-healing, has no migration burden, and cannot disagree with reality. The design below keeps derivation for everything it is good at (step progression *inside* the flow, prerequisite health) and adds exactly one owned bit (the completion latch) where derivation demonstrably gives the wrong answer.

## Proposed decisions

1. **The backend owns an explicit onboarding lifecycle value.** New Rust state `OnboardingState`, initially just `{ completed_at: Option<u64> }`, held in a `tauri::State<Observable<OnboardingState>>`, persisted to app data (same `Observable` + persistence pattern as `state/preferences.rs`). Contract per the ViewModel plan's naming rules: command `get_onboarding_state`, event `onboarding_state_changed`, probe-free getters.
1. **The frontend mirrors it, never writes it.** A new `viewmodel/onboarding-state.ts` sync module binds the slice with `bindBackendSlice`, mirroring into a new `onboardingState` field on `ViewModelState`. The existing transient onboarding zustand store (`celebrating`, `viewingStep`, `inferenceDeferred`, tracked customizations) is untouched — it remains session-only UI intent.
1. **The takeover gate reads the latch, not the derivation.** `showFlow = !onboardingState.completedAt || celebrating`. `computeOnboardingStep` survives unchanged as the *in-flow* step machine: while onboarding is open, the furthest step is still derived from durable facts (this is good — it makes progress crash-safe and restart-safe). It just no longer decides whether the flow exists.
1. **Completion is latched at an explicit moment.** A `onboarding.complete()` oRPC command sets `completed_at = now`; the backend validates the durable gates (at minimum `onboarding_last_build_at` set) before latching. The frontend calls it when the user dismisses the celebration — the same moment `celebrating` clears today.
1. **Startup reconciliation doubles as migration and crash recovery.** On launch, if `completed_at` is unset but `onboarding_last_build_at` is set, latch completion silently. Existing users who finished onboarding before this change never see the wizard again; a user whose app died between the first successful build and the celebration click is also covered.
1. **"Restart setup" clears the latch and gets a home in preferences.** `onboarding_reset` (`commands/onboarding.rs`) additionally sets `completed_at = None`; everything else it does today (clear config dir, host, scan/login/build timestamps, provisional dir wipe) stays. A "Restart setup…" button with a confirmation dialog is added to the preferences dialog (General tab) — today the button only exists inside the onboarding header, i.e. only while onboarding is already showing. The confirmation must spell out what is lost: the configuration directory selection, the chosen host, and the recorded scan/login/build progress (the config directory's contents on disk are not deleted unless it was a never-built provisional dir).
1. **Prerequisite regressions become targeted repair surfaces, never a takeover.** If a fundamental precondition breaks after completion (Nix uninstalled, config dir deleted, required permission revoked), the main UI shows a contextual blocking card or banner naming the problem, with actions "Fix" (deep-link to the relevant surface: permissions pane, settings, install instructions) and "Restart setup" as the escape hatch. Checked from the same probed ViewModel slices that exist today; evaluated at launch and surfaced in place — the window is never swapped mid-session by a background event.
1. **The settings dialog owns the post-dir-change host re-pick.** Clearing the host on dir change remains correct; the consequence is now local: after a dir change the General tab prompts for a host (the picker is already adjacent), and until one is chosen the main widget shows its existing "no host selected" fallback rather than the wizard.

## State taxonomy placement

Extending the taxonomy table from the ViewModel completion plan:

| Value | Kind | Home | Notes |
| --- | --- | --- | --- |
| `completed_at` latch | Mirrored backend state, persisted | `Observable<OnboardingState>` → ViewModel `onboardingState` | New. The one owned bit this design adds. |
| Furthest step inside the flow | Derived | `computeOnboardingStep` over ViewModel facts | Unchanged. |
| Prerequisite health (permissions, nix, flake) | Derived from probes | existing ViewModel slices | Unchanged; also feeds post-completion repair surfaces. |
| Progress facts (`onboarding_mac_scanned_at`, `onboarding_login_decided`, `onboarding_last_build_at`) | Mirrored backend state, persisted | `GlobalPreferences` today; candidates to move into `OnboardingState` (phase 3) | Moving them de-pollutes `GlobalPreferences` of journey-tracking fields. |
| `celebrating`, `viewingStep`, `inferenceDeferred`, tracked customizations | UI-only session state | onboarding zustand store | Unchanged. |

## Alternatives considered

1. **Keep pure derivation, special-case the settings path** (e.g. suppress `showFlow` while `settingsOpen`, or make `flakeReady` sticky once satisfied). Rejected: treats one symptom, leaves the mode/prerequisite conflation in place, and accumulates suppression flags for each new trigger (imports, restore-from-backup, external edits to the prefs file all clear or change these fields).
1. **Put `completed_at` on `GlobalPreferences` instead of a new slice.** Cheapest diff — the struct already carries four onboarding fields — and consistent with where those live today. Rejected as the end state (a lifecycle latch is not a user preference; ADR-0005 exception 3; and the existing onboarding fields on prefs are themselves slated to move out in phase 3), but acceptable as a stepping stone if the slice infrastructure work needs to land separately. Recommendation: go straight to the dedicated slice; the `Observable` pattern in `state/preferences.rs` makes it a small amount of mechanical code.
1. **Frontend-persisted flag (zustand persist / localStorage).** Rejected: violates the repo's Rust-as-source-of-truth decision and the frontend write discipline (ViewModel has no setters); the backend also needs the latch to decide reset/repair behavior.
1. **Richer lifecycle enum (`NotStarted | InProgress | Completed`) instead of a timestamp.** Deferred: `InProgress` is fully recoverable from the derived step machine, so the extra states are redundant today. The slice shape leaves room to grow (`completed_at` is a struct field, not the whole value) if a later need appears — e.g. distinguishing "never launched" from "reset by user" for telemetry.

## UX implications

1. **Settings become safe to touch.** Editing any preference — including the config directory — never swaps the window. The cost of a dir change is visible and local: "pick a machine for this configuration" in the same dialog.
1. **Onboarding gains clear entry semantics.** It appears exactly twice in a user's life: first launch, and after an explicit, confirmed "Restart setup". This matches the mental model of every installer/wizard the user knows.
1. **Regressions read as problems, not resets.** A revoked permission or uninstalled Nix after completion is presented as "something is broken, here's the fix" instead of silently demoting the user to setup mode — which today also discards their sense of place in the app. The full wizard remains available but is opt-in.
1. **Restart is discoverable.** Today the restart button is only rendered inside the onboarding header, which is only visible during onboarding — a completed user has no path back. The preferences-dialog button fixes that.
1. **Celebration and in-flow back-navigation are unaffected**; the stepper, `RESTART_TARGET_STEP` separator, and step gating all keep their current behavior.

## Phases

### Phase 1 — the latch and the gate

Scope: `OnboardingState` slice (`src-tauri/src/state/onboarding.rs`), persistence + `onboarding_state_changed`, `get_onboarding_state` + `onboarding.complete()` oRPC routes, startup reconciliation from `onboarding_last_build_at`, ViewModel mirror + sync module, `showFlow` switched to the latch, `onboarding_reset` clears the latch, celebration dismiss calls `complete()`.

Review gate: existing user data (prefs with `onboarding_last_build_at` set) launches straight to the main widget with no onboarding flash; fresh profile runs the full flow; killing the app mid-celebration and relaunching does not re-show onboarding; "Restart setup" from the wizard header still works; changing the config dir in settings no longer summons the wizard.

### Phase 2 — restart from preferences + post-dir-change host flow

Scope: "Restart setup…" button + confirmation in the settings General tab, with explicit warning copy listing what is lost (dir selection, host, recorded progress); host re-pick prompt in the General tab after a dir change; verify the main widget's "no host selected" fallback presents sensibly outside onboarding.

Review gate: a completed user can restart onboarding from preferences and the confirmation names the data that will be lost; changing dir then choosing a host entirely within the settings dialog leaves the main UI coherent throughout.

### Phase 3 — repair surfaces and field migration

Scope: contextual blocking card/banner for post-completion prerequisite regressions (config dir missing, Nix missing, required permission revoked) with fix/restart actions; move `onboarding_*` journey fields off `GlobalPreferences` into `OnboardingState` (with one-shot migration, following the `settings.json` → `global-preferences.json` precedent in `state/preferences.rs:73`).

Review gate: deleting the config dir on disk after completion produces the repair card, not the wizard; prefs JSON no longer carries onboarding fields; restart/reset still behaves.

## Dependency order

```text
Phase 1 (latch + gate)
  ├── Phase 2 (preferences restart + host re-pick)   [UX, independent of 3]
  └── Phase 3 (repair surfaces + field migration)    [builds on the slice]
```

## Risks

1. **Migration miss → completed users see onboarding again.** Mitigated by the startup reconciliation rule keying on `onboarding_last_build_at`, which is set exclusively by a successful apply (`rebuild/finalize_apply.rs:40`). Worst case is one wizard appearance with all gates already satisfied (lands on the final step, one click out).
1. **Latch says complete, facts say broken.** By design — but until phase 3 ships, a completed user with a deleted config dir sees the main widget's degraded fallback with no guidance. Acceptable interim (it's the edge case), but phase 3 should not be dropped.
1. **Two sources of "complete" during the transition.** Between phases, `computeOnboardingStep === null` and `completed_at` can disagree. Keep the derivation authoritative *inside* the flow and the latch authoritative for *visibility*, and never read `derivedStep === null` outside the flow after phase 1 — enforce with a lint-grep in review.
1. **`onboarding.complete()` racing `celebrating`.** The latch flips `showFlow`'s first disjunct while `celebrating` still holds the flow open; ordering is already handled by the existing `celebrating` mechanics, but the phase 1 gate should test the dismiss path explicitly.

## Amendment (2026-07-08): staged selections, committed at first apply

Review of the initial implementation surfaced a leftover cross-slice write:
`onboarding_reset` still cleared `config_dir`/`repo_root`/`host_attr` out of
`GlobalPreferences` — onboarding reaching into another owner's state to undo
its own side effects. Accepted follow-up, implemented as phase 4:

1. **The wizard's selections are staged on `OnboardingState`**
   (`staged_config_dir`, `staged_repo_root`, `staged_host_attr`). While
   onboarding is uncommitted (`completed_at` unset), the config write path
   (`config.setDir` / `setHostAttr` / imports / scaffold) writes the staged
   fields; after completion the same commands write preferences directly, so
   the shared picker components need no context switch.
1. **The commit point is the first successful apply, not the celebration.**
   `finalize_apply` moves the staged selection into `GlobalPreferences` in
   the same breath as `last_build_at` — the moment the configuration stops
   being a proposal and becomes what the machine runs. Committing any later
   would leave a window where the system runs a config that preferences
   don't name. The flow's other side effects (clones, scaffolds, scans, the
   build itself) are real and cannot be staged; only the selection pointers
   are.
1. **Reads resolve staged-first in the existing single accessors**
   (`store::get_config_dir_if_set`, `get_repo_root`, host attr): staged
   values, when present, name the active config for every backend consumer
   (flake listing, watcher, scan, build). No per-call-site threading.
1. **Reset touches only `OnboardingState`.** "Restart setup" stops being
   destructive: the committed configuration keeps working until a restarted
   flow applies a new one, and an abandoned restart leaves the app intact.
   The config-dir step pre-fills from the still-committed preferences so a
   restart feels safe rather than amnesiac.
1. **Migration:** at slice load, an uncommitted old-model flow (no latch, no
   recorded build, but preferences carry a config dir) adopts the preference
   values as staged. Values are copied, not moved — a completed-but-unlatched
   profile must never lose its working preferences.

Inference settings (`evolveProvider`/`evolveModel`) stay ordinary
preferences written immediately: they are genuine user preferences, not
journey state — which also resolves the previous inconsistency where reset
cleared the config selection but kept inference settings.

## Resolved questions (2026-07-08)

1. **Permission revoked after completion: banner, not takeover.** A blocking card only when the app is actually inoperable; phase 3 includes a pass over which permissions are truly load-bearing at runtime.
1. **Restart keeps today's destructive semantics** — one button, no soft "re-run against existing state" variant — **but the confirmation dialog must warn the user about the preferences being lost** (dir selection, host, recorded onboarding progress). Folded into decision 6 and phase 2.
1. **`OnboardingState` stays narrow.** No `AppLifecycle` generalization; rename is cheap while it holds one field.

## Tracking

- Beads epic: no beads integration.
