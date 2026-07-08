# Tech Debt And Garbage Collection

Agent throughput creates drift unless the repo continuously pays down repeated
mistakes. This file tracks cleanup classes that should become small PRs, tests,
or docs updates.

## Current Debt Classes

- Historical docs with stale status or superseded architecture.
- Product Proof is powerful but stale/advisory; refresh work is separate from
  normal code changes.
- Storybook and Vitest can fail because of environment/browser revision drift;
  do not dismiss failures without diagnosis.
- Formatter churn can create large rebase conflicts when treefmt/rustfmt
  disagree.
- Git/DB/frontend mirrored state can drift and mislead review/save flows.
- Onboarding has volatile P1 issues; durable docs should describe failure
  classes, while Linear tracks current status.

## Garbage Collection Cadence

Weekly:

- Run `bun run check:agent-docs`.
- Review orphan/stale docs reported by the checker.
- Check whether newly repeated PR review comments should become docs or tests.
- Review Product Proof freshness if a PR or release wants to use it as evidence.

Monthly:

- Re-score [QUALITY_SCORE.md](../QUALITY_SCORE.md) for high-risk domains.
- Review ADRs for decisions that have been superseded.
- Promote stable meeting/Slack decisions into docs and move volatile snapshots
  back to source logs.
