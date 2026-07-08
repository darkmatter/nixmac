# Copilot Agent Instructions

This repository uses [../AGENTS.md](../AGENTS.md), [../ARCHITECTURE.md](../ARCHITECTURE.md),
and [../docs](../docs) as the source of truth for agent guidance.

Before editing code:

1. Read [../AGENTS.md](../AGENTS.md).
2. Read [../ARCHITECTURE.md](../ARCHITECTURE.md).
3. Read [../docs/README.md](../docs/README.md).
4. Read the relevant product spec under [../docs/product-specs](../docs/product-specs).
5. Read [../docs/SECURITY.md](../docs/SECURITY.md) for path, credential, repo
   import, or provider changes.

Key defaults:

- Base branch: `main`.
- Package manager: Bun.
- App loop: `devenv up`.
- New Rust to TypeScript IPC: oRPC plus generated bindings.
- New fetchable async frontend data: Rust oRPC procedures, generated bindings,
  `apps/native/src/lib/orpc.ts`, and TanStack Query hooks under
  `apps/native/src/hooks/`.
- Use `packages/state` for shared client/view state, not new server-state
  caches.
- Product Proof / Computer Use E2E is stale and advisory until refreshed.

Linux/cloud agents cannot prove macOS desktop build behavior,
signing/notarization, Finder-launched PATH behavior, or macOS permissions.
