# Harness Engineering Execution Plan

Status: active

Owner: Farhan / agent-harness branch owner until team review assigns a maintainer.

Risks and rollback:

- Risk: docs overclaim measured agent-performance lift. Mitigation: keep measured
  results framed as provisional and record null confirmations explicitly.
- Risk: source-mining details feel like people-scoring instead of harness
  provenance. Mitigation: frame them as docs/evaluation hygiene and revise before
  merge if the team wants less process detail in-repo.
- Rollback path: revert the harness branch or remove the new `AGENTS.md`,
  `ARCHITECTURE.md`, `docs/design-docs/`, `docs/product-specs/`,
  `docs/references/`, and `check:agent-docs` wiring as a
  single docs-only change. No production systems depend on these files.

## Goal

Build a production-ready nixmac engineering harness equivalent in spirit to the
OpenAI harness engineering model: repository-local knowledge, plans, ADRs,
review-agent rubrics, application legibility, mechanical checks, and promoted
team decisions that help agents write good code.

## Non-Goals

- Do not run production deploys, release workflows, or remote Mac Product Proof
  without explicit instruction.
- Do not treat Product Proof as refreshed in this plan.
- Do not save external notes or post to Slack/GitHub/Linear.

## Phases

1. Establish routing docs and core rubrics.
2. Promote Slack, GitHub, Linear, Granola, and repo-history decisions.
3. Add missing application-legibility and runtime proof guidance.
4. Classify historical plans and add garbage-collection cadence.
5. Strengthen mechanical checks for links, orphan docs, required paths, and
   docs-drift source paths.
6. Run local verification and cross-model review.
7. Iterate until Codex and Claude review agree the artifact is production-ready.

## Phase Status

- Phase 1: complete. Root routing, docs map, quality, reliability, security,
  and review-agent rubrics are in place.
- Phase 2: complete. Slack thread replies, GitHub PR review-thread patterns,
  Linear issues, Granola meetings, cursor rules, and historical docs were
  promoted into durable docs.
- Phase 3: complete. Runtime boot, app-legibility, logs, Storybook, desktop
  tests, and Product Proof status are documented.
- Phase 4: complete. Historical docs are indexed and carry file-level status
  warnings.
- Phase 5: complete. `check-agent-docs` validates required files, markdown link
  targets, docs graph reachability, AGENTS routing links, selected repo-path
  references, and Danger docs-sensitive paths.
- Phase 6: in progress. Local docs checks pass; Claude review is being rerun as
  source mining is promoted into durable docs.
- Phase 7: in progress. Iterate until the current durable docs, checks, and
  evaluation plan have a zero-blocker review gate.

## Decision Log

- 2026-07-01: Root `AGENTS.md` should be committed as the agent routing file.
  Because `/AGENTS.md` was previously ignored by bd init, this needs PR-callout
  and team awareness before merge.
- 2026-07-01: Product Proof remains advisory until refreshed; runtime evidence
  should use smaller honest lanes unless explicitly asked to run Product Proof.
- 2026-07-01: Existing historical docs must be indexed with status instead of
  silently sitting under `docs/`.
- 2026-07-02: The primary harness evaluation produced a small positive point
  estimate, not broad proof. Future confirmatory evaluations must not count tasks
  whose failures seeded new guidance as clean primary evidence; report them
  separately or replace them with fresh tasks in the same category.
- 2026-07-03: The thin-harness confirmation ablation did not confirm the primary
  positive point estimate. Aggregate result: full harness +0.88/18, 90% CI
  [-0.81, 2.56], sign-test p=0.4531; judge variance was larger than the measured
  lift and the positive signal concentrated in one doc-covered task. Treat the
  current harness as useful operating context to live-test, not as statistically
  proven performance improvement.
- 2026-07-03: The next evaluation should include more doc-uncovered tasks,
  bundle-scoped blind IDs, neutral judge instructions, and a second judge or
  re-score sample when time permits.
- 2026-07-02: Current-base Rust verification needs the local `swift-build`
  blocker fixed before Rust-heavy synthetic tasks are treated as objectively
  verified rather than diff-judged.

## Verification

- `bun run check:agent-docs`
- `git diff --check`
- `node --check scripts/check-agent-docs.mjs`
- `bunx oxlint@1.63.0 dangerfile.ts scripts/check-agent-docs.mjs`
- 2026-07-01 review gate: `claude-review` reported zero blocking issues for the
  earlier harness-docs pass. This was a point-in-time gate and does not replace
  the later Phase 1 source-mining and durable-docs reviews.
- 2026-07-02 Phase 1 source package gate: promoted in
  `docs/references/source-log.md`; Claude review reported zero blocking issues after
  accepted fixes.
