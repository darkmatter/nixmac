# ARCHITECTURE.md

Core invariants and code-shape rules for nixmac.

## System Boundaries

- Rust owns filesystem, git, Nix, credentials, scanner, build/apply, and other
  host facts.
- React owns presentation and local interaction state.
- Fetchable backend facts use Rust oRPC procedures, generated bindings,
  `apps/native/src/lib/orpc.ts`, and React Query hooks.
- `packages/state` owns shared client/view projections and event-projected
  slices. It is not the default home for new server-state query caches.
- Generated bindings are regenerated, not hand-edited.

## Rust To UI Data Flow

1. Add or extend a Rust oRPC procedure under
   `apps/native/src-tauri/src/orpc/`.
2. Register it in `build_router()` under
   `apps/native/src-tauri/src/orpc/mod.rs`.
3. Run `cd apps/native && bun run gen:orpc`.
4. Consume through `apps/native/src/lib/orpc.ts` and a hook under
   `apps/native/src/hooks/`.

Legacy `invoke()` wrappers are migration targets, not the pattern for new work.

## State Ownership

- Backend-owned runtime state reaches the UI through typed contracts and sync
  modules.
- Event-pushed backend state stays on the existing event/sync path.
- Client-only interaction state stays local or in the existing UI store.
- Frontend validators must match backend validators and include regression
  coverage when drift has caused bugs.
- Git state is authoritative for review/save/discard/rollback. DB or frontend
  state must reconcile to git before presentation.

## Nix And Filesystem Safety

Managed Nix edits should be semantic, surgical, and scoped to user intent.

- Use existing managed-edit/path-safe helpers before raw text replacement.
- Preserve comments, attrset shape, option family, host/platform boundaries, and
  sibling ordering.
- Do not flatten parent attrsets to add one leaf.
- Keep repo root, selected config/flake root, and destination directory
  distinct.
- Reject absolute paths, parent/current/empty components, platform prefixes, and
  symlink escapes before materialization.
- Template fixes are new-repo fixes only. Existing users need migration,
  remediation, or compatibility.

## Rust Conventions

- Declare top-level modules in `apps/native/src-tauri/src/main.rs`; declare
  leaves in the parent `mod.rs`.
- Unused Rust items are denied by workspace lints.
- Public serde structs crossing Rust/TypeScript should use
  `#[serde(rename_all = "camelCase")]`.
- Tests mutating environment variables should use
  `crate::test_support::e2e_env_lock()` and `EnvVarRestore::capture(keys)`.
- Heavy brew, nix, git, or filesystem work should use the repo's blocking-task
  pattern instead of running directly on async command tasks.
- Tests needing config repos should use temp directories and explicit config
  roots, not `~/.darwin`.

## Config Tiers

Use exactly one tier:

- Build profile: `apps/native/env.development.json`,
  `apps/native/env.release.json`, or `apps/native/env.e2e.json`, read through
  `apps/native/src/lib/env.ts`.
- User preference: Tauri app data persistence via `global-preferences.json`.
- Project setting: `<config_dir>/.nixmac/settings.json`.

Do not make app-local `.nixmac/settings.json` look like desired user config
drift.

## Hosted Agent Constraint

Linux/cloud agents can run many frontend and Rust unit lanes, but they cannot
prove macOS desktop build behavior, signing/notarization, Finder-launched PATH,
or macOS permissions. Do not claim macOS app verification from Linux-only runs.
