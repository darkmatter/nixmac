# Frontend

Use this when touching React, oRPC, Storybook, UI state, generated bindings, or
shared UI primitives.

## Data Flow

- Rust oRPC procedures live under `apps/native/src-tauri/src/orpc/`.
- Register procedures in `apps/native/src-tauri/src/orpc/mod.rs`.
- Regenerate bindings with `cd apps/native && bun run gen:orpc`.
- Do not hand-edit `apps/native/src/ipc/orpc-bindings.ts`.
- Fetch through `apps/native/src/lib/orpc.ts` and hooks under
  `apps/native/src/hooks/`.

`packages/state` is for shared client/view projections and event-projected
state, not new fetchable async backend data. Existing slices under
`packages/state/src/onboarding`, `packages/state/src/ui`, and
`packages/state/src/viewmodel` are the local pattern.

## UI Ownership

- Generated shadcn source lives under `packages/ui/src/components/ui/` and is
  not edited directly.
- Hand-authored shared components belong under `packages/ui/src/components/`.
- App-specific UI belongs under `apps/native/src/components/`.
- App-local generated compatibility primitives under
  `apps/native/src/components/ui/` should not be casually edited.
- User-facing frontend diagnostics live in `apps/native/src/lib/errors.ts`.

## Storybook

Storybook is the primary frontend proof lane. Use it for UI state matrices,
empty/loading/error/skipped/retry/success states, and visual review. Treat
snapshot diffs as "visual changed" evidence, not automatic regression proof.

Storybook does not prove native app behavior, signing, permissions,
Finder-launched PATH behavior, rebuild/apply, or filesystem effects.

## Provider UI

Provider/model UI must match backend provider behavior. CLI-backed providers
such as `claude`, `codex`, and `opencode` may have valid empty model defaults;
OpenAI-compatible and Ollama selections must not show empty model placeholders
as valid choices.
