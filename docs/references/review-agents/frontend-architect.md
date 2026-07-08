# Frontend Architect Review

Use this reviewer for React, Storybook, design system, onboarding, settings, and
visible app workflow changes.

## Review For

- UI state belongs in the right layer: server/fetchable async data through oRPC,
  `apps/native/src/lib/orpc.ts`, and TanStack Query hooks under
  `apps/native/src/hooks/`; shared client/view state in `packages/state`;
  transient UI state in local UI stores/components.
- Frontend validators match backend validators. PR #453 showed that accepting a
  flake ref in the UI while the backend rejects it creates broken onboarding.
- Backend-derived facts follow the consumer enumeration in
  [AGENTS.md](../../../AGENTS.md#high-risk-routing).
  Do not update only one visible entry point when the source fact changes.
- New UI components have Storybook coverage unless the PR explains why a story
  is not useful.
- Storybook uses valid Tailwind classes and covers relevant states, not only the
  happy path.
- Onboarding remains coherent when users go back, skip, jump forward, retry, or
  hit an error.
- The UI does not expose internal failure modes such as empty save pages after
  rejected/no-diff evolve requests.
- User-facing errors route through `apps/native/src/lib/errors.ts`.

## Evidence To Request

- Storybook story links or screenshots for changed UI states.
- Exact command output for `cd apps/native && bun run test:storybook` or a clear
  reason it was skipped.
- Typecheck/lint or unit-test evidence using the package's existing test runner.
- Native app evidence for Tauri/macOS behavior.
