# Onboarding state ownership: implementation plan

- Date: 2026-07-08
- Status: ready to implement
- Relates to: `docs/2026-07-08-onboarding-state-ownership.md` (the accepted design; decisions numbered there are referenced as D1–D8), `docs/2026-06-12-viewmodel-completion-plan.md` (sync-module and naming conventions)

## Shape of the work

Three phases from the design doc, broken into commits that each build and test green on their own. Phase 1 is the load-bearing change (latch + gate) and fixes the settings-dialog takeover bug by itself; phases 2 and 3 are independent of each other and can land in either order.

Every Rust commit runs `cargo test` from `apps/native/src-tauri` inside the devenv shell; commits that change oRPC surface regenerate the specta TS bindings (`specta_gen_ts`, which must run from `apps/native/src-tauri` — it is cwd-sensitive) and commit the regenerated `apps/native/src/ipc/orpc-bindings.ts` together with the Rust change so the tree stays consistent.

## Phase 1 — the latch and the gate

### Commit 1: backend `OnboardingState` slice (D1, D5)

- New shared type `OnboardingState { completed_at: Option<u64> }` in `apps/native/src-tauri/src/shared_types/` (camelCase serde, specta `Type`, `Default`, `PartialEq`, same derive set as `GlobalPreferences` in `shared_types/prefs.rs:152`).
- New `apps/native/src-tauri/src/state/onboarding.rs` mirroring `state/preferences.rs`: `ONBOARDING_STATE_PATH = "onboarding-state.json"`, `ONBOARDING_STATE_CHANGED_EVENT = "onboarding_state_changed"`, `load_observable` (AppDataJson persistence + `emit_to` + `persist_to`), `try_read`, `write`.
- Startup reconciliation inside `load_observable` (D5): after loading, if `completed_at` is `None` and the already-loaded `GlobalPreferences.onboarding_last_build_at` is `Some`, latch `completed_at` and flush — this is the migration for existing users and the crash-recovery path in one rule. Takes the prefs value as a parameter so the function stays testable without an `AppHandle`.
- Manage the observable next to each of the three `load_global_observable` sites in `main.rs` (`main.rs:351`, `:408`, `:685`), after the preferences observable so reconciliation can read it.
- Unit tests in the module, following the `MemoryPersistence` pattern from `state/preferences.rs` tests: default when absent, roundtrip, reconciliation latches when `last_build_at` is set, reconciliation is a no-op when already latched.

Green when: `cargo test` passes; no frontend change yet.

### Commit 2: oRPC surface — `onboarding.getState` and `onboarding.complete` (D1, D4)

- Extend `apps/native/src-tauri/src/orpc/onboarding.rs` (`routes()` currently only has `"reset"`): `"getState"` returns the observable's current value; `"complete"` validates the durable gate (`GlobalPreferences.onboarding_last_build_at.is_some()`, else a typed error) and writes `completed_at = now` through `state::onboarding::write`.
- `onboarding_reset` in `commands/onboarding.rs` additionally clears `completed_at = None` alongside the preference fields it already clears at `:66-74` (D6, backend half).
- Regenerate and commit specta bindings.
- Rust tests for the complete-command validation (rejects before first build, latches after, idempotent).

Green when: `cargo test` passes and the regenerated bindings typecheck the frontend unchanged.

### Commit 3: ViewModel mirror (D2)

- Add `onboardingState` to `ViewModelState` in `packages/state/src/viewmodel/types.ts` (nullable until hydrated, like `preferences`), initial value in `store.ts`.
- New sync module `apps/native/src/viewmodel/onboarding-state.ts` using `bindBackendSlice` (`viewmodel/_helpers.ts:12`): hydrate via `client.onboarding.getState()`, listen on `onboarding_state_changed`, mirror the payload. Register in `startViewModelSync` (`viewmodel/index.ts:34`).
- No consumer changes yet — the mirror is dark.

Green when: frontend typecheck + unit tests pass; app behavior unchanged.

### Commit 4: switch the gate, latch on celebration dismiss (D3, D4)

- `use-onboarding-flow.ts:80`: `showFlow = !onboardingState?.completedAt || celebrating`. The hydration guard must keep its current shape: `widget.tsx` already withholds routing until `markViewModelHydrated()` has run, and the onboarding-state sync module hydrates inside `startViewModelSync`, so `onboardingState` is non-null before any gate reads it — verify there is no one-frame wizard flash on a completed profile.
- `computeOnboardingStep`/`derivedStep` remain the in-flow step machine (`furthestStep`, progress, stepper) — untouched.
- Celebration dismiss (`build-step.tsx:325`, the `CelebrationOverlay` `onDismiss`) calls `client.onboarding.complete()` before `setCelebrating(false)`; a failed call logs and leaves the flow open rather than silently stranding the latch.
- Update the doc comments that describe the old behavior as intended (`onboarding.ts:82-88`, `widget.tsx` near `:148-153`).
- Review lint-grep (design risk 3): no `derivedStep === null` / `computeOnboardingStep(...) === null` reads outside `use-onboarding-flow.ts` and the onboarding components.
- Extend the `lib/onboarding` unit tests where the gate inputs changed; add a hook-level test if the existing test setup supports it cheaply, otherwise cover via the phase review gate.

Green when: full test suite passes, plus the phase 1 review gate from the design doc, exercised manually via `/verify`:
existing profile with `onboardingLastBuildAt` set launches straight to the widget (no flash); fresh profile runs the full flow; kill mid-celebration → relaunch does not re-show onboarding; "Restart setup" from the wizard header still rewinds to `config-dir`; **changing the config dir in settings no longer summons the wizard**.

## Phase 2 — restart from preferences + host re-pick (D6 frontend, D8)

### Commit 5: extract and reuse the restart confirmation

- Extract the confirm-restart dialog + `restartSetup` handler from `onboarding-header.tsx:17-64` into a shared component under `components/widget/onboarding/` so header and settings render the same flow.
- Expand the warning copy per the resolved question: name what is lost — configuration directory selection, chosen host, recorded scan/login/build progress — and that on-disk config contents are kept (except a never-built provisional dir, which the backend already wipes, `commands/onboarding.rs:37-48`).

### Commit 6: "Restart setup…" in settings, host re-pick after dir change

- Add the button to the settings General tab (`general-tab.tsx`), wired to the shared confirmation; closing the settings dialog after reset lets the (now unlatched) gate present the wizard at `RESTART_TARGET_STEP`.
- After a dir change in the General tab (`applyDirResult` cleared the host), surface the host picker prompt inline so the re-pick completes inside the dialog; confirm the main widget's no-host fallback (`widget.tsx:187-193` routing to `BeginStep`) reads sensibly if the user closes the dialog without picking.

Green when: phase 2 review gate — completed user restarts from preferences and the confirmation names the lost data; dir change → host pick entirely within settings keeps the main UI coherent.

## Phase 3 — repair surfaces + field migration (D7, taxonomy cleanup)

### Commit 7: prerequisite repair surfaces

- New launch-evaluated repair card/banner in the main widget for post-completion regressions, reading the existing probed slices: config dir missing on disk, Nix not installed, required permission revoked. Actions: deep-link fix + "Restart setup" escape hatch. Blocking card only when the app is inoperable (resolved question 1); mid-session events never swap the window.
- Includes the pass over which permissions are load-bearing at runtime.

### Commit 8: move `onboarding_*` fields off `GlobalPreferences`

- Move `onboarding_mac_scanned_at`, `onboarding_login_decided`, `onboarding_last_build_at`, `onboarding_provisional_config_dir` from `shared_types/prefs.rs` into `OnboardingState`, with a one-shot migration in `load_observable` following the legacy-store precedent (`state/preferences.rs:73-105`, marker-key style).
- Update writers (`rebuild/finalize_apply.rs:40`, `commands/onboarding.rs`, `apply_ui_update` in `prefs.rs:236`) and frontend readers (`use-onboarding-flow.ts:30-32` move from `s.preferences` to `s.onboardingState`); regenerate bindings.
- This commit is the largest mechanical surface — keep it free of behavior changes so review is a rename-plus-migration diff.

Green when: phase 3 review gate — deleting the config dir after completion yields the repair card, not the wizard; `global-preferences.json` no longer carries onboarding fields after one launch; restart/reset still behaves.

## Ordering and independence

```text
C1 → C2 → C3 → C4          (phase 1, strictly ordered)
              ├── C5 → C6   (phase 2)
              └── C7, C8    (phase 3; C7 and C8 independent)
```

Phase 1 ships alone as the bug fix; 2 and 3 can be separate PRs.

## Verification notes

- Fresh-profile and completed-profile launches are the two fixtures every phase gate reuses; a completed profile is any app-data dir whose `global-preferences.json` has `onboardingLastBuildAt` set (phase 1–2) or whose `onboarding-state.json` has `completedAt` (post phase 3).
- The dev reset helper (`apps/native/src/lib/dev-onboarding-reset.ts`) must keep working across all phases — after phase 1 it needs to clear the latch too, or it becomes a no-op trap.
