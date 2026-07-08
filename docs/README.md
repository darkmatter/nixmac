# nixmac Docs

Repo-local durable docs for agents and reviewers.

## Entry Points

- [../AGENTS.md](../AGENTS.md) - agent operating guide.
- [../ARCHITECTURE.md](../ARCHITECTURE.md) - architecture and code boundaries.
- [FRONTEND.md](FRONTEND.md) - React, oRPC, Storybook, state, and UI ownership.
- [DESIGN.md](DESIGN.md) - app design principles and visual proof lanes.
- [PRODUCT_SENSE.md](PRODUCT_SENSE.md) - product/reviewer taste and team intent.
- [QUALITY_SCORE.md](QUALITY_SCORE.md) - quality rubric.
- [RELIABILITY.md](RELIABILITY.md) - reliability and verification expectations.
- [SECURITY.md](SECURITY.md) - security and user-config safety.
- [PLANS.md](PLANS.md) - planning, active work, and tech debt.

## Folders

- [design-docs/index.md](design-docs/index.md) - ADRs and core beliefs.
- [product-specs/index.md](product-specs/index.md) - durable product/domain specs.
- [exec-plans/active/harness-engineering.md](exec-plans/active/harness-engineering.md)
  - active harness plan.
- [exec-plans/completed/historical-index.md](exec-plans/completed/historical-index.md)
  - summarized historical plans.
- [exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) - tech debt.
- [generated/README.md](generated/README.md) - generated-doc ownership.
- [references/source-log.md](references/source-log.md) - source provenance.
- [references/source-partition.md](references/source-partition.md) - evaluation
  source partition.
- [references/github-app-server-contract.md](references/github-app-server-contract.md)
  - GitHub App/server contract.
- [references/review-agents/frontend-architect.md](references/review-agents/frontend-architect.md)
- [references/review-agents/reliability-engineer.md](references/review-agents/reliability-engineer.md)
- [references/review-agents/appsec-engineer.md](references/review-agents/appsec-engineer.md)
- [references/review-agents/product-engineer.md](references/review-agents/product-engineer.md)

## Freshness Contract

When code changes a documented invariant, update the relevant doc in the same
PR. When Slack, GitHub, Linear, Granola, or repo history becomes durable
guidance, cite the source in [references/source-log.md](references/source-log.md).

`bun run check:agent-docs` validates required docs, links, orphan docs, selected
repo-path references, and evaluation/backplay leakage.
