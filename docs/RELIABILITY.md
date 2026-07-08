# Reliability

nixmac reliability means the app does not lose user work, does not confuse git
state, and does not leave the user stuck without a recovery path.

## Core Risks

- Git state and DB/view state drift.
- Review/save/rollback actions operating on stale assumptions.
- Onboarding state leaking into the gated evolve flow.
- `darwin-rebuild` or build checks failing without actionable recovery.
- SQLite lock contention in summarization or state updates.
- CI artifacts not representing what developers can actually open.
- Finder-launched app subprocesses missing Nix/Homebrew PATH.
- Merge queue, runner, lockfile, or provider failures being mistaken for app
  regressions.
- Base-template evals hiding real failures from complex user repos.

## Reliability Rules

- Treat git as the source of truth for diffs and clean/dirty transitions.
- Persist only state that has a reconciliation path.
- Make no-op, rejection, cancellation, and build failure visible to the user.
- Prefer idempotent retry behavior for build/apply/summarize flows.
- Avoid repeated sudo prompts; batch or explain privileged checks.
- Add tests around state machines and path-sensitive backend helpers.
- Serialize local SQLite writes unless a real concurrency requirement justifies
  pooling.
- For known imports, re-check the current live missing/untracked set immediately
  before applying a managed edit.
- Keep provider availability claims timestamped; hosted model aliases and
  provider routing can change under the same visible name.
- Treat no-output or flaky build failures as retriable until reproduced with
  enough evidence to classify them as code failures.

## Evidence Expectations

For reliability-sensitive changes, include at least one of:

- Unit test for the state transition or backend helper.
- Regression test for the reported failure.
- Manual reproduction and fix evidence.
- Clear explanation that an affected stale lane, such as Product Proof, was not
  run and why.

For eval or harness changes, include partition status for every source used:
training, calibration, held-out, inventory-only, or excluded.
