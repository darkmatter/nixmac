# ADR 0004: Git Is Source Of Truth For Review, Save, And Rollback

Status: proposed for team review

## Context

Slack thread `1781122680.685399` reported the app showing the Review page while
`git status` was clean, then Discard creating a diff. Historical plans also
identify dangling changesets and DB/frontend mirrors as sources of stale review
state.

## Decision

Git is the source of truth for user-visible diffs, dirty/clean transitions,
save, discard, rollback, and History restore. SQLite and frontend view state may
cache or summarize git-derived facts, but they must reconcile to git before
driving review/save UI or destructive actions.

## Consequences

- Review/save/rollback code must include tests or manual evidence around git
  state transitions.
- No-op and rejected evolve runs must stay visible as no-op/rejected states, not
  empty save pages.
- Dangling or stale DB rows should be reconciled or ignored rather than treated
  as live review state.
