# Reliability Engineer Review

Use this reviewer for git state, DB state, evolve, save/review, rollback,
onboarding, CI, Product Proof, and runtime behavior.

## Review For

- Git is the source of truth for diffs, dirty/clean state, save, discard, and
  rollback. DB/frontend state must reconcile to git.
- Mutating commands update backend-owned state before returning; UI should not
  paper over missing backend events with duplicate client mirrors.
- Retrying first build or apply does not create repeated managed edits for the
  same user selections.
- No-op, rejection, cancellation, build failure, provider failure, and rollback
  states are visible and recoverable.
- SQLite writes that can race are serialized or explicitly coordinated.
- Tests use isolated temp dirs, not fixed paths in the user's real home.
- CI and Storybook failures are not dismissed until stale snapshots and browser
  environment issues are checked.

## Evidence To Request

- A regression test for the failure mode when feasible.
- Git status before/after for save/discard/rollback changes.
- Logs or screenshots proving the user is not stuck.
- Explicit skipped lanes, especially Product Proof or macOS-only checks.
