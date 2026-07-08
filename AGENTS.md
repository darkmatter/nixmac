# AGENTS.md

Repo-local operating guide for agents working in `darkmatter/nixmac`.

## Mission

nixmac is a native macOS app for evolving a user's nix-darwin repository through
an AI agent. It touches macOS state, Nix semantics, credentials, git history,
SQLite, and Tauri UI. Prefer evidence over guesses.

## Start Here

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing architecture, state,
   IPC, config, Nix edits, or the evolve agent.
2. Read [docs/FRONTEND.md](docs/FRONTEND.md) before touching React, oRPC hooks,
   `packages/state`, generated bindings, UI primitives, or Storybook.
3. Read the relevant product spec under [docs/product-specs](docs/product-specs/index.md).
4. Read [docs/SECURITY.md](docs/SECURITY.md) before touching filesystem
   boundaries, credentials, repo import, or provider auth.
5. Read [docs/RELIABILITY.md](docs/RELIABILITY.md) and
   [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) before reporting verification.
6. Read [docs/PLANS.md](docs/PLANS.md) for non-trivial work or when durable
   guidance changes.
7. Use [docs/design-docs](docs/design-docs/index.md) for ADRs and durable
   design decisions.

## Current Defaults

- Base branch: `main`.
- Package manager: Bun. Do not use npm or yarn.
- App loop: `devenv up`; it starts the process-compose stack and Tauri app from
  `nix/dev.nix`.
- New Rust/TypeScript IPC: oRPC under `apps/native/src-tauri/src/orpc/`, then
  `cd apps/native && bun run gen:orpc`.
- New fetchable async frontend data: generated bindings, `apps/native/src/lib/orpc.ts`,
  and React Query hooks under `apps/native/src/hooks/`.
- Shared client/view projections: `packages/state`. Do not put new server-state
  caches there.
- User-facing TypeScript diagnostics: `apps/native/src/lib/errors.ts`.
- Environment/profile access: `apps/native/src/lib/env.ts`; direct
  `import.meta.env.DEV` is the narrow exception.
- shadcn-generated UI under `packages/ui/src/components/ui` is not edited by
  hand.

## Context Rules

When gathering context from Slack, GitHub, Linear, Granola, or repo history,
read only. Do not post comments, resolve threads, close issues, dispatch
workflows, trigger release jobs, touch production services, or run Product
Proof/Computer Use E2E unless the user explicitly asks.

For Slack, read the parent message and thread replies before citing or promoting
anything. For GitHub PRs, inspect whether review threads are resolved and
outdated before treating them as current.

## High-Risk Routing

Stop and locate the owner before editing when a change touches:

- user config or managed Nix edits;
- filesystem containment, repo import, clone materialization, or symlinks;
- credentials, provider auth, Sentry/feedback DSNs, or redaction;
- backend-derived UI state, generated bindings, or event-projected state;
- save/review/discard/rollback git state;
- release, signing, notarization, auto-update, or production systems.

Rules of thumb:

- Re-read live user files immediately before applying managed edits.
- Preserve comments, attrset shape, option family, host/platform boundary, and
  sibling order unless the requested behavior requires a broader rewrite.
- Validate path/security constraints at the boundary that reads, copies, writes,
  authenticates, or executes, not only in the parser.
- Backend facts flow through Rust/oRPC/generated bindings/hooks. UI mirrors are
  review debt unless there is a clear client-owned state reason.
- Split the work if it crosses more than two major surfaces without one obvious
  owner.

## Verification

Use the smallest honest verification set for the change:

- `bun run check`
- `bun run knip`
- `cd apps/native && bun run gen:orpc` after oRPC router changes
- `cd apps/native && bun run test:unit`
- `cd apps/native && bun run test:storybook`
- `cd apps/native && bun run desktop:test`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml`

Storybook is useful frontend evidence, but it does not prove native macOS
behavior, signing, permissions, Finder PATH behavior, or rebuild/apply flows.
Product Proof / Computer Use E2E under `tests/e2e/computer-use/` is historical
and stale until refreshed.

Test plans must name the command or journey, what passed, what failed or was
skipped, and why skipped lanes were unavailable.

## Review Rules

PRs should have a Linear ID unless intentionally marked `#no-linear`.
Descriptions need a real test plan. If behavior-sensitive code changes, update
repo-local docs or explain why no docs update is needed.

Use the requested cross-model review tool when asked. Record which tool ran and
what blockers it found.
