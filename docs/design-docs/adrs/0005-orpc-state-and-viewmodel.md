# ADR 0005: oRPC, React Query Hooks, And Backend-Owned View State

Status: proposed for team review

## Context

Cursor rules and migration plans moved nixmac away from legacy Tauri `invoke()`
and scattered frontend state. PR review history shows frontend/backend validator
drift and duplicate client mirrors create real bugs.

## Decision

New Rust-to-TypeScript IPC uses oRPC. Fetchable async data uses TanStack Query
through the oRPC client in `apps/native/src/lib/orpc.ts` and hooks under
`apps/native/src/hooks/`. `packages/state` owns shared client/view state and
event-projected slices; it is not the current home for new server-state query
hooks. Backend-owned state reaches the UI through typed backend contracts and
sync modules; UI code should not invent new global server-state caches in
Zustand.

## Consequences

- Run `cd apps/native && bun run gen:orpc` after oRPC router changes.
- Do not hand-edit generated bindings.
- Legacy `invoke()` wrappers are migration targets, not the pattern for new
  work.
- Frontend validators must match backend validators and include regression
  tests when a mismatch has caused bugs.
