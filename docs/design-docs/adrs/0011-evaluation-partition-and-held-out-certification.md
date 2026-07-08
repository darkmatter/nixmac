# ADR 0011: Evaluation Partition And Held-Out Certification

Status: proposed for team review

## Context

The harness is meant to make agents write better nixmac code, not memorize prior
offline evaluation answers. Phase 1 mining read Slack threads, Granola meetings,
GitHub PRs/comments/review threads, and code history. That makes many valuable
sources training evidence, not clean evaluation material.

The team also has multiple proof lanes: unit tests, Storybook snapshots, AI eval
reports, Product Proof / Computer Use, real app dogfooding, and PR review
feedback. These lanes answer different questions and should not be mixed into a
single vague "tested" claim.

## Decision

Every source used by harness work must be partitioned before evaluation. This is
test-leakage control, not people-scoring:

- `training`: read, summarized, quoted, or distilled into docs/prompts.
- `calibration`: used to tune rubrics, thresholds, or examples, not final score.
- `held-out`: reserved for scoring and not used in docs, prompts, examples, or
  task-specific guidance.
- `inventory-only`: metadata was seen, but body/diff/comments/transcript were
  not parsed. It can become held-out only after certification.
- `excluded`: out of scope, already leaked into training, or explicitly
  disallowed.

Before a task becomes held-out, certify that its source body, diff, comments,
review threads, transcript, and title wording were not used in training docs or
prior evaluation artifacts. Build the task from the product/code situation, not
from review-comment wording.

Beads and `.beads` sources are excluded from harness docs/tests and held-out
candidates.

## Consequences

- Candidate tests derived from current docs, mined PRs, Slack, or Granola are
  training/calibration seeds only.
- Final scoring should prefer post-freeze merged PRs or certified
  inventory-only sources.
- If clean held-out supply is too small, scale the evaluation down or wait for
  new sources rather than silently reusing training material.
- Result reports must disclose skipped lanes and hard failures in denominators.
